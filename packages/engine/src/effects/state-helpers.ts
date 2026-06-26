/**
 * Shared state helpers — immutable read/update/remove operations over GameState
 * used by the effect handlers. Pure: state in → new state out, never mutate input.
 */
import type { GameState, CardInstance } from '../types/game-state.js';
import { findCard, removeFromZone } from '../zones/zone-manager.js';
import { isExiledOnDestruction, detachEquipmentForDiscard } from './destruction-destination.js';

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

export function findCardInState(
  state: GameState,
  instanceId: string,
): CardInstance | null {
  for (const player of state.players) {
    const loc = findCard(player.zones, instanceId);
    if (loc !== null) return loc.card;
  }
  return null;
}

export function removeCardFromState(state: GameState, instanceId: string): GameState {
  const newPlayers = state.players.map(player => {
    const { zones, removed } = removeFromZone(player.zones, instanceId);
    if (removed === null) return { ...player, zones };
    return {
      ...player,
      zones,
      // Volatile units (and tokens) are exiled — removed from the game, never added
      // to the discard pile, so recursion cannot reclaim them (Rulebook 16). A
      // destroyed holder's equipment follows it to the owner's discard pile as its
      // own entry (Rulebook 13), even when the holder itself is exiled.
      discardPile: discardForRemoval(player.discardPile, removed),
    };
  }) as unknown as readonly [typeof state.players[0], typeof state.players[1]];
  return { ...state, players: newPlayers };
}

function discardForRemoval(
  discardPile: readonly CardInstance[],
  removed: CardInstance,
): readonly CardInstance[] {
  const split = detachEquipmentForDiscard(removed);
  const holder = split?.holder ?? removed;
  const withHolder = isExiledOnDestruction(holder)
    ? [...discardPile]
    : [...discardPile, holder];
  return split === null ? withHolder : [...withHolder, split.equipment];
}
