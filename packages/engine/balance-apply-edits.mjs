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
import { toStatic } from './balance-data.mjs';
import { detectCardLoops } from './dist/balance/index.js';

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
export function applyEdits(rawInput, { mode = 'production', arm = 'all', flattenLp = 0, marginals, playRates } = {}) {
  const raw = JSON.parse(JSON.stringify(rawInput));
  const changes = [];
  const vetoed = [];
  if (mode === 'production') {
    const sug = computeSuggestions({ mode: 'campaign', pool: rawInput, marginals, playRates }); // fit the INPUT pool (so passes iterate)
    applyList(raw, sug.autoEdit ? [sug.autoEdit] : [], changes, vetoed);
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
