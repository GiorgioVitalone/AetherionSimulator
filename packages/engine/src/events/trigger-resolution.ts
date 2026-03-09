import type {
  CardInstance,
  EffectContext,
  EffectExecutionFrame,
  EventResolutionWorkItem,
  GameEvent,
  GameState,
  PendingChoice,
  PlayerResponse,
  ResolutionWorkItem,
  TriggerResolutionWorkItem,
} from '../types/game-state.js';
import type {
  ChooseOneEffect,
  DiscardEffect,
} from '../types/effects.js';
import { MAX_TRIGGER_DEPTH } from '../types/game-state.js';
import { executeEffect } from '../effects/interpreter.js';
import { evaluateCondition } from '../effects/condition-evaluator.js';
import { findCard, getAllCards } from '../zones/zone-manager.js';
import { findMatchingTriggers } from './trigger-matcher.js';
import {
  getAllRegisteredTriggers,
  registerCardTriggers,
} from './trigger-registry.js';

interface ResolutionDrainResult {
  readonly state: GameState;
  readonly events: readonly GameEvent[];
}

interface EffectRunResult {
  readonly state: GameState;
  readonly generatedEvents: readonly GameEvent[];
  readonly frames: readonly EffectExecutionFrame[];
  readonly pendingChoice?: PendingChoice;
}

type ResumeInput =
  | {
      readonly kind: 'select_targets';
      readonly selectedOptionIds: readonly string[];
    }
  | {
      readonly kind: 'choose_one';
      readonly selectedOptionIds: readonly string[];
    }
  | {
      readonly kind: 'choose_discard';
      readonly selectedOptionIds: readonly string[];
    };

export function resolveTriggeredEvents(
  state: GameState,
  initialEvents: readonly GameEvent[],
): ResolutionDrainResult {
  if (state.pendingChoice !== null && state.pendingResolution === null) {
    return { state, events: initialEvents };
  }

  const initialWorkItems = initialEvents.map<EventResolutionWorkItem>(event => ({
    kind: 'event',
    event,
    triggerDepth: 0,
  }));

  return drainResolutionQueue(
    clearPendingResolution(state),
    initialWorkItems,
    [],
  );
}

export function resumePendingResolution(
  state: GameState,
  response: PlayerResponse,
): ResolutionDrainResult {
  const pending = state.pendingResolution;
  const choiceType = state.pendingChoice?.type;

  if (pending === null || choiceType === undefined) {
    return {
      state: clearPendingResolution(state),
      events: [],
    };
  }

  const resumeInput = getResumeInput(choiceType, response);
  if (resumeInput === null) {
    return {
      state: clearPendingResolution(state),
      events: [],
    };
  }

  const resumed = runTriggerEffects(
    clearPendingResolution(state),
    pending.currentTrigger,
    pending.frames,
    resumeInput,
  );

  if (resumed.pendingChoice !== undefined) {
    return {
      state: {
        ...resumed.state,
        pendingChoice: resumed.pendingChoice,
        pendingResolution: {
          currentTrigger: pending.currentTrigger,
          frames: resumed.frames,
          bufferedEvents: [
            ...pending.bufferedEvents,
            ...resumed.generatedEvents,
          ],
          remainingWorkItems: pending.remainingWorkItems,
        },
      },
      events: [],
    };
  }

  const nextWorkItems = [
    ...eventsToWorkItems(
      [
        ...pending.bufferedEvents,
        ...resumed.generatedEvents,
      ],
      pending.currentTrigger.triggerDepth,
    ),
    ...pending.remainingWorkItems,
  ];

  return drainResolutionQueue(resumed.state, nextWorkItems, []);
}

function drainResolutionQueue(
  state: GameState,
  workItems: readonly ResolutionWorkItem[],
  processedEvents: readonly GameEvent[],
): ResolutionDrainResult {
  let currentState = clearPendingResolution(state);
  let queue = [...workItems];
  const events: GameEvent[] = [...processedEvents];

  while (queue.length > 0) {
    const [item, ...rest] = queue;
    queue = rest;

    if (item === undefined) break;

    if (item.kind === 'event') {
      currentState = applyEventSideEffects(currentState, item.event);
      events.push(item.event);

      const matchingTriggers = findMatchingTriggers(
        getAllRegisteredTriggers(currentState),
        item.event,
        getEventActivePlayerId(item.event, currentState.activePlayerIndex),
        instanceId => getCardInfo(currentState, instanceId),
      );

      const triggerItems = item.triggerDepth >= MAX_TRIGGER_DEPTH
        ? []
        : matchingTriggers.map<TriggerResolutionWorkItem>(trigger => ({
          kind: 'trigger',
          sourceInstanceId: trigger.sourceInstanceId,
          controllerId: trigger.ownerPlayerId,
          effects: trigger.effects,
          condition: trigger.condition,
          triggerDepth: item.triggerDepth + 1,
        }));

      queue = [...triggerItems, ...queue];
      continue;
    }

    const triggered = runTriggerEffects(
      currentState,
      item,
      [{ effects: item.effects, index: 0 }],
    );

    currentState = triggered.state;

    if (triggered.pendingChoice !== undefined) {
      return {
        state: {
          ...currentState,
          pendingChoice: triggered.pendingChoice,
          pendingResolution: {
            currentTrigger: item,
            frames: triggered.frames,
            bufferedEvents: triggered.generatedEvents,
            remainingWorkItems: queue,
          },
        },
        events,
      };
    }

    queue = [
      ...eventsToWorkItems(triggered.generatedEvents, item.triggerDepth),
      ...queue,
    ];
  }

  return {
    state: clearPendingResolution(currentState),
    events,
  };
}

function runTriggerEffects(
  state: GameState,
  trigger: TriggerResolutionWorkItem,
  frames: readonly EffectExecutionFrame[],
  resumeInput?: ResumeInput,
): EffectRunResult {
  const baseContext: EffectContext = {
    sourceInstanceId: trigger.sourceInstanceId,
    controllerId: trigger.controllerId,
    triggerDepth: trigger.triggerDepth,
  };

  if (
    resumeInput === undefined &&
    trigger.condition !== undefined &&
    !evaluateCondition(state, trigger.condition, baseContext)
  ) {
    return {
      state,
      generatedEvents: [],
      frames,
    };
  }

  let currentState = state;
  const generatedEvents: GameEvent[] = [];
  const frameStack = frames.map(frame => ({ ...frame }));
  let pendingResume = resumeInput;

  while (frameStack.length > 0) {
    const frame = frameStack[frameStack.length - 1];
    if (frame === undefined) break;

    if (frame.index >= frame.effects.length) {
      frameStack.pop();
      continue;
    }

    const effect = frame.effects[frame.index];
    if (effect === undefined) {
      frame.index++;
      continue;
    }

    if (pendingResume !== undefined) {
      if (pendingResume.kind === 'select_targets') {
        const resumed = executeEffect(currentState, effect, {
          ...baseContext,
          selectedTargets: pendingResume.selectedOptionIds,
        });
        currentState = resumed.newState;
        generatedEvents.push(...resumed.events);
        frame.index++;
        pendingResume = undefined;
        continue;
      }

      if (pendingResume.kind === 'choose_one' && effect.type === 'choose_one') {
        const selectedIndex = Number(pendingResume.selectedOptionIds[0]);
        frame.index++;
        pendingResume = undefined;
        if (
          Number.isInteger(selectedIndex) &&
          selectedIndex >= 0 &&
          selectedIndex < effect.options.length
        ) {
          frameStack.push({
            effects: effect.options[selectedIndex]!.effects,
            index: 0,
          });
        }
        continue;
      }

      if (pendingResume.kind === 'choose_discard' && effect.type === 'discard') {
        const discarded = resolveDiscardChoice(
          currentState,
          effect,
          trigger.controllerId,
          pendingResume.selectedOptionIds,
        );
        currentState = discarded.state;
        generatedEvents.push(...discarded.events);
        frame.index++;
        pendingResume = undefined;
        continue;
      }
    }

    if (effect.type === 'composite') {
      frame.index++;
      frameStack.push({
        effects: effect.effects,
        index: 0,
      });
      continue;
    }

    if (effect.type === 'conditional') {
      frame.index++;
      frameStack.push({
        effects: evaluateCondition(currentState, effect.condition, baseContext)
          ? effect.ifTrue
          : (effect.ifFalse ?? []),
        index: 0,
      });
      continue;
    }

    if (effect.type === 'choose_one') {
      return {
        state: currentState,
        generatedEvents,
        frames: cloneFrames(frameStack),
        pendingChoice: buildChooseOneChoice(effect, trigger.controllerId),
      };
    }

    const result = executeEffect(currentState, effect, baseContext);
    currentState = result.newState;
    generatedEvents.push(...result.events);

    if (result.pendingChoice !== undefined) {
      return {
        state: currentState,
        generatedEvents,
        frames: cloneFrames(frameStack),
        pendingChoice: result.pendingChoice,
      };
    }

    frame.index++;
  }

  return {
    state: currentState,
    generatedEvents,
    frames: [],
  };
}

function resolveDiscardChoice(
  state: GameState,
  effect: DiscardEffect,
  controllerId: 0 | 1,
  selectedOptionIds: readonly string[],
): { readonly state: GameState; readonly events: readonly GameEvent[] } {
  const playerId = getDiscardTargetPlayerId(effect, controllerId);
  const player = state.players[playerId];
  if (player === undefined) {
    return { state, events: [] };
  }

  const selectedSet = new Set(selectedOptionIds);
  const discarded = player.hand.filter(card => selectedSet.has(card.instanceId));
  const remainingHand = player.hand.filter(card => !selectedSet.has(card.instanceId));

  const newPlayers = [...state.players] as [typeof state.players[0], typeof state.players[1]];
  newPlayers[playerId] = {
    ...player,
    hand: remainingHand,
    discardPile: [...player.discardPile, ...discarded],
  };

  return {
    state: { ...state, players: newPlayers },
    events: discarded.map(card => ({
      type: 'CARD_DISCARDED' as const,
      cardInstanceId: card.instanceId,
      playerId,
    })),
  };
}

function getDiscardTargetPlayerId(
  effect: DiscardEffect,
  controllerId: 0 | 1,
): 0 | 1 {
  return 'side' in effect.target && effect.target.side === 'enemy'
    ? (controllerId === 0 ? 1 : 0)
    : controllerId;
}

function buildChooseOneChoice(
  effect: ChooseOneEffect,
  playerId: 0 | 1,
): PendingChoice {
  return {
    type: 'choose_one',
    playerId,
    options: effect.options.map((option, index) => ({
      id: String(index),
      label: option.label,
    })),
    minSelections: 1,
    maxSelections: 1,
    context: 'Choose one option',
  };
}

function cloneFrames(
  frames: readonly EffectExecutionFrame[],
): readonly EffectExecutionFrame[] {
  return frames.map(frame => ({ ...frame }));
}

function eventsToWorkItems(
  events: readonly GameEvent[],
  triggerDepth: number,
): readonly EventResolutionWorkItem[] {
  return events.map(event => ({
    kind: 'event',
    event,
    triggerDepth,
  }));
}

function applyEventSideEffects(
  state: GameState,
  event: GameEvent,
): GameState {
  if (event.type !== 'CARD_DEPLOYED') {
    return state;
  }

  const deployedCard = getCardFromBattlefield(state, event.cardInstanceId);
  if (deployedCard === null || deployedCard.registeredTriggers.length > 0) {
    return state;
  }

  return registerCardTriggers(state, event.cardInstanceId);
}

function getCardInfo(
  state: GameState,
  instanceId: string,
): {
  readonly instanceId: string;
  readonly cardType: CardInstance['cardType'];
  readonly traits: CardInstance['traits'];
  readonly tags: readonly string[];
} | null {
  const card = getCardAnywhere(state, instanceId);
  if (card === null) return null;

  return {
    instanceId: card.instanceId,
    cardType: card.cardType,
    traits: card.traits,
    tags: card.tags,
  };
}

function getCardAnywhere(
  state: GameState,
  instanceId: string,
): CardInstance | null {
  for (const player of state.players) {
    const zoneCard = findCard(player.zones, instanceId);
    if (zoneCard !== null) return zoneCard.card;

    const handCard = player.hand.find(card => card.instanceId === instanceId);
    if (handCard !== undefined) return handCard;

    const discardCard = player.discardPile.find(card => card.instanceId === instanceId);
    if (discardCard !== undefined) return discardCard;

    for (const battlefieldCard of getAllCards(player.zones)) {
      if (battlefieldCard.equipment?.instanceId === instanceId) {
        return battlefieldCard.equipment;
      }
    }
  }

  return null;
}

function getCardFromBattlefield(
  state: GameState,
  instanceId: string,
): CardInstance | null {
  for (const player of state.players) {
    const location = findCard(player.zones, instanceId);
    if (location !== null) return location.card;
  }

  return null;
}

function getEventActivePlayerId(
  event: GameEvent,
  fallback: 0 | 1,
): 0 | 1 {
  if (event.type === 'TURN_START' || event.type === 'TURN_END') {
    return event.playerId;
  }

  return fallback;
}

function clearPendingResolution(state: GameState): GameState {
  return {
    ...state,
    pendingChoice: null,
    pendingResolution: null,
  };
}

function getResumeInput(
  choiceType: PendingChoice['type'],
  response: PlayerResponse,
): ResumeInput | null {
  switch (choiceType) {
    case 'select_targets':
      return {
        kind: 'select_targets',
        selectedOptionIds: response.selectedOptionIds,
      };
    case 'choose_one':
      return {
        kind: 'choose_one',
        selectedOptionIds: response.selectedOptionIds,
      };
    case 'choose_discard':
      return {
        kind: 'choose_discard',
        selectedOptionIds: response.selectedOptionIds,
      };
    default:
      return null;
  }
}
