/**
 * Damage Calculator — pure math for combat damage resolution.
 * ARM reduces each damage instance individually (minimum 0).
 * Simultaneous damage by default; First Strike alters ordering.
 */
import type { Trait } from '../types/common.js';

export interface DamageResult {
  readonly damageToDefender: number;
  readonly damageToAttacker: number;
  readonly defenderDestroyed: boolean;
  readonly attackerDestroyed: boolean;
}

function hasTrait(traits: readonly Trait[], trait: Trait): boolean {
  return traits.includes(trait);
}

function applyArm(rawDamage: number, arm: number): number {
  return Math.max(0, rawDamage - arm);
}

/**
 * Calculate combat damage between two characters.
 * - Simultaneous: both deal full ATK (minus ARM) before either is removed.
 * - First Strike: attacker deals first; if defender dies, no counter-damage.
 * - Both First Strike: cancels out, damage is simultaneous.
 */
export function calculateCombatDamage(
  attackerAtk: number,
  attackerArm: number,
  attackerHp: number,
  defenderAtk: number,
  defenderArm: number,
  defenderHp: number,
  attackerTraits: readonly Trait[],
  defenderTraits: readonly Trait[],
): DamageResult {
  const dmgToDefender = applyArm(attackerAtk, defenderArm);
  const dmgToAttacker = applyArm(defenderAtk, attackerArm);

  const attackerHasFS = hasTrait(attackerTraits, 'first_strike');
  const defenderHasFS = hasTrait(defenderTraits, 'first_strike');

  // Both have First Strike → cancels out → simultaneous
  if (attackerHasFS && !defenderHasFS) {
    // Attacker strikes first
    const defenderDead = defenderHp - dmgToDefender <= 0;
    return {
      damageToDefender: dmgToDefender,
      damageToAttacker: defenderDead ? 0 : dmgToAttacker,
      defenderDestroyed: defenderDead,
      attackerDestroyed: defenderDead ? false : attackerHp - dmgToAttacker <= 0,
    };
  }

  if (defenderHasFS && !attackerHasFS) {
    // Defender strikes first
    const attackerDead = attackerHp - dmgToAttacker <= 0;
    return {
      damageToDefender: attackerDead ? 0 : dmgToDefender,
      damageToAttacker: dmgToAttacker,
      defenderDestroyed: attackerDead
        ? false
        : defenderHp - dmgToDefender <= 0,
      attackerDestroyed: attackerDead,
    };
  }

  // Simultaneous (default, or both have First Strike)
  return {
    damageToDefender: dmgToDefender,
    damageToAttacker: dmgToAttacker,
    defenderDestroyed: defenderHp - dmgToDefender <= 0,
    attackerDestroyed: attackerHp - dmgToAttacker <= 0,
  };
}

/**
 * Calculate damage to hero (hero does NOT deal counter-damage).
 */
export function calculateHeroDamage(
  attackerAtk: number,
  heroArm: number,
): number {
  return applyArm(attackerAtk, heroArm);
}
