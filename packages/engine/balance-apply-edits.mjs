// balance-apply-edits.mjs — apply balance edits to a raw aetherion-cards array.
// Default mode ('production') is gated: only the single campaign autoEdit (0
// or 1 change) is ever applied, fail-closed without marginals. mode:
// 'exploratory' keeps the old bulk apply (arm=all|nerfs|buffs|none) for
// pool-transform-for-inspection callers only — see applyEdits' doc comment.
// The CLI is always exploratory; it writes a scratch JSON, never card data.
// MODE=all|nerfs|buffs|none (CLI env, exploratory arm), FLATTEN_LP=1 ⇒ 30.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { computeSuggestions, copiesInStarterDeck, MIN_ATK, MIN_BULK, MIN_HP } from './balance-suggestions.mjs';
import { toStatic, indexFromRaw, loadBudgetModel } from './balance-data.mjs';
import { getDeck } from './deck-loader.mjs';
import {
  computeCardPower,
  assessLoopRisk,
  detectCardLoops,
  LEGAL_MAX_COPIES,
} from './dist/balance/index.js';
import { primaryResourceKey, classifyCandidate, rankOf, selectCampaignEdits } from './balance-gates.mjs';

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

/** §Y2 (round-10 auditor) — defense in depth at the APPLICATION boundary,
 * independent of whatever classified this edit: refuse to WRITE a card whose
 * composed cost/stats are non-finite or negative, no matter how it got here.
 * Returns a reason string if `a` (the proposed `{ cost, stats? }`) is not
 * writable, else null. This is deliberately narrower than the classification-
 * time viability floors below (finite + non-negative only) — it's the last
 * line, not a duplicate of the fuller check. */
function unwritableReason(a) {
  const costVals = [a.cost.mana, a.cost.energy, a.cost.flexible];
  if (costVals.some((v) => !Number.isFinite(v) || v < 0)) {
    return `non-finite or negative composed cost (${JSON.stringify(a.cost)})`;
  }
  // §H2 (2026-07-17 auditor): the dose contract is integer steps — a
  // fractional cost (e.g. a 0.9 costDelta composed onto a whole-number base)
  // is finite, non-negative, and |Δcost| <= 1, so it cleared every OTHER
  // gate and got written. This is the last line, independent of whatever
  // classified the edit: refuse to write a non-integer cost no matter how
  // it got here.
  if (costVals.some((v) => !Number.isInteger(v))) {
    return `non-integer composed cost (${JSON.stringify(a.cost)}) — dose contract is integer steps`;
  }
  if (a.stats) {
    const statVals = [a.stats.atk, a.stats.hp, a.stats.arm];
    if (statVals.some((v) => !Number.isFinite(v) || v < 0)) {
      return `non-finite or negative composed stats (${JSON.stringify(a.stats)})`;
    }
    if (statVals.some((v) => !Number.isInteger(v))) {
      return `non-integer composed stats (${JSON.stringify(a.stats)}) — dose contract is integer steps`;
    }
    // §Z1 (round-11 auditor): the write layer only rejected NEGATIVE values,
    // so a trim to exactly 0 HP passed through as AUTO_SAFE and got written.
    // Mirrors sim-runner.mjs's applyCardStatOverride floor (HP >= 1, never
    // born dead) on Characters, the only cardType with a real body.
    if (a.cardType === 'C' && a.stats.hp < MIN_HP) {
      return `composed HP ${a.stats.hp} below floor ${MIN_HP} on a Character (never born dead)`;
    }
  }
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
    // §Y2: refuse to write an unwritable composed result BEFORE the loop
    // guards even run (a non-finite/negative cost can't be meaningfully
    // compared to oldTotal anyway).
    const unwritable = unwritableReason(a);
    if (unwritable) {
      vetoed.push(`${card.name}: ${c.after.lever} — VETOED (${unwritable})`);
      continue;
    }
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

/** §Y2 (round-10 auditor) — classification-time viability check on a composed
 * proposal: mirrors the SAME floors balance-suggestions.mjs's searchStatEdit
 * already enforces on the generated-suggestions path (ARM ≥ 0, ATK ≥
 * min(MIN_ATK, current), HP+ARM ≥ min(MIN_BULK, current), HP ≥ min(MIN_HP,
 * current) — §Z1, round-11 auditor, single-sourced with searchStatEdit and
 * sim-runner.mjs's applyCardStatOverride convention that a nerfed body is
 * never born dead) — so the SAME card can't be pushed below viability just
 * because it arrived as an explicit proposal instead of a generated suggestion.
 * Also fail-closed on any non-finite delta input (cost or stat), which the
 * generated path can never produce (it only ever adds well-formed integers)
 * but an explicit proposal — sourced from outside this module — can.
 * §H2 (2026-07-17 auditor) — the dose contract is integer steps: a
 * fractional costDelta/statDelta component (e.g. 0.9, 0.5) is finite and can
 * compose to a |Δcost| <= 1 result, so it slipped past every other gate
 * (including costK > 1) and got written. Checked at TWO points: the raw
 * delta components on `combined` (the entries that produced this proposal —
 * catches a fractional input even if composition happens to round-trip to
 * an integer) and the composed cost/stats themselves (defense in depth,
 * catches any non-integer result regardless of how it was produced).
 * §R12-1 (fresh-auditor fix, 2026-07-18): the gate used to be
 * `Number.isFinite(v) && !Number.isInteger(v)` — a BOOLEAN fails
 * `Number.isFinite` too, so the whole conjunction was false and a boolean
 * delta (e.g. `costDelta: true`) sailed through this check, then JS coerced
 * it to 1 in the arithmetic downstream (`cost + true === cost + 1`), landing
 * on a perfectly-integer composed result that cleared every later gate too.
 * `Number.isInteger` alone is already false for EVERY non-integer-number
 * input — booleans, strings, boxed Numbers, null/undefined (guarded
 * separately via `!= null`), NaN, ±Infinity, arrays, plain objects — so it is
 * the correct single gate; do not re-add a `Number.isFinite` conjunct.
 * Returns `{ classification, reason }` if the composed proposal is invalid,
 * else null. */
function proposalViabilityVeto(scCurrent, scProposed, combined = []) {
  for (const p of combined) {
    if (p.costDelta != null && !Number.isInteger(p.costDelta)) {
      return {
        classification: 'SIM_REQUIRED',
        reason: `SIM_REQUIRED: non-integer costDelta (${JSON.stringify(p.costDelta)}) — dose contract is integer steps`,
      };
    }
    if (p.statDelta != null) {
      // §R12-1: statDelta itself must be a plain object — a boolean/string/
      // array statDelta (e.g. `statDelta: true`) previously iterated via
      // `Object.entries`, which silently yields zero entries for a
      // primitive instead of throwing, so the malformed value passed
      // through unnoticed as a no-op rather than failing closed with a
      // named reason.
      // §R15-3 (round-15 auditor): reject a non-object, an array, OR a
      // PROTOTYPED object. The integer check below enumerates OWN entries
      // (Object.entries), but the stat composer reads INHERITED hp/atk/arm — so
      // `Object.create({hp:true})` has no own entries, passes, and then the
      // composer coerces the inherited `true` to 1. Only a plain record (proto
      // === Object.prototype or null) is a trustworthy delta bag.
      const sdProto = p.statDelta == null ? null : Object.getPrototypeOf(p.statDelta);
      if (
        typeof p.statDelta !== 'object' ||
        Array.isArray(p.statDelta) ||
        (sdProto !== Object.prototype && sdProto !== null)
      ) {
        return {
          classification: 'SIM_REQUIRED',
          reason: `SIM_REQUIRED: statDelta must be a plain object of integer deltas, received ${Array.isArray(p.statDelta) ? 'array' : typeof p.statDelta} — dose contract is integer steps`,
        };
      }
      for (const [key, v] of Object.entries(p.statDelta)) {
        if (v != null && !Number.isInteger(v)) {
          return {
            classification: 'SIM_REQUIRED',
            reason: `SIM_REQUIRED: non-integer statDelta.${key} (${JSON.stringify(v)}) — dose contract is integer steps`,
          };
        }
      }
    }
  }

  const costVals = [scProposed.cost.mana, scProposed.cost.energy, scProposed.cost.flexible];
  if (costVals.some((v) => !Number.isFinite(v))) {
    return {
      classification: 'SIM_REQUIRED',
      reason: `SIM_REQUIRED: composed proposal has a non-finite cost (${JSON.stringify(scProposed.cost)}) — malformed delta input`,
    };
  }
  if (costVals.some((v) => !Number.isInteger(v))) {
    return {
      classification: 'SIM_REQUIRED',
      reason: `SIM_REQUIRED: composed proposal has a non-integer cost (${JSON.stringify(scProposed.cost)}) — dose contract is integer steps`,
    };
  }
  // Combat-viability floors (ARM/ATK/bulk/HP) only make sense for Characters
  // — searchStatEdit itself only ever scores stats on cardType 'C' (spells/
  // equipment carry an all-zero placeholder stats block that isn't a body).
  if (scProposed.cardType !== 'C' || !scProposed.stats) return null;
  const statVals = [scProposed.stats.atk, scProposed.stats.hp, scProposed.stats.arm];
  if (statVals.some((v) => !Number.isFinite(v))) {
    return {
      classification: 'SIM_REQUIRED',
      reason: `SIM_REQUIRED: composed proposal has non-finite stats (${JSON.stringify(scProposed.stats)}) — malformed delta input`,
    };
  }
  if (statVals.some((v) => !Number.isInteger(v))) {
    return {
      classification: 'SIM_REQUIRED',
      reason: `SIM_REQUIRED: composed proposal has non-integer stats (${JSON.stringify(scProposed.stats)}) — dose contract is integer steps`,
    };
  }
  const cur = scCurrent.stats;
  const prop = scProposed.stats;
  if (prop.arm < 0) {
    return {
      classification: 'HUMAN_REWRITE',
      reason: `HUMAN_REWRITE: composed ARM ${prop.arm} < 0 — below combat viability, no sim can fix nonsense`,
    };
  }
  if (cur && prop.atk < Math.min(MIN_ATK, cur.atk)) {
    return {
      classification: 'HUMAN_REWRITE',
      reason: `HUMAN_REWRITE: composed ATK ${prop.atk} below viability floor (min(${MIN_ATK}, current ${cur.atk}))`,
    };
  }
  if (cur && prop.hp + prop.arm < Math.min(MIN_BULK, cur.hp + cur.arm)) {
    return {
      classification: 'HUMAN_REWRITE',
      reason: `HUMAN_REWRITE: composed HP+ARM ${prop.hp + prop.arm} below viability floor (min(${MIN_BULK}, current ${cur.hp + cur.arm}))`,
    };
  }
  if (cur && prop.hp < Math.min(MIN_HP, cur.hp)) {
    return {
      classification: 'HUMAN_REWRITE',
      reason: `HUMAN_REWRITE: composed HP ${prop.hp} below viability floor (min(${MIN_HP}, current ${cur.hp})) — a nerfed body is never born dead (applyCardStatOverride convention)`,
    };
  }
  return null;
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
  // A single entry may carry BOTH deltas — apply both. (An early return here
  // used to drop statDelta when costDelta was present; it dropped consistently
  // in classify AND apply, so it failed safe, but it contradicted the entry
  // contract. Fixed after independent review, 2026-07-15.)
  let out = sc;
  if (proposal.costDelta != null) {
    const cost = { ...out.cost };
    const key = primaryResourceKey(cost);
    cost[key] = Math.max(0, cost[key] + proposal.costDelta);
    out = { ...out, cost };
  }
  if (proposal.statDelta && out.stats) {
    const s = out.stats;
    out = {
      ...out,
      stats: {
        atk: s.atk + (proposal.statDelta.atk ?? 0),
        hp: s.hp + (proposal.statDelta.hp ?? 0),
        arm: s.arm + (proposal.statDelta.arm ?? 0),
      },
    };
  }
  return out;
}

/** §P3 — every proposal entry that targets the same card id (a cost delta
 * and a stat delta may arrive as two separate entries for one id). Guards
 * against a null/non-object entry sharing the array with well-formed ones
 * (§R12-1) — `p.id` on `null`/a primitive would otherwise throw mid-filter. */
function proposalsFor(proposals, id) {
  return proposals.filter((p) => p != null && typeof p === 'object' && p.id === id);
}

/** §R12-1 (fresh-auditor fix, 2026-07-18) — a proposal ENTRY that is itself
 * `null`/not a plain object (as opposed to a well-formed entry carrying a
 * malformed delta, handled by proposalViabilityVeto) can share an array with
 * otherwise-valid entries; without this guard `p.id` on such an entry throws
 * mid-iteration in `classifyProposals`'s main loop. Silently dropping it here
 * is fail-closed: it contributes no delta and produces no row, rather than
 * crashing or being coerced into something applyable. */
/** §R16-1 (round-16 auditor): a PLAIN record — a non-null, non-array object
 * whose prototype is the plain Object.prototype (or null). Own-property
 * validation is worthless if the consumer reads INHERITED props, so any
 * evidence/option/proposal bag that isn't a plain record is untrustworthy. */
function isPlainRecord(o) {
  if (o == null || typeof o !== 'object' || Array.isArray(o)) return false;
  const proto = Object.getPrototypeOf(o);
  return proto === Object.prototype || proto === null;
}

/** §R17 (round-17 auditor): return a NULL-PROTOTYPE object holding only `o`'s
 * OWN enumerable properties. Destructuring/reading from the result can never
 * pick up an inherited value — this defeats BOTH a prototyped bag
 * (Object.create({mode})) AND a globally polluted Object.prototype (which even
 * a plain `{}` would otherwise inherit through). Non-objects/arrays -> empty. */
export function toOwnRecord(o) {
  const out = Object.create(null);
  if (o != null && typeof o === 'object' && !Array.isArray(o)) Object.assign(out, o);
  return out;
}

function isValidProposalEntry(p) {
  // §R16-1: reject a PROTOTYPED proposal entry — Object.create({id:11,
  // statDelta:{hp:-1}}) has no own keys, so the integer/id validation misses
  // it, but applyProposalToStatic reads the inherited fields and mutates.
  return isPlainRecord(p);
}

/** §R19 (round-19 auditor): normalize a caller proposals array to a list of
 * own-property-only entries. Iterates OWN array indices only (Object.hasOwn) —
 * Array.prototype.filter/map VISIT an inherited index in a SPARSE array (e.g.
 * Object.prototype[0] set + `Array(1)`), which would otherwise smuggle an
 * inherited proposal in. Each kept entry (and its statDelta) is copied to a
 * null-proto own-props record. Used by BOTH the classification and the
 * winner-application paths. */
function sanitizeProposalList(proposals) {
  const out = [];
  if (!Array.isArray(proposals)) return out;
  for (let i = 0; i < proposals.length; i++) {
    if (!Object.hasOwn(proposals, i)) continue; // sparse hole / inherited index
    const p = proposals[i];
    if (!isValidProposalEntry(p)) continue;
    const e = toOwnRecord(p);
    if (e.statDelta != null && typeof e.statDelta === 'object') e.statDelta = toOwnRecord(e.statDelta);
    out.push(e);
  }
  return out;
}

/** §P3 — apply EVERY proposal targeting one card, in order, composing their
 * deltas onto the SAME StaticCard (cost delta THEN stat delta both land). */
function applyAllProposals(sc, list) {
  return list.reduce((acc, p) => applyProposalToStatic(acc, p), sc);
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
 * one row per DISTINCT card id (with `.classification`/`.reason` attached) —
 * this is what lets a replay test assert ALL of them, not a hand-picked few.
 *
 * `proposals`: readonly array of { id, costDelta? } | { id, statDelta } |
 * both, as separate entries with the same id — §P3: ALL entries for one id
 * are grouped and applied together (a cost trim + a stat trim on the same
 * card compose), and that card is classified ONCE at the fully-combined
 * state, not once per entry. `opts`: { marginals, playRates } — forwarded to
 * classifyCandidate/rankOf unchanged.
 */
export function classifyProposals(rawInput, proposals, optsIn = {}) {
  const opts = toOwnRecord(optsIn); // §R17: own-property-only marginals/playRates
  // §H2-3 — a single object (not wrapped in an array) used to TypeError deep
  // inside (proposalsFor's .filter, the `for (const p of proposals)` loop).
  // Fail closed instead: zero rows, never throw, regardless of what called
  // this directly (applyEdits also guards its own entry, but this function
  // must be safe on its own).
  if (!Array.isArray(proposals)) return [];
  // §R12-1: drop any null/non-object entry BEFORE it can throw on `p.id` —
  // the rest of this function (and applyEdits' application of the winner)
  // only ever sees well-formed entries from here on.
  // §R18/§R19: normalize to own-property-only entries from OWN array indices —
  // no keyed read below (p.id/costDelta/statDelta.*) can reach an inherited
  // value, and a sparse array's inherited indices are skipped.
  const validProposals = sanitizeProposalList(proposals);
  const { index: currentIndex } = indexFromRaw(rawInput);
  const model = loadBudgetModel();

  const proposedRaw = rawInput.map((c) => {
    const list = proposalsFor(validProposals, c.id);
    const sc = currentIndex.get(c.id);
    if (list.length === 0 || !sc) return c;
    const after = applyAllProposals(sc, list);
    return { ...c, cost: after.cost, ...(after.stats ? { stats: after.stats } : {}) };
  });
  const { index: proposedIndex } = indexFromRaw(proposedRaw);
  // §DEFECT B fix: indexFromRaw only populates C/S/E — mirror
  // computeSuggestions' pool construction (balance-suggestions.mjs ~254-255)
  // so this gate assesses loop risk over the SAME pool the suggestions path
  // does. Without heroes/transforms here, a hero/transform cost-reduction
  // aura or free-acquisition ability (a loop SOURCE) is invisible to this
  // classifier while computeSuggestions sees it — the two gating paths could
  // disagree on the same proposed state.
  const heroesAndTransforms = proposedRaw
    .filter((c) => c.cardType === 'H' || c.cardType === 'T')
    .map(toStatic);
  const proposedPool = [...proposedIndex.values(), ...heroesAndTransforms];
  // §V4(a): actual starter-deck copy count where decked (evidence),
  // LEGAL_MAX_COPIES where not (no evidence -> conservative). A hero/
  // transform is never decked/copied — pin at 1 (mirrors computeSuggestions).
  const copiesOf = new Map(
    proposedPool.map((sc) => {
      if (sc.cardType === 'H' || sc.cardType === 'T') return [sc.id, 1];
      const n = copiesInStarterDeck(sc.id);
      return [sc.id, n > 0 ? n : LEGAL_MAX_COPIES];
    }),
  );
  const proposedRisk = assessLoopRisk(proposedPool, copiesOf);

  const seenIds = new Set();
  const rows = [];
  for (const p of validProposals) {
    if (seenIds.has(p.id)) continue; // §P3: classify the combined proposal ONCE
    seenIds.add(p.id);
    const combined = proposalsFor(validProposals, p.id);
    const sc = proposedIndex.get(p.id);
    const scCurrent = currentIndex.get(p.id);
    if (!sc || !scCurrent) {
      rows.push({ id: p.id, classification: 'SIM_REQUIRED', reason: `unknown card id ${p.id}` });
      continue;
    }
    // §Y2 (round-10 auditor): validate the COMPOSED result before it's scored
    // at all — a below-viability or non-finite stat/cost line must never
    // reach AUTO_SAFE (the Bio-Seedling ATK 0 -> -1 repro).
    const viabilityVeto = proposalViabilityVeto(scCurrent, sc, combined);
    if (viabilityVeto) {
      rows.push({ id: p.id, ...viabilityVeto });
      continue;
    }
    const bd = computeCardPower(sc);
    const bdCurrent = computeCardPower(scCurrent);
    const exp = model.expectedFor(totalCost(sc), sc.rarity, sc.cardType);
    const expCurrent = model.expectedFor(totalCost(scCurrent), scCurrent.rarity, scCurrent.cardType);
    const tol = model.tolFor(sc.cardType);
    const lo = exp - tol;
    const hi = exp + tol;
    // §Q3 (round-4 auditor) — costK must reflect the REAL composed cost
    // change, not a sum of raw deltas: sequential clamping (e.g. -5 then +5
    // on a cost-3 card, Math.max(0, ...) at each step) can make a raw-delta
    // sum report 0 while the actual cost moved 3→5. `sc`/`scCurrent` are
    // already the fully-composed proposed/current StaticCards, so their own
    // total cost IS the real before/after — diff that directly.
    const costK = Math.abs(totalCost(sc) - totalCost(scCurrent));
    // §R12-2 (fresh-auditor fix, 2026-07-18) — the ±1 dose discipline was
    // enforced for cost (costK > 1, above) but had no stat equivalent: an
    // explicit statDelta:{hp:-2} (or two accumulated {hp:-1} entries on the
    // same card, composed by applyAllProposals before this point) classified
    // AUTO_SAFE even though the maintainer's contract is "±1 then measure".
    // §R12-2b (round-12 re-review, Kimi K3): the first fix used per-axis MAX,
    // so a two-stat edit like {hp:-1, atk:-1} scored statK 1 and slipped the
    // gate while the analogous two-axis COST move (costK = |Δtotal| = 2) is
    // blocked. statK is now the SUM of absolute per-stat deltas across the
    // three independent printed stats (hp/atk/arm): each stat you touch is one
    // dose. Stats are independent dimensions (unlike cost axes, which sum for
    // affordability), so touching two of them is a two-unit change and must be
    // measured — hence sum-of-|Δ|, which is STRICTER than costK's |Δtotal| by
    // design. It is also strictly stricter than the first fix's max+bulk form:
    // besides catching {hp:-1, atk:-1} (max 1 -> sum 2), it now also gates a
    // bulk-neutral reshape like {hp:+1, arm:-1} (old bulk term 0 -> sum 2) —
    // that is a two-stat change and should be sim-measured, so the extra
    // gating is the intended fail-closed direction. Mirrored by
    // classifyCandidate's `statK > 1` gate.
    const statK =
      sc.stats && scCurrent.stats
        ? Math.abs(sc.stats.hp - scCurrent.stats.hp) +
          Math.abs(sc.stats.atk - scCurrent.stats.atk) +
          Math.abs(sc.stats.arm - scCurrent.stats.arm)
        : 0;

    // §P2/§Q2 — direction is ALWAYS the SIGN of the residual change (proposed
    // − current, both against the FROZEN budget line), never caller-supplied
    // metadata. A residual DECREASE (power falls relative to what its new
    // cost expects, or cost rises against unchanged power) is a nerf
    // ('over'); an INCREASE is a buff ('under'). Ambiguous/negligible
    // movement fails CLOSED (SIM_REQUIRED). A caller-supplied `p.status` is
    // NEVER used to gate direction — round-4's auditor proved a caller can
    // assert an arbitrary status to force AUTO_SAFE application; if a
    // combined entry carries one and it DISAGREES with the derived
    // direction, fail closed to SIM_REQUIRED naming the disagreement instead
    // of trusting either side.
    const callerStatus = combined.find((x) => x.status)?.status;
    const residualCurrent = bdCurrent.power - expCurrent;
    const residualProposed = bd.power - exp;
    const residualDelta = residualProposed - residualCurrent;
    const RESIDUAL_EPS = 0.05;
    const derivedStatus =
      residualDelta <= -RESIDUAL_EPS ? 'over' : residualDelta >= RESIDUAL_EPS ? 'under' : undefined;

    const base = {
      id: p.id,
      faction: factionOfId(p.id),
      // §Q4 (round-4 auditor) — real copies from starter-deck membership
      // (the SAME counting the suggestions pipeline uses, via
      // copiesInStarterDeck), not a hardcoded default that silently inverts
      // §B4's exposure ranking. Un-decked cards keep 1. Copies IS derivable
      // from deck membership, so a caller-supplied `copies` on the proposal
      // entry is a judgment, never evidence — it is ignored entirely, even
      // if present (round-4 principle: callers supply evidence, not
      // judgments).
      copies: copiesInStarterDeck(p.id) || 1,
      abilityShare: bd.power > 0 ? bd.abilityValue / bd.power : 0,
      // §R15-2 (round-15 auditor): §B4 exposure ranks on |power − expected|
      // (residual from the budget line), so carry it for rankOf — the proposed
      // card's own residual, not the tolerance-window `edge`.
      residual: Math.abs(residualProposed),
      costK,
      statK,
      flags: bd.flags,
      proposedLoopRisk: proposedRisk.get(p.id) ?? 'none',
      powerLow: bd.powerLow,
      powerHigh: bd.powerHigh,
      lo,
      hi,
    };
    if (callerStatus !== undefined && callerStatus !== derivedStatus) {
      rows.push({
        ...base,
        status: 'ambiguous',
        edge: 0,
        classification: 'SIM_REQUIRED',
        reason: `SIM_REQUIRED: caller-supplied status '${callerStatus}' disagrees with the residual-derived direction '${derivedStatus ?? 'ambiguous'}' — direction is never taken from caller metadata`,
      });
      continue;
    }
    if (derivedStatus === undefined) {
      rows.push({
        ...base,
        status: 'ambiguous',
        edge: 0,
        classification: 'SIM_REQUIRED',
        reason: 'SIM_REQUIRED: residual change is ambiguous/negligible — direction cannot be derived from the budget line, run a sim to confirm',
      });
      continue;
    }
    const row = {
      ...base,
      status: derivedStatus,
      edge: derivedStatus === 'over' ? round(bd.power - hi, 1) : round(lo - bd.power, 1),
    };
    const gate = classifyCandidate(row, opts);
    rows.push({ ...row, classification: gate.classification, reason: gate.reason });
  }
  return rows;
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
export function applyEdits(rawInput, optsIn = {}) {
  // §R16-1/§R17-2 (round-16/17 auditor): a PROTOTYPED options object
  // (Object.create({mode:'exploratory'})) OR a globally polluted Object.prototype
  // would leak an INHERITED `mode`/`marginals` through destructuring, silently
  // entering bulk apply. toOwnRecord copies only OWN enumerable props into a
  // null-proto object, so every destructured field below can ONLY come from an
  // own property (exotic/polluted -> the gated production default).
  const opts = toOwnRecord(optsIn);
  const { mode = 'production', arm = 'all', flattenLp = 0, marginals, playRates, proposals } = opts;
  const raw = JSON.parse(JSON.stringify(rawInput));
  const changes = [];
  const vetoed = [];
  if (mode === 'production') {
    // §R12-1(b) (fresh-auditor fix, 2026-07-18) — this used to be
    // `if (proposals)`, a truthiness check that treats `proposals: false`,
    // `''`, or `0` (all EXPLICITLY supplied, just malformed) the same as
    // "omitted", falling through to the `else` branch below and silently
    // running the generated-suggestions path instead of failing closed.
    // `!== undefined` is the correct "was a proposals option supplied at
    // all" test — anything supplied that isn't an array is caught by the
    // Array.isArray check right after and produces zero changes.
    if (proposals !== undefined) {
      // §H2-3 — a caller-supplied `proposals` that isn't an array (e.g. a
      // single object instead of a one-element array) used to TypeError
      // inside classifyProposals. Fail closed here too: record why, apply
      // zero changes, never throw.
      if (!Array.isArray(proposals)) {
        vetoed.push(
          `proposals must be an array of {id, costDelta?, statDelta?} — received ${typeof proposals} (${JSON.stringify(proposals)}); fail closed, zero changes applied`,
        );
        return { raw, changes, lpCount: 0, vetoed };
      }
      // §R1: gate the GIVEN proposals (each at its proposed value), not
      // today's re-derived suggestions. Still ≤1 AUTO_SAFE edit, §B4-ranked.
      // §T3 (round-5): route the winner through selectCampaignEdits so a
      // malformed playRates object suppresses the auto-edit here too, not
      // just in the computeSuggestions path.
      const rows = classifyProposals(rawInput, proposals, { marginals, playRates });
      for (const r of rows) r.rank = rankOf(r, { playRates });
      const { autoEdit: winner } = selectCampaignEdits(rows, { playRates });
      if (winner) {
        const { index: currentIndex } = indexFromRaw(rawInput);
        // §P3: apply ALL proposal entries for the winning id (e.g. a cost
        // delta + a stat delta on the same card), not just the first match.
        // §R12-1: `proposals.filter(isValidProposalEntry)` mirrors what
        // classifyProposals already ran internally to derive `winner` — a
        // null/non-object entry sharing the array can't reach here anyway.
        // §R18/§R19: same own-index, own-property-only normalization as
        // classifyProposals — this APPLICATION path must not read an inherited
        // entry/index/statDelta from a polluted prototype.
        const combined = proposalsFor(sanitizeProposalList(proposals), winner.id);
        const after = applyAllProposals(currentIndex.get(winner.id), combined);
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
  // flattenLp is an exploratory-only lab knob (flattens every hero's HP for
  // sim comparability) — production mode ignores it silently rather than
  // throwing: a caller that passes it in production almost certainly meant
  // "exploratory", and this function's whole contract is fail-closed-to-noop
  // for anything not explicitly gated, not fail-loud.
  let lpCount = 0;
  if (flattenLp && mode === 'exploratory') {
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
