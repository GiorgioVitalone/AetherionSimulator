/**
 * Replacement Handler — checks for replacement effects that intercept events.
 * E.g., "instead of being destroyed, exile and return to hand next upkeep."
 */
import type { CardInstance } from '../types/game-state.js';
import type { ReplacementEffect, ReplacedEvent } from '../types/effects.js';

export function checkReplacementEffect(
  card: CardInstance,
  eventType: ReplacedEvent['type'],
): ReplacementEffect | null {
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
