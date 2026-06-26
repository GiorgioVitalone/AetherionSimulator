/**
 * Aura Recompute — continuous passive recomputation.
 * Strips every aura-sourced modifier, then re-applies the stat/trait effects of
 * each in-play 'aura' AbilityDSL, honoring dynamic modifiers (e.g. ATK += ARM).
 *
 * Aura modifiers are tagged with an `aura_` id prefix and `while_in_play`
 * duration so they can be cleanly removed and rebuilt on every recompute.
 */
import type {
  GameState,
  CardInstance,
  EffectContext,
  ActiveModifier,
  ActiveCostReduction,
  PlayerState,
} from '../types/game-state.js';
import type { AuraAbilityDSL } from '../types/ability.js';
import type { Effect } from '../types/effects.js';
import type { StatModifier } from '../types/common.js';
import { getAllCards } from '../zones/zone-manager.js';
import { resolveTargets } from '../effects/target-resolver.js';
import { evaluateCondition } from '../effects/condition-evaluator.js';
import { evaluateDynamicStat } from '../effects/amount-evaluator.js';
import { updateCardInState, findCardInState } from '../effects/state-helpers.js';
import {
  isAuraNonStatEffect,
  applyAuraNonStatEffect,
  stripAllAuraNonStat,
} from './aura-nonstat.js';

const AURA_PREFIX = 'aura_';

function isAuraModifier(m: ActiveModifier): boolean {
  return m.id.startsWith(AURA_PREFIX);
}

/** Remove aura modifiers from every card and undo their stat contribution. */
function stripAuras(card: CardInstance): CardInstance {
  if (!card.modifiers.some(isAuraModifier)) return card;
  let atk = card.currentAtk;
  let hp = card.currentHp;
  let arm = card.currentArm;
  for (const m of card.modifiers) {
    if (!isAuraModifier(m)) continue;
    atk -= m.modifier.atk ?? 0;
    hp -= m.modifier.hp ?? 0;
    arm -= m.modifier.arm ?? 0;
  }
  return {
    ...card,
    currentAtk: atk,
    currentHp: hp,
    currentArm: arm,
    modifiers: card.modifiers.filter(m => !isAuraModifier(m)),
  };
}

function stripAllAuras(state: GameState): GameState {
  return {
    ...state,
    players: state.players.map(player => ({
      ...stripAuraCostReductions(player),
      zones: {
        reserve: player.zones.reserve.map(c => (c === null ? null : stripAuras(c))),
        frontline: player.zones.frontline.map(c => (c === null ? null : stripAuras(c))),
        highGround: player.zones.highGround.map(c => (c === null ? null : stripAuras(c))),
      },
    })) as unknown as readonly [GameState['players'][0], GameState['players'][1]],
  };
}

/** Snapshot the `usedThisTurn` flag of every aura cost reduction by id so it can
 * be carried across the strip-and-rebuild that each recompute performs. */
function snapshotAuraCostReductionUse(state: GameState): ReadonlyMap<string, boolean> {
  const map = new Map<string, boolean>();
  for (const player of state.players) {
    for (const red of player.costReductions ?? []) {
      if (red.id.startsWith(AURA_PREFIX)) map.set(red.id, red.usedThisTurn);
    }
  }
  return map;
}

/** Remove aura-sourced cost reductions from a player; keep one-shot (effect-
 * registered) reductions untouched so they still expire at end of turn. */
function stripAuraCostReductions(player: PlayerState): PlayerState {
  const reductions = player.costReductions;
  if (reductions === undefined) return player;
  const kept = reductions.filter(r => !r.id.startsWith(AURA_PREFIX));
  if (kept.length === reductions.length) return player;
  return { ...player, costReductions: kept.length === 0 ? undefined : kept };
}

/** Register one aura `cost_reduction` effect onto its controller, preserving the
 * `usedThisTurn` flag of the same aura reduction from the previous recompute so
 * `firstPerTurn` discounts stay consumed across the per-action recompute. */
function applyAuraCostReduction(
  state: GameState,
  effect: Extract<Effect, { type: 'cost_reduction' }>,
  context: EffectContext,
  auraIndex: number,
  priorUsed: ReadonlyMap<string, boolean>,
): GameState {
  const player = state.players[context.controllerId]!;
  const id = `${AURA_PREFIX}cr_${context.sourceInstanceId}_${String(auraIndex)}`;
  const registration: ActiveCostReduction = {
    id,
    reduction: effect.reduction,
    appliesTo: effect.appliesTo,
    usedThisTurn: priorUsed.get(id) ?? false,
  };
  const newPlayer: PlayerState = {
    ...player,
    costReductions: [...(player.costReductions ?? []), registration],
  };
  const players = [...state.players] as [PlayerState, PlayerState];
  players[context.controllerId] = newPlayer;
  return { ...state, players };
}

function combine(a: StatModifier, b: StatModifier): StatModifier {
  return {
    atk: (a.atk ?? 0) + (b.atk ?? 0),
    hp: (a.hp ?? 0) + (b.hp ?? 0),
    arm: (a.arm ?? 0) + (b.arm ?? 0),
  };
}

/** Apply one aura modify_stats effect to its resolved targets. */
function applyAuraStatEffect(
  state: GameState,
  effect: Extract<Effect, { type: 'modify_stats' }>,
  context: EffectContext,
  auraIndex: number,
): GameState {
  const resolved = resolveTargets(state, effect.target, context);
  if (!resolved.resolved) return state;
  let current = state;
  for (const targetId of resolved.targetIds) {
    const target = findCardInState(current, targetId);
    if (target === null) continue;
    const dyn = effect.dynamicModifier !== undefined
      ? evaluateDynamicStat(state, effect.dynamicModifier, target, context)
      : {};
    const total = combine(effect.modifier, dyn);
    if ((total.atk ?? 0) === 0 && (total.hp ?? 0) === 0 && (total.arm ?? 0) === 0) continue;
    const modifier: ActiveModifier = {
      id: `${AURA_PREFIX}${context.sourceInstanceId}_${String(auraIndex)}`,
      sourceInstanceId: context.sourceInstanceId,
      modifier: total,
      duration: { type: 'while_in_play', sourceId: context.sourceInstanceId },
    };
    current = updateCardInState(current, targetId, c => ({
      ...c,
      currentAtk: c.currentAtk + (total.atk ?? 0),
      currentHp: c.currentHp + (total.hp ?? 0),
      currentArm: c.currentArm + (total.arm ?? 0),
      modifiers: [...c.modifiers, modifier],
    }));
  }
  return current;
}

interface AuraSource {
  readonly card: CardInstance;
  readonly controllerId: 0 | 1;
}

function collectAuraSources(state: GameState): readonly AuraSource[] {
  const out: AuraSource[] = [];
  for (let pi = 0; pi < 2; pi++) {
    const controllerId = pi as 0 | 1;
    for (const card of getAllCards(state.players[controllerId]!.zones)) {
      // A character exhausted for Reserve Energy Generation has ALL abilities —
      // including passive Auras — disabled until next Upkeep (Rulebook 8 step 4).
      if (card.reserveEnergyExhausted === true) continue;
      if (card.abilities.some(a => a.type === 'aura')) out.push({ card, controllerId });
      // Attached equipment can carry its own continuous auras (e.g. Steel-Root
      // Armor's +0/+X HP); the source is the equipment instance so `equipped_character`
      // resolves to its host and its recorded xPaid feeds x_cost grants.
      const equip = card.equipment;
      if (equip !== null && equip.abilities.some(a => a.type === 'aura')) {
        out.push({ card: equip, controllerId });
      }
    }
  }
  return out;
}

/**
 * EC-001 — combine a body's ACTIVE ARM BUFFS by `max` instead of `sum`.
 *
 * "Active ARM buffs" are the positive ARM contributions tracked in
 * `card.modifiers` — both timed `modify_stats` modifiers (until_end_of_turn /
 * until_next_upkeep) and continuous aura ARM bonuses (aura_ ids). By the time
 * this runs (tail of recomputeAuras), every such modifier is present in the set,
 * so taking the max across the whole set satisfies "effective ARM = baseArm +
 * max(active ARM buffs)". The running scalar is corrected in place:
 *   currentArm := currentArm − Σ(positive arm buffs) + max(positive arm buffs).
 * Base/permanent ARM (never tracked as a modifier) and ARM debuffs (negative
 * contributions) are untouched. ATK/HP are untouched.
 *
 * Two responsibilities, gated independently:
 *  - INSTRUMENTATION (always, when a `diag` with armBuffsStackedEvents is
 *    supplied): tally bodies carrying 2+ positive ARM buffs and the (sum−max)
 *    points the rule would shave. Read-only; measurable on baseline (toggle OFF).
 *  - MUTATION (only when config.armBuffsTakeMax === true): rewrite currentArm.
 */
function applyArmBuffMaxRule(state: GameState): GameState {
  const takeMax = state.config?.armBuffsTakeMax === true;
  const diag = state.config?.diag;
  const measure = diag?.armBuffsStackedEvents !== undefined;
  if (!takeMax && !measure) return state;

  const adjust = (card: CardInstance | null): CardInstance | null => {
    if (card === null) return card;
    let sum = 0;
    let max = 0;
    let count = 0;
    for (const m of card.modifiers) {
      const arm = m.modifier.arm ?? 0;
      if (arm <= 0) continue;
      sum += arm;
      if (arm > max) max = arm;
      count++;
    }
    if (count < 2) return card;
    if (measure && diag !== undefined) {
      diag.armBuffsStackedEvents![card.owner]++;
      diag.armBuffsStackedShaved![card.owner] += sum - max;
    }
    if (!takeMax) return card;
    // Shave the redundant (sum − max) ARM, but record it as an aura-tagged
    // compensating modifier rather than only lowering the scalar. The buffs stay in
    // `card.modifiers` at full value, so the next recompute's stripAuras subtracts
    // their full sum from currentArm; tagging the −shave modifier `aura_` means it is
    // stripped in the same pass, cancelling exactly the over-subtraction. Without it,
    // strip removes the full sum from an already-collapsed currentArm and ARM drifts
    // down by (sum − max) every recompute (unbounded for unequal aura buffs).
    const shave = sum - max;
    if (shave === 0) return card;
    const compensator: ActiveModifier = {
      id: `${AURA_PREFIX}armmax_${card.instanceId}`,
      sourceInstanceId: card.instanceId,
      modifier: { atk: 0, hp: 0, arm: -shave },
      duration: { type: 'while_in_play', sourceId: card.instanceId },
    };
    return {
      ...card,
      currentArm: card.currentArm - shave,
      modifiers: [...card.modifiers, compensator],
    };
  };

  return {
    ...state,
    players: state.players.map(player => ({
      ...player,
      zones: {
        reserve: player.zones.reserve.map(adjust),
        frontline: player.zones.frontline.map(adjust),
        highGround: player.zones.highGround.map(adjust),
      },
    })) as unknown as readonly [GameState['players'][0], GameState['players'][1]],
  };
}

/**
 * Recompute all aura-sourced stat modifiers from scratch.
 * Pure: returns a new state with aura modifiers reset and re-applied.
 */
export function recomputeAuras(state: GameState): GameState {
  const priorUsed = snapshotAuraCostReductionUse(state);
  let current = stripAllAuraNonStat(stripAllAuras(state));
  for (const { card, controllerId } of collectAuraSources(state)) {
    const context: EffectContext = {
      sourceInstanceId: card.instanceId,
      controllerId,
      triggerDepth: 0,
      ...(card.xPaid !== undefined ? { xPaid: card.xPaid } : {}),
    };
    card.abilities.forEach((ability, index) => {
      if (ability.type !== 'aura') return;
      const aura: AuraAbilityDSL = ability;
      if (aura.condition !== undefined && !evaluateCondition(current, aura.condition, context)) {
        return;
      }
      for (const effect of aura.effects) {
        if (effect.type === 'modify_stats') {
          current = applyAuraStatEffect(current, effect, context, index);
        } else if (effect.type === 'cost_reduction') {
          current = applyAuraCostReduction(current, effect, context, index, priorUsed);
        } else if (isAuraNonStatEffect(effect)) {
          current = applyAuraNonStatEffect(current, effect, context, index);
        }
      }
    });
  }
  // EC-001 tail pass — combine ARM buffs by max (and/or instrument co-occurrence).
  // No-op unless config.armBuffsTakeMax is set or a co-occurrence diag is present.
  return applyArmBuffMaxRule(current);
}
