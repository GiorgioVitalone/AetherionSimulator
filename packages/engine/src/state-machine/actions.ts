/**
 * State Machine Actions — pure functions that produce new GameState.
 * Each action is called from XState assign() to update machine context.
 */
import type {
  GameState,
  PlayerState,
  CardInstance,
  GameEvent,
  StackItem,
} from '../types/game-state.js';
import type { Effect } from '../types/effects.js';
import type { PlayerAction } from './types.js';
import { computeAvailableActions } from '../actions/available-actions.js';
import { deployToZone } from '../zones/zone-manager.js';
import { canAfford, getReducedCardCost, payCost } from '../actions/cost-checker.js';
import { computeSpellTargeting } from '../actions/spell-targeting.js';
import { registerHeroTriggers } from '../events/index.js';
import { MAX_HAND_SIZE } from '../types/game-state.js';
import {
  cardHasActiveTrait,
  getRuntimeCardAbilities,
} from '../state/runtime-card-helpers.js';
import { discardCardsFromHand } from '../state/index.js';

interface PlayerActionResult {
  readonly state: GameState;
  readonly events: readonly GameEvent[];
  readonly stackItem?: StackItem;
}

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
  const isStunned = card.statusEffects.some(status => status.statusType === 'stunned');
  return {
    ...card,
    exhausted: isStunned ? card.exhausted : false,
    summoningSick: false,
    movedThisTurn: false,
    attackedThisTurn: false,
    movesThisTurn: 0,
    abilitiesSuppressed: false,
    transferredThisTurn: false,
    abilityCooldowns: decrementAbilityCooldownMap(card.abilityCooldowns),
    equipment: card.equipment === null ? null : refreshCard(card.equipment),
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
): PlayerActionResult {
  if (state.pendingChoice !== null) {
    return { state, events: [] };
  }

  if (!isActionLegal(state, action)) {
    return { state, events: [] };
  }

  switch (action.type) {
    case 'deploy':
      return executeDeploy(state, action);
    case 'cast_spell':
      return executeCastSpell(state, action);
    case 'attach_equipment':
      return executeAttachEquipment(state, action);
    case 'remove_equipment':
      return executeRemoveEquipment(state, action);
    case 'transfer_equipment':
      return executeTransferEquipment(state, action);
    case 'move':
      return executeMove(state, action);
    case 'activate_ability':
      return executeActivateAbility(state, action);
    case 'discard_for_energy':
      return executeDiscardForEnergy(state, action);
    case 'declare_attack':
      return executeDeclareAttack(state, action);
    case 'activate_hero_ability':
      return executeActivateHeroAbility(state, action);
    case 'declare_transform':
      return executeDeclareTransform(state);
  }
}

function executeDeploy(
  state: GameState,
  action: { cardInstanceId: string; zone: import('../types/common.js').ZoneType; slotIndex: number; xValue?: number },
): { readonly state: GameState; readonly events: readonly GameEvent[] } {
  const player = state.players[state.activePlayerIndex]!;
  const cardIndex = player.hand.findIndex(c => c.instanceId === action.cardInstanceId);
  if (cardIndex === -1) return { state, events: [] };

  const card = player.hand[cardIndex]!;
  const isXCost = card.cost.xMana === true || card.cost.xEnergy === true;
  const xValue = isXCost ? (action.xValue ?? 0) : undefined;
  const requiresPositiveX = isXCost && card.baseHp === 0 && card.baseAtk === 0;
  if (requiresPositiveX && (xValue ?? 0) <= 0) {
    return { state, events: [] };
  }
  const baseDeployCost = getReducedCardCost(player, card);
  const deployCost = action.zone === 'high_ground'
    ? addFlexibleCost(baseDeployCost, 2)
    : baseDeployCost;

  if (!canAfford(player, deployCost, xValue)) return { state, events: [] };
  const paidPlayer = payCost(player, deployCost, xValue);

  const hasHaste = cardHasActiveTrait(card, 'haste');

  // For X-cost characters with 0/0 base stats, X determines stats (X/X/0)
  const xStatBonus = isXCost && xValue !== undefined ? xValue : 0;
  const baseHp = card.baseHp === 0 && isXCost ? xStatBonus : card.baseHp;
  const baseAtk = card.baseAtk === 0 && isXCost ? xStatBonus : card.baseAtk;

  const deployedCard: CardInstance = {
    ...card,
    baseHp,
    baseAtk,
    currentHp: baseHp,
    currentAtk: baseAtk,
    exhausted: !hasHaste,
    summoningSick: !hasHaste,
    owner: state.activePlayerIndex,
    deployedTurn: state.turnNumber,
    xValue,
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
  action: { cardInstanceId: string; targetId?: string },
): PlayerActionResult {
  const player = state.players[state.activePlayerIndex]!;
  const cardIndex = player.hand.findIndex(c => c.instanceId === action.cardInstanceId);
  if (cardIndex === -1) return { state, events: [] };

  const card = player.hand[cardIndex]!;
  const castCost = getReducedCardCost(player, card);
  if (!canAfford(player, castCost)) return { state, events: [] };
  const targeting = computeSpellTargeting(state, state.activePlayerIndex, card);
  if (targeting.needsTarget) {
    if (action.targetId === undefined) return { state, events: [] };
    if (!targeting.validTargets.includes(action.targetId)) {
      return { state, events: [] };
    }
  }

  const paidPlayer = payCost(player, castCost);
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
    events: [],
    stackItem: {
      id: createStackItemId(state, 'spell', card.instanceId),
      type: 'spell',
      sourceInstanceId: card.instanceId,
      controllerId: state.activePlayerIndex,
      effects: getSpellCastEffects(card),
      targets: action.targetId !== undefined ? [action.targetId] : [],
      cardSnapshot: card,
    },
  };
}

function executeAttachEquipment(
  state: GameState,
  action: { cardInstanceId: string; targetInstanceId: string },
): PlayerActionResult {
  const player = state.players[state.activePlayerIndex]!;
  const cardIndex = player.hand.findIndex(c => c.instanceId === action.cardInstanceId);
  if (cardIndex === -1) return { state, events: [] };

  const equipCard = player.hand[cardIndex]!;
  const equipCost = getReducedCardCost(player, equipCard);
  if (!canAfford(player, equipCost)) return { state, events: [] };
  const paidPlayer = payCost(player, equipCost);
  const newHand = paidPlayer.hand.filter((_, i) => i !== cardIndex);

  const target = getAllBattlefieldCards(paidPlayer).find(card => card.instanceId === action.targetInstanceId);
  if (target === undefined || !canAttachEquipmentToTarget(equipCard, target)) {
    return { state, events: [] };
  }

  const newPlayer: PlayerState = {
    ...paidPlayer,
    hand: newHand,
    discardPile: [...paidPlayer.discardPile, equipCard],
    turnCounters: {
      ...paidPlayer.turnCounters,
      equipmentPlayed: paidPlayer.turnCounters.equipmentPlayed + 1,
    },
  };

  return {
    state: setPlayer(state, state.activePlayerIndex, newPlayer),
    events: [],
    stackItem: {
      id: createStackItemId(state, 'equipment', equipCard.instanceId),
      type: 'equipment',
      sourceInstanceId: equipCard.instanceId,
      controllerId: state.activePlayerIndex,
      effects: [],
      targets: [action.targetInstanceId],
      cardSnapshot: equipCard,
    },
  };
}

function executeRemoveEquipment(
  state: GameState,
  action: { cardInstanceId: string },
): PlayerActionResult {
  const player = state.players[state.activePlayerIndex]!;
  const hostCard = getAllBattlefieldCards(player).find(card => card.instanceId === action.cardInstanceId);
  if (hostCard?.equipment === null || hostCard === undefined) {
    return { state, events: [] };
  }

  const newState = detachEquipmentFromHost(state, state.activePlayerIndex, hostCard.instanceId, 'discard');
  const equipment = hostCard.equipment;
  return {
    state: newState,
    events: [{
      type: 'CARD_LEFT_BATTLEFIELD',
      cardInstanceId: equipment.instanceId,
      destination: 'discard',
      playerId: state.activePlayerIndex,
    }],
  };
}

function executeTransferEquipment(
  state: GameState,
  action: { cardInstanceId: string; targetInstanceId: string },
): PlayerActionResult {
  const player = state.players[state.activePlayerIndex]!;
  const sourceCard = getAllBattlefieldCards(player).find(card => card.instanceId === action.cardInstanceId);
  if (sourceCard?.equipment === null || sourceCard === undefined) {
    return { state, events: [] };
  }

  const equipment = sourceCard.equipment;
  const transferCost = getReducedCardCost(player, equipment);
  if (!canAfford(player, transferCost)) {
    return { state, events: [] };
  }

  const targetCard = getAllBattlefieldCards(player).find(card => card.instanceId === action.targetInstanceId);
  if (targetCard === undefined || !canAttachEquipmentToTarget(equipment, targetCard)) {
    return { state, events: [] };
  }

  const replacedEquipment = targetCard.equipment;
  let currentState = setPlayer(state, state.activePlayerIndex, payCost(player, transferCost));
  currentState = detachEquipmentFromHost(currentState, state.activePlayerIndex, sourceCard.instanceId, 'none');
  currentState = attachEquipmentToHost(
    currentState,
    state.activePlayerIndex,
    action.targetInstanceId,
    { ...equipment, transferredThisTurn: true },
  );

  return {
    state: currentState,
    events: [
      ...(replacedEquipment === null
        ? []
        : [
            {
              type: 'CARD_DESTROYED' as const,
              cardInstanceId: replacedEquipment.instanceId,
              cause: 'effect' as const,
              playerId: state.activePlayerIndex,
              destroyedCard: { ...replacedEquipment, equipment: null },
            },
            {
              type: 'CARD_LEFT_BATTLEFIELD' as const,
              cardInstanceId: replacedEquipment.instanceId,
              destination: 'discard' as const,
              playerId: state.activePlayerIndex,
            },
          ]),
      {
        type: 'EQUIPMENT_ATTACHED' as const,
        equipmentId: equipment.instanceId,
        targetId: action.targetInstanceId,
      },
    ],
  };
}

function executeMove(
  state: GameState,
  action: {
    cardInstanceId: string;
    toZone: import('../types/common.js').ZoneType;
    slotIndex: number;
  },
): PlayerActionResult {
  return {
    state,
    events: [],
    stackItem: {
      id: createStackItemId(state, 'move', action.cardInstanceId),
      type: 'move',
      sourceInstanceId: action.cardInstanceId,
      controllerId: state.activePlayerIndex,
      effects: [],
      targets: [],
      zone: action.toZone,
      slotIndex: action.slotIndex,
    },
  };
}

function executeActivateAbility(
  state: GameState,
  action: { cardInstanceId: string; abilityIndex: number; targetId?: string },
): PlayerActionResult {
  const player = state.players[state.activePlayerIndex]!;

  // Find the card on the battlefield
  const allSlots = [
    ...player.zones.reserve,
    ...player.zones.frontline,
    ...player.zones.highGround,
  ];
  const card = allSlots.find(c => c?.instanceId === action.cardInstanceId);
  if (!card) return { state, events: [] };

  // Check the ability exists
  const ability = getRuntimeCardAbilities(card)[action.abilityIndex];
  if (!ability) return { state, events: [] };

  // Pay cost if the ability is an activated triggered ability
  let updatedPlayer = player;
  let updatedCardCooldowns = new Map(card.abilityCooldowns);
  const updatedActivatedTurns = new Map(card.activatedAbilityTurns);
  if (ability.type === 'triggered' && ability.trigger.type === 'activated') {
    const abilityCost = ability.trigger.cost;
    if (!canAfford(player, abilityCost)) return { state, events: [] };
    updatedPlayer = payCost(player, abilityCost);
    const cooldown = ability.cooldown ?? ability.trigger.cooldown;
    if (cooldown !== undefined && cooldown > 0) {
      updatedCardCooldowns = new Map(card.abilityCooldowns);
      updatedCardCooldowns.set(action.abilityIndex, cooldown);
    }
  }
  updatedActivatedTurns.set(action.abilityIndex, state.turnNumber);

  // Exhaust the card
  const exhaustCard = (c: CardInstance | null): CardInstance | null => {
    if (c === null || c.instanceId !== action.cardInstanceId) return c;
    return {
      ...c,
      exhausted: true,
      stealthBroken: true,
      abilityCooldowns: updatedCardCooldowns,
      activatedAbilityTurns: updatedActivatedTurns,
    };
  };

  const newZones = {
    reserve: updatedPlayer.zones.reserve.map(exhaustCard),
    frontline: updatedPlayer.zones.frontline.map(exhaustCard),
    highGround: updatedPlayer.zones.highGround.map(exhaustCard),
  };

  const newPlayer: PlayerState = {
    ...updatedPlayer,
    zones: newZones,
    turnCounters: {
      ...updatedPlayer.turnCounters,
      abilitiesActivated: updatedPlayer.turnCounters.abilitiesActivated + 1,
    },
  };

  return {
    state: setPlayer(state, state.activePlayerIndex, newPlayer),
    events: [],
    stackItem: {
      id: createStackItemId(state, 'ability', action.cardInstanceId),
      type: 'ability',
      sourceInstanceId: action.cardInstanceId,
      controllerId: state.activePlayerIndex,
      effects: getHeroAbilityEffects(ability),
      targets: action.targetId !== undefined ? [action.targetId] : [],
      abilityIndex: action.abilityIndex,
    },
  };
}

function executeActivateHeroAbility(
  state: GameState,
  action: { abilityIndex: number; targetId?: string },
): PlayerActionResult {
  const player = state.players[state.activePlayerIndex]!;
  const hero = player.hero;

  const ability = hero.abilities[action.abilityIndex];
  if (!ability) return { state, events: [] };

  // Pay cost if activated trigger
  let updatedPlayer = player;
  if (ability.type === 'triggered' && ability.trigger.type === 'activated') {
    const abilityCost = ability.trigger.cost;
    if (!canAfford(player, abilityCost)) return { state, events: [] };
    updatedPlayer = payCost(player, abilityCost);
  }

  // Update cooldown on the hero
  const newCooldowns = new Map(hero.cooldowns);
  const activatedAbilityTurns = new Map(hero.activatedAbilityTurns);
  const usedUltimateAbilityIndices = [...hero.usedUltimateAbilityIndices];
  if (ability.type === 'triggered' && ability.trigger.type === 'activated' && ability.trigger.cooldown !== undefined) {
    newCooldowns.set(action.abilityIndex, ability.trigger.cooldown);
  }
  if (
    ability.type === 'triggered' &&
    ability.trigger.type === 'activated' &&
    ability.trigger.oncePerGame === true &&
    !usedUltimateAbilityIndices.includes(action.abilityIndex)
  ) {
    usedUltimateAbilityIndices.push(action.abilityIndex);
  }
  activatedAbilityTurns.set(action.abilityIndex, state.turnNumber);

  const newHero = {
    ...hero,
    cooldowns: newCooldowns,
    activatedAbilityTurns,
    usedUltimateAbilityIndices,
  };

  const newPlayer: PlayerState = {
    ...updatedPlayer,
    hero: newHero,
    turnCounters: {
      ...updatedPlayer.turnCounters,
      abilitiesActivated: updatedPlayer.turnCounters.abilitiesActivated + 1,
    },
  };

  return {
    state: setPlayer(state, state.activePlayerIndex, newPlayer),
    events: [],
    stackItem: {
      id: createStackItemId(state, 'hero_ability', `hero_${String(state.activePlayerIndex)}`),
      type: 'hero_ability',
      sourceInstanceId: `hero_${String(state.activePlayerIndex)}`,
      controllerId: state.activePlayerIndex,
      effects: getHeroAbilityEffects(ability),
      targets: action.targetId !== undefined ? [action.targetId] : [],
      abilityIndex: action.abilityIndex,
    },
  };
}

function getHeroAbilityEffects(ability: import('../types/ability.js').AbilityDSL): readonly Effect[] {
  if (ability.type !== 'triggered') return [];
  if (ability.condition !== undefined) {
    return [{
      type: 'conditional',
      condition: ability.condition,
      ifTrue: ability.effects,
    }];
  }
  return ability.effects;
}

function executeDiscardForEnergy(
  state: GameState,
  action: { cardInstanceId: string },
): { readonly state: GameState; readonly events: readonly GameEvent[] } {
  const player = state.players[state.activePlayerIndex]!;
  const cardIndex = player.hand.findIndex(c => c.instanceId === action.cardInstanceId);
  if (cardIndex === -1) return { state, events: [] };

  const card = player.hand[cardIndex]!;
  const resourceType = getPrimaryResourceType(card);
  const discarded = discardCardsFromHand(state, state.activePlayerIndex, [action.cardInstanceId]);
  const updatedPlayer = discarded.state.players[state.activePlayerIndex]!;
  const newState: GameState = {
    ...setPlayer(discarded.state, state.activePlayerIndex, {
      ...updatedPlayer,
      temporaryResources: [
        ...updatedPlayer.temporaryResources,
        { resourceType, amount: 1 },
      ],
    }),
    turnState: { ...discarded.state.turnState, discardedForEnergy: true },
  };

  return {
    state: newState,
    events: [
      ...discarded.events,
      {
        type: 'RESOURCE_GAINED',
        playerId: state.activePlayerIndex,
        resourceType,
        amount: 1,
      },
    ],
  };
}

function getSpellCastEffects(card: CardInstance): readonly Effect[] {
  const effects: Effect[] = [];

  for (const ability of getRuntimeCardAbilities(card)) {
    if (ability.type !== 'triggered' || ability.trigger.type !== 'on_cast') {
      continue;
    }

    if (ability.condition !== undefined) {
      effects.push({
        type: 'conditional',
        condition: ability.condition,
        ifTrue: ability.effects,
      });
      continue;
    }

    effects.push(...ability.effects);
  }

  return effects;
}

function executeDeclareAttack(
  state: GameState,
  action: { attackerInstanceId: string; targetId: string | 'hero' },
): PlayerActionResult {
  const attackerOwner = state.activePlayerIndex;
  const player = state.players[attackerOwner]!;
  const updateAttacker = (card: CardInstance | null): CardInstance | null => {
    if (card === null || card.instanceId !== action.attackerInstanceId) {
      return card;
    }
    return {
      ...card,
      stealthBroken: true,
    };
  };

  return {
    state: setPlayer(state, attackerOwner, {
      ...player,
      zones: {
        reserve: player.zones.reserve.map(updateAttacker),
        frontline: player.zones.frontline.map(updateAttacker),
        highGround: player.zones.highGround.map(updateAttacker),
      },
    }),
    events: [],
    stackItem: {
      id: createStackItemId(state, 'attack', action.attackerInstanceId),
      type: 'attack',
      sourceInstanceId: action.attackerInstanceId,
      controllerId: attackerOwner,
      effects: [],
      targets: [action.targetId],
    },
  };
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
  return discardCardsFromHand(state, state.activePlayerIndex, cardIds).state;
}

export function decrementHeroCooldowns(state: GameState): GameState {
  return updateActivePlayer(state, player => {
    const hero = player.hero;
    if (hero.cooldowns.size === 0) return player;

    const newCooldowns = new Map<number, number>();
    for (const [abilityIndex, remaining] of hero.cooldowns) {
      const decremented = remaining - 1;
      if (decremented > 0) {
        newCooldowns.set(abilityIndex, decremented);
      }
    }

    return {
      ...player,
      hero: { ...hero, cooldowns: newCooldowns },
    };
  });
}

export function passTurn(state: GameState): GameState {
  const nextPlayer = state.activePlayerIndex === 0 ? 1 : 0;
  const players = state.players.map(player => ({
    ...player,
    hero: {
      ...player.hero,
      transformedThisTurn: false,
    },
  })) as [PlayerState, PlayerState];
  return {
    ...state,
    players,
    activePlayerIndex: nextPlayer as 0 | 1,
    turnNumber: state.turnNumber + 1,
    turnState: {
      discardedForEnergy: false,
      firstPlayerFirstTurn: false,
      usedReplacementEffectIds: [],
    },
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

function isActionLegal(state: GameState, action: PlayerAction): boolean {
  const available = computeAvailableActions(state);

  switch (action.type) {
    case 'deploy':
      return available.canDeploy.some(option =>
        option.cardInstanceId === action.cardInstanceId &&
        option.validSlots.some(slot => slot.zone === action.zone && slot.slots.includes(action.slotIndex)) &&
        (
          !option.isXCost ||
          (
            action.xValue !== undefined &&
            action.xValue >= option.minX &&
            action.xValue <= option.maxX
          )
        ),
      );
    case 'cast_spell':
      return available.canCastSpell.some(option =>
        option.cardInstanceId === action.cardInstanceId &&
        (!option.needsTarget || (action.targetId !== undefined && option.validTargets.includes(action.targetId))),
      );
    case 'attach_equipment':
      return available.canAttachEquipment.some(option =>
        option.cardInstanceId === action.cardInstanceId &&
        option.validTargets.includes(action.targetInstanceId),
      );
    case 'remove_equipment':
      return available.canRemoveEquipment.some(option => option.cardInstanceId === action.cardInstanceId);
    case 'transfer_equipment':
      return available.canTransferEquipment.some(option =>
        option.cardInstanceId === action.cardInstanceId &&
        option.validTargets.includes(action.targetInstanceId),
      );
    case 'move':
      return available.canMove.some(option =>
        option.cardInstanceId === action.cardInstanceId &&
        option.validSlots.some(slot => slot.zone === action.toZone && slot.slotIndex === action.slotIndex),
      );
    case 'activate_ability':
      return available.canActivateAbility.some(option =>
        option.cardInstanceId === action.cardInstanceId &&
        option.abilityIndex === action.abilityIndex,
      );
    case 'activate_hero_ability':
      return available.canActivateHeroAbility.some(option => option.abilityIndex === action.abilityIndex);
    case 'discard_for_energy':
      return available.canDiscardForEnergy &&
        state.players[state.activePlayerIndex]!.hand.some(card => card.instanceId === action.cardInstanceId);
    case 'declare_attack':
      return available.canAttack.some(option =>
        option.attackerInstanceId === action.attackerInstanceId &&
        option.validTargets.some(target =>
          action.targetId === 'hero'
            ? target.type === 'hero'
            : target.type === 'character' && target.instanceId === action.targetId,
        ),
      );
    case 'declare_transform':
      return available.canTransform;
  }
}

function getPrimaryResourceType(card: CardInstance): 'mana' | 'energy' {
  return card.resourceTypes[0] ?? 'mana';
}

function decrementAbilityCooldownMap(
  cooldowns: ReadonlyMap<number, number>,
): ReadonlyMap<number, number> {
  if (cooldowns.size === 0) {
    return cooldowns;
  }
  const nextCooldowns = new Map<number, number>();
  for (const [abilityIndex, remaining] of cooldowns) {
    const decremented = remaining - 1;
    if (decremented > 0) {
      nextCooldowns.set(abilityIndex, decremented);
    }
  }
  return nextCooldowns;
}

function addFlexibleCost(cost: CardInstance['cost'], amount: number): CardInstance['cost'] {
  return {
    ...cost,
    flexible: cost.flexible + amount,
  };
}

function getAllBattlefieldCards(player: PlayerState): readonly CardInstance[] {
  return [
    ...player.zones.reserve.filter((card): card is CardInstance => card !== null),
    ...player.zones.frontline.filter((card): card is CardInstance => card !== null),
    ...player.zones.highGround.filter((card): card is CardInstance => card !== null),
  ];
}

function detachEquipmentFromHost(
  state: GameState,
  playerId: 0 | 1,
  hostInstanceId: string,
  destination: 'discard' | 'none',
): GameState {
  const player = state.players[playerId]!;
  const hostCard = getAllBattlefieldCards(player).find(card => card.instanceId === hostInstanceId);
  if (hostCard?.equipment === null || hostCard === undefined) {
    return state;
  }

  const equipment = hostCard.equipment;
  const bonuses = getEquipmentStatBonuses(equipment);
  const updateHost = (card: CardInstance | null): CardInstance | null => {
    if (card === null || card.instanceId !== hostInstanceId) return card;
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

  const nextPlayer: PlayerState = {
    ...player,
    zones: {
      reserve: player.zones.reserve.map(updateHost),
      frontline: player.zones.frontline.map(updateHost),
      highGround: player.zones.highGround.map(updateHost),
    },
    discardPile: destination === 'discard'
      ? [...player.discardPile, { ...equipment, transferredThisTurn: false }]
      : player.discardPile,
  };

  return setPlayer(state, playerId, nextPlayer);
}

function attachEquipmentToHost(
  state: GameState,
  playerId: 0 | 1,
  hostInstanceId: string,
  equipment: CardInstance,
): GameState {
  const player = state.players[playerId]!;
  const hostCard = getAllBattlefieldCards(player).find(card => card.instanceId === hostInstanceId);
  if (hostCard === undefined) {
    return state;
  }

  const replacedEquipment = hostCard.equipment;
  let discardPile = player.discardPile;
  if (replacedEquipment !== null) {
    discardPile = [...discardPile, { ...replacedEquipment, transferredThisTurn: false }];
  }

  const bonuses = getEquipmentStatBonuses(equipment);
  const oldBonuses = replacedEquipment === null ? zeroStatBonuses() : getEquipmentStatBonuses(replacedEquipment);
  const updateHost = (card: CardInstance | null): CardInstance | null => {
    if (card === null || card.instanceId !== hostInstanceId) return card;
    return {
      ...card,
      equipment,
      baseAtk: card.baseAtk - oldBonuses.atk + bonuses.atk,
      baseHp: card.baseHp - oldBonuses.hp + bonuses.hp,
      baseArm: card.baseArm - oldBonuses.arm + bonuses.arm,
      currentAtk: card.currentAtk - oldBonuses.atk + bonuses.atk,
      currentHp: card.currentHp - oldBonuses.hp + bonuses.hp,
      currentArm: card.currentArm - oldBonuses.arm + bonuses.arm,
    };
  };

  return setPlayer(state, playerId, {
    ...player,
    zones: {
      reserve: player.zones.reserve.map(updateHost),
      frontline: player.zones.frontline.map(updateHost),
      highGround: player.zones.highGround.map(updateHost),
    },
    discardPile,
  });
}

function getEquipmentStatBonuses(equipment: CardInstance): { atk: number; hp: number; arm: number } {
  let atk = 0;
  let hp = 0;
  let arm = 0;

  for (const ability of equipment.abilities) {
    if (ability.type !== 'stat_grant') continue;
    atk += ability.modifier.atk ?? 0;
    hp += ability.modifier.hp ?? 0;
    arm += ability.modifier.arm ?? 0;
  }

  return { atk, hp, arm };
}

function zeroStatBonuses(): { atk: number; hp: number; arm: number } {
  return { atk: 0, hp: 0, arm: 0 };
}

function canAttachEquipmentToTarget(
  equipment: CardInstance,
  target: CardInstance,
): boolean {
  if (equipment.alignment.length > 0 && !equipment.alignment.some(alignment => target.alignment.includes(alignment))) {
    return false;
  }
  if (equipment.resourceTypes.length > 0 && !equipment.resourceTypes.some(resourceType => target.resourceTypes.includes(resourceType))) {
    return false;
  }
  return true;
}

function executeDeclareTransform(state: GameState): PlayerActionResult {
  const player = state.players[state.activePlayerIndex]!;
  const hero = player.hero;
  const transformDefinition = hero.transformDefinition;
  if (transformDefinition === null || hero.transformedCardDefId === null) {
    return { state, events: [] };
  }

  const damageTaken = Math.max(0, hero.maxLp - hero.currentLp);
  const transformedCurrentLp = Math.max(0, transformDefinition.maxLp - damageTaken);

  const transformedHero = {
    ...hero,
    cardDefId: transformDefinition.cardDefId,
    name: transformDefinition.name,
    currentLp: transformedCurrentLp,
    maxLp: transformDefinition.maxLp,
    alignment: transformDefinition.alignment,
    resourceTypes: transformDefinition.resourceTypes,
    transformedCardDefId: null,
    transformDefinition: null,
    transformed: true,
    canTransformThisGame: false,
    transformedThisTurn: true,
    abilities: transformDefinition.abilities,
    cooldowns: new Map(),
    registeredTriggers: [],
  };

  const updatedState = setPlayer(state, state.activePlayerIndex, {
    ...player,
    hero: transformedHero,
  });

  return {
    state: registerHeroTriggers(updatedState, state.activePlayerIndex),
    events: [],
  };
}

function createStackItemId(
  state: GameState,
  type: StackItem['type'],
  sourceInstanceId: string,
): string {
  return `${type}_${sourceInstanceId}_${String(state.turnNumber)}_${String(state.stack.length)}_${String(state.log.length)}`;
}
