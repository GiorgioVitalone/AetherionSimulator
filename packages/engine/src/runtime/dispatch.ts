/**
 * Trigger Dispatch — event → triggered-ability resolution.
 * Scans registered triggers for abilities whose Trigger matches each emitted
 * event, runs their effects through executeEffect, and recurses on produced
 * events with a depth cap (anti-loop via MAX_TRIGGER_DEPTH).
 *
 * Triggers are taken from a snapshot pool so that 'on_destroy' (Last Breath)
 * still fires after the source has already left play.
 */
import type {
  GameState,
  GameEvent,
  RegisteredTrigger,
  EffectContext,
  TriggerDispatchContinuation,
  TriggerOrderContinuation,
  PendingChoice,
} from '../types/game-state.js';
import type { CardTypeCode, Trait } from '../types/common.js';
import { MAX_TRIGGER_DEPTH } from '../types/game-state.js';
import { findMatchingTriggers } from '../events/trigger-matcher.js';
import { getAllRegisteredTriggers } from '../events/trigger-registry.js';
import { getAllCards } from '../zones/zone-manager.js';
import { runEffectSequence } from '../effects/effect-runner.js';
import { evaluateCondition } from '../effects/condition-evaluator.js';
import { triggerRateLimited } from './trigger-gating.js';
import { findCardInState, updateCardInState } from '../effects/state-helpers.js';
import { GuardExhaustionError } from '../errors/engine-errors.js';
import { stampGameEvents } from './event-envelope.js';

interface CardInfo {
  readonly instanceId: string;
  readonly cardType: CardTypeCode;
  readonly traits: readonly Trait[];
  readonly tags: readonly string[];
}

export interface DispatchResult {
  readonly newState: GameState;
  readonly events: readonly GameEvent[];
}

/** Build a card-info lookup over the current battlefield. */
function makeCardInfoLookup(state: GameState): (id: string) => CardInfo | null {
  const map = new Map<string, CardInfo>();
  for (const player of state.players) {
    for (const card of getAllCards(player.zones)) {
      map.set(card.instanceId, {
        instanceId: card.instanceId,
        cardType: card.cardType,
        traits: card.traits,
        tags: card.tags,
      });
    }
  }
  return (id) => map.get(id) ?? null;
}

function lookupForEvent(
  base: (id: string) => CardInfo | null,
  event: GameEvent,
): (id: string) => CardInfo | null {
  return (id) => {
    if (
      event.type === 'CARD_DESTROYED' &&
      event.cardInstanceId === id &&
      event.lastKnownCard !== undefined
    ) {
      return event.lastKnownCard;
    }
    return base(id);
  };
}

/**
 * Derive the triggering-event-payload fields of an EffectContext: the numeric
 * value (event_value), the triggering card's cost (triggering_card_cost), and the
 * used-temporary-resource flag (event_context). Lets dispatch hand each fired
 * ability the context its conditions/amounts need.
 */
function eventContextFields(
  state: GameState,
  event: GameEvent,
): Pick<EffectContext, 'eventValue' | 'triggeringCardCost' | 'usedTemporaryResource'> {
  switch (event.type) {
    case 'DAMAGE_DEALT':
      return { eventValue: event.amount };
    case 'SPELL_CAST':
      return { triggeringCardCost: cardTotalCost(state, event.cardInstanceId) };
    case 'CARD_DEPLOYED':
      return { usedTemporaryResource: state.turnState.usedTemporaryResource === true };
    default:
      return {};
  }
}

/** Total resource cost of a card instance anywhere in either player's zones, hand,
 * or discard. Returns 0 when not found. */
function cardTotalCost(state: GameState, instanceId: string): number {
  for (const player of state.players) {
    const pools = [player.hand, player.discardPile, getAllCards(player.zones)];
    for (const pool of pools) {
      const card = pool.find((c) => c.instanceId === instanceId);
      if (card !== undefined) return card.cost.mana + card.cost.energy + card.cost.flexible;
    }
  }
  return 0;
}

interface TriggerRunResult extends DispatchResult {
  /** False when the trigger's condition failed and nothing ran (state untouched). */
  readonly fired: boolean;
}

function runTrigger(
  state: GameState,
  trigger: RegisteredTrigger,
  depth: number,
  event: GameEvent,
): TriggerRunResult {
  const context: EffectContext = {
    sourceInstanceId: trigger.sourceInstanceId,
    controllerId: trigger.ownerPlayerId,
    triggerDepth: depth,
    ...eventContextFields(state, event),
  };
  if (trigger.condition !== undefined && !evaluateCondition(state, trigger.condition, context)) {
    return { newState: state, events: [], fired: false };
  }
  const result = runEffectSequence(state, trigger.effects, context);
  return { newState: result.state, events: result.events, fired: true };
}

/**
 * Dispatch triggered abilities for a batch of events, recursing on the events
 * those abilities produce. `triggerPool` lets the caller supply triggers from a
 * pre-event snapshot so Last Breath fires after the source has left play.
 */
export function dispatchTriggers(
  state: GameState,
  events: readonly GameEvent[],
  depth: number,
  triggerPool?: readonly RegisteredTrigger[],
): DispatchResult {
  return dispatchWork(
    state,
    events,
    depth,
    triggerPool ?? getAllRegisteredTriggers(state),
    undefined,
    [],
    [],
  );
}

/** Resume the event/trigger batch that was suspended behind a player choice. */
export function resumeTriggerDispatch(
  state: GameState,
  resumedEvents: readonly GameEvent[],
  continuation: TriggerDispatchContinuation,
): DispatchResult {
  const stamped = stampGameEvents(state, resumedEvents, {
    parentEventId: continuation.currentEvent.eventId,
    actionId: continuation.currentEvent.actionId,
    transactionId: continuation.currentEvent.transactionId,
  });
  return dispatchWork(
    stamped.state,
    [continuation.currentEvent, ...continuation.remainingEvents],
    continuation.depth,
    continuation.triggerPool,
    continuation.remainingTriggers,
    [...continuation.producedEvents, ...stamped.events],
    stamped.events,
  );
}

function orderedById(
  triggers: readonly RegisteredTrigger[],
): readonly RegisteredTrigger[] {
  return [...triggers].sort((a, b) => a.id.localeCompare(b.id));
}

function triggerOrderChoice(
  event: GameEvent,
  ownerPlayerId: 0 | 1,
  triggers: readonly RegisteredTrigger[],
  continuation: TriggerOrderContinuation,
): PendingChoice {
  const ordered = orderedById(triggers);
  const interactionId = [
    'trigger-order',
    event.eventId ?? `${String(event.turnNumber)}:${String(event.sequence)}`,
    ownerPlayerId,
    ...ordered.map((trigger) => trigger.id),
  ].join(':');
  return {
    interactionId,
    validationToken: interactionId,
    type: 'choose_trigger_order',
    playerId: ownerPlayerId,
    options: ordered.map((trigger) => ({
      id: trigger.id,
      label: `${trigger.sourceInstanceId} ability ${String(trigger.abilityIndex)}`,
      instanceId: trigger.sourceInstanceId,
    })),
    minSelections: ordered.length,
    maxSelections: ordered.length,
    context: `Order ${String(ordered.length)} simultaneous triggers`,
    optional: false,
    visibility: 'public',
    triggerOrderContinuation: {
      ...continuation,
      groupOwnerPlayerId: ownerPlayerId,
      groupTriggers: ordered,
    },
  };
}

function triggerOrderPlan(
  matching: readonly RegisteredTrigger[],
  activePlayerId: 0 | 1,
): {
  readonly ordered?: readonly RegisteredTrigger[];
  readonly promptGroup?: readonly RegisteredTrigger[];
  readonly promptOwner?: 0 | 1;
  readonly orderedPrefix: readonly RegisteredTrigger[];
  readonly remainingGroup: readonly RegisteredTrigger[];
} {
  const active = orderedById(
    matching.filter((trigger) => trigger.ownerPlayerId === activePlayerId),
  );
  const nonActivePlayerId = activePlayerId === 0 ? 1 : 0;
  const nonActive = orderedById(
    matching.filter((trigger) => trigger.ownerPlayerId === nonActivePlayerId),
  );
  if (active.length > 1) {
    return {
      promptGroup: active,
      promptOwner: activePlayerId,
      orderedPrefix: [],
      remainingGroup: nonActive,
    };
  }
  if (nonActive.length > 1) {
    return {
      promptGroup: nonActive,
      promptOwner: nonActivePlayerId,
      orderedPrefix: active,
      remainingGroup: [],
    };
  }
  return {
    ordered: [...active, ...nonActive],
    orderedPrefix: [],
    remainingGroup: [],
  };
}

/** Resume an APNAP owner-order interaction with the submitted trigger permutation. */
export function resumeTriggerOrdering(
  state: GameState,
  choice: PendingChoice,
  selectedTriggerIds: readonly string[],
): DispatchResult {
  const continuation = choice.triggerOrderContinuation;
  if (continuation === undefined) return { newState: state, events: [] };
  const byId = new Map(
    continuation.groupTriggers.map((trigger) => [trigger.id, trigger]),
  );
  const selected = selectedTriggerIds.map((id) => byId.get(id)!);
  const orderedPrefix = [...continuation.orderedPrefix, ...selected];
  const cleared = { ...state, pendingChoice: null };
  if (continuation.remainingGroup.length > 1) {
    const owner = continuation.remainingGroup[0]!.ownerPlayerId;
    const nextContinuation: TriggerOrderContinuation = {
      ...continuation,
      orderedPrefix,
      groupOwnerPlayerId: owner,
      groupTriggers: continuation.remainingGroup,
      remainingGroup: [],
    };
    const pending = triggerOrderChoice(
      continuation.currentEvent,
      owner,
      continuation.remainingGroup,
      nextContinuation,
    );
    const requested = stampGameEvents(
      { ...cleared, pendingChoice: pending },
      [
        {
          type: 'CHOICE_REQUESTED',
          interactionId: pending.interactionId!,
          playerId: owner,
          choiceType: pending.type,
          sourceInstanceId: pending.sourceInstanceId,
        },
      ],
      {
        parentEventId: continuation.currentEvent.eventId,
        actionId: continuation.currentEvent.actionId,
        transactionId: continuation.currentEvent.transactionId,
        timing: 'interaction',
      },
    );
    return { newState: requested.state, events: requested.events };
  }
  const completeOrder = [
    ...orderedPrefix,
    ...continuation.remainingGroup,
  ];
  return dispatchWork(
    cleared,
    [continuation.currentEvent, ...continuation.remainingEvents],
    continuation.depth,
    continuation.triggerPool,
    completeOrder,
    continuation.producedEvents,
    [],
  );
}

function dispatchWork(
  state: GameState,
  events: readonly GameEvent[],
  depth: number,
  pool: readonly RegisteredTrigger[],
  firstEventTriggers: readonly RegisteredTrigger[] | undefined,
  producedSeed: readonly GameEvent[],
  returnedPrefix: readonly GameEvent[],
): DispatchResult {
  const prepared = stampGameEvents(state, events);
  state = prepared.state;
  events = prepared.events;
  if (events.length === 0) {
    if (producedSeed.length === 0) {
      return { newState: state, events: returnedPrefix };
    }
    const recursed = dispatchWork(
      state,
      producedSeed,
      depth + 1,
      pool,
      undefined,
      [],
      [],
    );
    return {
      newState: recursed.newState,
      events: [...returnedPrefix, ...recursed.events],
    };
  }
  if (depth >= MAX_TRIGGER_DEPTH) {
    if (state.config?.authoritativeTransitions === true) {
      throw new GuardExhaustionError(
        `Trigger depth exhausted with ${String(events.length)} pending event(s)`,
      );
    }
    return { newState: state, events: [] };
  }
  const lookup = makeCardInfoLookup(state);
  const observedPool = new Map(pool.map((trigger) => [trigger.id, trigger]));

  let current = state;
  const allProduced: GameEvent[] = [...producedSeed];
  const newlyProduced: GameEvent[] = [];
  const firedTriggerIds = new Set<string>();

  for (let eventIndex = 0; eventIndex < events.length; eventIndex++) {
    const event = events[eventIndex]!;
    const matching =
      eventIndex === 0 && firstEventTriggers !== undefined
        ? firstEventTriggers
        : findMatchingTriggers(
            pool,
            event,
            current.activePlayerIndex,
            lookupForEvent(lookup, event),
          );
    let orderedMatching = matching;
    if (
      state.config?.authoritativeTransitions === true &&
      !(eventIndex === 0 && firstEventTriggers !== undefined)
    ) {
      const plan = triggerOrderPlan(matching, current.activePlayerIndex);
      if (
        plan.promptGroup !== undefined &&
        plan.promptOwner !== undefined
      ) {
        const continuation: TriggerOrderContinuation = {
          depth,
          triggerPool: [...observedPool.values()],
          currentEvent: event,
          remainingEvents: events.slice(eventIndex + 1),
          producedEvents: allProduced,
          orderedPrefix: plan.orderedPrefix,
          groupOwnerPlayerId: plan.promptOwner,
          groupTriggers: plan.promptGroup,
          remainingGroup: plan.remainingGroup,
        };
        const pending = triggerOrderChoice(
          event,
          plan.promptOwner,
          plan.promptGroup,
          continuation,
        );
        const requested = stampGameEvents(
          { ...current, pendingChoice: pending },
          [
            {
              type: 'CHOICE_REQUESTED',
              interactionId: pending.interactionId!,
              playerId: pending.playerId,
              choiceType: pending.type,
              sourceInstanceId: pending.sourceInstanceId,
            },
          ],
          {
            parentEventId: event.eventId,
            actionId: event.actionId,
            transactionId: event.transactionId,
            timing: 'interaction',
          },
        );
        return {
          newState: requested.state,
          events: [...returnedPrefix, ...newlyProduced, ...requested.events],
        };
      }
      orderedMatching = plan.ordered ?? matching;
    }
    for (let triggerIndex = 0; triggerIndex < orderedMatching.length; triggerIndex++) {
      const trigger = orderedMatching[triggerIndex]!;
      if (
        state.config?.authoritativeTransitions !== true &&
        firedTriggerIds.has(trigger.id)
      ) {
        continue;
      }
      // Wrapper oncePerTurn / cooldown on dispatch triggers (Rulebook 16). The
      // marker is recorded in the working log below so later events in this chain
      // also see the limit (firedTriggerIds only covers a single event's batch).
      const limited = trigger.oncePerTurn === true || trigger.cooldown !== undefined;
      if (limited && triggerRateLimited(current, trigger)) continue;
      // [React] (config.reactAbilities): cannot proc while its source is already
      // exhausted. Looked up against `current`, not the once-built `lookup` map,
      // since exhaustion can change mid-chain within this same dispatch pass.
      const isReact = state.config?.reactAbilities === true && trigger.react === true;
      if (isReact) {
        const source = findCardInState(current, trigger.sourceInstanceId);
        if (source !== null && source.exhausted) continue;
      }
      for (const liveTrigger of getAllRegisteredTriggers(current)) {
        observedPool.set(liveTrigger.id, liveTrigger);
      }
      firedTriggerIds.add(trigger.id);
      const result = runTrigger(current, trigger, depth, event);
      const stampedResult = stampGameEvents(result.newState, result.events, {
        parentEventId: event.eventId,
        actionId: event.actionId,
        transactionId: event.transactionId,
      });
      current = stampedResult.state;
      if (isReact && result.fired) {
        // [React] procced: exhaust the source card. No-ops for the hero pseudo-id
        // (heroes aren't stored in zone slots — no [React] on Heroes by rule).
        current = updateCardInState(current, trigger.sourceInstanceId, (card) => ({
          ...card,
          exhausted: true,
        }));
      }
      if (limited) {
        // Append the fire-marker to the WORKING log only (not to produced events):
        // the caller appends produced events to state.log, so adding it to both
        // would double-count. Subsequent in-chain checks read current.log.
        current = {
          ...current,
          log: [...current.log, { type: 'TRIGGER_FIRED', triggerId: trigger.id }],
        };
      }
      allProduced.push(...stampedResult.events);
      newlyProduced.push(...stampedResult.events);
      if (current.pendingChoice !== null) {
        current = {
          ...current,
          pendingChoice: {
            ...current.pendingChoice,
            dispatchContinuation: {
              depth,
              triggerPool: [...observedPool.values()],
              currentEvent: event,
              remainingTriggers: orderedMatching.slice(triggerIndex + 1),
              remainingEvents: events.slice(eventIndex + 1),
              producedEvents: allProduced,
            },
          },
        };
        return {
          newState: current,
          events: [...returnedPrefix, ...newlyProduced],
        };
      }
      if (current.winner !== null) {
        return {
          newState: current,
          events: [...returnedPrefix, ...newlyProduced],
        };
      }
    }
  }

  if (allProduced.length > 0) {
    const recursed = dispatchWork(
      current,
      allProduced,
      depth + 1,
      [...observedPool.values()],
      undefined,
      [],
      [],
    );
    return {
      newState: recursed.newState,
      events: [...returnedPrefix, ...newlyProduced, ...recursed.events],
    };
  }
  return {
    newState: current,
    events: [...returnedPrefix, ...newlyProduced],
  };
}
