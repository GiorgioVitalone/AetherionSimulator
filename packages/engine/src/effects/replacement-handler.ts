/**
 * Replacement Handler — checks for replacement effects that intercept events.
 * E.g., "instead of being destroyed, exile and return to hand next upkeep."
 */
import type { ActiveReplacementEffect, CardInstance, GameState } from '../types/game-state.js';
import type { ReplacementEffect, ReplacedEvent } from '../types/effects.js';

export function checkReplacementEffect(
  card: CardInstance,
  eventType: ReplacedEvent['type'],
): ReplacementEffect | null {
  const active = card.replacementEffects.find(entry => entry.effect.replaces.type === eventType);
  if (active !== undefined) {
    return active.effect;
  }

  for (const ability of card.abilities) {
    if (ability.type !== 'triggered') continue;

    for (const effect of ability.effects) {
      if (effect.type === 'replacement' && effect.replaces.type === eventType) {
        return effect;
      }
    }
  }

  return null;
}

export function getActiveReplacementEffect(
  state: GameState,
  card: CardInstance,
  eventType: ReplacedEvent['type'],
): ActiveReplacementEffect | null {
  const activeEntry = card.replacementEffects.find(entry =>
    entry.effect.replaces.type === eventType &&
    (
      entry.effect.oncePerTurn !== true ||
      !state.turnState.usedReplacementEffectIds.includes(entry.id)
    ),
  );
  if (activeEntry !== undefined) {
    return activeEntry;
  }

  for (const ability of card.abilities) {
    if (ability.type !== 'triggered') continue;

    for (let effectIndex = 0; effectIndex < ability.effects.length; effectIndex++) {
      const effect = ability.effects[effectIndex];
      if (effect?.type === 'replacement' && effect.replaces.type === eventType) {
        return {
          id: `static:${card.instanceId}:${String(effectIndex)}`,
          sourceInstanceId: card.instanceId,
          controllerId: card.owner,
          effect,
          duration: { type: 'permanent' },
        };
      }
    }
  }

  return null;
}

export function markReplacementEffectUsed(
  state: GameState,
  replacementId: string,
): GameState {
  if (state.turnState.usedReplacementEffectIds.includes(replacementId)) {
    return state;
  }
  return {
    ...state,
    turnState: {
      ...state.turnState,
      usedReplacementEffectIds: [...state.turnState.usedReplacementEffectIds, replacementId],
    },
  };
}
