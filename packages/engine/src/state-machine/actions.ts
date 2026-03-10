/**
 * State Machine Actions — pure functions that produce new GameState.
 * Each action is called from XState assign() to update machine context.
 */
import type {
  GameState,
  PlayerState,
  CardInstance,
  EffectResolutionWorkItem,
  GameEvent,
} from '../types/game-state.js';
import type { Effect } from '../types/effects.js';
import type { PlayerAction } from './types.js';
import { deployToZone, moveCard } from '../zones/zone-manager.js';
import { resolveCombat } from '../combat/combat-resolver.js';
import { canAfford, payCost } from '../actions/cost-checker.js';
import { computeSpellTargeting } from '../actions/spell-targeting.js';
import { MAX_HAND_SIZE } from '../types/game-state.js';

interface PlayerActionResult {
  readonly state: GameState;
  readonly events: readonly GameEvent[];
  readonly effectWorkItem?: EffectResolutionWorkItem;
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
): PlayerActionResult {
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
  if (!canAfford(player, card.cost)) return { state, events: [] };
  const paidPlayer = payCost(player, card.cost);

  const hasHaste = card.traits.includes('haste');
  const deployedCard: CardInstance = {
    ...card,
    exhausted: !hasHaste,
    summoningSick: !hasHaste,
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

  const spellEffects = getSpellCastEffects(card);
  const allEvents: GameEvent[] = [{
    type: 'SPELL_CAST',
    cardInstanceId: card.instanceId,
    playerId: state.activePlayerIndex,
  }];

  const nextState = setPlayer(state, state.activePlayerIndex, newPlayer);
  if (spellEffects.length === 0) {
    return { state: nextState, events: allEvents };
  }

  return {
    state: nextState,
    events: allEvents,
    effectWorkItem: {
      kind: 'effect',
      sourceInstanceId: card.instanceId,
      controllerId: state.activePlayerIndex,
      effects: spellEffects,
      triggerDepth: 0,
      selectedTargets: action.targetId !== undefined ? [action.targetId] : undefined,
    },
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
  if (!canAfford(player, equipCard.cost)) return { state, events: [] };
  const paidPlayer = payCost(player, equipCard.cost);
  const newHand = paidPlayer.hand.filter((_, i) => i !== cardIndex);

  // Compute stat bonuses from equipment's stat_grant abilities
  let atkBonus = 0;
  let hpBonus = 0;
  let armBonus = 0;
  for (const ability of equipCard.abilities) {
    if (ability.type === 'stat_grant') {
      atkBonus += ability.modifier.atk ?? 0;
      hpBonus += ability.modifier.hp ?? 0;
      armBonus += ability.modifier.arm ?? 0;
    }
  }

  // Attach to target character and apply stat grants (both base and current)
  const attachToCard = (c: CardInstance | null): CardInstance | null => {
    if (c === null || c.instanceId !== action.targetInstanceId) return c;
    return {
      ...c,
      equipment: equipCard,
      baseAtk: c.baseAtk + atkBonus,
      baseHp: c.baseHp + hpBonus,
      baseArm: c.baseArm + armBonus,
      currentAtk: c.currentAtk + atkBonus,
      currentHp: c.currentHp + hpBonus,
      currentArm: c.currentArm + armBonus,
    };
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
  action: {
    cardInstanceId: string;
    toZone: import('../types/common.js').ZoneType;
    slotIndex: number;
  },
): { readonly state: GameState; readonly events: readonly GameEvent[] } {
  const player = state.players[state.activePlayerIndex]!;
  const newZones = moveCard(
    player.zones,
    action.cardInstanceId,
    action.toZone,
    action.slotIndex,
  );

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
  if (ability.type === 'triggered' && ability.trigger.type === 'activated') {
    const abilityCost = ability.trigger.cost;
    if (!canAfford(player, abilityCost)) return { state, events: [] };
    updatedPlayer = payCost(player, abilityCost);
  }

  // Exhaust the card
  const exhaustCard = (c: CardInstance | null): CardInstance | null => {
    if (c === null || c.instanceId !== action.cardInstanceId) return c;
    return { ...c, exhausted: true };
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

  const nextState = setPlayer(state, state.activePlayerIndex, newPlayer);
  const allEvents: GameEvent[] = [{
    type: 'ABILITY_ACTIVATED',
    cardInstanceId: action.cardInstanceId,
    abilityIndex: action.abilityIndex,
    turnNumber: state.turnNumber,
  }];

  // Extract and execute ability effects
  const abilityEffects = getHeroAbilityEffects(ability);
  if (abilityEffects.length === 0) {
    return { state: nextState, events: allEvents };
  }

  return {
    state: nextState,
    events: allEvents,
    effectWorkItem: {
      kind: 'effect',
      sourceInstanceId: action.cardInstanceId,
      controllerId: state.activePlayerIndex,
      effects: abilityEffects,
      triggerDepth: 0,
      selectedTargets: action.targetId !== undefined ? [action.targetId] : undefined,
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
  if (ability.type === 'triggered' && ability.trigger.type === 'activated' && ability.trigger.cooldown !== undefined) {
    newCooldowns.set(action.abilityIndex, ability.trigger.cooldown);
  }

  const newHero = {
    ...hero,
    cooldowns: newCooldowns,
  };

  const newPlayer: PlayerState = {
    ...updatedPlayer,
    hero: newHero,
    turnCounters: {
      ...updatedPlayer.turnCounters,
      abilitiesActivated: updatedPlayer.turnCounters.abilitiesActivated + 1,
    },
  };

  const nextState = setPlayer(state, state.activePlayerIndex, newPlayer);
  const allEvents: GameEvent[] = [{
    type: 'HERO_ABILITY_ACTIVATED',
    playerId: state.activePlayerIndex,
    abilityIndex: action.abilityIndex,
    turnNumber: state.turnNumber,
  }];

  // Extract and execute ability effects
  const abilityEffects = getHeroAbilityEffects(ability);
  if (abilityEffects.length === 0) {
    return { state: nextState, events: allEvents };
  }

  return {
    state: nextState,
    events: allEvents,
    effectWorkItem: {
      kind: 'effect',
      sourceInstanceId: `hero_${String(state.activePlayerIndex)}`,
      controllerId: state.activePlayerIndex,
      effects: abilityEffects,
      triggerDepth: 0,
      selectedTargets: action.targetId !== undefined ? [action.targetId] : undefined,
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

  // Determine resource type from the card's cost structure:
  // cards with more energy cost grant Energy, otherwise Mana.
  // Flexible-only cards default to Mana.
  const resourceType: import('../types/index.js').ResourceType =
    card.cost.energy > card.cost.mana ? 'energy' : 'mana';

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
  return {
    ...state,
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
