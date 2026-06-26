/**
 * Combat Resolver — resolves a full attack declaration.
 * Validates, exhausts attacker, calculates damage, applies results, emits events.
 */
import type { GameState, GameEvent, CardInstance, DiagCounters } from '../types/game-state.js';
import type { Trait } from '../types/common.js';
import { findCard } from '../zones/zone-manager.js';
import { getValidAttackTargets, activeForcingDefenders } from '../zones/targeting.js';
import { calculateCombatDamage, calculateHeroDamage } from './damage-calculator.js';
import { applyDamageReplacements, markReplacementsUsed } from '../effects/replacement-handler.js';
import {
  isExiledOnDestruction,
  detachEquipmentForDiscard,
} from '../effects/destruction-destination.js';

export interface CombatResult {
  readonly newState: GameState;
  readonly events: readonly GameEvent[];
}

function allTraits(card: CardInstance): readonly Trait[] {
  return [...card.traits, ...card.grantedTraits.map((g) => g.trait)];
}

// ── Diagnostic instrumentation (no-op unless a `diag` accumulator is supplied) ──

/** ARM points actually absorbed by a card against one raw incoming ATK, split into
 * the Bulwark portion (ARM granted by `until_next_upkeep` modifiers — uniquely
 * Seraphina's +1 frontline ARM) and the printed/base remainder. Pure read. */
function accumulateArmAbsorbed(
  diag: DiagCounters,
  card: CardInstance,
  rawAtk: number,
  ownerPlayerId: 0 | 1,
): void {
  const absorbed = Math.min(Math.max(0, rawAtk), Math.max(0, card.currentArm));
  if (absorbed <= 0) return;
  const bulwarkArm = card.modifiers.reduce(
    (sum, m) =>
      m.duration.type === 'until_next_upkeep' ? sum + Math.max(0, m.modifier.arm ?? 0) : sum,
    0,
  );
  // The Bulwark ARM is the topmost layer: it only absorbs what base ARM did not.
  const baseArm = Math.max(0, card.currentArm - bulwarkArm);
  const baseAbsorbed = Math.min(absorbed, baseArm);
  diag.armAbsorbedBase[ownerPlayerId] += baseAbsorbed;
  diag.armAbsorbedBulwark[ownerPlayerId] += absorbed - baseAbsorbed;
}

// ── TEST A / TEST B: alternative ARM mechanics (mutually exclusive) ───────────

/** Which alternative ARM mechanic (if any) is active. armChargeAbsorb (TEST B)
 * takes precedence if both are somehow set. Pure read. */
function armMechanic(config: GameState['config']): 'charge' | 'oneTime' | 'none' {
  if (config?.armChargeAbsorb === true) return 'charge';
  if (config?.armOneTimeAbsolute === true) return 'oneTime';
  return 'none';
}

interface ArmBody {
  readonly currentArm: number;
  readonly armConsumed?: boolean;
  readonly armCharges?: number;
  readonly armChargeSyncedArm?: number;
}

/** Resolve the ARM a body presents against ONE incoming combat instance under the
 * active alternative mechanic, plus the post-instance state delta to persist.
 * - oneTime (TEST A): present currentArm only if not yet consumed; consuming on this
 *   instance sets armConsumed (never resets). After consumption, ARM = 0 forever.
 * - charge (TEST B): if charges remain, fully negate (present ARM >= rawAtk) and
 *   decrement the charge; when charges hit 0, ARM = 0 (normal flow). Charges are
 *   lazily initialized from currentArm and topped up when currentArm exceeds them.
 * `delta` is the fields to merge onto the body if this instance actually engaged
 * ARM (so the OFF/no-engagement path stays a byte-identical no-op). */
function resolveArmMechanic(
  body: ArmBody,
  rawAtk: number,
  mechanic: 'charge' | 'oneTime',
): { presentedArm: number; delta: Partial<ArmBody> | null } {
  if (mechanic === 'oneTime') {
    if (body.armConsumed === true) return { presentedArm: 0, delta: null };
    if (body.currentArm <= 0) return { presentedArm: 0, delta: null };
    // First ever instance: ARM reduces it, then is consumed forever.
    return { presentedArm: body.currentArm, delta: { armConsumed: true } };
  }
  // charge (TEST B): on first sight (armCharges undefined) charges = currentArm.
  // Thereafter the tracked remaining is authoritative, plus any FRESH ARM buff —
  // detected as currentArm rising above the value at the last sync (armChargeSyncedArm).
  // Consuming a charge does NOT lower currentArm, so syncedArm guards against
  // re-charging from the unchanged printed ARM every instance.
  const synced = body.armChargeSyncedArm ?? 0;
  const freshBuff = Math.max(0, body.currentArm - synced);
  const remaining =
    (body.armCharges ?? body.currentArm) + (body.armCharges === undefined ? 0 : freshBuff);
  if (remaining <= 0) {
    // Never-engaged 0-ARM body: leave it completely untouched (no-op feel).
    if (body.armCharges === undefined) return { presentedArm: 0, delta: null };
    // No charges, but record the synced ARM so a later buff is measured correctly.
    if (body.armChargeSyncedArm === body.currentArm) return { presentedArm: 0, delta: null };
    return { presentedArm: 0, delta: { armCharges: 0, armChargeSyncedArm: body.currentArm } };
  }
  // Fully negate this instance and spend one charge.
  return {
    presentedArm: Math.max(rawAtk, 0),
    delta: { armCharges: remaining - 1, armChargeSyncedArm: body.currentArm },
  };
}

// ── EC-002: first-instance-only ARM (config.armFirstInstanceOnly) ─────────────

/** The ARM a body actually presents against ONE incoming combat instance under
 * the active rule. Engine default: its printed/current ARM (per-instance). EC-002:
 * its current ARM only if it has NOT yet spent its first-instance charge this turn
 * (`armMitigatedThisTurn` unset); otherwise 0. Pure read. */
function effectiveCombatArm(
  card: { currentArm: number; armMitigatedThisTurn?: boolean },
  firstInstanceOnly: boolean,
): number {
  if (!firstInstanceOnly) return card.currentArm;
  return card.armMitigatedThisTurn === true ? 0 : card.currentArm;
}

/** EC-002 instrumentation (read-only; no-op unless a diag with the EC-002 fields
 * is supplied). When this body's ARM is WITHHELD on a subsequent instance, record
 * the ARM points per-instance rules would have absorbed (min(rawAtk, realArm))
 * and count the gang hit, by the armored body's side. */
function accumulateFirstInstanceStripped(
  diag: DiagCounters | undefined,
  card: { currentArm: number; armMitigatedThisTurn?: boolean },
  rawAtk: number,
  side: 0 | 1,
): void {
  if (diag?.armFirstInstanceStripped === undefined) return;
  if (card.armMitigatedThisTurn !== true) return; // first instance: nothing stripped
  const stripped = Math.min(Math.max(0, rawAtk), Math.max(0, card.currentArm));
  if (stripped <= 0) return;
  diag.armFirstInstanceStripped[side] += stripped;
  // armFirstInstanceGangHits is independently optional on DiagCounters — guard it
  // directly rather than asserting non-null off the *Stripped check above, so a diag
  // that supplies only one of the pair cannot crash combat mid-resolution.
  if (diag.armFirstInstanceGangHits !== undefined) diag.armFirstInstanceGangHits[side] += 1;
}

// ── EC-003: first-instance-only shield (config.shieldFirstInstanceOnly) ───────

/** Whether this body's −1 "would take damage" shield should be SUPPRESSED for the
 * instance currently resolving: only under EC-003, and only once the body has
 * already spent its first-instance shield charge this turn. Default (toggle OFF)
 * always returns false ⇒ the per-instance shield is applied normally. Pure read. */
function shieldSuppressed(
  card: { shieldMitigatedThisTurn?: boolean },
  firstInstanceOnly: boolean,
): boolean {
  if (!firstInstanceOnly) return false;
  return card.shieldMitigatedThisTurn === true;
}

// ── Updaters (immutable) ─────────────────────────────────────────────────────

function updateCardInZones(
  state: GameState,
  instanceId: string,
  updater: (card: CardInstance) => CardInstance,
): GameState {
  return {
    ...state,
    players: state.players.map((player) => ({
      ...player,
      zones: {
        reserve: player.zones.reserve.map((c) => (c?.instanceId === instanceId ? updater(c) : c)),
        frontline: player.zones.frontline.map((c) =>
          c?.instanceId === instanceId ? updater(c) : c,
        ),
        highGround: player.zones.highGround.map((c) =>
          c?.instanceId === instanceId ? updater(c) : c,
        ),
      },
    })) as unknown as readonly [(typeof state.players)[0], (typeof state.players)[1]],
  };
}

function removeCardFromZones(
  state: GameState,
  instanceId: string,
): { state: GameState; removedFrom: 0 | 1; card: CardInstance } | null {
  for (let pi = 0; pi < 2; pi++) {
    const player = state.players[pi]!;
    const location = findCard(player.zones, instanceId);
    if (location !== null) {
      const newZones = {
        reserve: player.zones.reserve.map((c) => (c?.instanceId === instanceId ? null : c)),
        frontline: player.zones.frontline.map((c) => (c?.instanceId === instanceId ? null : c)),
        highGround: player.zones.highGround.map((c) => (c?.instanceId === instanceId ? null : c)),
      };
      const newPlayers = [...state.players] as [
        (typeof state.players)[0],
        (typeof state.players)[1],
      ];
      // The destroyed holder's equipment follows it to the discard pile as its own
      // entry (Rulebook 13), even if the holder itself is exiled.
      const split = detachEquipmentForDiscard(location.card);
      const holder = split?.holder ?? location.card;
      const withHolder = isExiledOnDestruction(holder)
        ? player.discardPile
        : [...player.discardPile, holder];
      newPlayers[pi] = {
        ...player,
        zones: newZones,
        // Volatile units (and tokens) are exiled — removed from the game rather
        // than placed in the discard pile (Rulebook 16).
        discardPile: split === null ? withHolder : [...withHolder, split.equipment],
      };
      return {
        state: { ...state, players: newPlayers },
        removedFrom: pi as 0 | 1,
        card: location.card,
      };
    }
  }
  return null;
}

// ── Core Resolution ──────────────────────────────────────────────────────────

export function resolveCombat(
  state: GameState,
  attackerInstanceId: string,
  targetId: string,
): CombatResult {
  const events: GameEvent[] = [];

  // The first player cannot declare attacks on their first turn (Rulebook 7).
  if (state.turnState.firstPlayerFirstTurn) {
    throw new Error('First player cannot attack on the first turn');
  }

  // 1. Find attacker
  const attackerPlayer = state.players[state.activePlayerIndex];
  const attackerLocation = findCard(attackerPlayer.zones, attackerInstanceId);
  if (attackerLocation === null) {
    throw new Error(`Attacker ${attackerInstanceId} not found`);
  }
  if (attackerLocation.card.exhausted) {
    throw new Error(`Attacker ${attackerInstanceId} is exhausted`);
  }

  // 2. Validate target
  const defenderIndex = state.activePlayerIndex === 0 ? 1 : 0;
  const defenderPlayer = state.players[defenderIndex];
  const validTargets = getValidAttackTargets(
    attackerLocation.zone,
    allTraits(attackerLocation.card),
    defenderPlayer.zones,
    state.config,
    state.activePlayerIndex,
  );
  const isValidTarget =
    targetId === 'hero'
      ? validTargets.some((t) => t.type === 'hero')
      : validTargets.some((t) => t.type === 'character' && t.instanceId === targetId);
  if (!isValidTarget) {
    throw new Error(`Invalid target: ${targetId}`);
  }

  // 3. Exhaust attacker
  const currentState = updateCardInZones(state, attackerInstanceId, (card) => ({
    ...card,
    exhausted: true,
    attackedThisTurn: true,
    // Attacking lifts Stealth's untargetability permanently (Rulebook 16).
    hasActed: true,
  }));

  events.push({
    type: 'CHARACTER_ATTACKED',
    attackerId: attackerInstanceId,
    targetId,
  });

  // EC-004 (config.defenderForceCap): snapshot the Defenders still forcing at
  // declaration so we can (a) charge this attack against the chosen Defender's cap
  // and (b) instrument bypasses. Cap unset (default) ⇒ snapshot unused, no-op.
  const forceCap = state.config?.defenderForceCap;
  const ec004On = forceCap !== undefined && forceCap > 0;
  const forcingIds = ec004On
    ? new Set(
        activeForcingDefenders(
          defenderPlayer.zones,
          forceCap,
          state.config?.defenderHighGroundOnly === true,
        ).map((d) => d.instanceId),
      )
    : null;
  const diag = state.config?.diag;
  const attackerPlayerIndex = state.activePlayerIndex;

  // 4. Resolve damage
  if (targetId === 'hero') {
    // Instrument every attack that reaches the hero face (independent of EC-004, but
    // only when a diag accumulator is attached ⇒ no-op for a normal run).
    if (diag?.heroFaceAttacks) diag.heroFaceAttacks[attackerPlayerIndex] += 1;
    return resolveHeroAttack(currentState, attackerLocation.card, defenderIndex, events);
  }

  const result = resolveCharacterAttack(
    currentState,
    attackerLocation.card,
    attackerInstanceId,
    targetId,
    events,
  );

  // EC-004: charge the cap. If the chosen target was a forcing Defender, increment
  // its per-turn forced-attacks counter (survivors only; a destroyed Defender's
  // counter no longer matters). If instead a Frontline Defender existed but the
  // attacker flowed around a capped-out wall, tally a bypass.
  if (ec004On && forcingIds !== null) {
    if (forcingIds.has(targetId)) {
      const newState = updateCardInZones(result.newState, targetId, (card) => ({
        ...card,
        forcedAttacksThisTurn: (card.forcedAttacksThisTurn ?? 0) + 1,
      }));
      return { ...result, newState };
    }
    // Target was NOT a forcing Defender, yet Frontline Defenders existed ⇒ flowed
    // around the wall. (forcingIds empty means all Defenders were capped out.)
    if (diag?.defendersBypassed && getDefendersInFrontlineCount(defenderPlayer.zones) > 0) {
      diag.defendersBypassed[attackerPlayerIndex] += 1;
    }
  }

  return result;
}

/** EC-004 instrumentation helper: count of Frontline Defenders the defending player
 * controls (forcing or capped-out). Pure read. */
function getDefendersInFrontlineCount(zones: GameState['players'][0]['zones']): number {
  return zones.frontline.filter(
    (c) =>
      c !== null &&
      (c.traits.includes('defender') || c.grantedTraits.some((g) => g.trait === 'defender')),
  ).length;
}

function resolveHeroAttack(
  state: GameState,
  attacker: CardInstance,
  defenderIndex: 0 | 1,
  events: GameEvent[],
): CombatResult {
  const hero = state.players[defenderIndex].hero;
  // EC-002: the hero's ARM (granted-only; base 0) also blunts only the first combat
  // instance it takes this turn. Default OFF ⇒ effectiveCombatArm returns currentArm.
  const firstInstanceOnly = state.config?.armFirstInstanceOnly === true;
  const diag = state.config?.diag;
  accumulateFirstInstanceStripped(diag, hero, attacker.currentAtk, defenderIndex);
  // TEST A / TEST B: alternative ARM mechanics also govern the hero's granted ARM
  // (heroes have no counter-damage, so only the incoming instance matters). Default
  // OFF ⇒ mechanic === 'none' ⇒ EC-002/engine-default branch runs unchanged.
  const mechanic = armMechanic(state.config);
  let heroArm: number;
  let heroArmDelta: Partial<ArmBody> | null = null;
  if (mechanic === 'none') {
    heroArm = effectiveCombatArm(hero, firstInstanceOnly);
  } else {
    const h = resolveArmMechanic(hero, attacker.currentAtk, mechanic);
    heroArm = h.presentedArm;
    heroArmDelta = h.delta;
  }
  const damage = calculateHeroDamage(attacker.currentAtk, heroArm, state.config?.damageScale ?? 1);
  const newLp = Math.max(0, hero.currentLp - damage);

  events.push({
    type: 'HERO_DAMAGED',
    playerId: defenderIndex,
    amount: damage,
    sourceId: attacker.instanceId,
  });

  const spendHeroCharge =
    firstInstanceOnly && hero.currentArm > 0 && hero.armMitigatedThisTurn !== true;
  const newPlayers = [...state.players] as [(typeof state.players)[0], (typeof state.players)[1]];
  newPlayers[defenderIndex] = {
    ...state.players[defenderIndex],
    hero: {
      ...hero,
      currentLp: newLp,
      ...(spendHeroCharge ? { armMitigatedThisTurn: true } : {}),
      // TEST A / TEST B: persist the ARM-mechanic spend onto the hero (null ⇒ no-op).
      ...(heroArmDelta ?? {}),
    },
  };

  let newState: GameState = { ...state, players: newPlayers };

  if (newLp <= 0) {
    newState = {
      ...newState,
      winner: state.activePlayerIndex,
    };
  }

  return { newState, events };
}

function resolveCharacterAttack(
  state: GameState,
  attacker: CardInstance,
  attackerInstanceId: string,
  targetId: string,
  events: GameEvent[],
  attackerPlayerId: 0 | 1 = state.activePlayerIndex,
  defenderPlayerId: 0 | 1 = state.activePlayerIndex === 0 ? 1 : 0,
): CombatResult {
  // Find defender in either player's zones
  let defender: CardInstance | null = null;
  for (const player of state.players) {
    const loc = findCard(player.zones, targetId);
    if (loc !== null) {
      defender = loc.card;
      break;
    }
  }
  if (defender === null) {
    throw new Error(`Defender ${targetId} not found`);
  }

  // The defending character blocks the attack (Rulebook 16 / Sunlit Guardian).
  // Drives the on_block trigger; dispatched alongside the combat events.
  events.push({
    type: 'CHARACTER_BLOCKED',
    blockerId: targetId,
    attackerId: attackerInstanceId,
  });

  // "Would take damage" replacements (e.g. an aura -1) reduce each side's incoming
  // combat damage before HP is consulted. We collect the consumed replacement ids
  // so oncePerTurn reductions are marked used after the exchange resolves.
  // DIAGNOSTIC: config.ablateShield no-ops every reduction (default false ⇒ no-op);
  // config.diag (when present) accumulates shield fires/prevented + ARM absorbed.
  const ablateShield = state.config?.ablateShield === true;
  // EC-003: each body's −1 shield blunts only its FIRST combat instance this turn.
  // Default OFF ⇒ shieldSuppressed always false (per-instance shield, byte-identical).
  const shieldFirstInstanceOnly = state.config?.shieldFirstInstanceOnly === true;
  const diag = state.config?.diag;
  const defConsumed: string[] = [];
  const atkConsumed: string[] = [];
  // Records, per body, whether its shield actually fired in this exchange (so the
  // EC-003 first-instance charge is spent only when a reduction really happened).
  // Held in a mutable record so the closures below can flag firing without the
  // outer flag being narrowed to a `false` literal by control-flow analysis.
  const shieldFired: { def: boolean; atk: boolean } = { def: false, atk: false };
  const reduceShield = (
    holder: CardInstance,
    raw: number,
    consumed: string[],
    holderPlayerId: 0 | 1,
    onFired: () => void,
  ): number => {
    if (ablateShield) return raw;
    // EC-003: once this body has spent its first-instance shield charge this turn,
    // withhold the shield on subsequent instances (pass raw through). Instrument the
    // points the per-instance shield would have prevented (the gang bite).
    if (shieldSuppressed(holder, shieldFirstInstanceOnly)) {
      if (diag?.shieldFirstInstanceStripped !== undefined) {
        const would = applyDamageReplacements(holder, raw);
        const stripped = raw - would.amount;
        if (stripped > 0) {
          diag.shieldFirstInstanceStripped[holderPlayerId] += stripped;
          // Guard the independently-optional GangHits field directly (see the ARM
          // counterpart) instead of a non-null assertion off the *Stripped check.
          if (diag.shieldFirstInstanceGangHits !== undefined) {
            diag.shieldFirstInstanceGangHits[holderPlayerId] += 1;
          }
        }
      }
      return raw;
    }
    const r = applyDamageReplacements(holder, raw);
    consumed.push(...r.consumedIds);
    if (r.consumedIds.length > 0) onFired();
    if (diag !== undefined && r.consumedIds.length > 0) {
      diag.shieldFires[holderPlayerId] += r.consumedIds.length;
      diag.shieldPrevented[holderPlayerId] += raw - r.amount;
    }
    return r.amount;
  };
  if (diag !== undefined) {
    // ARM absorbed = raw ATK − post-ARM (clamped at 0). The Bulwark portion is the
    // extra absorbed when this card carries +1 ARM from an until_next_upkeep mod.
    accumulateArmAbsorbed(diag, defender, attacker.currentAtk, defenderPlayerId);
    accumulateArmAbsorbed(diag, attacker, defender.currentAtk, attackerPlayerId);
  }
  const reduceDefender = (raw: number): number =>
    reduceShield(defender, raw, defConsumed, defenderPlayerId, () => {
      shieldFired.def = true;
    });
  const reduceAttacker = (raw: number): number =>
    reduceShield(attacker, raw, atkConsumed, attackerPlayerId, () => {
      shieldFired.atk = true;
    });

  // EC-002: each body presents ARM only on its FIRST combat instance this turn.
  // Default OFF ⇒ effectiveCombatArm returns currentArm (byte-identical). The diag
  // instrumentation records the ARM points withheld on subsequent (gang) instances.
  const firstInstanceOnly = state.config?.armFirstInstanceOnly === true;
  accumulateFirstInstanceStripped(diag, defender, attacker.currentAtk, defenderPlayerId);
  accumulateFirstInstanceStripped(diag, attacker, defender.currentAtk, attackerPlayerId);
  // TEST A / TEST B: alternative ARM mechanics fully define ARM presentation when
  // ON (replacing the normal/EC-002 path). Default OFF ⇒ mechanic === 'none' ⇒ the
  // EC-002/engine-default branch runs unchanged (byte-identical no-op).
  const mechanic = armMechanic(state.config);
  let defenderArm: number;
  let attackerArm: number;
  let defArmDelta: Partial<ArmBody> | null = null;
  let atkArmDelta: Partial<ArmBody> | null = null;
  if (mechanic === 'none') {
    defenderArm = effectiveCombatArm(defender, firstInstanceOnly);
    attackerArm = effectiveCombatArm(attacker, firstInstanceOnly);
  } else {
    const def = resolveArmMechanic(defender, attacker.currentAtk, mechanic);
    const atk = resolveArmMechanic(attacker, defender.currentAtk, mechanic);
    defenderArm = def.presentedArm;
    attackerArm = atk.presentedArm;
    defArmDelta = def.delta;
    atkArmDelta = atk.delta;
  }

  const result = calculateCombatDamage(
    attacker.currentAtk,
    attackerArm,
    attacker.currentHp,
    defender.currentAtk,
    defenderArm,
    defender.currentHp,
    allTraits(attacker),
    allTraits(defender),
    reduceDefender,
    reduceAttacker,
    state.config?.damageScale ?? 1,
  );

  let currentState = state;
  // EC-002: spend each body's first-instance charge once its ARM has blunted a
  // combat instance this turn (ARM > 0 and not yet spent). Bodies with 0 ARM have
  // nothing to spend, so the flag is left untouched (keeps the gate minimal).
  if (firstInstanceOnly) {
    if (defender.currentArm > 0 && defender.armMitigatedThisTurn !== true) {
      currentState = updateCardInZones(currentState, targetId, (card) => ({
        ...card,
        armMitigatedThisTurn: true,
      }));
    }
    if (attacker.currentArm > 0 && attacker.armMitigatedThisTurn !== true) {
      currentState = updateCardInZones(currentState, attackerInstanceId, (card) => ({
        ...card,
        armMitigatedThisTurn: true,
      }));
    }
  }
  // TEST A / TEST B: persist the ARM-mechanic spend (armConsumed / decremented
  // armCharges) onto each body whose ARM actually engaged this instance. Delta null
  // (no engagement, or mechanic OFF) ⇒ flag untouched (byte-identical no-op).
  if (defArmDelta !== null) {
    currentState = updateCardInZones(currentState, targetId, (card) => ({
      ...card,
      ...defArmDelta,
    }));
  }
  if (atkArmDelta !== null) {
    currentState = updateCardInZones(currentState, attackerInstanceId, (card) => ({
      ...card,
      ...atkArmDelta,
    }));
  }
  // EC-003: spend each body's first-instance SHIELD charge once its −1 shield has
  // actually blunted a combat instance this turn (it fired and was not already
  // spent). Bodies whose shield did not fire leave the flag untouched (minimal gate).
  if (shieldFirstInstanceOnly) {
    if (shieldFired.def && defender.shieldMitigatedThisTurn !== true) {
      currentState = updateCardInZones(currentState, targetId, (card) => ({
        ...card,
        shieldMitigatedThisTurn: true,
      }));
    }
    if (shieldFired.atk && attacker.shieldMitigatedThisTurn !== true) {
      currentState = updateCardInZones(currentState, attackerInstanceId, (card) => ({
        ...card,
        shieldMitigatedThisTurn: true,
      }));
    }
  }
  currentState = markReplacementsUsed(currentState, targetId, defConsumed);
  currentState = markReplacementsUsed(currentState, attackerInstanceId, atkConsumed);

  // Apply damage to defender
  if (result.damageToDefender > 0) {
    events.push({
      type: 'DAMAGE_DEALT',
      sourceId: attackerInstanceId,
      targetId,
      amount: result.damageToDefender,
    });
    currentState = updateCardInZones(currentState, targetId, (card) => ({
      ...card,
      currentHp: card.currentHp - result.damageToDefender,
    }));
  }

  // Apply damage to attacker
  if (result.damageToAttacker > 0) {
    events.push({
      type: 'DAMAGE_DEALT',
      sourceId: targetId,
      targetId: attackerInstanceId,
      amount: result.damageToAttacker,
    });
    currentState = updateCardInZones(currentState, attackerInstanceId, (card) => ({
      ...card,
      currentHp: card.currentHp - result.damageToAttacker,
    }));
  }

  // Destroy defender if dead
  if (result.defenderDestroyed) {
    events.push({
      type: 'LETHAL_DAMAGE_DEALT',
      attackerId: attackerInstanceId,
      targetId,
    });
    events.push({
      type: 'CARD_DESTROYED',
      cardInstanceId: targetId,
      cause: 'combat',
      playerId: defenderPlayerId,
    });
    if (!defender.isToken && isExiledOnDestruction(defender)) {
      events.push({ type: 'CARD_EXILED', cardInstanceId: targetId, playerId: defenderPlayerId });
    }
    if (defender.equipment !== null) {
      events.push({
        type: 'CARD_DESTROYED',
        cardInstanceId: defender.equipment.instanceId,
        cause: 'combat',
        playerId: defenderPlayerId,
      });
    }
    const removal = removeCardFromZones(currentState, targetId);
    if (removal !== null) {
      currentState = removal.state;
    }
  }

  // Destroy attacker if dead
  if (result.attackerDestroyed) {
    events.push({
      type: 'CARD_DESTROYED',
      cardInstanceId: attackerInstanceId,
      cause: 'combat',
      playerId: attackerPlayerId,
    });
    if (!attacker.isToken && isExiledOnDestruction(attacker)) {
      events.push({
        type: 'CARD_EXILED',
        cardInstanceId: attackerInstanceId,
        playerId: attackerPlayerId,
      });
    }
    if (attacker.equipment !== null) {
      events.push({
        type: 'CARD_DESTROYED',
        cardInstanceId: attacker.equipment.instanceId,
        cause: 'combat',
        playerId: attackerPlayerId,
      });
    }
    const removal = removeCardFromZones(currentState, attackerInstanceId);
    if (removal !== null) {
      currentState = removal.state;
    }
  }

  return { newState: currentState, events };
}
