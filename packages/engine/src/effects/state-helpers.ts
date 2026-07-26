/**
 * Shared state helpers — immutable read/update/remove operations over GameState
 * used by the effect handlers. Pure: state in → new state out, never mutate input.
 */
import type { GameState, CardInstance, ExileRecord } from '../types/game-state.js';
import { findCard, removeFromZone } from '../zones/zone-manager.js';
import { isExiledOnDestruction, detachEquipmentForDiscard } from './destruction-destination.js';
import { expireInactiveSourceDurations } from '../runtime/duration-lifecycle.js';

export function updateCardInState(
  state: GameState,
  instanceId: string,
  updater: (card: CardInstance) => CardInstance,
): GameState {
  const updateBoardCard = (card: CardInstance | null): CardInstance | null => {
    if (card === null) return null;
    if (card.instanceId === instanceId) return updater(card);
    if (card.equipment?.instanceId === instanceId) {
      return { ...card, equipment: updater(card.equipment) };
    }
    return card;
  };
  return {
    ...state,
    players: state.players.map(player => ({
      ...player,
      zones: {
        reserve: player.zones.reserve.map(updateBoardCard),
        frontline: player.zones.frontline.map(updateBoardCard),
        highGround: player.zones.highGround.map(updateBoardCard),
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
    for (const zone of [
      player.zones.reserve,
      player.zones.frontline,
      player.zones.highGround,
    ]) {
      const equipment = zone.find(
        (card) => card?.equipment?.instanceId === instanceId,
      )?.equipment;
      if (equipment !== null && equipment !== undefined) return equipment;
    }
  }
  return null;
}

export function removeCardFromState(state: GameState, instanceId: string): GameState {
  const newPlayers = state.players.map(player => {
    const { zones, removed } = removeFromZone(player.zones, instanceId);
    if (removed === null) return { ...player, zones };
    const exiled = !removed.isToken && isExiledOnDestruction(removed);
    const split = detachEquipmentForDiscard(removed);
    const holder = split?.holder ?? removed;
    const exileRecord: ExileRecord = {
      instanceId: holder.instanceId,
      card: holder,
      ownerPlayerId: holder.owner,
      cause: 'volatile',
      turnNumber: state.turnNumber,
    };
    return {
      ...player,
      zones,
      // Volatile units (and tokens) are exiled — removed from the game, never added
      // to the discard pile, so recursion cannot reclaim them (Rulebook 16). A
      // destroyed holder's equipment follows it to the owner's discard pile as its
      // own entry (Rulebook 13), even when the holder itself is exiled.
      discardPile: discardForRemoval(player.discardPile, removed),
      ...(exiled ? { exile: [...player.exile, exileRecord] } : {}),
    };
  }) as unknown as readonly [typeof state.players[0], typeof state.players[1]];
  return expireInactiveSourceDurations({ ...state, players: newPlayers });
}

export function exileCardFromState(
  state: GameState,
  instanceId: string,
  cause: ExileRecord['cause'],
  sourceInstanceId?: string,
): GameState {
  const newPlayers = state.players.map((player) => {
    const { zones, removed } = removeFromZone(player.zones, instanceId);
    if (removed === null) return player;
    const split = detachEquipmentForDiscard(removed);
    const exiledCard = split?.holder ?? removed;
    const record: ExileRecord = {
      instanceId: exiledCard.instanceId,
      card: exiledCard,
      ownerPlayerId: exiledCard.owner,
      cause,
      turnNumber: state.turnNumber,
      ...(sourceInstanceId !== undefined ? { sourceInstanceId } : {}),
    };
    return {
      ...player,
      zones,
      ...(removed.isToken ? {} : { exile: [...player.exile, record] }),
      ...(split === null
        ? {}
        : { discardPile: [...player.discardPile, split.equipment] }),
    };
  }) as unknown as readonly [typeof state.players[0], typeof state.players[1]];
  return expireInactiveSourceDurations({ ...state, players: newPlayers });
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
