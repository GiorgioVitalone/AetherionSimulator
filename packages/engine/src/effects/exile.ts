/**
 * Exile — removes a card from the battlefield to the exile zone.
 * Exile ≠ destruction: Last Breath does NOT fire on exile.
 * CARD_LEFT_BATTLEFIELD triggers DO fire.
 */
import type { GameState, GameEvent, CardInstance } from '../types/game-state.js';
import { findCard, removeFromZone } from '../zones/zone-manager.js';

export function executeExile(
  state: GameState,
  instanceId: string,
): { readonly state: GameState; readonly events: readonly GameEvent[] } {
  const events: GameEvent[] = [];

  // Find which player owns the card
  let ownerIndex: 0 | 1 | null = null;
  let card: CardInstance | null = null;

  for (let pi = 0; pi < 2; pi++) {
    const loc = findCard(state.players[pi]!.zones, instanceId);
    if (loc !== null) {
      ownerIndex = pi as 0 | 1;
      card = loc.card;
      break;
    }
  }

  if (card === null || ownerIndex === null) return { state, events: [] };

  // Remove from zones
  const player = state.players[ownerIndex]!;
  const { zones: newZones } = removeFromZone(player.zones, instanceId);

  // Handle equipment: detach and send to discard
  let equipmentToDiscard: CardInstance[] = [];
  if (card.equipment !== null) {
    equipmentToDiscard = [card.equipment];
    events.push({
      type: 'CARD_DESTROYED',
      cardInstanceId: card.equipment.instanceId,
      cause: 'effect',
      playerId: ownerIndex,
    });
  }

  const newPlayers = [...state.players] as [typeof state.players[0], typeof state.players[1]];

  if (card.isToken) {
    // Tokens are removed from game entirely, not added to exile
    newPlayers[ownerIndex] = {
      ...player,
      zones: newZones,
      discardPile: [...player.discardPile, ...equipmentToDiscard],
    };
  } else {
    // Non-token: add to exile zone (without equipment)
    const exiledCard: CardInstance = { ...card, equipment: null };
    newPlayers[ownerIndex] = {
      ...player,
      zones: newZones,
      exileZone: [...player.exileZone, exiledCard],
      discardPile: [...player.discardPile, ...equipmentToDiscard],
    };
  }

  events.push({
    type: 'CARD_EXILED',
    cardInstanceId: instanceId,
    playerId: ownerIndex,
  });

  events.push({
    type: 'CARD_LEFT_BATTLEFIELD',
    cardInstanceId: instanceId,
    destination: 'exile',
    playerId: ownerIndex,
  });

  return {
    state: { ...state, players: newPlayers },
    events,
  };
}
