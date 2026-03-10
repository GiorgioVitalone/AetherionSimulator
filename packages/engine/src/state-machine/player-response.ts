import type {
  CardInstance,
  ChoiceOption,
  GameEvent,
  GameState,
  PendingChoice,
  PlayerResponse,
  StackItem,
  TemporaryResource,
} from '../types/game-state.js';
import type { AbilityDSL } from '../types/ability.js';
import type { ResourceType } from '../types/common.js';
import type { Effect } from '../types/effects.js';
import { resumePendingResolution } from '../events/index.js';
import { canAfford, payCost } from '../actions/cost-checker.js';
import { findCard } from '../zones/zone-manager.js';
import { pushToStack, resolveStack } from '../stack/stack-resolver.js';
import { advanceResponseWindow, beginResponseWindow } from '../stack/response-window.js';

interface PlayerResponseResult {
  readonly state: GameState;
  readonly pendingChoice: PendingChoice | null;
  readonly events: readonly GameEvent[];
}

export function beginResponseChain(
  state: GameState,
  initiatorPlayerId: 0 | 1,
  _bufferedEvents: readonly GameEvent[] = [],
): PlayerResponseResult {
  const result = beginResponseWindow(state, initiatorPlayerId);
  return {
    state: result.newState,
    pendingChoice: result.pendingChoice ?? null,
    events: result.events,
  };
}

export function applyPendingChoiceResponse(
  state: GameState,
  response: PlayerResponse,
): PlayerResponseResult {
  const choice = state.pendingChoice;
  if (choice === null) {
    return { state, pendingChoice: null, events: [] };
  }

  if (choice.type === 'reserve_exhaust') {
    const player = state.players[choice.playerId]!;
    const selectedInstanceIds = getSelectedChoiceOptions(choice, response.selectedOptionIds)
      .flatMap(option => option.instanceId !== undefined ? [option.instanceId] : []);
    const selectedSet = new Set(selectedInstanceIds);
    const events: GameEvent[] = [];
    const generatedResources: TemporaryResource[] = [];
    const newReserve = player.zones.reserve.map(card => {
      if (card !== null && selectedSet.has(card.instanceId)) {
        const resourceType = deriveReserveResourceType(card);
        generatedResources.push({ resourceType, amount: 1 });
        events.push({
          type: 'RESOURCE_GAINED',
          playerId: choice.playerId,
          resourceType,
          amount: 1,
        });
        return {
          ...card,
          exhausted: true,
          abilitiesSuppressed: true,
        };
      }
      return card;
    });
    const newPlayers = [...state.players] as [typeof state.players[0], typeof state.players[1]];
    newPlayers[choice.playerId] = {
      ...player,
      zones: { ...player.zones, reserve: newReserve },
      temporaryResources: [...player.temporaryResources, ...generatedResources],
    };

    return {
      state: {
        ...state,
        players: newPlayers,
        pendingChoice: null,
        pendingResolution: null,
      },
      pendingChoice: null,
      events,
    };
  }

  if (choice.type === 'choose_first_player') {
    const selectedId = response.selectedOptionIds[0];
    const chosenPlayerId = selectedId === 'player_1' ? 1 : 0;
    return {
      state: {
        ...state,
        activePlayerIndex: chosenPlayerId,
        firstPlayerId: chosenPlayerId,
        phase: 'upkeep',
        pendingChoice: null,
        pendingResolution: null,
      },
      pendingChoice: null,
      events: [],
    };
  }

  if (
    choice.type === 'select_targets' ||
    choice.type === 'choose_one' ||
    choice.type === 'choose_discard' ||
    choice.type === 'pay_unless'
  ) {
    const resolved = resumePendingResolution(state, response);
    if (
      resolved.state.pendingChoice === null &&
      resolved.state.responseState === null &&
      resolved.state.stack.length > 0
    ) {
      const continued = resolveStack(resolved.state);
      return {
        state: continued.state,
        pendingChoice: continued.state.pendingChoice,
        events: [...resolved.events, ...continued.events],
      };
    }

    return {
      state: resolved.state,
      pendingChoice: resolved.state.pendingChoice,
      events: resolved.events,
    };
  }

  if (choice.type === 'response_window') {
    const selectedOption = getSelectedChoiceOptions(choice, response.selectedOptionIds)[0];
    const nextPriorityPlayerId = choice.playerId === 0 ? 1 : 0;
    const currentPassCount = state.responseState?.passesInRow ?? 0;

    if (selectedOption === undefined || selectedOption.id === 'pass') {
      const advanced = advanceResponseWindow(
        {
          ...state,
          pendingChoice: null,
        },
        nextPriorityPlayerId as 0 | 1,
        currentPassCount + 1,
      );
      return {
        state: advanced.newState,
        pendingChoice: advanced.pendingChoice ?? null,
        events: advanced.events,
      };
    }

    const played = playSelectedResponseOption(
      {
        ...state,
        pendingChoice: null,
      },
      choice.playerId,
      selectedOption,
      choice.responseContext?.stackItemId,
    );
    if (played === null) {
      const advanced = advanceResponseWindow(
        {
          ...state,
          pendingChoice: null,
        },
        nextPriorityPlayerId as 0 | 1,
        currentPassCount + 1,
      );
      return {
        state: advanced.newState,
        pendingChoice: advanced.pendingChoice ?? null,
        events: advanced.events,
      };
    }

    const advanced = advanceResponseWindow(played, nextPriorityPlayerId as 0 | 1, 0);
    return {
      state: advanced.newState,
      pendingChoice: advanced.pendingChoice ?? null,
      events: advanced.events,
    };
  }

  return {
    state: {
      ...state,
      pendingChoice: null,
      pendingResolution: null,
    },
    pendingChoice: null,
    events: [],
  };
}

function playSelectedResponseOption(
  state: GameState,
  respondingPlayerId: 0 | 1,
  option: ChoiceOption,
  targetStackItemId: string | undefined,
): GameState | null {
  switch (option.sourceType ?? 'card') {
    case 'card':
      return playResponseCard(state, respondingPlayerId, option.id, targetStackItemId);
    case 'card_ability':
      return playResponseCardAbility(state, respondingPlayerId, option, targetStackItemId);
    case 'hero_ability':
      return playResponseHeroAbility(state, respondingPlayerId, option, targetStackItemId);
  }
}

function playResponseCard(
  state: GameState,
  respondingPlayerId: 0 | 1,
  selectedId: string,
  targetStackItemId: string | undefined,
): GameState | null {
  const player = state.players[respondingPlayerId]!;
  const cardIndex = player.hand.findIndex(card => card.instanceId === selectedId);
  if (cardIndex === -1) {
    return null;
  }

  const card = player.hand[cardIndex]!;
  if (!canAfford(player, card.cost)) {
    return null;
  }

  const paidPlayer = payCost(player, card.cost);
  const newPlayer = {
    ...paidPlayer,
    hand: paidPlayer.hand.filter((_, i) => i !== cardIndex),
    discardPile: [...paidPlayer.discardPile, card],
  };

  const newPlayers = [...state.players] as [typeof state.players[0], typeof state.players[1]];
  newPlayers[respondingPlayerId] = newPlayer;

  const stackItem: StackItem = {
    id: `response_${card.instanceId}_${String(state.stack.length + 1)}`,
    type: hasCounterResponse(card) ? 'counter' : 'flash',
    sourceInstanceId: card.instanceId,
    controllerId: respondingPlayerId,
    effects: extractResponseEffects(card),
    targets: targetStackItemId === undefined ? [] : [targetStackItemId],
    cardSnapshot: card,
  };

  return pushToStack({
    ...state,
    players: newPlayers,
    priorityPlayerId: respondingPlayerId,
  }, stackItem);
}

function playResponseCardAbility(
  state: GameState,
  respondingPlayerId: 0 | 1,
  option: ChoiceOption,
  targetStackItemId: string | undefined,
): GameState | null {
  const instanceId = option.instanceId;
  const abilityIndex = option.abilityIndex;
  if (instanceId === undefined || abilityIndex === undefined) {
    return null;
  }

  const player = state.players[respondingPlayerId]!;
  const location = findCard(player.zones, instanceId);
  if (location === null) {
    return null;
  }

  const ability = location.card.abilities[abilityIndex];
  if (ability === undefined || ability.type !== 'triggered' || ability.trigger.type !== 'activated') {
    return null;
  }
  if (!canAfford(player, ability.trigger.cost)) {
    return null;
  }

  const updatedPlayer = payCost(player, ability.trigger.cost);
  const updatedCooldowns = new Map(location.card.abilityCooldowns);
  const cooldown = ability.cooldown ?? ability.trigger.cooldown;
  if (cooldown !== undefined && cooldown > 0) {
    updatedCooldowns.set(abilityIndex, cooldown);
  }
  const activatedAbilityTurns = new Map(location.card.activatedAbilityTurns);
  activatedAbilityTurns.set(abilityIndex, state.turnNumber);

  const updateCard = (card: CardInstance | null): CardInstance | null => {
    if (card === null || card.instanceId !== instanceId) return card;
    return {
      ...card,
      exhausted: true,
      abilityCooldowns: updatedCooldowns,
      activatedAbilityTurns,
    };
  };

  const newPlayer = {
    ...updatedPlayer,
    zones: {
      reserve: updatedPlayer.zones.reserve.map(updateCard),
      frontline: updatedPlayer.zones.frontline.map(updateCard),
      highGround: updatedPlayer.zones.highGround.map(updateCard),
    },
    turnCounters: {
      ...updatedPlayer.turnCounters,
      abilitiesActivated: updatedPlayer.turnCounters.abilitiesActivated + 1,
    },
  };

  const stackItem: StackItem = {
    id: `response_${instanceId}_${String(abilityIndex)}_${String(state.stack.length + 1)}`,
    type: 'ability',
    sourceInstanceId: instanceId,
    controllerId: respondingPlayerId,
    effects: getTriggeredAbilityEffects(ability),
    targets: targetStackItemId === undefined ? [] : [targetStackItemId],
    abilityIndex,
  };

  return pushToStack(setPlayer(state, respondingPlayerId, newPlayer), stackItem);
}

function playResponseHeroAbility(
  state: GameState,
  respondingPlayerId: 0 | 1,
  option: ChoiceOption,
  targetStackItemId: string | undefined,
): GameState | null {
  const abilityIndex = option.abilityIndex;
  if (abilityIndex === undefined) {
    return null;
  }

  const player = state.players[respondingPlayerId]!;
  const ability = player.hero.abilities[abilityIndex];
  if (ability === undefined || ability.type !== 'triggered' || ability.trigger.type !== 'activated') {
    return null;
  }
  if (player.hero.transformedThisTurn && ability.trigger.oncePerGame === true) {
    return null;
  }
  if (!canAfford(player, ability.trigger.cost)) {
    return null;
  }

  const updatedPlayer = payCost(player, ability.trigger.cost);
  const cooldowns = new Map(player.hero.cooldowns);
  if (ability.trigger.cooldown !== undefined && ability.trigger.cooldown > 0) {
    cooldowns.set(abilityIndex, ability.trigger.cooldown);
  }
  const activatedAbilityTurns = new Map(player.hero.activatedAbilityTurns);
  activatedAbilityTurns.set(abilityIndex, state.turnNumber);
  const usedUltimateAbilityIndices = ability.trigger.oncePerGame === true &&
    !player.hero.usedUltimateAbilityIndices.includes(abilityIndex)
    ? [...player.hero.usedUltimateAbilityIndices, abilityIndex]
    : player.hero.usedUltimateAbilityIndices;

  const newPlayer = {
    ...updatedPlayer,
    hero: {
      ...updatedPlayer.hero,
      cooldowns,
      activatedAbilityTurns,
      usedUltimateAbilityIndices,
    },
    turnCounters: {
      ...updatedPlayer.turnCounters,
      abilitiesActivated: updatedPlayer.turnCounters.abilitiesActivated + 1,
    },
  };

  const stackItem: StackItem = {
    id: `response_hero_${String(abilityIndex)}_${String(state.stack.length + 1)}`,
    type: 'hero_ability',
    sourceInstanceId: `hero_${String(respondingPlayerId)}`,
    controllerId: respondingPlayerId,
    effects: getTriggeredAbilityEffects(ability),
    targets: targetStackItemId === undefined ? [] : [targetStackItemId],
    abilityIndex,
  };

  return pushToStack(setPlayer(state, respondingPlayerId, newPlayer), stackItem);
}

function deriveReserveResourceType(card: CardInstance): ResourceType {
  return card.resourceTypes[0] ?? 'mana';
}

function hasCounterResponse(card: CardInstance): boolean {
  return card.abilities.some(
    ability => ability.type === 'triggered' && ability.trigger.type === 'on_counter',
  );
}

function extractResponseEffects(card: CardInstance): readonly Effect[] {
  const effects: Effect[] = [];
  for (const ability of card.abilities) {
    if (ability.type !== 'triggered') continue;
    if (ability.trigger.type !== 'on_counter' && ability.trigger.type !== 'on_flash') continue;
    effects.push(...ability.effects);
  }
  return effects;
}

function getTriggeredAbilityEffects(ability: AbilityDSL): readonly Effect[] {
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

function getSelectedChoiceOptions(
  choice: PendingChoice,
  selectedOptionIds: readonly string[],
): readonly ChoiceOption[] {
  const optionMap = new Map(choice.options.map(option => [option.id, option] as const));
  return selectedOptionIds.flatMap(optionId => {
    const option = optionMap.get(optionId);
    return option === undefined ? [] : [option];
  });
}

function setPlayer(
  state: GameState,
  playerId: 0 | 1,
  player: typeof state.players[0],
): GameState {
  const players = [...state.players] as [typeof state.players[0], typeof state.players[1]];
  players[playerId] = player;
  return { ...state, players };
}
