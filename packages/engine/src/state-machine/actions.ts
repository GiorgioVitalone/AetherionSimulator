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
import { canAfford, payCost } from '../actions/cost-checker.js';
import { computeSpellTargeting } from '../actions/spell-targeting.js';
import { registerHeroTriggers } from '../events/index.js';
import { MAX_HAND_SIZE } from '../types/game-state.js';

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
    abilitiesSuppressed: false,
    transferredThisTurn: false,
    abilityCooldowns: decrementAbilityCooldownMap(card.abilityCooldowns),
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
  const deployCost = action.zone === 'high_ground'
    ? addFlexibleCost(card.cost, 2)
    : card.cost;

  if (!canAfford(player, deployCost, xValue)) return { state, events: [] };
  const paidPlayer = payCost(player, deployCost, xValue);

  const hasHaste = allTraits(card).includes('haste');

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
  if (!canAfford(player, card.cost)) return { state, events: [] };
  const targeting = computeSpellTargeting(state, state.activePlayerIndex, card);
  if (targeting.needsTarget) {
    if (action.targetId === undefined) return { state, events: [] };
    if (!targeting.validTargets.includes(action.targetId)) {
      return { state, events: [] };
    }
  }

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
  if (!canAfford(player, equipCard.cost)) return { state, events: [] };
  const paidPlayer = payCost(player, equipCard.cost);
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
  const ability = card.abilities[action.abilityIndex];
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

  const newPlayer: PlayerState = {
    ...player,
    hand: player.hand.filter((_, i) => i !== cardIndex),
    discardPile: [...player.discardPile, card],
    temporaryResources: [
      ...player.temporaryResources,
      { resourceType, amount: 1 },
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

function getSpellCastEffects(card: CardInstance): readonly Effect[] {
  const effects: Effect[] = [];

  for (const ability of card.abilities) {
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
  return {
    state,
    events: [],
    stackItem: {
      id: createStackItemId(state, 'attack', action.attackerInstanceId),
      type: 'attack',
      sourceInstanceId: action.attackerInstanceId,
      controllerId: state.activePlayerIndex,
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

function isActionLegal(state: GameState, action: PlayerAction): boolean {
  const available = computeAvailableActions(state);

  switch (action.type) {
    case 'deploy':
      return available.canDeploy.some(option =>
        option.cardInstanceId === action.cardInstanceId &&
        option.validSlots.some(slot => slot.zone === action.zone && slot.slots.includes(action.slotIndex)) &&
        (!option.isXCost || (action.xValue ?? 0) <= option.maxX),
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

function allTraits(card: CardInstance): readonly string[] {
  return [
    ...card.traits,
    ...card.grantedTraits.map(trait => trait.trait),
  ];
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
