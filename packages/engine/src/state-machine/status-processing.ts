/**
 * Status Processing — handles upkeep status effect ticks.
 * Applies persistent damage, regeneration, and decrements/removes expired statuses.
 */
import type { GameState, GameEvent, CardInstance } from '../types/game-state.js';
import { getAllCards } from '../zones/zone-manager.js';
import { updateCardInState, destroyCard } from '../state/index.js';

export function processStatusTicks(
  state: GameState,
): { readonly state: GameState; readonly events: readonly GameEvent[] } {
  const events: GameEvent[] = [];
  let currentState = state;

  for (let pi = 0; pi < 2; pi++) {
    const player = currentState.players[pi]!;
    const cards = getAllCards(player.zones);

    for (const card of cards) {
      if (card.statusEffects.length === 0) continue;

      const { updatedCard, cardEvents, shouldDestroy } = tickCardStatuses(card);
      events.push(...cardEvents);

      currentState = updateCardInState(
        currentState,
        card.instanceId,
        () => updatedCard,
      );

      if (shouldDestroy) {
        const destruction = destroyCard(currentState, card.instanceId, 'effect');
        currentState = destruction.state;
        events.push(...destruction.events);
      }
    }
  }

  return { state: currentState, events };
}

function tickCardStatuses(card: CardInstance): {
  readonly updatedCard: CardInstance;
  readonly cardEvents: readonly GameEvent[];
  readonly shouldDestroy: boolean;
} {
  const events: GameEvent[] = [];
  let currentHp = card.currentHp;

  for (const status of card.statusEffects) {
    if (status.statusType === 'persistent') {
      currentHp = Math.max(0, currentHp - status.value);
      events.push({
        type: 'DAMAGE_DEALT',
        sourceId: card.instanceId,
        targetId: card.instanceId,
        amount: status.value,
      });
    }

    if (status.statusType === 'regeneration') {
      const healAmount = Math.min(status.value, card.baseHp - currentHp);
      if (healAmount > 0) {
        currentHp += healAmount;
        events.push({
          type: 'CHARACTER_HEALED',
          cardInstanceId: card.instanceId,
          amount: healAmount,
        });
      }
    }
  }

  // Decrement remaining turns and remove expired statuses
  const remainingStatuses = card.statusEffects
    .map(status => {
      if (status.remainingTurns === null) return status;
      const remaining = status.remainingTurns - 1;
      if (remaining <= 0) return null;
      return { ...status, remainingTurns: remaining };
    })
    .filter((s): s is NonNullable<typeof s> => s !== null);

  return {
    updatedCard: {
      ...card,
      currentHp,
      statusEffects: remainingStatuses,
    },
    cardEvents: events,
    shouldDestroy: currentHp <= 0,
  };
}
