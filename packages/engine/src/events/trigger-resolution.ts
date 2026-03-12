import type {
  CardInstance,
  ContinuableResolutionWorkItem,
  EffectContext,
  EffectResolutionWorkItem,
  EffectExecutionFrame,
  EventResolutionWorkItem,
  GameEvent,
  GameState,
  PendingChoice,
  PlayerResponse,
  ResolutionWorkItem,
  TriggerResolutionWorkItem,
} from '../types/game-state.js';
import type { TriggeredAbilityDSL } from '../types/ability.js';
import type {
  ChooseOneEffect,
  DiscardEffect,
} from '../types/effects.js';
import { MAX_TRIGGER_DEPTH } from '../types/game-state.js';
import { executeEffect } from '../effects/interpreter.js';
import { resumeCounterSpellEffect } from '../effects/interpreter.js';
import { evaluateCondition } from '../effects/condition-evaluator.js';
import { findCard, getAllCards } from '../zones/zone-manager.js';
import { findMatchingTriggers } from './trigger-matcher.js';
import {
  getAllRegisteredTriggers,
  registerCardTriggers,
} from './trigger-registry.js';
import {
  getRuntimeCardTraits,
} from '../state/runtime-card-helpers.js';
import {
  discardCardsFromHand,
  normalizeGameState,
} from '../state/index.js';

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

interface ResolvableTrigger {
  readonly sourceInstanceId: string;
  readonly ownerPlayerId: 0 | 1;
  readonly effects: TriggerResolutionWorkItem['effects'];
  readonly condition?: TriggerResolutionWorkItem['condition'];
  readonly resolveAfterChain?: boolean;
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
    }
  | {
      readonly kind: 'pay_unless';
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
  const deferredWorkItems = initialWorkItems.length === 0 && state.stack.length === 0
    ? [...state.deferredTriggerQueue]
    : [];

  return drainResolutionQueue(
    clearPendingResolution({
      ...state,
      deferredTriggerQueue: deferredWorkItems.length > 0 ? [] : state.deferredTriggerQueue,
    }),
    [...initialWorkItems, ...deferredWorkItems],
    [],
  );
}

export function resolveEffectWorkItem(
  state: GameState,
  workItem: EffectResolutionWorkItem,
  initialEvents: readonly GameEvent[] = [],
): ResolutionDrainResult {
  const resolved = runEffectWorkItem(
    clearPendingResolution(state),
    workItem,
    [{ effects: workItem.effects, index: 0 }],
  );

  if (resolved.pendingChoice !== undefined) {
    return {
      state: {
        ...resolved.state,
        pendingChoice: resolved.pendingChoice,
        pendingResolution: {
          currentWorkItem: workItem,
          frames: resolved.frames,
          bufferedEvents: [
            ...initialEvents,
            ...resolved.generatedEvents,
          ],
          remainingWorkItems: [],
        },
      },
      events: [],
    };
  }

  return drainResolutionQueue(
    resolved.state,
    eventsToWorkItems(
      [
        ...initialEvents,
        ...resolved.generatedEvents,
      ],
      workItem.triggerDepth,
    ),
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

  const resumed = runEffectWorkItem(
    clearPendingResolution(state),
    pending.currentWorkItem,
    pending.frames,
    resumeInput,
  );

  if (resumed.pendingChoice !== undefined) {
    return {
      state: {
        ...resumed.state,
        pendingChoice: resumed.pendingChoice,
        pendingResolution: {
          currentWorkItem: pending.currentWorkItem,
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
      pending.currentWorkItem.triggerDepth,
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

      const activePlayerId = getEventActivePlayerId(item.event, currentState.activePlayerIndex);
      const matchingTriggers = findMatchingTriggers(
        getAllRegisteredTriggers(currentState),
        item.event,
        activePlayerId,
        instanceId => getCardInfo(currentState, instanceId),
      );
      const eventScopedTriggers = getEventScopedTriggers(item.event);

      const triggerItems = item.triggerDepth >= MAX_TRIGGER_DEPTH
        ? []
        : buildTriggerItems(
          [...matchingTriggers, ...eventScopedTriggers],
          activePlayerId,
          item.triggerDepth + 1,
        );
      const { immediate, deferred } = partitionDeferredTriggers(triggerItems, currentState.stack.length > 0);
      if (deferred.length > 0) {
        currentState = {
          ...currentState,
          deferredTriggerQueue: [...currentState.deferredTriggerQueue, ...deferred],
        };
      }

      queue = [...immediate, ...queue];
      continue;
    }

    const triggered = runEffectWorkItem(
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
            currentWorkItem: item,
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

    if (queue.length === 0 && currentState.stack.length === 0 && currentState.deferredTriggerQueue.length > 0) {
      queue = [...currentState.deferredTriggerQueue];
      currentState = {
        ...currentState,
        deferredTriggerQueue: [],
      };
    }
  }

  return {
    state: clearPendingResolution(currentState),
    events,
  };
}

function runEffectWorkItem(
  state: GameState,
  workItem: ContinuableResolutionWorkItem,
  frames: readonly EffectExecutionFrame[],
  resumeInput?: ResumeInput,
): EffectRunResult {
  const baseContext: EffectContext = {
    sourceInstanceId: workItem.sourceInstanceId,
    controllerId: workItem.controllerId,
    triggerDepth: workItem.triggerDepth,
    selectedTargets: workItem.kind === 'effect'
      ? workItem.selectedTargets
      : undefined,
  };

  if (
    resumeInput === undefined &&
    workItem.condition !== undefined &&
    !evaluateCondition(state, workItem.condition, baseContext)
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
        const normalized = normalizeGameState(resumed.newState);
        currentState = normalized.state;
        generatedEvents.push(...resumed.events, ...normalized.events);
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
          workItem.controllerId,
          pendingResume.selectedOptionIds,
        );
        const normalized = normalizeGameState(discarded.state);
        currentState = normalized.state;
        generatedEvents.push(...discarded.events, ...normalized.events);
        frame.index++;
        pendingResume = undefined;
        continue;
      }

      if (pendingResume.kind === 'pay_unless' && effect.type === 'counter_spell') {
        const resumed = resumeCounterSpellEffect(currentState, effect, baseContext, pendingResume.selectedOptionIds[0]);
        const normalized = normalizeGameState(resumed.newState);
        currentState = normalized.state;
        generatedEvents.push(...resumed.events, ...normalized.events);
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
        pendingChoice: buildChooseOneChoice(effect, workItem.controllerId),
      };
    }

    const result = executeEffect(currentState, effect, baseContext);
    const normalized = normalizeGameState(result.newState);
    currentState = normalized.state;
    generatedEvents.push(...result.events, ...normalized.events);

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
  if (state.players[playerId] === undefined) {
    return { state, events: [] };
  }
  return discardCardsFromHand(state, playerId, selectedOptionIds);
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
    traits: getRuntimeCardTraits(card),
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

function buildTriggerItems(
  triggers: readonly ResolvableTrigger[],
  activePlayerId: 0 | 1,
  triggerDepth: number,
): readonly TriggerResolutionWorkItem[] {
  const activeTriggers = triggers.filter(trigger => trigger.ownerPlayerId === activePlayerId);
  const inactiveTriggers = triggers.filter(trigger => trigger.ownerPlayerId !== activePlayerId);
  return [...activeTriggers, ...inactiveTriggers].map(trigger => ({
    kind: 'trigger',
    sourceInstanceId: trigger.sourceInstanceId,
    controllerId: trigger.ownerPlayerId,
    effects: trigger.effects,
    condition: trigger.condition,
    triggerDepth,
    resolveAfterChain: trigger.resolveAfterChain,
  }));
}

function getEventScopedTriggers(
  event: GameEvent,
): readonly ResolvableTrigger[] {
  if (event.type !== 'CARD_DESTROYED' || event.destroyedCard === undefined) {
    return [];
  }

  return extractSelfDestroyTriggers(event.destroyedCard, event.playerId);
}

function extractSelfDestroyTriggers(
  card: CardInstance,
  ownerPlayerId: 0 | 1,
): readonly ResolvableTrigger[] {
  const triggers: ResolvableTrigger[] = [];

  for (const ability of card.abilities) {
    if (ability.type !== 'triggered' || !isDestroyTriggeredAbility(ability)) continue;
    triggers.push({
      sourceInstanceId: card.instanceId,
      ownerPlayerId,
      effects: ability.effects,
      condition: ability.condition,
    });
  }

  for (const entry of card.grantedAbilities) {
    if (entry.ability.type !== 'triggered' || !isDestroyTriggeredAbility(entry.ability)) continue;
    triggers.push({
      sourceInstanceId: card.instanceId,
      ownerPlayerId,
      effects: entry.ability.effects,
      condition: entry.ability.condition,
      resolveAfterChain: entry.resolveAfterChain,
    });
  }

  return triggers;
}

function partitionDeferredTriggers(
  items: readonly TriggerResolutionWorkItem[],
  shouldDefer: boolean,
): {
  readonly immediate: readonly TriggerResolutionWorkItem[];
  readonly deferred: readonly TriggerResolutionWorkItem[];
} {
  if (!shouldDefer) {
    return { immediate: items, deferred: [] };
  }

  const immediate: TriggerResolutionWorkItem[] = [];
  const deferred: TriggerResolutionWorkItem[] = [];
  for (const item of items) {
    if (item.resolveAfterChain === true) {
      deferred.push(item);
      continue;
    }
    immediate.push(item);
  }
  return { immediate, deferred };
}

function isDestroyTriggeredAbility(
  ability: TriggeredAbilityDSL,
): boolean {
  return ability.trigger.type === 'on_destroy';
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
    case 'pay_unless':
      return {
        kind: 'pay_unless',
        selectedOptionIds: response.selectedOptionIds,
      };
    default:
      return null;
  }
}
