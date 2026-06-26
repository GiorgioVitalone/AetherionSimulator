/**
 * Destruction destination — decides where a removed non-token card goes.
 *
 * Volatile (Rulebook 16): "When this character is destroyed, exile it (remove it
 * from the game) instead of placing it in the discard pile." Exiled cards are not
 * placed anywhere retrievable, so Onyx discard-pile recursion can never reclaim a
 * Volatile unit. Tokens are always removed from the game regardless of Volatile.
 *
 * The card is still considered DESTROYED — Last Breath / on_destroy triggers fire
 * (the caller emits CARD_DESTROYED). This module only governs the destination.
 */
import type { CardInstance } from '../types/game-state.js';

/** A Volatile non-token card is exiled (removed from game) on destruction. */
export function isExiledOnDestruction(card: CardInstance): boolean {
  if (card.isToken) return true; // tokens never enter the discard pile
  return cardHasVolatile(card);
}

function cardHasVolatile(card: CardInstance): boolean {
  return (
    card.traits.includes('volatile') ||
    card.grantedTraits.some(g => g.trait === 'volatile')
  );
}

/**
 * Equipment-follows-to-discard (Rulebook 13): when a character carrying equipment
 * is removed (destroyed by an effect or in combat), the equipment is detached and
 * placed in the owner's discard pile as its own top-level entry — so discard-pile
 * recursion can reclaim it. Returns the holder with `equipment: null` plus the
 * detached equipment (reset to base) to push into the discard pile, or null when
 * the holder carries no equipment. Pure.
 */
export function detachEquipmentForDiscard(
  holder: CardInstance,
): { readonly holder: CardInstance; readonly equipment: CardInstance } | null {
  const equip = holder.equipment;
  if (equip === null) return null;
  return {
    holder: { ...holder, equipment: null },
    equipment: {
      ...equip,
      currentHp: equip.baseHp,
      currentAtk: equip.baseAtk,
      currentArm: equip.baseArm,
      xPaid: undefined,
    },
  };
}
