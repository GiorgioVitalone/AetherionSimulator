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
} from '../types/game-state.js';
import type { CardTypeCode, Trait } from '../types/common.js';
import { MAX_TRIGGER_DEPTH } from '../types/game-state.js';
import { findMatchingTriggers } from '../events/trigger-matcher.js';
import { getAllRegisteredTriggers } from '../events/trigger-registry.js';
import { getAllCards } from '../zones/zone-manager.js';
import { executeEffect } from '../effects/interpreter.js';
import { evaluateCondition } from '../effects/condition-evaluator.js';
import { triggerRateLimited } from './trigger-gating.js';

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
  return id => map.get(id) ?? null;
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
      const card = pool.find(c => c.instanceId === instanceId);
      if (card !== undefined) return card.cost.mana + card.cost.energy + card.cost.flexible;
    }
  }
  return 0;
}

function runTrigger(
  state: GameState,
  trigger: RegisteredTrigger,
  depth: number,
  event: GameEvent,
): DispatchResult {
  const context: EffectContext = {
    sourceInstanceId: trigger.sourceInstanceId,
    controllerId: trigger.ownerPlayerId,
    triggerDepth: depth,
    ...eventContextFields(state, event),
  };
  if (trigger.condition !== undefined && !evaluateCondition(state, trigger.condition, context)) {
    return { newState: state, events: [] };
  }
  let current = state;
  const produced: GameEvent[] = [];
  for (const effect of trigger.effects) {
    let result = executeEffect(current, effect, context);
    if (result.pendingChoice !== undefined) {
      // Auto-resolve from the offered options (engine bot policy, deterministic).
      const ids = result.pendingChoice.options
        .map(o => o.instanceId ?? o.id)
        .filter((x): x is string => typeof x === 'string');
      const want = Math.min(ids.length, Math.max(result.pendingChoice.minSelections, 1));
      result = executeEffect(current, effect, { ...context, selectedTargets: ids.slice(0, want) });
    }
    current = result.newState;
    produced.push(...result.events);
    if (current.winner !== null) break;
  }
  return { newState: current, events: produced };
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
  if (depth >= MAX_TRIGGER_DEPTH || events.length === 0) {
    return { newState: state, events: [] };
  }
  const pool = triggerPool ?? getAllRegisteredTriggers(state);
  const lookup = makeCardInfoLookup(state);

  let current = state;
  const allProduced: GameEvent[] = [];
  const firedTriggerIds = new Set<string>();

  for (const event of events) {
    const matching = findMatchingTriggers(pool, event, current.activePlayerIndex, lookup);
    for (const trigger of matching) {
      if (firedTriggerIds.has(trigger.id)) continue;
      // Wrapper oncePerTurn / cooldown on dispatch triggers (Rulebook 16). The
      // marker is recorded in the working log below so later events in this chain
      // also see the limit (firedTriggerIds only covers a single event's batch).
      const limited = trigger.oncePerTurn === true || trigger.cooldown !== undefined;
      if (limited && triggerRateLimited(current, trigger)) continue;
      firedTriggerIds.add(trigger.id);
      const result = runTrigger(current, trigger, depth, event);
      current = result.newState;
      if (limited) {
        // Append the fire-marker to the WORKING log only (not to produced events):
        // the caller appends produced events to state.log, so adding it to both
        // would double-count. Subsequent in-chain checks read current.log.
        current = {
          ...current,
          log: [...current.log, { type: 'TRIGGER_FIRED', triggerId: trigger.id }],
        };
      }
      allProduced.push(...result.events);
      if (current.winner !== null) {
        return { newState: current, events: allProduced };
      }
    }
  }

  if (allProduced.length > 0) {
    const recursed = dispatchTriggers(current, allProduced, depth + 1);
    return { newState: recursed.newState, events: [...allProduced, ...recursed.events] };
  }
  return { newState: current, events: allProduced };
}
