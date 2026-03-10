/**
 * Shared card manipulation helpers — extracted from interpreter.ts and combat-resolver.ts.
 * Centralizes find/update/remove/destroy/exile operations on cards in game state.
 */
import type {
  GameState,
  GameEvent,
  CardInstance,
} from '../types/game-state.js';
import { findCard, removeFromZone } from '../zones/zone-manager.js';

/**
 * Update a card on the battlefield by instanceId.
 * Applies `updater` to the matching card across all zones for all players.
 */
export function updateCardInState(
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

/**
 * Find a card on the battlefield by instanceId.
 * Returns the card with its owner, or null if not found.
 */
export function findCardInState(
  state: GameState,
  instanceId: string,
): (CardInstance & { readonly owner: 0 | 1 }) | null {
  for (let pi = 0; pi < 2; pi++) {
    const player = state.players[pi]!;
    const loc = findCard(player.zones, instanceId);
    if (loc !== null) return { ...loc.card, owner: pi as 0 | 1 };
  }
  return null;
}

/**
 * Remove a card from the battlefield zones and add to discard (skip for tokens).
 */
export function removeCardFromState(
  state: GameState,
  instanceId: string,
): GameState {
  const newPlayers = state.players.map(player => {
    const { zones, removed } = removeFromZone(player.zones, instanceId);
    return {
      ...player,
      zones,
      discardPile: removed !== null && !removed.isToken
        ? [...player.discardPile, removed]
        : player.discardPile,
    };
  }) as unknown as readonly [typeof state.players[0], typeof state.players[1]];
  return { ...state, players: newPlayers };
}

/**
 * Reset a card to its base state (used for bounce-to-hand).
 */
export function resetCard(card: CardInstance): CardInstance {
  return {
    ...card,
    currentHp: card.baseHp,
    currentAtk: card.baseAtk,
    currentArm: card.baseArm,
    exhausted: false,
    summoningSick: false,
    movedThisTurn: false,
    attackedThisTurn: false,
    grantedTraits: [],
    modifiers: [],
    statusEffects: [],
    registeredTriggers: [],
    equipment: null,
  };
}

/**
 * Centralized destruction: find card → remove from zones → add to discard
 * (skip for tokens) → handle attached equipment → emit events.
 */
export function destroyCard(
  state: GameState,
  instanceId: string,
  cause: 'combat' | 'effect' | 'sacrifice',
): { readonly state: GameState; readonly events: readonly GameEvent[] } {
  const events: GameEvent[] = [];
  const card = findCardInState(state, instanceId);
  if (card === null) return { state, events: [] };

  events.push({
    type: 'CARD_DESTROYED',
    cardInstanceId: instanceId,
    cause,
    playerId: card.owner,
  });

  // Handle attached equipment — send to discard
  if (card.equipment !== null) {
    events.push({
      type: 'CARD_DESTROYED',
      cardInstanceId: card.equipment.instanceId,
      cause: 'effect',
      playerId: card.owner,
    });
  }

  let newState = removeCardFromState(state, instanceId);

  // Equipment goes to discard separately (removeCardFromState already handled the card)
  if (card.equipment !== null && !card.equipment.isToken) {
    const ownerPlayer = newState.players[card.owner]!;
    const newPlayers = [...newState.players] as [typeof newState.players[0], typeof newState.players[1]];
    newPlayers[card.owner] = {
      ...ownerPlayer,
      discardPile: [...ownerPlayer.discardPile, card.equipment],
    };
    newState = { ...newState, players: newPlayers };
  }

  return { state: newState, events };
}
