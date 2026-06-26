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

/** DESIGN-SWEEP: scale a post-ARM, post-replacement combat-damage amount by
 * `scale` (default 1 ⇒ unchanged), rounding with Math.round (engine standard).
 * Applied here — the single source of truth — so the scaled magnitude also drives
 * destruction / First Strike lethality consistently. */
function scaleDamage(damage: number, scale: number): number {
  return scale === 1 ? damage : Math.round(damage * scale);
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
  reduceDefender: (raw: number) => number = (raw) => raw,
  reduceAttacker: (raw: number) => number = (raw) => raw,
  damageScale = 1,
): DamageResult {
  // ARM mitigates first (per-instance), then "would take damage" replacements
  // (e.g. an aura -1) reduce the post-ARM amount, before HP is consulted. The
  // design-sweep damageScale then multiplies the final amount (default 1 = no-op),
  // so both HP loss AND First Strike lethality reflect the scaled magnitude.
  const dmgToDefender = scaleDamage(reduceDefender(applyArm(attackerAtk, defenderArm)), damageScale);
  const dmgToAttacker = scaleDamage(reduceAttacker(applyArm(defenderAtk, attackerArm)), damageScale);

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
  damageScale = 1,
): number {
  return scaleDamage(applyArm(attackerAtk, heroArm), damageScale);
}
