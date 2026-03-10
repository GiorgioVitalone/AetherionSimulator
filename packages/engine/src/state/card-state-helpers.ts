/**
 * Shared card manipulation helpers — extracted from interpreter.ts and combat-resolver.ts.
 * Centralizes find/update/remove/destroy/exile operations on cards in game state.
 */
import type {
  CardInstance,
  GameEvent,
  GameState,
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
 * Centralized destruction: find card → remove from zones → move to discard/exile
 * (skip for tokens) → handle attached equipment → emit events.
 */
export function destroyCard(
  state: GameState,
  instanceId: string,
  cause: 'combat' | 'effect' | 'sacrifice',
): { readonly state: GameState; readonly events: readonly GameEvent[] } {
  const card = findCardInState(state, instanceId);
  if (card === null) {
    return { state, events: [] };
  }

  const ownerPlayer = state.players[card.owner]!;
  const { zones: newZones } = removeFromZone(ownerPlayer.zones, instanceId);
  const discardPile = [...ownerPlayer.discardPile];
  const exileZone = [...ownerPlayer.exileZone];
  const events: GameEvent[] = [];

  const destination = card.isToken || cardHasTrait(card, 'volatile')
    ? 'exile'
    : 'discard';
  const destroyedCard = withoutEquipment(card);

  events.push({
    type: 'CARD_DESTROYED',
    cardInstanceId: instanceId,
    cause,
    playerId: card.owner,
    destroyedCard,
  });

  if (!card.isToken) {
    if (destination === 'exile') {
      exileZone.push(destroyedCard);
      events.push({
        type: 'CARD_EXILED',
        cardInstanceId: instanceId,
        playerId: card.owner,
      });
    } else {
      discardPile.push(destroyedCard);
    }
  }

  events.push({
    type: 'CARD_LEFT_BATTLEFIELD',
    cardInstanceId: instanceId,
    destination,
    playerId: card.owner,
  });

  if (card.equipment !== null) {
    events.push({
      type: 'CARD_DESTROYED',
      cardInstanceId: card.equipment.instanceId,
      cause: 'effect',
      playerId: card.owner,
      destroyedCard: withoutEquipment(card.equipment),
    });
    events.push({
      type: 'CARD_LEFT_BATTLEFIELD',
      cardInstanceId: card.equipment.instanceId,
      destination: card.equipment.isToken ? 'exile' : 'discard',
      playerId: card.owner,
    });
    if (!card.equipment.isToken) {
      discardPile.push(withoutEquipment(card.equipment));
    }
  }

  const newPlayers = [...state.players] as [typeof state.players[0], typeof state.players[1]];
  newPlayers[card.owner] = {
    ...ownerPlayer,
    zones: newZones,
    discardPile,
    exileZone,
  };

  return {
    state: { ...state, players: newPlayers },
    events,
  };
}

function withoutEquipment(card: CardInstance): CardInstance {
  return {
    ...card,
    equipment: null,
  };
}

function cardHasTrait(
  card: CardInstance,
  trait: CardInstance['traits'][number],
): boolean {
  return card.traits.includes(trait) || card.grantedTraits.some(entry => entry.trait === trait);
}
