// balance-suggestions.mjs — draft balance changes for every starter-pool card that
// falls OUTSIDE its rarity-adjusted cost-budget window (both over and under). Each
// stat/keyword edit is RE-SCORED through computeCardPower to confirm it lands back
// inside the window; the cost lever is derived from the budget slope.
//
// computeSuggestions() is exported (used by balance-compare.mjs to apply the SAME
// edits); running this file directly writes docs/balance-suggestions.md.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { computeCardPower } from './dist/balance/index.js';
import { loadBalanceData, indexFromRaw, loadBudgetModel } from './balance-data.mjs';
import { getDeck } from './deck-loader.mjs';

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
const MIN_ATK = 1;
const MIN_BULK = 2; // hp + arm
const STAT_TRIM_MAX = 2; // max total stat points to trim before deferring to the cost lever
const withStats = (sc, da, dh, dr) => ({ ...sc, stats: { atk: sc.stats.atk + da, hp: sc.stats.hp + dh, arm: sc.stats.arm + dr } });
const withCostDelta = (sc, delta) => {
  const c = { ...sc.cost };
  const key = c.energy >= c.mana ? 'energy' : 'mana';
  c[key] = Math.max(0, c[key] + delta);
  return { ...sc, cost: c };
};

/** Suggestions for the starter pool. Pass `rawOverride` (a full SimCard array) to
 * fit a PATCHED pool instead of the baseline — used to iterate the fit to convergence. */
export function computeSuggestions(rawOverride) {
  const { index, raw } = rawOverride
    ? { index: indexFromRaw(rawOverride).index, raw: rawOverride }
    : loadBalanceData();
  const effectText = new Map();
  for (const c of raw) {
    const t = (c.abilities || []).map((a) => a.effect).filter(Boolean).join(' / ');
    if (t) effectText.set(c.id, t);
  }
  const cards = [];
  for (const f of FACTIONS) {
    const deck = getDeck(f);
    const counts = new Map();
    for (const id of deck.mainDeckDefIds) counts.set(id, (counts.get(id) || 0) + 1);
    for (const id of new Set(deck.mainDeckDefIds)) {
      const sc = index.get(id);
      if (!sc) continue;
      const bd = computeCardPower(sc);
      cards.push({ sc, id, faction: f, copies: counts.get(id), cost: totalCost(sc), rarity: sc.rarity, cardType: sc.cardType, power: round(bd.power, 2), statBase: bd.statBase, abilityValue: bd.abilityValue });
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
  }
  return { model, cards, over, under, effectText };
}

// ── Markdown ─────────────────────────────────────────────────────────────────
function buildMarkdown({ model, over, under, cards, effectText }) {
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
    const head = `- **${c.sc.name}** — ${c.rarity}, cost ${c.cost}, ${role}${tr}  ·  power **${round(c.power, 1)}** vs **[${c.lo}, ${c.hi}]** (**${sign}**)`;
    return `${head}\n${suggestionLines(c)}`;
  };
  const byFaction = (list) => FACTIONS.map((f) => {
    const sub = list.filter((c) => c.faction === f);
    return sub.length ? `\n#### ${f}\n${sub.map(entry).join('\n')}` : '';
  }).join('\n');

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
