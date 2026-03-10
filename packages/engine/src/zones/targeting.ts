/**
 * Attack Targeting — determines valid attack targets based on zone positions,
 * Defender priority, Flying bypass, Sniper from Reserve, and Empty Board Rule.
 */
import type { CardInstance, ZoneState } from '../types/game-state.js';
import type { Trait, ZoneType } from '../types/common.js';
import { getCardsInZone } from './zone-manager.js';

// ── Attack Target ────────────────────────────────────────────────────────────

export interface AttackTarget {
  readonly type: 'character' | 'hero';
  readonly instanceId: string | null;
}

function characterTarget(instanceId: string): AttackTarget {
  return { type: 'character', instanceId };
}

function heroTarget(): AttackTarget {
  return { type: 'hero', instanceId: null };
}

// ── Trait Helpers ─────────────────────────────────────────────────────────────

function hasTrait(traits: readonly Trait[], trait: Trait): boolean {
  return traits.includes(trait);
}

function cardHasTrait(card: CardInstance, trait: Trait): boolean {
  return hasTrait(card.traits, trait) ||
    card.grantedTraits.some(g => g.trait === trait);
}

// ── Board State Queries ──────────────────────────────────────────────────────

export function isBoardEmpty(zones: ZoneState): boolean {
  const frontline = getCardsInZone(zones, 'frontline');
  const highGround = getCardsInZone(zones, 'high_ground');
  return frontline.length === 0 && highGround.length === 0;
}

function getDefendersInFrontline(zones: ZoneState): readonly CardInstance[] {
  return getCardsInZone(zones, 'frontline').filter(c => cardHasTrait(c, 'defender'));
}

// ── Core Targeting ───────────────────────────────────────────────────────────

/**
 * Compute valid attack targets for a character at a given zone.
 * Accounts for: zone attack matrix, Defender priority, Flying bypass,
 * Sniper from Reserve, and Empty Board Rule.
 */
export function getValidAttackTargets(
  attackerZone: ZoneType,
  attackerTraits: readonly Trait[],
  defenderZones: ZoneState,
): readonly AttackTarget[] {
  const isFlying = hasTrait(attackerTraits, 'flying');
  const isSniper = hasTrait(attackerTraits, 'sniper');

  // Empty Board Rule: any attacker can hit Hero
  if (isBoardEmpty(defenderZones)) {
    return [heroTarget()];
  }

  // Reserve: cannot attack unless Sniper (targets enemy Frontline only)
  if (attackerZone === 'reserve') {
    if (!isSniper) return [];
    return applyDefenderPriority(
      getCardsInZone(defenderZones, 'frontline'),
      defenderZones,
      isFlying,
      false,
    );
  }

  // Determine reachable zones based on attacker position
  const reachableZones = getReachableZones(attackerZone);
  const canTargetHero = attackerZone === 'high_ground';

  // Collect all characters in reachable zones
  const reachableCharacters = reachableZones.flatMap(zone =>
    getCardsInZone(defenderZones, zone),
  );

  // Apply Defender priority
  return applyDefenderPriority(
    reachableCharacters,
    defenderZones,
    isFlying,
    canTargetHero,
  );
}

function getReachableZones(attackerZone: ZoneType): readonly ZoneType[] {
  switch (attackerZone) {
    case 'frontline':
      return ['frontline', 'high_ground'];
    case 'high_ground':
      return ['frontline', 'high_ground'];
    case 'reserve':
      return [];
  }
}

function applyDefenderPriority(
  reachableCharacters: readonly CardInstance[],
  defenderZones: ZoneState,
  attackerIsFlying: boolean,
  canTargetHero: boolean,
): readonly AttackTarget[] {
  const defenders = getDefendersInFrontline(defenderZones);
  const hasActiveDefenders = defenders.length > 0;

  // Flying bypasses Defenders unless Defender also has Flying or Sniper
  const defendersBypassable = attackerIsFlying
    ? defenders.every(d => !cardHasTrait(d, 'flying') && !cardHasTrait(d, 'sniper'))
    : false;

  if (hasActiveDefenders && !defendersBypassable) {
    // Must target a Defender in Frontline
    return defenders.map(d => characterTarget(d.instanceId));
  }

  // No Defender restriction — all reachable characters + hero if applicable
  const targets: AttackTarget[] = reachableCharacters.map(c =>
    characterTarget(c.instanceId),
  );
  if (canTargetHero) {
    targets.push(heroTarget());
  }
  return targets;
}
