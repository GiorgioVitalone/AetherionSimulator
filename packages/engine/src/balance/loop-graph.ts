/**
 * §S4 — loop-risk veto graph over the card DSL, WITHOUT simulation.
 *
 * v1 (loop-detector.ts) scores a single ability's own repeatable-engine shape.
 * It missed the Arcane Echoes ↔ discard catastrophe for three reasons: on_cast
 * wasn't in its repeatable-trigger set, it never resolved a filter against the
 * pool (so it couldn't see that Echoes' own filter matches Echoes), and it has
 * no notion of castFreeIfCost / cost-reduction auras chaining casts together.
 *
 * This module builds an actual directed graph: an edge A → B means "A's
 * effects can put a copy of B (or B itself) into hand/play/castable state" —
 * via copy_card, return_from_discard, search_deck, or deploy_from_deck — and
 * finds cycles (including self-loops) through it. A cost-reduction aura or a
 * search_deck's castFreeIfCost annotates edges/cards with a lowered effective
 * cost; cycles are classified by their net PER-AXIS resource residual per
 * traversal (§R12-5): mana/energy/flexible are tracked separately, and a gain
 * of one specific axis (e.g. energy) never offsets a cost on the OTHER
 * specific axis (mana) — only spare same-axis gains can pay a flexible cost.
 * This mirrors the runtime split (actions/cost-checker.ts rejects a shortage
 * on either specific axis; effects/interpreter.ts credits a gain to its
 * specific resourceType), where a card that pays mana and regenerates energy
 * is NOT self-funding.
 *
 * Filter-resolution mirrors the RUNTIME semantics in
 * effects/target-resolver.ts's applyFilter: trait/tag/cardType exact-or-
 * includes match, maxCost/minCost/maxHp/maxAtk numeric bounds. Two exceptions,
 * both intentional and recall-biased ("classify up" — see task brief):
 *  - excludeSelf is IGNORED. It only blocks an effect from re-targeting the
 *    SAME INSTANCE that cast it; a real deck carries 2-3 copies of a card, so
 *    those other copies still complete a definitional cycle on this card id.
 *  - costRelativeTo needs a runtime reference cost (destroyed_card/cast_spell)
 *    we don't have statically. Left unconstrained, matching applyFilter's own
 *    no-op fallback when no reference cost is supplied.
 *
 * B3 gating contract: assessLoopRisk has no notion of "current" vs "proposed"
 * cost — it evaluates whatever `cost` is on the StaticCard it's handed. B3
 * callers pass cost-MODIFIED copies of the pool to gate a proposed edit.
 */
import type { Effect } from '../types/effects.js';
import type { TargetExpr, TargetFilter } from '../types/targets.js';
import type { Trigger } from '../types/triggers.js';
import type { CardTypeCode, ResourceCost } from '../types/common.js';
import type { StaticCard } from './types.js';
import { flattenEffects } from './signal-extract.js';
import { scanRiskyEffects } from './risky-effects.js';
import { abilityThrottle, isRepeatableTrigger } from './loop-detector.js';

export type LoopRisk = 'none' | 'possible' | 'likely';

const RISK_RANK: Record<LoopRisk, number> = { none: 0, possible: 1, likely: 2 };
const maxRisk = (a: LoopRisk, b: LoopRisk): LoopRisk => (RISK_RANK[a] >= RISK_RANK[b] ? a : b);

function totalCost(c: StaticCard): number {
  return c.cost.mana + c.cost.energy + c.cost.flexible;
}

// ── Filter resolution (mirrors effects/target-resolver.ts applyFilter) ────────

function matchesFilter(candidate: StaticCard, filter: TargetFilter | undefined): boolean {
  if (filter === undefined) return true;
  if (filter.trait !== undefined && !candidate.traits.includes(filter.trait)) return false;
  if (filter.tag !== undefined && !candidate.tags.includes(filter.tag)) return false;
  if (filter.cardType !== undefined && candidate.cardType !== filter.cardType) return false;
  const cost = totalCost(candidate);
  if (filter.maxCost !== undefined && cost > filter.maxCost) return false;
  if (filter.minCost !== undefined && cost < filter.minCost) return false;
  // §V4(b) (round-7): maxHp/maxAtk are MUTABLE-RANGE predicates — the runtime
  // matches a candidate's live currentHp/currentAtk (damage taken, +/-stat
  // effects), not the printed stat this StaticCard carries. A body with
  // printed HP 5 can still be at 0 (or any value below its printed HP) when
  // the filter is actually consulted — a maxHp:0 filter is reachable against
  // ANY positive-HP body, not just ones printed at 0. Excluding on printed
  // stats here can drop a genuinely reachable acquisition edge (the auditor's
  // maxHp:0 probe). Recall-biased per the module's own stated policy
  // (excludeSelf/costRelativeTo above): a filter that CAN match at some
  // reachable runtime state keeps the edge; only provably-impossible matches
  // (trait/tag/cardType/printed-cost, which are NOT mutated by in-play
  // effects the way HP/ATK are) drop it. maxHp/maxAtk are therefore never
  // treated as exclusionary here.
  return true;
}

function targetFilterOf(target: TargetExpr): TargetFilter | undefined {
  return 'filter' in target ? target.filter : undefined;
}

interface EdgeEffectSpec {
  readonly filter: TargetFilter | undefined;
  /** True when traversing this edge costs the acquired card NOTHING,
   * regardless of its printed/effective cost: search_deck→battlefield and
   * deploy_from_deck deploy directly with no cast, and search_deck's
   * castForFree:true casts unconditionally on pickup. */
  readonly unconditionalFree?: boolean;
  readonly castFreeIfCost?: number;
}

/** Which effect types create a graph edge, and what they filter on. */
function edgeEffectSpec(e: Effect): EdgeEffectSpec | undefined {
  switch (e.type) {
    case 'copy_card':
      return { filter: e.filter };
    case 'search_deck':
      return {
        filter: e.filter,
        unconditionalFree: e.destination === 'battlefield' || e.castForFree === true,
        castFreeIfCost: e.castFreeIfCost,
      };
    case 'deploy_from_deck':
      return { filter: e.filter, unconditionalFree: true };
    case 'return_from_discard':
      // §T2 (round-5): return_from_discard->battlefield is the same free
      // acquisition edge as search_deck->battlefield — the card enters play
      // directly, no cast, no cost. Only the 'hand' destination requires a
      // later cast (conditional-free, gated by castFreeIfCost elsewhere).
      return {
        filter: targetFilterOf(e.target),
        unconditionalFree: e.destination === 'battlefield',
      };
    default:
      return undefined;
  }
}

/** Per-axis resource gain (§R12-5): mana and energy tracked SEPARATELY — a
 * gain of one specific axis must never be summed into the other, or a loop
 * that pays mana and regenerates energy would read as self-funding when the
 * runtime can never actually pay a mana cost from an energy pool
 * (actions/cost-checker.ts's specific-axis shortage check). §R12-2b (round-12
 * re-review, Kimi K3): a flexible-typed gain CAN occur (ResourceType includes
 * 'flexible' and effects/interpreter.ts's executeGainResource banks it) —
 * dropping it (contributing to neither axis) is correct not because it can't
 * be produced, but because the runtime cannot SPEND it: getAvailableResources
 * (actions/cost-checker.ts) counts only mana/energy when testing affordability,
 * so a banked flexible gain can never actually pay a loop's recurring cost.
 * Excluding it matches that runtime behavior. (If the runtime is ever changed
 * to spend flexible-banked resources, this drop would become a false negative
 * and must be revisited — see the flexible-gain regression test.) */
interface AxisGain {
  readonly mana: number;
  readonly energy: number;
}

function loopResourceGain(flat: readonly Effect[]): AxisGain {
  // Only explicit gain_resource effects count. The universal Discard-for-
  // Energy floor (≥1 resource/turn) is a once-per-turn GAME rule, not a card
  // effect — it never appears here, and we deliberately never add it in, so a
  // repeatable cycle's "resource generation" can't be inflated by a mechanic
  // that can fire at most once per turn regardless of how many times the
  // cycle loops within that turn.
  //
  // §Y1 (round-10 auditor): temporary resources count identically to
  // permanent ones. The runtime (effects/interpreter.ts) credits a temporary
  // gain_resource to the player IMMEDIATELY, and cost-checker.ts's
  // affordability check spends from that same pool with no distinction — a
  // loop traversal happens entirely within one turn, so "expires at end of
  // turn" never becomes observable before the next traversal's cost is paid.
  // Excluding `temporary` gains understated net cost for exactly the shape
  // that matters most (a card that funds its own recast via a temporary
  // gain), letting a genuinely self-sustaining loop classify 'none'.
  let mana = 0;
  let energy = 0;
  for (const e of flat) {
    if (e.type !== 'gain_resource') continue;
    switch (e.resourceType) {
      case 'mana':
        mana += e.amount;
        break;
      case 'energy':
        energy += e.amount;
        break;
      case 'flexible':
        break;
      default: {
        const _exhaustive: never = e.resourceType;
        return _exhaustive;
      }
    }
  }
  return { mana, energy };
}

// ── Cost-reduction annotations (auras) ────────────────────────────────────────

interface CostReducer {
  readonly cardType?: Extract<CardTypeCode, 'C' | 'S' | 'E'>;
  readonly tag?: string;
  readonly reduction: number;
  /** The alignment of the CARD that grants this reducer — needed to veto
   * combining reducers/targets that could never share a deck (§U1). */
  readonly sourceAlignment: readonly string[];
}

/** §V4(a) (round-7): the runtime counts one reducer contribution PER IN-PLAY
 * INSTANCE (a deck can run up to 3 copies of any non-Hero card — game-domain
 * rule), but a static pool only ever carries ONE StaticCard per id — the old
 * model collected each reducer once regardless of how many copies of its
 * source card a real deck runs. `copiesOf` resolves a card id to its legal
 * deck-copy count; callers with real deck data (balance-suggestions.mjs /
 * balance-apply-edits.mjs) pass actual starter-deck membership counts (real
 * evidence for decked cards, LEGAL_MAX_COPIES for a genuinely un-decked id —
 * no evidence → conservative, per the brief). Omitting `copiesOf` entirely
 * (existing unit tests / any caller without deck data) preserves the
 * pre-fix 1-copy-per-definition behavior — no blanket ×3 default, which
 * would over-flag broadly without deck evidence to back it. */
export const LEGAL_MAX_COPIES = 3;

function copyCountOf(id: number, copiesOf: ReadonlyMap<number, number> | undefined): number {
  if (copiesOf === undefined) return 1;
  return copiesOf.get(id) ?? LEGAL_MAX_COPIES;
}

function collectCostReducers(
  cards: readonly StaticCard[],
  copiesOf: ReadonlyMap<number, number> | undefined,
): readonly CostReducer[] {
  const out: CostReducer[] = [];
  for (const c of cards) {
    // §P1 (R3 fix): scanRiskyEffects walks EVERY ability kind (aura AND
    // triggered/activated) — the runtime genuinely supports triggered
    // one-shot cost reductions (effects/cost-reduction-handler.ts), and a
    // triggered self-discounting copier (cost-3 on_cast card that reduces
    // spells by 3 and copies itself) must not read as risk-free just because
    // the reducer wasn't wrapped in an `aura`.
    const copies = copyCountOf(c.id, copiesOf);
    for (const e of scanRiskyEffects(c.abilities).costReducers) {
      // firstPerTurn EXCLUDED here: this pool feeds effectiveCost(), which
      // governs loop SUSTAINABILITY — the marginal, per-iteration cost of
      // repeating a within-turn cycle. A firstPerTurn reduction (runtime ref:
      // cost-checker.ts:44, reductionMatches' usedThisTurn gate) discounts
      // only the FIRST matching cast each turn; every subsequent same-turn
      // cast pays full price. Modeling it as a standing discount would charge
      // a one-time saving on every loop traversal, understating the true
      // sustained cost (§ DEFECT A). Contrast with the maxPoolReduction guard
      // in balance-apply-edits.mjs, which deliberately COUNTS firstPerTurn —
      // that guard asks a different, conservative question ("could LOWERING
      // this cost enable churn?"), not "is this loop sustainable?" — the two
      // are not contradictory.
      if (e.appliesTo.firstPerTurn === true) continue;
      out.push({
        cardType: e.appliesTo.cardType,
        tag: e.appliesTo.tag,
        // §V4(a): each of the reducer's `copies` in-play instances stacks
        // simultaneously — mirrors the runtime totalReduction SUM, extended
        // from "one reducer definition" to "one reducer definition per copy".
        reduction: e.reduction * copies,
        sourceAlignment: c.alignment,
      });
    }
  }
  return out;
}

/** Can a reducer's source card and a candidate card genuinely be in the same
 * legal deck together (sim/deck-legality.ts: every main-deck card's faction
 * must equal the single-faction hero's)? An empty alignment means we don't
 * know the card's faction (e.g. a bare test fixture) — recall-biased: ASSUME
 * they CAN coexist rather than silently drop a real reducer. Two non-empty,
 * disjoint alignments (genuinely different single-faction cards) cannot. */
function canCoexist(a: readonly string[], b: readonly string[]): boolean {
  if (a.length === 0 || b.length === 0) return true;
  return a.some((x) => b.includes(x));
}

/** Effective cast cost after SUMMING every simultaneously-stackable matching
 * reducer, mirroring the runtime's totalReduction (actions/cost-checker.ts)
 * — including its costFloor: stacked discounts can't take a printed cost >=1
 * below an effective total of 1 (§12c). A reducer only stacks against a
 * candidate if the two could genuinely share a deck (§U1: the single-LARGEST
 * model understated stacked reducers; naive full-pool summing overstated
 * impossible cross-faction combinations — this scopes the same way the
 * existing cardType/tag match already scopes, extended to alignment). */
function totalReductionFor(card: StaticCard, reducers: readonly CostReducer[]): number {
  let reduction = 0;
  for (const r of reducers) {
    if (r.cardType !== undefined && card.cardType !== r.cardType) continue;
    if (r.tag !== undefined && !card.tags.includes(r.tag)) continue;
    if (!canCoexist(r.sourceAlignment, card.alignment)) continue;
    reduction += r.reduction;
  }
  const printed = totalCost(card);
  if (printed >= 1) return Math.min(reduction, printed - 1);
  return reduction;
}

function effectiveCost(card: StaticCard, reducers: readonly CostReducer[]): number {
  const reduction = totalReductionFor(card, reducers);
  return Math.max(0, totalCost(card) - reduction);
}

/** Lowers the loosest axis first (flexible → energy → mana), mirroring the
 * runtime's own discount order (actions/cost-checker.ts discountCost) — the
 * PER-AXIS counterpart of effectiveCost, needed so §R12-5's net-residual
 * accounting can tell a mana need from an energy need after reducers apply. */
function discountAxisCost(cost: ResourceCost, reduction: number): ResourceCost {
  let left = reduction;
  const take = (n: number): number => {
    const d = Math.min(n, left);
    left -= d;
    return n - d;
  };
  const flexible = take(cost.flexible);
  const energy = take(cost.energy);
  const mana = take(cost.mana);
  return { mana, energy, flexible };
}

function effectiveCostByAxis(card: StaticCard, reducers: readonly CostReducer[]): ResourceCost {
  const reduction = totalReductionFor(card, reducers);
  return discountAxisCost(card.cost, reduction);
}

// ── Graph edges ───────────────────────────────────────────────────────────────

/** One (card, ability, edge-effect) source: casting/triggering `from` can put
 * any of `targets` into hand/play/castable state. */
interface AbilitySource {
  readonly from: number;
  readonly targets: readonly number[];
  readonly resourceGain: AxisGain;
  readonly unconditionalFree?: boolean;
  readonly castFreeIfCost?: number;
  /** §H3-4 (batch-C): mana/energy/flexible cost to FIRE `from`'s activated
   * trigger (0 for any other trigger type) — paid EVERY traversal, on top of
   * whatever the acquired card itself costs to (re)cast. Previously ignored,
   * which understated the true per-loop cost of an activated-ability engine
   * (e.g. a hero's cooldown-gated recycle ability that costs real mana to
   * fire each time, independent of what it fetches). Kept per-axis (§R12-5)
   * so its mana/energy/flexible components fold into the same per-axis need
   * as the per-card costs, rather than collapsing to one scalar. */
  readonly activationCost: ResourceCost;
}

/** The activated trigger's own firing cost, per axis (all-zero for any other
 * trigger type). §R12-5 companion to the old scalar activationCostTotal
 * (loop-detector.ts) — this module needs the axis split, not the sum. */
function activationCostByAxis(t: Trigger): ResourceCost {
  return t.type === 'activated' ? t.cost : { mana: 0, energy: 0, flexible: 0 };
}

/** Is this trigger loop-shaped for the ACQUISITION graph (broader than v1's
 * per-ability isRepeatableTrigger): a spell recast fires on_cast again, and a
 * recursion-fed body fires on_deploy again each time it's redeployed. */
function isLoopGraphTrigger(t: Trigger): boolean {
  return isRepeatableTrigger(t) || t.type === 'on_cast' || t.type === 'on_deploy';
}

function buildSources(cards: readonly StaticCard[]): readonly AbilitySource[] {
  const sources: AbilitySource[] = [];
  for (const from of cards) {
    for (const ab of from.abilities) {
      if (ab.type !== 'triggered') continue;
      if (!isLoopGraphTrigger(ab.trigger)) continue;
      // A throttle of 'turn'/'game' fully bounds the ability to (at most) one
      // fire per turn/game — it can't be the repeating half of a cycle.
      // 'cooldown' still allows repetition across turns; kept (recall-biased).
      const throttle = abilityThrottle(ab);
      if (throttle === 'turn' || throttle === 'game') continue;

      const flat = flattenEffects(ab.effects);
      const gain = loopResourceGain(flat);
      const activationCost = activationCostByAxis(ab.trigger);
      for (const e of flat) {
        const spec = edgeEffectSpec(e);
        if (spec === undefined) continue;
        const targets = cards.filter((c) => matchesFilter(c, spec.filter)).map((c) => c.id);
        if (targets.length === 0) continue;
        sources.push({
          from: from.id,
          targets,
          resourceGain: gain,
          unconditionalFree: spec.unconditionalFree,
          castFreeIfCost: spec.castFreeIfCost,
          activationCost,
        });
      }
    }
  }
  return sources;
}

// ── Tarjan SCC (finds cycles, incl. self-loops, without exponential blowup) ──

function tarjanScc(
  nodes: readonly number[],
  adjacency: ReadonlyMap<number, ReadonlySet<number>>,
): number[][] {
  let counter = 0;
  const indices = new Map<number, number>();
  const lowlink = new Map<number, number>();
  const onStack = new Set<number>();
  const stack: number[] = [];
  const components: number[][] = [];

  function strongConnect(v: number): void {
    indices.set(v, counter);
    lowlink.set(v, counter);
    counter += 1;
    stack.push(v);
    onStack.add(v);

    for (const w of adjacency.get(v) ?? []) {
      if (!indices.has(w)) {
        strongConnect(w);
        lowlink.set(v, Math.min(lowlink.get(v) as number, lowlink.get(w) as number));
      } else if (onStack.has(w)) {
        lowlink.set(v, Math.min(lowlink.get(v) as number, indices.get(w) as number));
      }
    }

    if (lowlink.get(v) === indices.get(v)) {
      const component: number[] = [];
      let w: number;
      do {
        w = stack.pop() as number;
        onStack.delete(w);
        component.push(w);
      } while (w !== v);
      components.push(component);
    }
  }

  for (const v of nodes) if (!indices.has(v)) strongConnect(v);
  return components;
}

// ── Classification ────────────────────────────────────────────────────────────

function classifyGroup(
  members: ReadonlySet<number>,
  cardById: ReadonlyMap<number, StaticCard>,
  reducers: readonly CostReducer[],
  sources: readonly AbilitySource[],
): LoopRisk {
  // A member acquired via an unconditional free-cast/deploy edge (or a
  // castFreeIfCost edge whose threshold actually covers its cost) traverses
  // the cycle at ZERO net cost, regardless of its printed/effective cost —
  // that's the whole point of castForFree / search_deck→battlefield /
  // deploy_from_deck. Track those separately from the fuzzy "near threshold"
  // signal (which only bumps risk to 'possible', not free).
  const freeMembers = new Set<number>();
  let gainSum: AxisGain = { mana: 0, energy: 0 };
  // §H3-4 (batch-C): the activated trigger's own firing cost, charged once
  // per contributing source per traversal — additive with the per-card cast
  // costs summed below, never a substitute for them.
  let activationCostSum: ResourceCost = { mana: 0, energy: 0, flexible: 0 };
  let freeCastNear = false;
  for (const src of sources) {
    if (!members.has(src.from)) continue;
    const targetsInGroup = src.targets.filter((t) => members.has(t));
    if (targetsInGroup.length === 0) continue;
    gainSum = {
      mana: gainSum.mana + src.resourceGain.mana,
      energy: gainSum.energy + src.resourceGain.energy,
    };
    activationCostSum = {
      mana: activationCostSum.mana + src.activationCost.mana,
      energy: activationCostSum.energy + src.activationCost.energy,
      flexible: activationCostSum.flexible + src.activationCost.flexible,
    };
    for (const t of targetsInGroup) {
      if (src.unconditionalFree === true) {
        freeMembers.add(t);
        continue;
      }
      if (src.castFreeIfCost !== undefined) {
        const c = effectiveCost(cardById.get(t) as StaticCard, reducers);
        if (c <= src.castFreeIfCost) freeMembers.add(t);
        else if (Math.abs(c - src.castFreeIfCost) <= 1) freeCastNear = true;
      }
    }
  }

  let costSum: ResourceCost = activationCostSum;
  for (const id of members) {
    if (freeMembers.has(id)) continue;
    const axisCost = effectiveCostByAxis(cardById.get(id) as StaticCard, reducers);
    costSum = {
      mana: costSum.mana + axisCost.mana,
      energy: costSum.energy + axisCost.energy,
      flexible: costSum.flexible + axisCost.flexible,
    };
  }

  // §R12-5: per-axis net residual — mana and energy are tracked SEPARATELY,
  // so a gain on one specific axis can never pay a cost on the OTHER specific
  // axis. Only genuinely SPARE same-axis gains (what's left after covering
  // that axis's own need) can pay a flexible cost, mirroring the runtime's
  // own flexible-payment rule (actions/cost-checker.ts canAfford: flexible
  // draws from whatever mana/energy remains after specific costs are paid).
  const residMana = Math.max(0, costSum.mana - gainSum.mana);
  const residEnergy = Math.max(0, costSum.energy - gainSum.energy);
  const leftover =
    Math.max(0, gainSum.mana - costSum.mana) + Math.max(0, gainSum.energy - costSum.energy);
  const residFlex = Math.max(0, costSum.flexible - leftover);
  const netResidual = residMana + residEnergy + residFlex;

  // A direct, unthrottled self-copy at cost ≤1 is 'likely' regardless of the
  // net-cost arithmetic below — the classic Arcane-Echoes-at-1 failure mode:
  // at that price the chain is bounded only by discard/deck supply, not mana.
  // A self-loop that acquires itself via an unconditional free-cast/deploy
  // edge is 'likely' too, at ANY printed cost — the cost is never actually
  // paid on the repeating edge.
  const soleMember = [...members][0] as number;
  const selfLoopCheap =
    members.size === 1 &&
    (freeMembers.has(soleMember) ||
      effectiveCost(cardById.get(soleMember) as StaticCard, reducers) <= 1);

  if (netResidual <= 0 || selfLoopCheap) return 'likely';
  if (netResidual <= 2 || freeCastNear) return 'possible';
  return 'none';
}

// ── §V3 (round-7): per-cycle classification, not SCC aggregates ──────────────
// The old model classified a WHOLE strongly-connected component by one
// aggregate cost/gain sum — a cheap self-loop card sitting inside a big SCC
// diluted to 'none' the moment an expensive, merely-mutually-reachable card
// joined the same component (their costs summed together). The fix enumerates
// actual SIMPLE CYCLES within each SCC and classifies each cycle by ITS OWN
// member costs; a card's risk is the MAX over every cycle it participates in
// (self-loops included — a self-loop is a length-1 cycle found the same way).
//
// Bound: pools are ~130 cards with sparse acquisition edges, and a real
// repeatable-engine cycle is definitionally SHORT (a card re-acquiring itself
// through 5+ intermediate cards isn't "the loop," it's normal deck flow) — so
// cycles are capped at MAX_CYCLE_LEN=4 hops. A bounded DFS from every SCC
// member (not full Johnson's algorithm — simpler, and cheap at this pool
// size/edge sparsity) enumerates them. If an SCC exceeds
// SCC_ENUMERATION_BUDGET members, or no cycle <=4 hops is found inside an SCC
// known (by Tarjan) to contain at least one cycle, the WHOLE component falls
// back to a conservative 'possible' floor rather than 'none' — recall over
// precision, per the brief.
const MAX_CYCLE_LEN = 4;
const SCC_ENUMERATION_BUDGET = 20;

function canonicalCycleKey(cycle: readonly number[]): string {
  let minIdx = 0;
  for (let i = 1; i < cycle.length; i += 1) {
    if ((cycle[i] as number) < (cycle[minIdx] as number)) minIdx = i;
  }
  return [...cycle.slice(minIdx), ...cycle.slice(0, minIdx)].join(',');
}

function enumerateSimpleCycles(
  members: readonly number[],
  adjacency: ReadonlyMap<number, ReadonlySet<number>>,
  maxLen: number,
): number[][] {
  const memberSet = new Set(members);
  const cycles: number[][] = [];
  const seen = new Set<string>();
  for (const start of members) {
    const stack: number[] = [start];
    const visited = new Set<number>([start]);
    const dfs = (current: number): void => {
      for (const next of adjacency.get(current) ?? []) {
        if (!memberSet.has(next)) continue;
        if (next === start) {
          const key = canonicalCycleKey(stack);
          if (!seen.has(key)) {
            seen.add(key);
            cycles.push([...stack]);
          }
          continue;
        }
        if (visited.has(next) || stack.length >= maxLen) continue;
        visited.add(next);
        stack.push(next);
        dfs(next);
        stack.pop();
        visited.delete(next);
      }
    };
    dfs(start);
  }
  return cycles;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * §S4 loop-risk veto: for each card, the worst-case risk of a repeatable,
 * low/zero-net-cost re-acquisition cycle running through it. Consumed by
 * Layer 2 as BLOCKED (likely) / SIM_REQUIRED-adjacent (possible).
 *
 * `copiesOf` (§V4a, round-7): optional card-id -> legal deck-copy count, used
 * to multiply reducer sources by how many in-play instances a real deck can
 * field. See collectCostReducers' doc comment for the evidence policy.
 *
 * Pure and additive: does not touch v1's exports (detectCardLoops etc.), which
 * keep scoring per-ability engine risk independently.
 */
export function assessLoopRisk(
  cards: readonly StaticCard[],
  copiesOf?: ReadonlyMap<number, number>,
): ReadonlyMap<number, LoopRisk> {
  const cardById = new Map(cards.map((c) => [c.id, c] as const));
  const reducers = collectCostReducers(cards, copiesOf);
  const sources = buildSources(cards);

  const adjacency = new Map<number, Set<number>>();
  for (const c of cards) adjacency.set(c.id, new Set());
  for (const src of sources) {
    const set = adjacency.get(src.from);
    if (set === undefined) continue;
    for (const t of src.targets) set.add(t);
  }

  const result = new Map<number, LoopRisk>(cards.map((c) => [c.id, 'none' as LoopRisk]));

  const components = tarjanScc(
    cards.map((c) => c.id),
    adjacency,
  );
  for (const component of components) {
    const isSelfLoop =
      component.length === 1 &&
      (adjacency.get(component[0] as number)?.has(component[0] as number) ?? false);
    if (component.length === 1 && !isSelfLoop) continue; // trivial, acyclic node

    if (component.length > SCC_ENUMERATION_BUDGET) {
      // Bound hit: too large to exhaustively enumerate at this pool size —
      // conservative floor for every member (recall over precision).
      for (const id of component) result.set(id, maxRisk(result.get(id) as LoopRisk, 'possible'));
      continue;
    }

    const cycles = enumerateSimpleCycles(component, adjacency, MAX_CYCLE_LEN);
    if (cycles.length === 0) {
      // Tarjan guarantees this component IS a cycle (or a self-loop) — the
      // bounded DFS just didn't find one within MAX_CYCLE_LEN hops. A longer
      // cycle may still exist; conservative floor rather than 'none'.
      for (const id of component) result.set(id, maxRisk(result.get(id) as LoopRisk, 'possible'));
      continue;
    }
    // SCOPE NOTE (round-7 review): the zero-cycles floor above covers only the
    // nothing-found case. In a MIXED component (some cycles <= MAX_CYCLE_LEN
    // found, others longer), members lying ONLY on the longer cycles keep
    // 'none' — a deliberate precision choice (a >4-hop re-acquisition chain is
    // normal deck flow, not an engine), narrower than a blanket whole-component
    // floor. Disclosed limit.
    for (const cycle of cycles) {
      const members = new Set(cycle);
      const risk = classifyGroup(members, cardById, reducers, sources);
      for (const id of cycle) result.set(id, maxRisk(result.get(id) as LoopRisk, risk));
    }
  }

  // Backward feeder propagation: a card that can search/fetch-and-free-cast
  // INTO a risky cycle inherits that risk (the Master Archivist mechanism —
  // its own on_deploy is one-shot, but it drops the player straight into the
  // Echoes loop for free). Unconditional-free (castForFree / →battlefield /
  // deploy_from_deck) and castFreeIfCost-covered sources both propagate,
  // since a plain non-free fetch doesn't make the FEEDER itself repeatable.
  let changed = true;
  while (changed) {
    changed = false;
    for (const src of sources) {
      if (src.unconditionalFree !== true && src.castFreeIfCost === undefined) continue;
      let candidate: LoopRisk = 'none';
      for (const t of src.targets) {
        const targetCard = cardById.get(t) as StaticCard;
        const targetCost = effectiveCost(targetCard, reducers);
        if (src.unconditionalFree === true || targetCost <= (src.castFreeIfCost as number)) {
          candidate = maxRisk(candidate, result.get(t) as LoopRisk);
        } else if (Math.abs(targetCost - (src.castFreeIfCost as number)) <= 1) {
          candidate = maxRisk(candidate, 'possible');
        }
      }
      const current = result.get(src.from) as LoopRisk;
      const next = maxRisk(current, candidate);
      if (next !== current) {
        result.set(src.from, next);
        changed = true;
      }
    }
  }

  return result;
}
