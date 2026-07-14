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
 * cost; cycles are classified by their net mana cost per traversal.
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
import type { CardTypeCode } from '../types/common.js';
import type { StaticCard } from './types.js';
import { flattenEffects } from './signal-extract.js';
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
  if (filter.maxHp !== undefined && (candidate.stats?.hp ?? 0) > filter.maxHp) return false;
  if (filter.maxAtk !== undefined && (candidate.stats?.atk ?? 0) > filter.maxAtk) return false;
  return true;
}

function targetFilterOf(target: TargetExpr): TargetFilter | undefined {
  return 'filter' in target ? target.filter : undefined;
}

interface EdgeEffectSpec {
  readonly filter: TargetFilter | undefined;
  readonly castFreeIfCost?: number;
}

/** Which effect types create a graph edge, and what they filter on. */
function edgeEffectSpec(e: Effect): EdgeEffectSpec | undefined {
  switch (e.type) {
    case 'copy_card':
      return { filter: e.filter };
    case 'search_deck':
      return { filter: e.filter, castFreeIfCost: e.castFreeIfCost };
    case 'deploy_from_deck':
      return { filter: e.filter };
    case 'return_from_discard':
      return { filter: targetFilterOf(e.target) };
    default:
      return undefined;
  }
}

function permanentResourceGain(flat: readonly Effect[]): number {
  // Only explicit gain_resource effects count. The universal Discard-for-
  // Energy floor (≥1 resource/turn) is a once-per-turn GAME rule, not a card
  // effect — it never appears here, and we deliberately never add it in, so a
  // repeatable cycle's "resource generation" can't be inflated by a mechanic
  // that can fire at most once per turn regardless of how many times the
  // cycle loops within that turn.
  let sum = 0;
  for (const e of flat) if (e.type === 'gain_resource' && e.temporary !== true) sum += e.amount;
  return sum;
}

// ── Cost-reduction annotations (auras) ────────────────────────────────────────

interface CostReducer {
  readonly cardType?: Extract<CardTypeCode, 'C' | 'S' | 'E'>;
  readonly tag?: string;
  readonly reduction: number;
}

function collectCostReducers(cards: readonly StaticCard[]): readonly CostReducer[] {
  const out: CostReducer[] = [];
  for (const c of cards) {
    for (const ab of c.abilities) {
      if (ab.type !== 'aura') continue;
      for (const e of flattenEffects(ab.effects)) {
        if (e.type !== 'cost_reduction') continue;
        out.push({ cardType: e.appliesTo.cardType, tag: e.appliesTo.tag, reduction: e.reduction });
      }
    }
  }
  return out;
}

/** Effective cast cost after the single LARGEST applicable reducer (not
 * stacked — assuming every reducer in the pool is simultaneously in play
 * would overstate risk pool-wide; recall-biased but bounded). */
function effectiveCost(card: StaticCard, reducers: readonly CostReducer[]): number {
  let reduction = 0;
  for (const r of reducers) {
    if (r.cardType !== undefined && card.cardType !== r.cardType) continue;
    if (r.tag !== undefined && !card.tags.includes(r.tag)) continue;
    reduction = Math.max(reduction, r.reduction);
  }
  return Math.max(0, totalCost(card) - reduction);
}

// ── Graph edges ───────────────────────────────────────────────────────────────

/** One (card, ability, edge-effect) source: casting/triggering `from` can put
 * any of `targets` into hand/play/castable state. */
interface AbilitySource {
  readonly from: number;
  readonly targets: readonly number[];
  readonly resourceGain: number;
  readonly castFreeIfCost?: number;
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
      const gain = permanentResourceGain(flat);
      for (const e of flat) {
        const spec = edgeEffectSpec(e);
        if (spec === undefined) continue;
        const targets = cards.filter((c) => matchesFilter(c, spec.filter)).map((c) => c.id);
        if (targets.length === 0) continue;
        sources.push({
          from: from.id,
          targets,
          resourceGain: gain,
          castFreeIfCost: spec.castFreeIfCost,
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
  let costSum = 0;
  for (const id of members) costSum += effectiveCost(cardById.get(id) as StaticCard, reducers);

  let gainSum = 0;
  let freeCastNear = false;
  for (const src of sources) {
    if (!members.has(src.from)) continue;
    const targetsInGroup = src.targets.filter((t) => members.has(t));
    if (targetsInGroup.length === 0) continue;
    gainSum += src.resourceGain;
    if (src.castFreeIfCost !== undefined) {
      for (const t of targetsInGroup) {
        const c = effectiveCost(cardById.get(t) as StaticCard, reducers);
        if (Math.abs(c - src.castFreeIfCost) <= 1) freeCastNear = true;
      }
    }
  }

  const net = costSum - gainSum;
  // A direct, unthrottled self-copy at cost ≤1 is 'likely' regardless of the
  // net-cost arithmetic below — the classic Arcane-Echoes-at-1 failure mode:
  // at that price the chain is bounded only by discard/deck supply, not mana.
  const selfLoopCheap =
    members.size === 1 &&
    effectiveCost(cardById.get([...members][0] as number) as StaticCard, reducers) <= 1;

  if (net <= 0 || selfLoopCheap) return 'likely';
  if (net <= 2 || freeCastNear) return 'possible';
  return 'none';
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * §S4 loop-risk veto: for each card, the worst-case risk of a repeatable,
 * low/zero-net-cost re-acquisition cycle running through it. Consumed by
 * Layer 2 as BLOCKED (likely) / SIM_REQUIRED-adjacent (possible).
 *
 * Pure and additive: does not touch v1's exports (detectCardLoops etc.), which
 * keep scoring per-ability engine risk independently.
 */
export function assessLoopRisk(cards: readonly StaticCard[]): ReadonlyMap<number, LoopRisk> {
  const cardById = new Map(cards.map((c) => [c.id, c] as const));
  const reducers = collectCostReducers(cards);
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
    const members = new Set(component);
    const risk = classifyGroup(members, cardById, reducers, sources);
    for (const id of component) result.set(id, maxRisk(result.get(id) as LoopRisk, risk));
  }

  // Backward feeder propagation: a card that can search/fetch-and-free-cast
  // INTO a risky cycle inherits that risk (the Master Archivist mechanism —
  // its own on_deploy is one-shot, but it drops the player straight into the
  // Echoes loop for free). Only castFreeIfCost-bearing sources propagate,
  // since a plain non-free fetch doesn't make the FEEDER itself repeatable.
  let changed = true;
  while (changed) {
    changed = false;
    for (const src of sources) {
      if (src.castFreeIfCost === undefined) continue;
      let candidate: LoopRisk = 'none';
      for (const t of src.targets) {
        const targetCard = cardById.get(t) as StaticCard;
        const targetCost = effectiveCost(targetCard, reducers);
        if (targetCost <= src.castFreeIfCost) {
          candidate = maxRisk(candidate, result.get(t) as LoopRisk);
        } else if (Math.abs(targetCost - src.castFreeIfCost) <= 1) {
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
