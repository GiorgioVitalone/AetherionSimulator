/**
 * Attack Targeting — determines valid attack targets based on zone positions,
 * Defender priority, Flying bypass, Sniper from Reserve, and Empty Board Rule.
 */
import type { CardInstance, ZoneState, GameConfig } from '../types/game-state.js';
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
  return hasTrait(card.traits, trait) || card.grantedTraits.some((g) => g.trait === trait);
}

// ── Board State Queries ──────────────────────────────────────────────────────

export function isBoardEmpty(zones: ZoneState): boolean {
  const frontline = getCardsInZone(zones, 'frontline');
  const highGround = getCardsInZone(zones, 'high_ground');
  return frontline.length === 0 && highGround.length === 0;
}

function getForcingDefenders(zones: ZoneState, highGroundOnly: boolean): readonly CardInstance[] {
  // EC-007 (highGroundOnly): a Defender forces only from High Ground; otherwise
  // (engine default) it forces only from the Frontline.
  const zone: ZoneType = highGroundOnly ? 'high_ground' : 'frontline';
  return getCardsInZone(zones, zone).filter((c) => cardHasTrait(c, 'defender'));
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
  config?: GameConfig,
  attackerPlayerIndex?: 0 | 1,
): readonly AttackTarget[] {
  // DIAGNOSTIC ABLATION (default absent ⇒ no-op): config.ablateFlying treats the
  // Flying trait as absent (so it grants no Defender bypass / evasive reach).
  const isFlying = config?.ablateFlying === true ? false : hasTrait(attackerTraits, 'flying');
  const isSniper = hasTrait(attackerTraits, 'sniper');

  // DIAGNOSTIC ABLATION (default absent ⇒ no-op): config.disableHeroReachBySeat
  // strips the enemy Hero from this seat's legal attack targets, so it can never
  // reduce the enemy Hero's LP via combat (Flying / High-Ground / Empty-Board /
  // Sniper paths all lose the hero target). Enemy CHARACTERS remain targetable.
  const heroReachDisabled =
    attackerPlayerIndex !== undefined &&
    config?.disableHeroReachBySeat?.[attackerPlayerIndex] === true;

  // Empty Board Rule: any attacker can hit Hero
  if (isBoardEmpty(defenderZones)) {
    return heroReachDisabled ? [] : [heroTarget()];
  }

  // Reserve: cannot attack unless Sniper (targets enemy Frontline only)
  if (attackerZone === 'reserve') {
    if (!isSniper) return [];
    return getCardsInZone(defenderZones, 'frontline').map((c) => characterTarget(c.instanceId));
  }

  // Determine reachable zones based on attacker position
  const reachableZones = getReachableZones(attackerZone);
  const canTargetHero = attackerZone === 'high_ground' && !heroReachDisabled;

  // Collect all characters in reachable zones
  const reachableCharacters = reachableZones.flatMap((zone) => getCardsInZone(defenderZones, zone));

  // Apply Defender priority
  return applyDefenderPriority(
    reachableCharacters,
    defenderZones,
    isFlying,
    canTargetHero,
    config?.ablateDefenderForcing === true,
    config?.defenderForceCap,
    config?.defenderHighGroundOnly === true,
  );
}

/**
 * EC-004 (config.defenderForceCap): a Frontline Defender stops forcing once it has
 * had `cap` attacks forced onto it this turn. Returns the Defenders that are STILL
 * forcing (under cap). `cap` absent/<= 0 ⇒ unlimited (every Defender keeps forcing),
 * preserving the engine-default behavior.
 */
export function activeForcingDefenders(
  zones: ZoneState,
  cap?: number,
  highGroundOnly = false,
): readonly CardInstance[] {
  // EC-007 (highGroundOnly): forcing Defenders are drawn from High Ground instead
  // of the Frontline. Default false ⇒ Frontline (engine default).
  const defenders = getForcingDefenders(zones, highGroundOnly);
  if (cap === undefined || cap <= 0) return defenders;
  return defenders.filter((d) => (d.forcedAttacksThisTurn ?? 0) < cap);
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
  ablateForcing = false,
  forceCap?: number,
  highGroundOnly = false,
): readonly AttackTarget[] {
  // EC-004: only Defenders still UNDER their per-turn force cap keep forcing. With
  // the cap unset (default), this returns every Frontline Defender ⇒ unchanged.
  // EC-007 (highGroundOnly): the forcing Defenders are taken from High Ground.
  const defenders = ablateForcing
    ? []
    : activeForcingDefenders(defenderZones, forceCap, highGroundOnly);

  // Flying bypasses each Defender unless that Defender also has Flying or
  // Sniper — bypass is per-Defender, not all-or-nothing.
  const forcingDefenders = attackerIsFlying
    ? defenders.filter((d) => cardHasTrait(d, 'flying') || cardHasTrait(d, 'sniper'))
    : defenders;

  if (forcingDefenders.length > 0) {
    // Must target a still-forcing Defender
    return forcingDefenders.map((d) => characterTarget(d.instanceId));
  }

  // No Defender restriction — all reachable characters + hero if applicable
  const targets: AttackTarget[] = reachableCharacters.map((c) => characterTarget(c.instanceId));
  if (canTargetHero) {
    targets.push(heroTarget());
  }
  return targets;
}
