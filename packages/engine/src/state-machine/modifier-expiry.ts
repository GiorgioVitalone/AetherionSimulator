/**
 * Modifier Expiry — removes end-of-turn modifiers and granted traits.
 * Checks for destruction when HP-granting modifiers expire.
 */
import type { GameState, GameEvent, CardInstance } from '../types/game-state.js';
import { getAllCards } from '../zones/zone-manager.js';
import { updateCardInState, destroyCard } from '../state/index.js';

export function expireEndOfTurnModifiers(
  state: GameState,
): { readonly state: GameState; readonly events: readonly GameEvent[] } {
  const events: GameEvent[] = [];
  let currentState = state;

  for (let pi = 0; pi < 2; pi++) {
    const player = currentState.players[pi]!;
    const cards = getAllCards(player.zones);

    for (const card of cards) {
      const hasExpiring =
        card.modifiers.some(m => m.duration.type === 'until_end_of_turn') ||
        card.grantedTraits.some(g => g.duration.type === 'until_end_of_turn');

      if (!hasExpiring) continue;

      const { updatedCard, shouldDestroy } = expireCardModifiers(card);
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

function expireCardModifiers(card: CardInstance): {
  readonly updatedCard: CardInstance;
  readonly shouldDestroy: boolean;
} {
  // Calculate HP being removed from expiring modifiers
  let hpLoss = 0;
  for (const modifier of card.modifiers) {
    if (
      modifier.duration.type === 'until_end_of_turn' &&
      modifier.modifier.hp !== undefined &&
      modifier.modifier.hp > 0
    ) {
      hpLoss += modifier.modifier.hp;
    }
  }

  // Calculate stat adjustments from expiring modifiers
  let atkLoss = 0;
  let armLoss = 0;
  for (const modifier of card.modifiers) {
    if (modifier.duration.type === 'until_end_of_turn') {
      atkLoss += modifier.modifier.atk ?? 0;
      armLoss += modifier.modifier.arm ?? 0;
    }
  }

  const remainingModifiers = card.modifiers.filter(
    m => m.duration.type !== 'until_end_of_turn',
  );

  const remainingTraits = card.grantedTraits.filter(
    g => g.duration.type !== 'until_end_of_turn',
  );

  const newHp = Math.max(0, card.currentHp - hpLoss);

  return {
    updatedCard: {
      ...card,
      currentHp: newHp,
      currentAtk: card.currentAtk - atkLoss,
      currentArm: card.currentArm - armLoss,
      modifiers: remainingModifiers,
      grantedTraits: remainingTraits,
    },
    shouldDestroy: newHp <= 0 && card.currentHp > 0,
  };
}
