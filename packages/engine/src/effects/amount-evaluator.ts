/**
 * Amount Evaluator — resolves AmountExpr to a concrete number.
 */
import type { AmountExpr, CountingExpr, CountingFilter, DynamicStatSource, StatModifier } from '../types/common.js';
import type { GameState, EffectContext, CardInstance } from '../types/game-state.js';
import { getCardsInZone, getAllCards, getZoneArray } from '../zones/zone-manager.js';

export function evaluateAmount(
  state: GameState,
  amount: AmountExpr,
  context: EffectContext,
): number {
  switch (amount.type) {
    case 'fixed':
      return amount.value;
    case 'x_cost':
      // The variable cost paid for the source, captured at cast time in context.
      return context.xPaid ?? 0;
    case 'event_value':
      // Value carried by the triggering event (e.g. damage taken), threaded into
      // the EffectContext by the dispatch runtime. Absent ≡ 0.
      return context.eventValue ?? 0;
    case 'dice':
      // The roll is performed once via the engine's seeded RNG in the executeEffect
      // pre-pass (so the RNG counter persists deterministically) and threaded in as
      // context.rolledDice. Falls back to the minimum (one per die) if unrolled.
      return context.rolledDice ?? amount.count;
    case 'count':
      return evaluateCount(state, amount.counting, context, amount.max);
  }
}

/** Resolve a CountingExpr to a concrete number, clamped to `max` if given. */
function evaluateCount(
  state: GameState,
  counting: CountingExpr,
  context: EffectContext,
  max: number | undefined,
): number {
  const count = countValue(state, counting, context);
  return max !== undefined ? Math.min(count, max) : count;
}

function countValue(
  state: GameState,
  counting: CountingExpr,
  context: EffectContext,
): number {
  switch (counting.type) {
    case 'cards_in_zone':
      return countCardsInZone(state, counting, context.controllerId);
    case 'characters_destroyed_this_turn':
      return countEventsThisTurn(state, 'CARD_DESTROYED');
    case 'spells_cast_this_turn':
      return countEventsThisTurn(state, 'SPELL_CAST');
    case 'empty_slots': {
      const player = counting.side === 'enemy'
        ? state.players[context.controllerId === 0 ? 1 : 0]
        : state.players[context.controllerId];
      const zoneCards = getCardsInZone(player.zones, counting.zone);
      // Capacity = live zone-array length (respects a zone-capacity override),
      // identical to ZONE_SLOTS under the default 3/2 board.
      const zoneSlots = getZoneArray(player.zones, counting.zone).length;
      return zoneSlots - zoneCards.length;
    }
  }
}

/**
 * Count log events of `eventType` that occurred during the current turn — i.e.
 * after the most recent TURN_START. When no TURN_START has been logged yet
 * (turn 1 / test fixtures) every matching event counts, which still equals the
 * this-turn total. The full log spans the whole game, so unscoped counting would
 * be wrong for "this turn" effects.
 */
function countEventsThisTurn(state: GameState, eventType: 'CARD_DESTROYED' | 'SPELL_CAST'): number {
  let lastTurnStart = -1;
  for (let i = state.log.length - 1; i >= 0; i--) {
    if (state.log[i]!.type === 'TURN_START') { lastTurnStart = i; break; }
  }
  let count = 0;
  for (let i = lastTurnStart + 1; i < state.log.length; i++) {
    if (state.log[i]!.type === eventType) count++;
  }
  return count;
}

/**
 * Resolve a DynamicStatSource against a concrete target card to the stat delta
 * it contributes. Shared by the effect interpreter (one-shot modify_stats) and
 * the aura recompute (continuous auras) so both agree on the math.
 */
export function evaluateDynamicStat(
  state: GameState,
  dynamic: DynamicStatSource,
  target: CardInstance,
  context: EffectContext,
): StatModifier {
  switch (dynamic.type) {
    case 'equals_stat': {
      const ref = dynamic.sourceRef === 'atk' ? target.currentAtk
        : dynamic.sourceRef === 'hp' ? target.currentHp : target.currentArm;
      return { [dynamic.stat]: ref };
    }
    case 'multiply': {
      const base = dynamic.factor - 1;
      return {
        atk: target.currentAtk * base,
        hp: target.currentHp * base,
        arm: target.currentArm * base,
      };
    }
    case 'per_count':
      return { [dynamic.stat]: evaluateCount(state, dynamic.counting, context, undefined) * dynamic.valuePerCount };
    case 'x_cost':
      return { [dynamic.stat]: context.xPaid ?? 0 };
  }
}

function countCardsInZone(
  state: GameState,
  counting: Extract<AmountExpr, { type: 'count' }>['counting'] & { type: 'cards_in_zone' },
  controllerId: 0 | 1,
): number {
  const playerIndex = counting.side === 'enemy'
    ? (controllerId === 0 ? 1 : 0)
    : controllerId;
  const player = state.players[playerIndex];

  switch (counting.zone) {
    case 'hand':
      return filterCards(player.hand, counting.filter).length;
    case 'discard':
      return filterCards(player.discardPile, counting.filter).length;
    case 'resource_bank':
      return player.resourceBank.length;
    case 'battlefield':
      return filterCards(getAllCards(player.zones), counting.filter).length;
  }
}

function filterCards(
  cards: readonly CardInstance[],
  filter: CountingFilter | undefined,
): readonly CardInstance[] {
  if (filter === undefined) return cards;
  return cards.filter(c => {
    if (filter.cardType !== undefined && c.cardType !== filter.cardType) return false;
    if (filter.trait !== undefined && !c.traits.includes(filter.trait)) return false;
    if (filter.tag !== undefined && !c.tags.includes(filter.tag)) return false;
    if (filter.maxCost !== undefined) {
      const totalCost = c.cost.mana + c.cost.energy + c.cost.flexible;
      if (totalCost > filter.maxCost) return false;
    }
    return true;
  });
}
