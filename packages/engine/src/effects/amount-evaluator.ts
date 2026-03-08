/**
 * Amount Evaluator — resolves AmountExpr to a concrete number.
 */
import type { AmountExpr } from '../types/common.js';
import type { GameState, EffectContext } from '../types/game-state.js';
import { getCardsInZone, getAllCards } from '../zones/zone-manager.js';

export function evaluateAmount(
  state: GameState,
  amount: AmountExpr,
  context: EffectContext,
): number {
  switch (amount.type) {
    case 'fixed':
      return amount.value;
    case 'x_cost':
      // X cost is determined at cast time — stored in context
      return 0; // Placeholder: resolved by cost-payment system
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
          const zoneSlots = counting.zone === 'frontline' ? 3 : 2;
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
      return applyCountFilter(player.hand.length, counting);
    case 'discard':
      return applyCountFilter(player.discardPile.length, counting);
    case 'resource_bank':
      return player.resourceBank.length;
    case 'battlefield':
      return getAllCards(player.zones).filter(c => {
        if (counting.filter === undefined) return true;
        if (counting.filter.cardType !== undefined && c.cardType !== counting.filter.cardType) return false;
        if (counting.filter.trait !== undefined && !c.traits.includes(counting.filter.trait)) return false;
        if (counting.filter.tag !== undefined && !c.tags.includes(counting.filter.tag)) return false;
        if (counting.filter.maxCost !== undefined) {
          const totalCost = c.cost.mana + c.cost.energy + c.cost.flexible;
          if (totalCost > counting.filter.maxCost) return false;
        }
        return true;
      }).length;
  }
}

function applyCountFilter(
  baseCount: number,
  _counting: { filter?: { cardType?: string } },
): number {
  // For hand/discard we'd need card references; for now return base count
  // Full filtering requires access to the card list — acceptable simplification
  return baseCount;
}
