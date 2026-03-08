/**
 * Combat Resolver — resolves a full attack declaration.
 * Validates, exhausts attacker, calculates damage, applies results, emits events.
 */
import type {
  GameState,
  GameEvent,
  CardInstance,
} from '../types/game-state.js';
import type { Trait } from '../types/common.js';
import { findCard } from '../zones/zone-manager.js';
import { getValidAttackTargets } from '../zones/targeting.js';
import {
  calculateCombatDamage,
  calculateHeroDamage,
} from './damage-calculator.js';

export interface CombatResult {
  readonly newState: GameState;
  readonly events: readonly GameEvent[];
}

function allTraits(card: CardInstance): readonly Trait[] {
  return [
    ...card.traits,
    ...card.grantedTraits.map(g => g.trait),
  ];
}

// ── Updaters (immutable) ─────────────────────────────────────────────────────

function updateCardInZones(
  state: GameState,
  instanceId: string,
  updater: (card: CardInstance) => CardInstance,
): GameState {
  return {
    ...state,
    players: state.players.map(player => ({
      ...player,
      zones: {
        reserve: player.zones.reserve.map(c =>
          c?.instanceId === instanceId ? updater(c) : c,
        ),
        frontline: player.zones.frontline.map(c =>
          c?.instanceId === instanceId ? updater(c) : c,
        ),
        highGround: player.zones.highGround.map(c =>
          c?.instanceId === instanceId ? updater(c) : c,
        ),
      },
    })) as unknown as readonly [typeof state.players[0], typeof state.players[1]],
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
        reserve: player.zones.reserve.map(c =>
          c?.instanceId === instanceId ? null : c,
        ),
        frontline: player.zones.frontline.map(c =>
          c?.instanceId === instanceId ? null : c,
        ),
        highGround: player.zones.highGround.map(c =>
          c?.instanceId === instanceId ? null : c,
        ),
      };
      const newPlayers = [...state.players] as [typeof state.players[0], typeof state.players[1]];
      newPlayers[pi] = {
        ...player,
        zones: newZones,
        discardPile: location.card.isToken
          ? player.discardPile
          : [...player.discardPile, location.card],
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
  targetId: string | 'hero',
): CombatResult {
  const events: GameEvent[] = [];

  // 1. Find attacker
  const attackerPlayer = state.players[state.activePlayerIndex]!;
  const attackerLocation = findCard(attackerPlayer.zones, attackerInstanceId);
  if (attackerLocation === null) {
    throw new Error(`Attacker ${attackerInstanceId} not found`);
  }
  if (attackerLocation.card.exhausted) {
    throw new Error(`Attacker ${attackerInstanceId} is exhausted`);
  }

  // 2. Validate target
  const defenderIndex = state.activePlayerIndex === 0 ? 1 : 0;
  const defenderPlayer = state.players[defenderIndex]!;
  const validTargets = getValidAttackTargets(
    attackerLocation.zone,
    allTraits(attackerLocation.card),
    defenderPlayer.zones,
    defenderPlayer.hero,
  );
  const isValidTarget =
    targetId === 'hero'
      ? validTargets.some(t => t.type === 'hero')
      : validTargets.some(
          t => t.type === 'character' && t.instanceId === targetId,
        );
  if (!isValidTarget) {
    throw new Error(`Invalid target: ${targetId}`);
  }

  // 3. Exhaust attacker
  let currentState = updateCardInZones(state, attackerInstanceId, card => ({
    ...card,
    exhausted: true,
    attackedThisTurn: true,
  }));

  events.push({
    type: 'CHARACTER_ATTACKED',
    attackerId: attackerInstanceId,
    targetId,
  });

  // 4. Resolve damage
  if (targetId === 'hero') {
    return resolveHeroAttack(
      currentState,
      attackerLocation.card,
      defenderIndex,
      events,
    );
  }

  return resolveCharacterAttack(
    currentState,
    attackerLocation.card,
    attackerInstanceId,
    targetId,
    events,
  );
}

function resolveHeroAttack(
  state: GameState,
  attacker: CardInstance,
  defenderIndex: 0 | 1,
  events: GameEvent[],
): CombatResult {
  const damage = calculateHeroDamage(attacker.currentAtk, 0);
  const hero = state.players[defenderIndex]!.hero;
  const newLp = Math.max(0, hero.currentLp - damage);

  events.push({
    type: 'HERO_DAMAGED',
    playerId: defenderIndex,
    amount: damage,
    sourceId: attacker.instanceId,
  });

  const newPlayers = [...state.players] as [typeof state.players[0], typeof state.players[1]];
  newPlayers[defenderIndex] = {
    ...state.players[defenderIndex]!,
    hero: { ...hero, currentLp: newLp },
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
  defenderPlayerId: 0 | 1 = (state.activePlayerIndex === 0 ? 1 : 0) as 0 | 1,
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

  const result = calculateCombatDamage(
    attacker.currentAtk,
    attacker.currentArm,
    attacker.currentHp,
    defender.currentAtk,
    defender.currentArm,
    defender.currentHp,
    allTraits(attacker),
    allTraits(defender),
  );

  let currentState = state;

  // Apply damage to defender
  if (result.damageToDefender > 0) {
    events.push({
      type: 'DAMAGE_DEALT',
      sourceId: attackerInstanceId,
      targetId,
      amount: result.damageToDefender,
    });
    currentState = updateCardInZones(currentState, targetId, card => ({
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
    currentState = updateCardInZones(
      currentState,
      attackerInstanceId,
      card => ({
        ...card,
        currentHp: card.currentHp - result.damageToAttacker,
      }),
    );
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
    const removal = removeCardFromZones(currentState, attackerInstanceId);
    if (removal !== null) {
      currentState = removal.state;
    }
  }

  return { newState: currentState, events };
}
