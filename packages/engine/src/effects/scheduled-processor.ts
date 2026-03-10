/**
 * Scheduled Effect Processor — registers, evaluates, and fires scheduled effects.
 * Effects can be scheduled for future timings (next_upkeep, end_of_turn, next_turn_start).
 */
import type {
  GameState,
  GameEvent,
  EffectContext,
  ScheduledEffectEntry,
} from '../types/game-state.js';
import type { ScheduledEffect } from '../types/effects.js';
import { executeEffect } from './interpreter.js';
import { evaluateCondition } from './condition-evaluator.js';

let scheduledCounter = 0;

export function resetScheduledCounter(): void {
  scheduledCounter = 0;
}

export function registerScheduledEffect(
  state: GameState,
  scheduled: ScheduledEffect,
  context: EffectContext,
): GameState {
  scheduledCounter++;
  const entry: ScheduledEffectEntry = {
    id: `sched_${String(scheduledCounter)}`,
    timing: scheduled.timing,
    turnsRemaining: 1,
    effects: scheduled.effects,
    sourceInstanceId: context.sourceInstanceId,
    controllerId: context.controllerId,
    condition: scheduled.condition,
    oneShot: true,
  };

  return {
    ...state,
    scheduledEffects: [...state.scheduledEffects, entry],
  };
}

export function processScheduledEffects(
  state: GameState,
  currentTiming: 'next_upkeep' | 'end_of_turn' | 'next_turn_start',
): { readonly state: GameState; readonly events: readonly GameEvent[] } {
  const allEvents: GameEvent[] = [];
  let currentState = state;

  const matching = currentState.scheduledEffects.filter(
    entry => entry.timing.type === currentTiming && entry.turnsRemaining <= 0,
  );

  if (matching.length === 0) return { state, events: [] };

  const firedIds = new Set<string>();

  for (const entry of matching) {
    const context: EffectContext = {
      sourceInstanceId: entry.sourceInstanceId,
      controllerId: entry.controllerId,
      triggerDepth: 0,
    };

    // Check condition if present
    if (entry.condition !== undefined) {
      if (!evaluateCondition(currentState, entry.condition, context)) {
        // Condition not met — skip but still mark for removal if oneShot
        if (entry.oneShot) firedIds.add(entry.id);
        continue;
      }
    }

    // Execute all effects in the scheduled entry
    for (const effect of entry.effects) {
      const result = executeEffect(currentState, effect, context);
      currentState = result.newState;
      allEvents.push(...result.events);
    }

    if (entry.oneShot) firedIds.add(entry.id);
  }

  // Remove fired oneShot entries
  if (firedIds.size > 0) {
    currentState = {
      ...currentState,
      scheduledEffects: currentState.scheduledEffects.filter(
        e => !firedIds.has(e.id),
      ),
    };
  }

  return { state: currentState, events: allEvents };
}

export function decrementScheduledTimers(state: GameState): GameState {
  if (state.scheduledEffects.length === 0) return state;

  return {
    ...state,
    scheduledEffects: state.scheduledEffects.map(entry => ({
      ...entry,
      turnsRemaining: entry.turnsRemaining - 1,
    })),
  };
}
