// balance-suggestions.mjs — draft balance changes for every starter-pool card that
// falls OUTSIDE its rarity-adjusted cost-budget window (both over and under). Each
// stat/keyword edit is RE-SCORED through computeCardPower to confirm it lands back
// inside the window; the cost lever is derived from the budget slope.
//
// computeSuggestions() is exported (used by balance-compare.mjs to apply the SAME
// edits); running this file directly writes docs/balance-suggestions.md.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { computeCardPower, assessLoopRisk, LEGAL_MAX_COPIES } from './dist/balance/index.js';
import { loadBalanceData, indexFromRaw, loadBudgetModel, toStatic } from './balance-data.mjs';
import { getDeck } from './deck-loader.mjs';
import { primaryResourceKey, classifyCandidate, rankOf, selectCampaignEdits } from './balance-gates.mjs';

const FACTIONS = ['Onyx', 'Radiant', 'Sapphire', 'Verdant'];
const round = (x, n = 1) => {
  const p = 10 ** n;
  return Math.round(x * p) / p;
};
const totalCost = (sc) => sc.cost.mana + sc.cost.energy + sc.cost.flexible;
const statline = (s) => (s ? `${s.atk}/${s.hp}/${s.arm}` : '—');
const TRAIT_NAME = { first_strike: 'First Strike' };
const traitName = (t) => TRAIT_NAME[t] ?? t.charAt(0).toUpperCase() + t.slice(1);
// Combat-viability floor for a PROPOSED stat line — a stat cut must never drop a
// body below these, or it craters past a combat breakpoint (a 0-ATK body can't
// trade; hp+arm below 2 dies to any ping). The §11f budget-fit ignored this and
// printed 0/3 and 2/1 bodies. Beyond a gentle trim, prefer cost (preserve the body).
// §Y2 (round-10 auditor): exported so balance-apply-edits.mjs's explicit-
// proposals path (classifyProposals) can validate a composed stat delta
// against the SAME floors this generated-suggestions path already enforces,
// instead of inventing a second set of numbers that could drift from these.
export const MIN_ATK = 1;
export const MIN_BULK = 2; // hp + arm
// §Z1 (round-11 auditor): searchStatEdit checked ARM/ATK/bulk but never HP
// itself — a 1/1/2 Defender got a −1 HP suggestion (1/0/2), which passed
// every existing floor (ARM still 2, ATK unchanged, bulk still 2) and was
// AUTO_SAFE/written. Mirrors sim-runner.mjs's applyCardStatOverride convention
// ("a nerfed body is never born dead" — HP floored at 1).
export const MIN_HP = 1;
const STAT_TRIM_MAX = 2; // max total stat points to trim before deferring to the cost lever
const withStats = (sc, da, dh, dr) => ({ ...sc, stats: { atk: sc.stats.atk + da, hp: sc.stats.hp + dh, arm: sc.stats.arm + dr } });
// §B3: the delta lands on the PRIMARY (largest) cost component — the exact
// rule applyCardCostOverride uses at sim time (sim-runner.mjs) — so the
// `resource:` axis named in the report can never drift from the real edit.
const withCostDelta = (sc, delta) => {
  const c = { ...sc.cost };
  const key = primaryResourceKey(c);
  c[key] = Math.max(0, c[key] + delta);
  return { ...sc, cost: c };
};

/** Suggestions for the starter pool.
 * `opts.mode`: 'author' (informational — every outlier gets a full arithmetic
 * suggestion, nothing withheld; no sims for new cards) or 'campaign' (default
 * — full §B3 gating, at most one AUTO_SAFE `autoEdit`, the rest ranked as
 * `candidates`). `opts.marginals`: { [faction]: winPct } — REQUIRED for any
 * AUTO_SAFE classification (fail closed: no data, no auto edits).
 * `opts.playRates`: { [cardId]: perGameRate } for §B4 ranking (defaults to 1).
 * `opts.pool`: a raw SimCard array to score INSTEAD of the committed baseline
 * (campaign: fits a patched pool so passes iterate; author: the maintainer's
 * own candidate set). `opts.card`: a single StaticCard-shaped object — scored
 * IN ADDITION to the pool even if it belongs to no deck (author mode only;
 * §14 "check a new card" workflow — deck membership is never required to
 * score a card).
 * Author mode's scope is every C/S/E card in the pool (opts.pool ?? the full
 * committed card list — not just the 4 starter decks) plus opts.card, so a
 * brand-new, un-decked card can be scored and given a cost suggestion without
 * a sim. Heroes/transforms/resources are OUT of that scoring surface (they
 * have no rarity-adjusted cost budget to be judged against) — but H/T ARE
 * included as loop-graph sources, same as campaign mode. Campaign mode's
 * scope remains the 4 starter decks (copies/play-rate ranking needs real
 * deck membership).
 * Back-compat: a bare array (`computeSuggestions(rawCards)`) is still treated
 * as the legacy `rawOverride` — a full SimCard array to fit a PATCHED pool
 * instead of the baseline (used by balance-apply-edits.mjs / balance-lab to
 * iterate the fit to convergence); existing callers are unaffected. */
/** §Q4 (round-4 auditor) — real copy count of `id` in its starter-deck
 * faction's main deck (0 if the card isn't decked at all). Exported so
 * balance-apply-edits.mjs's classifyProposals can derive the SAME copies
 * value it uses for §B4 exposure ranking, instead of a hardcoded default. */
export function copiesInStarterDeck(id) {
  for (const f of FACTIONS) {
    const deck = getDeck(f);
    if (!deck.mainDeckDefIds.includes(id)) continue;
    let n = 0;
    for (const x of deck.mainDeckDefIds) if (x === id) n += 1;
    return n;
  }
  return 0;
}

export function computeSuggestions(rawOverrideOrOpts) {
  const rawOverride = Array.isArray(rawOverrideOrOpts) ? rawOverrideOrOpts : undefined;
  const opts = Array.isArray(rawOverrideOrOpts) || !rawOverrideOrOpts ? {} : rawOverrideOrOpts;
  const mode = opts.mode === 'author' ? 'author' : 'campaign';
  const poolOverride = rawOverride || opts.pool;
  const { index, raw } = poolOverride
    ? { index: indexFromRaw(poolOverride).index, raw: poolOverride }
    : loadBalanceData();
  const effectText = new Map();
  for (const c of raw) {
    const t = (c.abilities || []).map((a) => a.effect).filter(Boolean).join(' / ');
    if (t) effectText.set(c.id, t);
  }
  const cards = [];
  const rowFor = (sc, faction, copies) => {
    const bd = computeCardPower(sc);
    return { sc, id: sc.id, faction, copies, cost: totalCost(sc), rarity: sc.rarity, cardType: sc.cardType, power: round(bd.power, 2), statBase: bd.statBase, abilityValue: bd.abilityValue, powerLow: bd.powerLow, powerHigh: bd.powerHigh, flags: bd.flags };
  };
  if (mode === 'author') {
    const scope = new Map(index); // id -> StaticCard, every card in the pool (no deck filter)
    if (opts.card) {
      // Fail closed on an id collision: opts.card is for scoring a BRAND-NEW,
      // un-decked card (§14 "check a new card" workflow). A colliding id
      // would silently overwrite an existing pool card's row with the
      // caller's version — if the intent is to score a MODIFIED existing
      // card, that's what proposals/campaign mode are for, not opts.card.
      // §R13-4 (round-13 auditor): check against EVERY raw card id, not just
      // the C/S/E `index` — a new spell reusing a HERO/transform/resource id
      // (e.g. 133) previously slipped past because index omits H/T/R.
      if (raw.some((c) => c.id === opts.card.id)) {
        throw new Error(
          `computeSuggestions: opts.card.id '${opts.card.id}' collides with an existing pool card — a new card must have a new id; to score a modified existing card use proposals/campaign mode instead`,
        );
      }
      scope.set(opts.card.id, opts.card);
    }
    for (const sc of scope.values()) cards.push(rowFor(sc, sc.alignment?.[0] || 'Unaligned', 1));
  } else {
    for (const f of FACTIONS) {
      const deck = getDeck(f);
      for (const id of new Set(deck.mainDeckDefIds)) {
        const sc = index.get(id);
        if (!sc) continue;
        cards.push(rowFor(sc, f, copiesInStarterDeck(id)));
      }
    }
  }
  // Characters and spells/equipment are different populations (steep stat-driven
  // power-for-cost vs gentle effect-driven power-for-cost) -- one shared line is a
  // bad fit for either. §B1: the line itself is a frozen, declared constant, not a
  // fit on THIS pool. See loadBudgetModel's doc comment.
  const model = loadBudgetModel();
  const { expectedFor, tolFor } = model;
  for (const c of cards) {
    const exp = expectedFor(c.cost, c.rarity, c.cardType);
    const tol = tolFor(c.cardType);
    c.expected = round(exp, 1);
    c.lo = round(exp - tol, 1);
    c.hi = round(exp + tol, 1);
    c.status = c.power > exp + tol ? 'over' : c.power < exp - tol ? 'under' : 'within';
    c.edge = c.status === 'over' ? round(c.power - c.hi, 1) : c.status === 'under' ? round(c.lo - c.power, 1) : 0;
  }

  const searchStatEdit = (c) => {
    const sc = c.sc;
    if (sc.cardType !== 'C' || !sc.stats) return null; // stats only score on Characters
    const dir = c.status === 'over' ? -1 : 1;
    const best = [];
    for (let a = 0; a <= 4; a++)
      for (let h = 0; h <= 4; h++)
        for (const r of [0, 1]) {
          if (a === 0 && h === 0 && r === 0) continue;
          const da = a * dir, dh = h * dir, dr = r * dir;
          const ns = { atk: sc.stats.atk + da, hp: sc.stats.hp + dh, arm: sc.stats.arm + dr };
          // never propose a sub-viable body (unless the card already started below
          // the floor, in which case don't push it further down)
          if (ns.arm < 0) continue;
          if (ns.atk < Math.min(MIN_ATK, sc.stats.atk)) continue;
          if (ns.hp + ns.arm < Math.min(MIN_BULK, sc.stats.hp + sc.stats.arm)) continue;
          if (ns.hp < Math.min(MIN_HP, sc.stats.hp)) continue;
          const p = computeCardPower(withStats(sc, da, dh, dr)).power;
          if (p >= c.lo && p <= c.hi) best.push({ da, dh, dr, ns, p, mag: a + h + 1.3 * r, touched: (a ? 1 : 0) + (h ? 1 : 0) + (r ? 1 : 0) });
        }
    if (!best.length) return null;
    best.sort((x, y) => x.mag - y.mag || x.touched - y.touched);
    const b = best[0];
    const parts = [];
    if (b.da) parts.push(`${b.da > 0 ? '+' : ''}${b.da} ATK`);
    if (b.dh) parts.push(`${b.dh > 0 ? '+' : ''}${b.dh} HP`);
    if (b.dr) parts.push(`${b.dr > 0 ? '+' : ''}${b.dr} ARM`);
    return { da: b.da, dh: b.dh, dr: b.dr, mag: b.mag, desc: parts.join(', '), from: statline(sc.stats), to: statline(b.ns), newPower: round(b.p, 1) };
  };
  const searchKeywordEdit = (c) => {
    const sc = c.sc;
    if (sc.cardType !== 'C') return null;
    const mid = (c.lo + c.hi) / 2;
    const opts = [];
    if (c.status === 'over') {
      for (const t of sc.traits) {
        const p = computeCardPower({ ...sc, traits: sc.traits.filter((x) => x !== t) }).power;
        if (p >= c.lo && p <= c.hi) opts.push({ desc: `remove ${traitName(t)}`, p });
      }
    } else if (sc.stats) {
      const add = [];
      if (sc.stats.hp >= 1) add.push('defender');
      if (sc.stats.atk >= 1) add.push('flying', 'first_strike');
      for (const t of add) {
        if (sc.traits.includes(t)) continue;
        const p = computeCardPower({ ...sc, traits: [...sc.traits, t] }).power;
        if (p >= c.lo && p <= c.hi) opts.push({ desc: `add ${traitName(t)}`, p });
      }
    }
    opts.sort((x, y) => Math.abs(x.p - mid) - Math.abs(y.p - mid));
    return opts[0] ? { desc: opts[0].desc, newPower: round(opts[0].p, 1) } : null;
  };

  const over = cards.filter((c) => c.status === 'over').sort((a, b) => b.edge - a.edge);
  const under = cards.filter((c) => c.status === 'under').sort((a, b) => b.edge - a.edge);
  // Per-outlier: the verified edits + the PRIMARY change applied for an "after" view.
  for (const c of [...over, ...under]) {
    c.statEdit = searchStatEdit(c);
    c.kwEdit = searchKeywordEdit(c);
    c.abilityShare = c.power > 0 ? c.abilityValue / c.power : 0;
    const exp = expectedFor(c.cost, c.rarity, c.cardType);
    const tol = tolFor(c.cardType);
    const slope = model[c.cardType === 'C' ? 'characters' : 'spellsEquip'].slope;
    c.resource = primaryResourceKey(c.sc.cost); // §B3: name the axis the cost lever lands on
    if (c.status === 'over') {
      c.costK = Math.max(1, Math.ceil((c.power - (exp + tol)) / slope));
      c.costAfter = c.cost + c.costK;
      // Pick the FUNCTION-PRESERVING lever. A small viable stat trim is the primary
      // edit only for an over-STATTED vanilla body; otherwise raise cost (keeps the
      // body, slows it). Never trim an ability-driven card's stats (its power isn't
      // the body) and never below viability (searchStatEdit already enforces that).
      const cleanTrim = c.statEdit && c.abilityShare < 0.5 && c.statEdit.mag <= STAT_TRIM_MAX;
      // An ability-driven card's overage lives in its EFFECT, not its stats or its
      // cost -- a cost raise doesn't shrink an overpowered ability, it just delays
      // the same effect. Don't pretend a numeric lever fixes it: leave the card
      // unedited and flag it for a human to rewrite the ability itself.
      c.after = c.abilityShare >= 0.5
        ? { static: c.sc, totalCost: c.cost, lever: 'ability (manual review — not mechanically edited)' }
        : cleanTrim
          ? { static: withStats(c.sc, c.statEdit.da, c.statEdit.dh, c.statEdit.dr), totalCost: c.cost, lever: `stats ${c.statEdit.desc}` }
          : { static: withCostDelta(c.sc, c.costK), totalCost: c.costAfter, lever: `cost +${c.costK}` };
    } else {
      c.costK = Math.max(1, Math.ceil((exp - tol - c.power) / slope));
      c.costAfter = Math.max(0, c.cost - c.costK);
      c.after = { static: withCostDelta(c.sc, c.costAfter - c.cost), totalCost: c.costAfter, lever: c.costAfter < c.cost ? `cost −${c.cost - c.costAfter}` : '(min cost)' };
    }
    // §R12-2b (round-12 re-review, Kimi K3): expose statK on the generated path
    // too — the classifier's `statK > 1` dose gate was dead code here because
    // computeSuggestions never set it, so a mag-2 stat trim (STAT_TRIM_MAX = 2)
    // was caught only by the incidental costK coupling, not the dose gate
    // itself. Sum of absolute per-stat deltas between the chosen lever's
    // composed stats and the current stats — identical semantics to
    // classifyProposals' statK (each touched stat is one dose).
    c.statK =
      c.after.static.stats && c.sc.stats
        ? Math.abs(c.after.static.stats.hp - c.sc.stats.hp) +
          Math.abs(c.after.static.stats.atk - c.sc.stats.atk) +
          Math.abs(c.after.static.stats.arm - c.sc.stats.arm)
        : 0;
  }

  // §S4/B2/B3 — loop risk (CURRENT and PROPOSED) + gate classification. §Z2
  // (round-11 auditor): this must run over EVERY playable card in the
  // supplied pool (opts.pool, or the full committed card file when no
  // override is given) — not just the starter-deck-scoped `cards` rows —
  // so an off-starter reducer/copier still counts toward the acquisition
  // graph. `index` already covers that full pool unconditionally (built
  // straight from `raw` above); campaign candidate SELECTION stays
  // starter-deck-scoped via `cards`/`outliers` below.
  // §H3-2 (batch-C): heroes (H) and their transforms (T) were entirely
  // absent from `index` (indexFromRaw only populates C/S/E) — a hero's own
  // free-acquisition ability (e.g. a transform's unconditional
  // return_from_discard->battlefield) or a deck-wide cost-reduction aura
  // (e.g. a hero's equipment discount) never entered the acquisition graph
  // at all, so neither could ever count as an edge/reducer SOURCE. They're
  // always in play for their faction (a hero/transform is never cast, never
  // re-acquired), so they only need to act as SOURCES here — nothing else
  // targets them, and that's fine (heroes need not be classifiable targets).
  const heroesAndTransforms = raw.filter((c) => c.cardType === 'H' || c.cardType === 'T').map(toStatic);
  // R12-3: the authored card (opts.card, author mode only) is scored above but
  // was never added to the loop-analysis pool built here — it defaulted to
  // 'none' loop risk even when its own ability makes it a self-loop (e.g. an
  // on_cast copy_card whose filter matches itself). It must be visible to the
  // acquisition/loop graph as both a candidate and a potential source, exactly
  // like every other C/S/E card. Campaign mode never sets opts.card, so this
  // is a no-op there.
  const authoredCard = mode === 'author' ? opts.card : undefined;
  const pool = [...index.values(), ...heroesAndTransforms, ...(authoredCard ? [authoredCard] : [])];
  // §V4(a): reducer multiplicity — actual starter-deck copy count where the
  // card IS decked (evidence), LEGAL_MAX_COPIES where it isn't (no evidence
  // -> conservative), never a blanket max that would over-flag broadly. A
  // hero/transform can only ever have exactly ONE in-play instance (never
  // decked, never copied) — defaulting it to LEGAL_MAX_COPIES like an
  // un-decked non-hero card would overstate its reducer's stacking 3x. The
  // authored card has no deck membership at all (that's the point of
  // opts.card) — §R13-1 (round-13 auditor): pin an authored C/S/E card at
  // LEGAL_MAX_COPIES UNCONDITIONALLY, ignoring any caller-supplied `copies`.
  // The R12-3b fix used `copies ?? LEGAL_MAX_COPIES`, which still TRUSTED a
  // caller value — copies:1 gave 'possible', copies:0/-1 gave 'none', reviving
  // the R12-3 soft-risk bypass with no validation. A conservative loop-risk
  // assessment must assume the worst legal stacking (LEGAL_MAX_COPIES) regardless
  // of the author's stated intent to run fewer; the card's own reducer must never
  // be under-stacked. (A Legendary's true legal max is 1, so LEGAL_MAX_COPIES=3
  // over-stacks it — the SAFE over-flag direction, and identical to the
  // pre-existing convention for an un-decked Legendary, copiesInStarterDeck→0→
  // LEGAL_MAX_COPIES. An authored H/T is already pinned at 1 by the H/T branch
  // above, before this line — a hero/transform can only ever be 1 in play.)
  const copiesOf = new Map(
    pool.map((sc) => {
      if (sc.cardType === 'H' || sc.cardType === 'T') return [sc.id, 1];
      if (authoredCard && sc.id === authoredCard.id) return [sc.id, LEGAL_MAX_COPIES];
      const n = copiesInStarterDeck(sc.id);
      return [sc.id, n > 0 ? n : LEGAL_MAX_COPIES];
    }),
  );
  const riskAtCurrent = assessLoopRisk(pool, copiesOf);
  const outliers = [...over, ...under];
  for (const c of outliers) {
    c.loopRisk = riskAtCurrent.get(c.id) ?? 'none';
    const proposedPool = pool.map((sc) => (sc.id === c.id ? c.after.static : sc));
    c.proposedLoopRisk = assessLoopRisk(proposedPool, copiesOf).get(c.id) ?? 'none';
    // author mode is informational only — no gate classification, no faction
    // gates, no simulation directive; a plain risk NOTE (not an imperative) is
    // the only thing it adds beyond the raw loop-risk level above.
    if (mode === 'campaign') {
      const gate = classifyCandidate(c, opts);
      c.classification = gate.classification;
      c.gateReason = gate.reason;
      c.rank = round(rankOf(c, opts), 2);
    } else {
      c.loopRiskNote = c.proposedLoopRisk === 'none' ? 'no loop risk at this cost' : `loop risk at this cost: ${c.proposedLoopRisk}`;
    }
  }

  // §B3/B4 — campaign mode: at most ONE AUTO_SAFE autoEdit (the top-ranked
  // one); everything else — including AUTO_SAFE cards that lost the ranking —
  // is a ranked candidate, each carrying its classification and gateReason
  // ("what unlocks it"). author mode withholds nothing and never auto-applies.
  let autoEdit = null;
  let candidates = null;
  if (mode === 'campaign') {
    ({ autoEdit, candidates } = selectCampaignEdits(outliers, opts));
  }

  return { model, cards, over, under, effectText, mode, autoEdit, candidates };
}

// ── Markdown ─────────────────────────────────────────────────────────────────
function buildMarkdown({ model, over, under, cards, effectText, mode, autoEdit, candidates }) {
  const tolFor = (c) => model.tolFor(c.cardType);
  const expFor = (c, cost) => model.expectedFor(cost, c.rarity, c.cardType);
  const costLeverText = (c) => {
    const tol = tolFor(c);
    if (c.status === 'over') {
      const ne = expFor(c, c.costAfter);
      return `raise cost ${c.cost}→${c.costAfter} (+${c.costK}) → window [${round(ne - tol, 1)}, ${round(ne + tol, 1)}]`;
    }
    if (c.costAfter < c.cost) {
      const ne = expFor(c, c.costAfter);
      return `lower cost ${c.cost}→${c.costAfter} (−${c.cost - c.costAfter}) → window [${round(ne - tol, 1)}, ${round(ne + tol, 1)}]`;
    }
    return 'already at minimum cost — buff the card instead';
  };
  const suggestionLines = (c) => {
    const lines = [];
    const abilityEdited = c.after.lever.startsWith('ability');
    if (c.statEdit) lines.push(`  - **Stats:** ${c.statEdit.desc} (${c.statEdit.from} → ${c.statEdit.to}) → power ${c.statEdit.newPower} ✓`);
    if (c.kwEdit) lines.push(`  - **Keyword:** ${c.kwEdit.desc} → power ${c.kwEdit.newPower} ✓`);
    if (c.sc.cardType !== 'C' || c.abilityShare >= 0.5) {
      const fx = effectText.get(c.id);
      const verb = c.status === 'over' ? 'scale down / add a cooldown / raise its activation cost' : 'scale up / lower its activation cost';
      const flag = abilityEdited ? ' — **chosen lever: this card was left unedited, needs a human ability rewrite**' : '';
      lines.push(`  - **Ability** (${round(c.abilityValue, 1)} of ${round(c.power, 1)} power): ${verb}${flag}${fx ? ` — "${fx.slice(0, 120)}${fx.length > 120 ? '…' : ''}"` : ''}`);
    }
    if (!abilityEdited) lines.push(`  - **Cost:** ${costLeverText(c)}`);
    return lines.join('\n');
  };
  const entry = (c) => {
    const sign = c.status === 'over' ? `+${c.edge} over` : `−${c.edge} under`;
    const role = c.sc.cardType === 'C' ? statline(c.sc.stats) : c.sc.cardType === 'E' ? 'equipment' : 'spell';
    const tr = c.sc.cardType === 'C' && c.sc.traits.length ? ` [${c.sc.traits.map(traitName).join(', ')}]` : '';
    const gateBadge = ` — **[${c.classification}]**${c === autoEdit ? ' ← chosen autoEdit' : ''}`;
    const head = `- **${c.sc.name}** — ${c.rarity}, cost ${c.cost}, ${role}${tr}  ·  power **${round(c.power, 1)}** vs **[${c.lo}, ${c.hi}]** (**${sign}**)${gateBadge}`;
    return `${head}\n${suggestionLines(c)}\n  - **Gate:** ${c.gateReason}`;
  };
  const byFaction = (list) => FACTIONS.map((f) => {
    const sub = list.filter((c) => c.faction === f);
    return sub.length ? `\n#### ${f}\n${sub.map(entry).join('\n')}` : '';
  }).join('\n');
  const gateSummaryLine = () => {
    const outliers = [...over, ...under];
    const counts = { AUTO_SAFE: 0, SIM_REQUIRED: 0, HUMAN_REWRITE: 0, BLOCKED: 0 };
    for (const c of outliers) counts[c.classification] = (counts[c.classification] || 0) + 1;
    return `**Campaign gate summary:** AUTO_SAFE ${counts.AUTO_SAFE} · SIM_REQUIRED ${counts.SIM_REQUIRED} · HUMAN_REWRITE ${counts.HUMAN_REWRITE} · BLOCKED ${counts.BLOCKED} · autoEdit: ${autoEdit ? `${autoEdit.sc.name} (rank ${autoEdit.rank})` : 'none'} · ${candidates ? candidates.length : 0} candidates remain.`;
  };

  return `# Starter-Pool Balance Suggestions

_Generated by \`balance-suggestions.mjs\` from the first-principles card-power score against the
rarity-adjusted cost budget. **Every stat/keyword edit below is re-scored through the formula** to
confirm it lands inside the window; the cost lever is derived from the budget slope. The budget line
is a **frozen, declared constant** (\`sim-data/balance-budget.v1.json\`, schema version ${model.version})
— it does not move when the pool does; recalibration is a deliberate, versioned, human-triggered step._

> **Read this first.** The score is **raw power, not win-rate.** Situational value — control/counters,
> recursion, ramp, card advantage — is systematically under-rated (the documented Verdant blind spot).
> So for the **under-budget** list (almost all spells), treat the flag as _"verify this is actually
> weak"_ rather than an automatic buff — many are fine and simply score low; lowering cost is the
> gentlest lever if you do act. For the **over-budget** list the **primary** edit is now chosen to
> _preserve the card's function_: a small viable stat trim only for an over-statted vanilla body,
> otherwise a **cost raise** (keeps the body, slows it) — never a stat cut on an ability-driven card
> and never below combat viability (**ATK ≥ 1, HP+ARM ≥ 2**). The stat / keyword / ability lines below
> each entry remain as alternatives to hand-pick from.

**Budget model** (declared SEPARATELY per card type — a character's power scales steeply with cost via
stats, a spell/equipment's scales gently via situational effects, so one shared line under-serves both;
frozen constants, not a fit on this pool):
- **Characters:** expected = ${model.characters.intercept} + ${model.characters.slope}·cost + rarity; window ±${model.characters.tol}.
- **Spells/Equipment:** expected = ${model.spellsEquip.intercept} + ${model.spellsEquip.slope}·cost + rarity; window ±${model.spellsEquip.tol}.

**Outliers:** ${over.length} over budget · ${under.length} under budget · ${cards.length - over.length - under.length} within.

**Mode:** \`${mode}\`${mode === 'author' ? ' — informational only: every outlier below gets a full suggestion regardless of its classification; nothing is auto-applied.' : ` — ${gateSummaryLine()}`}

**Levers** — pick what fits the card's role:
- **Stats / keyword** — surgical power change for characters (re-scored to land in-window).
- **Cost** — re-cost to move the window onto the card; works for any type but changes its curve slot.
- **Ability** — when the ability drives the score (≥ half of an OVER-budget card), it is left
  **unedited** here — a cost raise doesn't shrink an overpowered effect, it only delays it, so no
  mechanical lever is applied; it needs a human ability rewrite (qualitative — the score can't
  re-grade arbitrary DSL edits). Under-budget ability-driven cards still get the cost-cut lever
  (a cautious buff is safe even if the ability turns out fine; a cautious nerf that undercounts an
  overpowered ability is not).

## Over budget — suggested nerfs (tone down)
${byFaction(over)}

## Under budget — suggested buffs (bring up)
${byFaction(under)}
`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const data = computeSuggestions();
  writeFileSync(new URL('../../docs/balance-suggestions.md', import.meta.url), buildMarkdown(data));
  console.log(`Wrote docs/balance-suggestions.md — ${data.over.length} over, ${data.under.length} under.`);
}
