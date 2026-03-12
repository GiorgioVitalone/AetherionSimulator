/**
 * Amount Evaluator — resolves AmountExpr to a concrete number.
 */
import type { AmountExpr, CountingFilter } from '../types/common.js';
import type { GameState, EffectContext, CardInstance } from '../types/game-state.js';
import { getCardsInZone, getAllCards } from '../zones/zone-manager.js';
import { ZONE_SLOTS } from '../types/game-state.js';

export function evaluateAmount(
  state: GameState,
  amount: AmountExpr,
  context: EffectContext,
): number {
  switch (amount.type) {
    case 'fixed':
      return amount.value;
    case 'x_cost':
      return context.xValue ?? 0;
    case 'event_value':
      // Event-derived value — resolved by event context
      return 0; // Placeholder: resolved by event system
    case 'dice':
      // Dice rolls use PRNG — placeholder until integrated
      return amount.count; // Minimum roll (1 per die)
    case 'count': {
      const { counting } = amount;
      let count: number;

      switch (counting.type) {
        case 'cards_in_zone': {
          count = countCardsInZone(state, counting, context.controllerId);
          break;
        }
        case 'characters_destroyed_this_turn':
          count = state.log.filter(e => e.type === 'CARD_DESTROYED').length;
          break;
        case 'spells_cast_this_turn':
          count = state.log.filter(e => e.type === 'SPELL_CAST').length;
          break;
        case 'empty_slots': {
          const player = counting.side === 'enemy'
            ? state.players[context.controllerId === 0 ? 1 : 0]!
            : state.players[context.controllerId]!;
          const zoneCards = getCardsInZone(player.zones, counting.zone);
          const zoneSlots = ZONE_SLOTS[counting.zone];
          count = zoneSlots - zoneCards.length;
          break;
        }
      }

      return amount.max !== undefined ? Math.min(count, amount.max) : count;
    }
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
  const player = state.players[playerIndex]!;

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
