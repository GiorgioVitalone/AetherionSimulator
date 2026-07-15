// balance-apply-edits.mjs — apply balance edits to a raw aetherion-cards array.
// Default mode ('production') is gated: only the single campaign autoEdit (0
// or 1 change) is ever applied, fail-closed without marginals. mode:
// 'exploratory' keeps the old bulk apply (arm=all|nerfs|buffs|none) for
// pool-transform-for-inspection callers only — see applyEdits' doc comment.
// The CLI is always exploratory; it writes a scratch JSON, never card data.
// MODE=all|nerfs|buffs|none (CLI env, exploratory arm), FLATTEN_LP=1 ⇒ 30.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { computeSuggestions } from './balance-suggestions.mjs';
import { toStatic, indexFromRaw, loadBudgetModel } from './balance-data.mjs';
import { getDeck } from './deck-loader.mjs';
import { computeCardPower, assessLoopRisk, detectCardLoops } from './dist/balance/index.js';
import { primaryResourceKey, classifyCandidate, rankOf } from './balance-gates.mjs';

// ── §13a loop guards ──────────────────────────────────────────────────────────
// The §12c disaster chain (budget cut Echoes 5→1 × Wizard's Robe's unfloored −1
// × self-copy = 0-cost infinite loop) was fully static-checkable BEFORE any sim.
// Two guards, applied to every cost-LOWERING edit:
//   1. min-effective-cost: newCost − the max stacking cost_reduction the pool
//      can aim at this card ≤ 0, AND the card has a recursion-class effect
//      (copy/search/return) ⇒ VETO.
//   2. detectCardLoops on the edited card ⇒ VETO on any non-'none' risk level.
const RECURSION_EFFECTS = new Set(['copy_card', 'search_deck', 'return_from_discard']);

function cardEffectTypes(card) {
  const out = new Set();
  for (const ab of card.abilities || []) {
    for (const e of ab.dsl?.effects || []) {
      out.add(e.type);
      for (const sub of e.effects || []) out.add(sub.type);
    }
  }
  return out;
}

/** Max total cost_reduction the POOL can stack against `card` (tag/type match).
 * firstPerTurn reductions still count — the loop only needs one free cast/turn
 * to churn; and multiple copies of the source can be in play. */
function maxPoolReduction(raw, card) {
  let sum = 0;
  for (const src of raw) {
    for (const ab of src.abilities || []) {
      for (const e of ab.dsl?.effects || []) {
        if (e.type !== 'cost_reduction') continue;
        const f = e.appliesTo || {};
        if (f.cardType !== undefined && f.cardType !== card.cardType) continue;
        if (f.tag !== undefined && !(card.tags || []).includes(f.tag)) continue;
        sum += e.reduction;
      }
    }
  }
  return sum;
}

function guardVeto(raw, card, newTotalCost) {
  const fx = cardEffectTypes(card);
  const recursive = [...fx].some((t) => RECURSION_EFFECTS.has(t));
  if (recursive && newTotalCost - maxPoolReduction(raw, card) <= 0) {
    return `min-effective-cost ${newTotalCost}−${maxPoolReduction(raw, card)} ≤ 0 on a recursion card`;
  }
  const risk = detectCardLoops(toStatic(card));
  if (risk.level !== 'none') return `loop risk '${risk.level}' (${risk.abilities.map((a) => a.reasons.join('/')).join('; ')})`;
  return null;
}

/** Apply a candidate list to `raw` (mutates raw's cards in place — raw itself
 * must already be a private copy). Cost-LOWERING edits pass the §13a loop
 * guards or are vetoed. Shared by both applyEdits modes below. */
function applyList(raw, list, changes, vetoed) {
  const byId = new Map(raw.map((c) => [c.id, c]));
  for (const c of list) {
    const card = byId.get(c.id);
    if (!card) continue;
    const a = c.after.static;
    const oldTotal = card.cost.mana + card.cost.energy + card.cost.flexible;
    const newTotal = a.cost.mana + a.cost.energy + a.cost.flexible;
    if (newTotal < oldTotal) {
      const reason = guardVeto(raw, { ...card, cost: a.cost }, newTotal);
      if (reason) {
        vetoed.push(`${card.name}: ${c.after.lever} — VETOED (${reason})`);
        continue;
      }
    }
    if (a.stats) card.stats = { hp: a.stats.hp, atk: a.stats.atk, arm: a.stats.arm };
    card.cost = { mana: a.cost.mana, energy: a.cost.energy, flexible: a.cost.flexible };
    changes.push(`${card.name}: ${c.after.lever}`);
  }
}

// ── §R1/F3 — classify an EXPLICIT proposal list at its PROPOSED values ───────
const FACTIONS = ['Onyx', 'Radiant', 'Sapphire', 'Verdant'];
const round = (x, n = 1) => {
  const p = 10 ** n;
  return Math.round(x * p) / p;
};
const totalCost = (sc) => sc.cost.mana + sc.cost.energy + sc.cost.flexible;

function factionOfId(id) {
  for (const f of FACTIONS) if (getDeck(f).mainDeckDefIds.includes(id)) return f;
  return 'Unaligned';
}

/** Apply one proposal's costDelta/statDelta to a StaticCard, mirroring
 * sim-runner.mjs's applyCardCostOverride `bump` (primaryResourceKey picks the
 * axis). Returns a NEW StaticCard — never mutates `sc`. */
function applyProposalToStatic(sc, proposal) {
  if (proposal.costDelta != null) {
    const cost = { ...sc.cost };
    const key = primaryResourceKey(cost);
    cost[key] = Math.max(0, cost[key] + proposal.costDelta);
    return { ...sc, cost };
  }
  if (proposal.statDelta && sc.stats) {
    const s = sc.stats;
    return {
      ...sc,
      stats: {
        atk: s.atk + (proposal.statDelta.atk ?? 0),
        hp: s.hp + (proposal.statDelta.hp ?? 0),
        arm: s.arm + (proposal.statDelta.arm ?? 0),
      },
    };
  }
  return sc;
}

/**
 * §R1/F3 — classify an EXPLICIT list of proposals (e.g. a committed historical
 * fixture) against `rawInput`, each AT ITS PROPOSED card state — not today's
 * re-derived suggestions. Every proposal's delta is applied SIMULTANEOUSLY
 * (the historical patch's own shape) to build one proposed pool; power/
 * interval/flags are recomputed from the PROPOSED card via computeCardPower
 * (a stat trim changes power, not just the stat line), and loop risk is
 * reassessed over the whole proposed pool. Each row is then classified
 * through the SAME production gate classifier campaign mode uses. Returns
 * one row per proposal (with `.classification`/`.reason` attached) — this is
 * what lets a replay test assert ALL of them, not a hand-picked few.
 *
 * `proposals`: readonly array of { id, costDelta? } | { id, statDelta } |
 * (both may be combined by passing two entries for the same id — this
 * fixture never does). `opts`: { marginals, playRates } — forwarded to
 * classifyCandidate/rankOf unchanged.
 */
export function classifyProposals(rawInput, proposals, opts = {}) {
  const { index: currentIndex } = indexFromRaw(rawInput);
  const model = loadBudgetModel();

  const proposedRaw = rawInput.map((c) => {
    const p = proposals.find((x) => x.id === c.id);
    const sc = currentIndex.get(c.id);
    if (!p || !sc) return c;
    const after = applyProposalToStatic(sc, p);
    return { ...c, cost: after.cost, ...(after.stats ? { stats: after.stats } : {}) };
  });
  const { index: proposedIndex } = indexFromRaw(proposedRaw);
  const proposedRisk = assessLoopRisk([...proposedIndex.values()]);

  return proposals.map((p) => {
    const sc = proposedIndex.get(p.id);
    if (!sc) return { id: p.id, classification: 'SIM_REQUIRED', reason: `unknown card id ${p.id}` };
    const bd = computeCardPower(sc);
    const exp = model.expectedFor(totalCost(sc), sc.rarity, sc.cardType);
    const tol = model.tolFor(sc.cardType);
    const lo = exp - tol;
    const hi = exp + tol;
    const status = p.status ?? (p.costDelta != null ? (p.costDelta > 0 ? 'over' : 'under') : 'over');
    const costK = p.costDelta != null ? Math.abs(p.costDelta) : 0;
    const row = {
      id: p.id,
      faction: factionOfId(p.id),
      copies: p.copies ?? 1,
      status,
      abilityShare: bd.power > 0 ? bd.abilityValue / bd.power : 0,
      costK,
      flags: bd.flags,
      proposedLoopRisk: proposedRisk.get(p.id) ?? 'none',
      powerLow: bd.powerLow,
      powerHigh: bd.powerHigh,
      lo,
      hi,
      edge: status === 'over' ? round(bd.power - hi, 1) : round(lo - bd.power, 1),
    };
    const gate = classifyCandidate(row, opts);
    return { ...row, classification: gate.classification, reason: gate.reason };
  });
}

/** Apply balance edits to a COPY of `rawInput`. Never mutates input.
 *
 * `mode` (default `'production'`) — the F1 certification fix (2026-07-15):
 * the 2026-07-14 disaster was this function applying EVERY SIM_REQUIRED
 * suggestion wholesale, zero vetoes. Two modes now, and the gated one is the
 * silent default (no flag needed, and an unrecognized mode throws rather than
 * risking a silent bulk apply):
 *   - `'production'` (default): runs campaign-mode `computeSuggestions` (full
 *     §B3 gating) against `rawInput` and applies ONLY its single `autoEdit`
 *     (0 or 1 change). Requires `marginals` for anything to ever be
 *     AUTO_SAFE — omit them and this mode is a guaranteed no-op (fail
 *     closed). SIM_REQUIRED / HUMAN_REWRITE / BLOCKED candidates are NEVER
 *     mechanically applied, here or anywhere else in this file.
 *     §R1: pass an explicit `proposals` list (readonly {id, costDelta?,
 *     statDelta?}[] — e.g. a committed historical fixture) to gate THOSE
 *     proposals instead of today's re-derived suggestions — each one
 *     classified via classifyProposals at its PROPOSED value, still ≤1
 *     AUTO_SAFE edit applied, same §13a guards.
 *   - `'exploratory'`: the pre-fix bulk behavior — applies `arm`
 *     (`all|nerfs|buffs|none`, i.e. sug.over / sug.under / both / neither)
 *     with no gating beyond the §13a loop guards. Exists ONLY to transform a
 *     pool for visualization or lab-simulation INPUT — it is never a
 *     prescription and its output must never be written back as card data.
 *     Current callers: balance-dashboard.mjs (in-memory before/after view),
 *     balance-lab/balance-refit.mjs (writes /tmp by default), make-pools.mjs
 *     (writes to a generated-pools/ scratch dir), and this file's own CLI.
 *
 * Returns { raw, changes, lpCount, vetoed }. */
export function applyEdits(rawInput, { mode = 'production', arm = 'all', flattenLp = 0, marginals, playRates, proposals } = {}) {
  const raw = JSON.parse(JSON.stringify(rawInput));
  const changes = [];
  const vetoed = [];
  if (mode === 'production') {
    if (proposals) {
      // §R1: gate the GIVEN proposals (each at its proposed value), not
      // today's re-derived suggestions. Still ≤1 AUTO_SAFE edit, §B4-ranked.
      const rows = classifyProposals(rawInput, proposals, { marginals, playRates });
      const autoSafe = rows.filter((r) => r.classification === 'AUTO_SAFE');
      const winner = [...autoSafe].sort((a, b) => rankOf(b, { playRates }) - rankOf(a, { playRates }))[0];
      if (winner) {
        const { index: currentIndex } = indexFromRaw(rawInput);
        const p = proposals.find((x) => x.id === winner.id);
        const after = applyProposalToStatic(currentIndex.get(winner.id), p);
        const list = [
          {
            id: winner.id,
            after: { static: { cost: after.cost, stats: after.stats }, lever: 'historical proposal (§R1 replay)' },
          },
        ];
        applyList(raw, list, changes, vetoed);
      }
    } else {
      const sug = computeSuggestions({ mode: 'campaign', pool: rawInput, marginals, playRates }); // fit the INPUT pool (so passes iterate)
      applyList(raw, sug.autoEdit ? [sug.autoEdit] : [], changes, vetoed);
    }
  } else if (mode === 'exploratory') {
    const sug = computeSuggestions(rawInput); // legacy rawOverride path — fit the INPUT pool
    const list =
      arm === 'nerfs' ? sug.over : arm === 'buffs' ? sug.under : arm === 'none' ? [] : [...sug.over, ...sug.under];
    applyList(raw, list, changes, vetoed);
  } else {
    throw new Error(`applyEdits: unknown mode '${mode}' — must be 'production' or 'exploratory'`);
  }
  let lpCount = 0;
  if (flattenLp) {
    for (const card of raw) {
      if (card.cardType === 'H' && card.stats) {
        card.stats = { ...card.stats, hp: flattenLp };
        lpCount++;
      }
    }
  }
  return { raw, changes, lpCount, vetoed };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  // CLI purpose is always exploratory — it writes a scratch JSON for manual
  // inspection / sim input, never card data.
  const ARM = process.env.MODE || 'all';
  const OUT = process.env.OUT || '/tmp/aetherion-cards-after.json';
  const FLATTEN_LP = process.env.FLATTEN_LP ? (Number(process.env.FLATTEN_LP) > 1 ? Number(process.env.FLATTEN_LP) : 30) : 0;
  const base = JSON.parse(readFileSync(new URL('./sim-data/aetherion-cards.json', import.meta.url)));
  const { raw, changes, lpCount, vetoed } = applyEdits(base, { mode: 'exploratory', arm: ARM, flattenLp: FLATTEN_LP });
  writeFileSync(OUT, JSON.stringify(raw));
  console.log(
    `Wrote ${OUT} — ${ARM} (${changes.length} edits)${FLATTEN_LP ? ` + LP→${FLATTEN_LP} (${lpCount} heroes)` : ''}:`,
  );
  for (const ch of changes) console.log(`  · ${ch}`);
  for (const v of vetoed) console.log(`  ✗ ${v}`);
}
