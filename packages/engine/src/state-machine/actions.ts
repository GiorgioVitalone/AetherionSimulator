/**
 * State Machine Actions — pure functions that produce new GameState.
 * Each action is called from XState assign() to update machine context.
 */
import type {
  GameState,
  PlayerState,
  CardInstance,
  GameEvent,
} from '../types/game-state.js';
import type { PlayerAction } from './types.js';
import { deployToZone, moveCard } from '../zones/zone-manager.js';
import { resolveCombat } from '../combat/combat-resolver.js';
import { payCost } from '../actions/cost-checker.js';
import { MAX_HAND_SIZE } from '../types/game-state.js';

// ── Upkeep Actions ──────────────────────────────────────────────────────────

export function refreshCards(state: GameState): GameState {
  return updateActivePlayer(state, player => ({
    ...player,
    zones: {
      reserve: player.zones.reserve.map(refreshCard),
      frontline: player.zones.frontline.map(refreshCard),
      highGround: player.zones.highGround.map(refreshCard),
    },
    resourceBank: player.resourceBank.map(r => ({ ...r, exhausted: false })),
  }));
}

function refreshCard(card: CardInstance | null): CardInstance | null {
  if (card === null) return null;
  return {
    ...card,
    exhausted: false,
    summoningSick: false,
    movedThisTurn: false,
    attackedThisTurn: false,
  };
}

export function drawResourceCard(state: GameState): {
  readonly state: GameState;
  readonly events: readonly GameEvent[];
} {
  const player = state.players[state.activePlayerIndex]!;
  if (player.resourceDeck.length === 0) {
    return { state, events: [] };
  }

  const drawn = player.resourceDeck[0]!;
  const newPlayer: PlayerState = {
    ...player,
    resourceDeck: player.resourceDeck.slice(1),
    resourceBank: [...player.resourceBank, drawn],
  };

  return {
    state: setPlayer(state, state.activePlayerIndex, newPlayer),
    events: [{
      type: 'RESOURCE_GAINED',
      playerId: state.activePlayerIndex,
      resourceType: drawn.resourceType,
      amount: 1,
    }],
  };
}

export function drawMainDeckCard(state: GameState): {
  readonly state: GameState;
  readonly events: readonly GameEvent[];
  readonly deckEmpty: boolean;
} {
  const player = state.players[state.activePlayerIndex]!;
  if (player.mainDeck.length === 0) {
    return { state, events: [], deckEmpty: true };
  }

  const drawn = player.mainDeck[0]!;
  const newPlayer: PlayerState = {
    ...player,
    mainDeck: player.mainDeck.slice(1),
    hand: [...player.hand, drawn],
  };

  return {
    state: setPlayer(state, state.activePlayerIndex, newPlayer),
    events: [{
      type: 'CARD_DRAWN',
      playerId: state.activePlayerIndex,
      count: 1,
    }],
    deckEmpty: false,
  };
}

// ── Strategy Phase Actions ──────────────────────────────────────────────────

export function executePlayerAction(
  state: GameState,
  action: PlayerAction,
): { readonly state: GameState; readonly events: readonly GameEvent[] } {
  switch (action.type) {
    case 'deploy':
      return executeDeploy(state, action);
    case 'cast_spell':
      return executeCastSpell(state, action);
    case 'attach_equipment':
      return executeAttachEquipment(state, action);
    case 'move':
      return executeMove(state, action);
    case 'activate_ability':
      return executeActivateAbility(state, action);
    case 'discard_for_energy':
      return executeDiscardForEnergy(state, action);
    case 'declare_attack':
      return executeDeclareAttack(state, action);
    case 'declare_transform':
      return { state, events: [] }; // Placeholder
  }
}

function executeDeploy(
  state: GameState,
  action: { cardInstanceId: string; zone: import('../types/common.js').ZoneType; slotIndex: number },
): { readonly state: GameState; readonly events: readonly GameEvent[] } {
  const player = state.players[state.activePlayerIndex]!;
  const cardIndex = player.hand.findIndex(c => c.instanceId === action.cardInstanceId);
  if (cardIndex === -1) return { state, events: [] };

  const card = player.hand[cardIndex]!;
  const paidPlayer = payCost(player, card.cost);

  const deployedCard: CardInstance = {
    ...card,
    summoningSick: !card.traits.includes('haste'),
    owner: state.activePlayerIndex,
  };

  const newZones = deployToZone(paidPlayer.zones, deployedCard, action.zone, action.slotIndex);
  const newHand = paidPlayer.hand.filter((_, i) => i !== cardIndex);

  const newPlayer: PlayerState = {
    ...paidPlayer,
    zones: newZones,
    hand: newHand,
    turnCounters: {
      ...paidPlayer.turnCounters,
      charactersDeployed: paidPlayer.turnCounters.charactersDeployed + 1,
    },
  };

  return {
    state: setPlayer(state, state.activePlayerIndex, newPlayer),
    events: [{
      type: 'CARD_DEPLOYED',
      cardInstanceId: card.instanceId,
      zone: action.zone,
      playerId: state.activePlayerIndex,
    }],
  };
}

function executeCastSpell(
  state: GameState,
  action: { cardInstanceId: string },
): { readonly state: GameState; readonly events: readonly GameEvent[] } {
  const player = state.players[state.activePlayerIndex]!;
  const cardIndex = player.hand.findIndex(c => c.instanceId === action.cardInstanceId);
  if (cardIndex === -1) return { state, events: [] };

  const card = player.hand[cardIndex]!;
  const paidPlayer = payCost(player, card.cost);
  const newHand = paidPlayer.hand.filter((_, i) => i !== cardIndex);

  const newPlayer: PlayerState = {
    ...paidPlayer,
    hand: newHand,
    discardPile: [...paidPlayer.discardPile, card],
    turnCounters: {
      ...paidPlayer.turnCounters,
      spellsCast: paidPlayer.turnCounters.spellsCast + 1,
    },
  };

  return {
    state: setPlayer(state, state.activePlayerIndex, newPlayer),
    events: [{
      type: 'SPELL_CAST',
      cardInstanceId: card.instanceId,
      playerId: state.activePlayerIndex,
    }],
  };
}

function executeAttachEquipment(
  state: GameState,
  action: { cardInstanceId: string; targetInstanceId: string },
): { readonly state: GameState; readonly events: readonly GameEvent[] } {
  const player = state.players[state.activePlayerIndex]!;
  const cardIndex = player.hand.findIndex(c => c.instanceId === action.cardInstanceId);
  if (cardIndex === -1) return { state, events: [] };

  const equipCard = player.hand[cardIndex]!;
  const paidPlayer = payCost(player, equipCard.cost);
  const newHand = paidPlayer.hand.filter((_, i) => i !== cardIndex);

  // Attach to target character
  const attachToCard = (c: CardInstance | null): CardInstance | null => {
    if (c === null || c.instanceId !== action.targetInstanceId) return c;
    return { ...c, equipment: equipCard };
  };

  const newZones = {
    reserve: paidPlayer.zones.reserve.map(attachToCard),
    frontline: paidPlayer.zones.frontline.map(attachToCard),
    highGround: paidPlayer.zones.highGround.map(attachToCard),
  };

  const newPlayer: PlayerState = {
    ...paidPlayer,
    zones: newZones,
    hand: newHand,
    turnCounters: {
      ...paidPlayer.turnCounters,
      equipmentPlayed: paidPlayer.turnCounters.equipmentPlayed + 1,
    },
  };

  return {
    state: setPlayer(state, state.activePlayerIndex, newPlayer),
    events: [{
      type: 'EQUIPMENT_ATTACHED',
      equipmentId: equipCard.instanceId,
      targetId: action.targetInstanceId,
    }],
  };
}

function executeMove(
  state: GameState,
  action: { cardInstanceId: string; toZone: import('../types/common.js').ZoneType },
): { readonly state: GameState; readonly events: readonly GameEvent[] } {
  const player = state.players[state.activePlayerIndex]!;
  const newZones = moveCard(player.zones, action.cardInstanceId, action.toZone);

  const fromLoc = (['reserve', 'frontline', 'high_ground'] as const)
    .find(z => {
      const arr = z === 'reserve' ? player.zones.reserve
        : z === 'frontline' ? player.zones.frontline
          : player.zones.highGround;
      return arr.some(c => c?.instanceId === action.cardInstanceId);
    });

  return {
    state: setPlayer(state, state.activePlayerIndex, { ...player, zones: newZones }),
    events: [{
      type: 'CARD_MOVED',
      cardInstanceId: action.cardInstanceId,
      fromZone: fromLoc ?? 'frontline',
      toZone: action.toZone,
    }],
  };
}

function executeActivateAbility(
  state: GameState,
  action: { cardInstanceId: string; abilityIndex: number },
): { readonly state: GameState; readonly events: readonly GameEvent[] } {
  // Placeholder — ability execution routes through effect interpreter
  return {
    state,
    events: [{
      type: 'ABILITY_ACTIVATED',
      cardInstanceId: action.cardInstanceId,
      abilityIndex: action.abilityIndex,
    }],
  };
}

function executeDiscardForEnergy(
  state: GameState,
  action: { cardInstanceId: string },
): { readonly state: GameState; readonly events: readonly GameEvent[] } {
  const player = state.players[state.activePlayerIndex]!;
  const cardIndex = player.hand.findIndex(c => c.instanceId === action.cardInstanceId);
  if (cardIndex === -1) return { state, events: [] };

  const card = player.hand[cardIndex]!;
  const newPlayer: PlayerState = {
    ...player,
    hand: player.hand.filter((_, i) => i !== cardIndex),
    discardPile: [...player.discardPile, card],
    temporaryResources: [
      ...player.temporaryResources,
      { resourceType: 'energy', amount: 1 },
    ],
  };

  const newState: GameState = {
    ...setPlayer(state, state.activePlayerIndex, newPlayer),
    turnState: { ...state.turnState, discardedForEnergy: true },
  };

  return {
    state: newState,
    events: [{
      type: 'CARD_DISCARDED',
      cardInstanceId: card.instanceId,
      playerId: state.activePlayerIndex,
    }],
  };
}

function executeDeclareAttack(
  state: GameState,
  action: { attackerInstanceId: string; targetId: string | 'hero' },
): { readonly state: GameState; readonly events: readonly GameEvent[] } {
  const result = resolveCombat(state, action.attackerInstanceId, action.targetId);
  return { state: result.newState, events: result.events };
}

// ── End Phase Actions ───────────────────────────────────────────────────────

export function removeTemporaryResources(state: GameState): GameState {
  return updateActivePlayer(state, player => ({
    ...player,
    temporaryResources: [],
  }));
}

export function checkHandSize(state: GameState): {
  readonly needsDiscard: boolean;
  readonly count: number;
} {
  const player = state.players[state.activePlayerIndex]!;
  const excess = player.hand.length - MAX_HAND_SIZE;
  return { needsDiscard: excess > 0, count: Math.max(0, excess) };
}

export function discardCards(
  state: GameState,
  cardIds: readonly string[],
): GameState {
  return updateActivePlayer(state, player => {
    const discarded: CardInstance[] = [];
    const remaining = player.hand.filter(c => {
      if (cardIds.includes(c.instanceId)) {
        discarded.push(c);
        return false;
      }
      return true;
    });
    return {
      ...player,
      hand: remaining,
      discardPile: [...player.discardPile, ...discarded],
    };
  });
}

export function passTurn(state: GameState): GameState {
  const nextPlayer = state.activePlayerIndex === 0 ? 1 : 0;
  return {
    ...state,
    activePlayerIndex: nextPlayer as 0 | 1,
    turnNumber: nextPlayer === 0 ? state.turnNumber + 1 : state.turnNumber,
    turnState: { discardedForEnergy: false, firstPlayerFirstTurn: false },
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function setPlayer(
  state: GameState,
  index: 0 | 1,
  player: PlayerState,
): GameState {
  const newPlayers = [...state.players] as [PlayerState, PlayerState];
  newPlayers[index] = player;
  return { ...state, players: newPlayers };
}

function updateActivePlayer(
  state: GameState,
  updater: (player: PlayerState) => PlayerState,
): GameState {
  const player = state.players[state.activePlayerIndex]!;
  return setPlayer(state, state.activePlayerIndex, updater(player));
}
