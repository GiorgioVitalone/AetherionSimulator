import type { CardInstance, GameState } from '../types/game-state.js';

/** Damage a character suffers per Reserve Energy Generation under
 * `reserveTapStrain` (§13m rules change): direct HP wear — no ARM mitigation,
 * no damage triggers. */
export const RESERVE_TAP_STRAIN_DAMAGE = 1;

/**
 * Eligible for Reserve Energy Generation (Rulebook 8, Upkeep step 4): a ready
 * (not exhausted), non-summoning-sick character. Snipers are excluded — they
 * stay ready to attack from Reserve. Under `reserveTapStrain`, a character with
 * only 1 HP left is too weak to generate (the strain would kill it; the floor
 * keeps the rule death-free). Shared by the automatic upkeep path and the
 * `tap_reserve` player action so the rule surface is identical in both modes.
 */
export function isReserveTapEligible(card: CardInstance, config: GameState['config']): boolean {
  if (card.cardType !== 'C') return false;
  if (card.exhausted || card.summoningSick) return false;
  if (card.traits.includes('sniper') || card.grantedTraits.some((g) => g.trait === 'sniper')) {
    return false;
  }
  if (config?.reserveTapStrain === true && card.currentHp <= RESERVE_TAP_STRAIN_DAMAGE) {
    return false;
  }
  return true;
}

/** Apply the tap to the card instance: exhaust it, disable ALL its abilities
 * until next Upkeep (Rulebook 8 step 4), and under strain apply the wear. */
export function tapReserveCard(card: CardInstance, config: GameState['config']): CardInstance {
  return {
    ...card,
    exhausted: true,
    reserveEnergyExhausted: true,
    ...(config?.reserveTapStrain === true
      ? { currentHp: card.currentHp - RESERVE_TAP_STRAIN_DAMAGE }
      : {}),
  };
}
