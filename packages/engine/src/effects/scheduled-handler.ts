/**
 * Scheduled effects — enqueue an effect to run at a future phase boundary, and
 * process the queue when that boundary arrives.
 *
 * A `scheduled` effect appends a ScheduledEntry to GameState.scheduledEffects.
 * The turn machine calls `processScheduledEffects` at each boundary
 * (end_of_turn at the end phase; next_turn_start / next_upkeep at upkeep),
 * which runs the matching entries' effects through the interpreter and removes
 * them from the queue.
 */
import type { Effect, ScheduledTiming } from '../types/effects.js';
import type {
  GameState,
  GameEvent,
  ScheduledEntry,
  EffectContext,
  EffectResult,
} from '../types/game-state.js';
import { evaluateCondition } from './condition-evaluator.js';

export function executeScheduled(
  state: GameState,
  effect: Extract<Effect, { type: 'scheduled' }>,
  context: EffectContext,
): EffectResult {
  const existing = state.scheduledEffects ?? [];
  const entry: ScheduledEntry = {
    id: `scheduled_${context.sourceInstanceId}_${String(existing.length)}`,
    timing: effect.timing,
    effects: effect.effects,
    ...(effect.condition !== undefined ? { condition: effect.condition } : {}),
    sourceInstanceId: context.sourceInstanceId,
    controllerId: context.controllerId,
  };
  return {
    newState: { ...state, scheduledEffects: [...existing, entry] },
    events: [],
  };
}

type RunEffects = (
  state: GameState,
  sourceInstanceId: string,
  controllerId: 0 | 1,
  effects: readonly Effect[],
) => { readonly state: GameState; readonly events: readonly GameEvent[] };

/** Fire every scheduled entry whose timing matches `timing`, in queue order, then
 * drop them from the queue. `runEffects` is injected so this stays free of an
 * interpreter import (the machine layer supplies the runner). Pure. */
export function processScheduledEffects(
  state: GameState,
  timing: ScheduledTiming['type'],
  runEffects: RunEffects,
): { readonly state: GameState; readonly events: readonly GameEvent[] } {
  const queue = state.scheduledEffects ?? [];
  if (queue.length === 0) return { state, events: [] };

  const fire: ScheduledEntry[] = [];
  const keep: ScheduledEntry[] = [];
  for (const entry of queue) {
    (entry.timing.type === timing ? fire : keep).push(entry);
  }
  if (fire.length === 0) return { state, events: [] };

  let current: GameState = { ...state, scheduledEffects: keep };
  const events: GameEvent[] = [];
  for (const entry of fire) {
    if (!conditionHolds(current, entry)) continue;
    const ran = runEffects(current, entry.sourceInstanceId, entry.controllerId, entry.effects);
    current = ran.state;
    events.push(...ran.events);
    if (current.winner !== null) break;
  }
  return { state: current, events };
}

function conditionHolds(state: GameState, entry: ScheduledEntry): boolean {
  if (entry.condition === undefined) return true;
  const context: EffectContext = {
    sourceInstanceId: entry.sourceInstanceId,
    controllerId: entry.controllerId,
    triggerDepth: 0,
  };
  return evaluateCondition(state, entry.condition, context);
}
