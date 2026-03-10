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
import {
  getActiveReplacementEffect,
  markReplacementEffectUsed,
} from '../effects/replacement-handler.js';
import { executeEffect } from '../effects/interpreter.js';
import { getNumericTraitValue } from './runtime-card-helpers.js';

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
      auraZone: player.auraZone.map(card =>
        card.instanceId === instanceId ? updater(card) : card,
      ),
      zones: {
        reserve: player.zones.reserve.map(c =>
          c?.instanceId === instanceId
            ? updater(c)
            : c?.equipment?.instanceId === instanceId
              ? updateEquipmentOnHost(c, updater)
              : c,
        ),
        frontline: player.zones.frontline.map(c =>
          c?.instanceId === instanceId
            ? updater(c)
            : c?.equipment?.instanceId === instanceId
              ? updateEquipmentOnHost(c, updater)
              : c,
        ),
        highGround: player.zones.highGround.map(c =>
          c?.instanceId === instanceId
            ? updater(c)
            : c?.equipment?.instanceId === instanceId
              ? updateEquipmentOnHost(c, updater)
              : c,
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
    const auraCard = player.auraZone.find(card => card.instanceId === instanceId);
    if (auraCard !== undefined) {
      return { ...auraCard, owner: pi as 0 | 1 };
    }
    const loc = findCard(player.zones, instanceId);
    if (loc !== null) return { ...loc.card, owner: pi as 0 | 1 };
    for (const zone of [player.zones.reserve, player.zones.frontline, player.zones.highGround]) {
      for (const card of zone) {
        if (card?.equipment?.instanceId === instanceId) {
          return { ...card.equipment, owner: pi as 0 | 1 };
        }
      }
    }
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
  const location = locateCardInState(state, instanceId);
  if (location === null) {
    return state;
  }

  switch (location.kind) {
    case 'battlefield': {
      const player = state.players[location.playerId]!;
      const { zones, removed } = removeFromZone(player.zones, instanceId);
      const players = [...state.players] as [typeof state.players[0], typeof state.players[1]];
      players[location.playerId] = {
        ...player,
        zones,
        discardPile: removed !== null && !removed.isToken
          ? [...player.discardPile, removed]
          : player.discardPile,
      };
      return { ...state, players };
    }
    case 'aura': {
      const player = state.players[location.playerId]!;
      const players = [...state.players] as [typeof state.players[0], typeof state.players[1]];
      players[location.playerId] = {
        ...player,
        auraZone: player.auraZone.filter(card => card.instanceId !== instanceId),
        discardPile: location.card.isToken
          ? player.discardPile
          : [...player.discardPile, location.card],
      };
      return { ...state, players };
    }
    case 'equipment':
      return detachEquipmentFromHost(
        state,
        location.playerId,
        location.host.instanceId,
        instanceId,
        location.card.isToken ? 'none' : 'discard',
      );
  }
}

export function discardCardsFromHand(
  state: GameState,
  playerId: 0 | 1,
  cardIds: readonly string[],
): {
  readonly state: GameState;
  readonly discardedCards: readonly CardInstance[];
  readonly events: readonly GameEvent[];
} {
  const player = state.players[playerId]!;
  const selected = new Set(cardIds);
  const discardedCards = player.hand.filter(card => selected.has(card.instanceId));
  const remainingHand = player.hand.filter(card => !selected.has(card.instanceId));
  const players = [...state.players] as [typeof state.players[0], typeof state.players[1]];
  players[playerId] = {
    ...player,
    hand: remainingHand,
    discardPile: [...player.discardPile, ...discardedCards],
  };

  let currentState: GameState = { ...state, players };
  const events: GameEvent[] = discardedCards.map(card => ({
    type: 'CARD_DISCARDED',
    cardInstanceId: card.instanceId,
    playerId,
  }));

  for (const card of discardedCards) {
    const recycleCount = getNumericTraitValue(card, 'recycle');
    if (recycleCount <= 0) {
      continue;
    }
    const drawResult = executeEffect(currentState, {
      type: 'draw_cards',
      count: { type: 'fixed', value: recycleCount },
      player: 'allied',
    }, {
      sourceInstanceId: card.instanceId,
      controllerId: playerId,
      triggerDepth: 0,
    });
    currentState = drawResult.newState;
    events.push(...drawResult.events);
  }

  return {
    state: currentState,
    discardedCards,
    events,
  };
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
    movesThisTurn: 0,
    deployedTurn: null,
    stealthBroken: false,
    grantedTraits: [],
    grantedAbilities: [],
    modifiers: [],
    statusEffects: [],
    registeredTriggers: [],
    replacementEffects: [],
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
  const location = locateCardInState(state, instanceId);
  const card = location?.card ?? null;
  if (location === null || card === null) {
    return { state, events: [] };
  }

  const replacement = getActiveReplacementEffect(state, card, 'on_would_be_destroyed');
  if (replacement !== null) {
    let replacedState = replacement.effect.oncePerTurn === true
      ? markReplacementEffectUsed(state, replacement.id)
      : state;
    const replacedEvents: GameEvent[] = [];

    for (const effect of replacement.effect.instead) {
      const result = executeEffect(replacedState, effect, {
        sourceInstanceId: replacement.sourceInstanceId,
        controllerId: replacement.controllerId,
        triggerDepth: 0,
      });
      replacedState = result.newState;
      replacedEvents.push(...result.events);
    }

    return { state: replacedState, events: replacedEvents };
  }

  const ownerPlayer = state.players[card.owner]!;
  let newZones = ownerPlayer.zones;
  let newAuraZone = ownerPlayer.auraZone;
  let discardPile = [...ownerPlayer.discardPile];
  let exileZone = [...ownerPlayer.exileZone];
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

  if (!card.isToken && location.kind !== 'equipment') {
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

  if (location.kind === 'battlefield') {
    const removed = removeFromZone(ownerPlayer.zones, instanceId);
    newZones = removed.zones;
  } else if (location.kind === 'aura') {
    newAuraZone = ownerPlayer.auraZone.filter(entry => entry.instanceId !== instanceId);
  } else {
    const detached = detachEquipmentFromHost(
      state,
      location.playerId,
      location.host.instanceId,
      instanceId,
      destination === 'discard' ? 'discard' : 'none',
    );
    const detachedPlayer = detached.players[location.playerId]!;
      discardPile = [...detachedPlayer.discardPile];
      exileZone = [...detachedPlayer.exileZone];
      newZones = detachedPlayer.zones;
      if (destination === 'exile' && !card.isToken) {
        events.push({
          type: 'CARD_EXILED',
          cardInstanceId: instanceId,
          playerId: card.owner,
        });
        exileZone.push(destroyedCard);
      }
    }

  if (location.kind === 'battlefield' && card.equipment !== null) {
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
    auraZone: newAuraZone,
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

function updateEquipmentOnHost(
  host: CardInstance,
  updater: (card: CardInstance) => CardInstance,
): CardInstance {
  if (host.equipment === null) {
    return host;
  }
  return {
    ...host,
    equipment: updater(host.equipment),
  };
}

type CardStateLocation =
  | {
      readonly kind: 'battlefield';
      readonly playerId: 0 | 1;
      readonly card: CardInstance;
    }
  | {
      readonly kind: 'aura';
      readonly playerId: 0 | 1;
      readonly card: CardInstance;
    }
  | {
      readonly kind: 'equipment';
      readonly playerId: 0 | 1;
      readonly host: CardInstance;
      readonly card: CardInstance;
    };

function locateCardInState(
  state: GameState,
  instanceId: string,
): CardStateLocation | null {
  for (let pi = 0; pi < 2; pi++) {
    const player = state.players[pi]!;
    const auraCard = player.auraZone.find(card => card.instanceId === instanceId);
    if (auraCard !== undefined) {
      return { kind: 'aura', playerId: pi as 0 | 1, card: auraCard };
    }

    const found = findCard(player.zones, instanceId);
    if (found !== null) {
      return { kind: 'battlefield', playerId: pi as 0 | 1, card: found.card };
    }

    for (const zone of [player.zones.reserve, player.zones.frontline, player.zones.highGround]) {
      for (const card of zone) {
        if (card?.equipment?.instanceId === instanceId) {
          return {
            kind: 'equipment',
            playerId: pi as 0 | 1,
            host: card,
            card: card.equipment,
          };
        }
      }
    }
  }

  return null;
}

function detachEquipmentFromHost(
  state: GameState,
  playerId: 0 | 1,
  hostInstanceId: string,
  equipmentInstanceId: string,
  destination: 'discard' | 'none',
): GameState {
  const player = state.players[playerId]!;
  const discardPile = [...player.discardPile];
  const updateHost = (card: CardInstance | null): CardInstance | null => {
    if (card === null || card.instanceId !== hostInstanceId || card.equipment === null) {
      return card;
    }
    if (card.equipment.instanceId !== equipmentInstanceId) {
      return card;
    }
    const bonuses = getEquipmentStatBonuses(card.equipment);
    if (destination === 'discard' && !card.equipment.isToken) {
      discardPile.push({
        ...card.equipment,
        transferredThisTurn: false,
      });
    }
    return {
      ...card,
      equipment: null,
      baseAtk: card.baseAtk - bonuses.atk,
      baseHp: card.baseHp - bonuses.hp,
      baseArm: card.baseArm - bonuses.arm,
      currentAtk: card.currentAtk - bonuses.atk,
      currentHp: card.currentHp - bonuses.hp,
      currentArm: card.currentArm - bonuses.arm,
    };
  };

  const players = [...state.players] as [typeof state.players[0], typeof state.players[1]];
  players[playerId] = {
    ...player,
    zones: {
      reserve: player.zones.reserve.map(updateHost),
      frontline: player.zones.frontline.map(updateHost),
      highGround: player.zones.highGround.map(updateHost),
    },
    discardPile,
  };
  return { ...state, players };
}

function getEquipmentStatBonuses(equipment: CardInstance): { atk: number; hp: number; arm: number } {
  let atk = 0;
  let hp = 0;
  let arm = 0;

  for (const ability of equipment.abilities) {
    if (ability.type !== 'stat_grant') {
      continue;
    }
    atk += ability.modifier.atk ?? 0;
    hp += ability.modifier.hp ?? 0;
    arm += ability.modifier.arm ?? 0;
  }

  return { atk, hp, arm };
}

function cardHasTrait(
  card: CardInstance,
  trait: CardInstance['traits'][number],
): boolean {
  return card.traits.includes(trait) || card.grantedTraits.some(entry => entry.trait === trait);
}
