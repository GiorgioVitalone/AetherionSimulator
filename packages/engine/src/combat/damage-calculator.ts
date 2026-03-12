/**
 * Damage Calculator - pure math for combat damage resolution.
 * ARM reduces each damage instance individually (minimum 0).
 * Combat damage is simultaneous unless another card effect replaces it.
 */
import type { Trait } from '../types/common.js';

export interface DamageResult {
  readonly damageToDefender: number;
  readonly damageToAttacker: number;
  readonly defenderDestroyed: boolean;
  readonly attackerDestroyed: boolean;
}

function applyArm(rawDamage: number, arm: number): number {
  return Math.max(0, rawDamage - arm);
}

/**
 * Calculate combat damage between two characters.
 * - Simultaneous: both deal full ATK (minus ARM) before either is removed.
 */
export function calculateCombatDamage(
  attackerAtk: number,
  attackerArm: number,
  attackerHp: number,
  defenderAtk: number,
  defenderArm: number,
  defenderHp: number,
  _attackerTraits: readonly Trait[],
  _defenderTraits: readonly Trait[],
): DamageResult {
  const dmgToDefender = applyArm(attackerAtk, defenderArm);
  const dmgToAttacker = applyArm(defenderAtk, attackerArm);

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
