import type {
  GameEvent,
  GameState,
  RegisteredTrigger,
} from '../types/game-state.js';
import { getAllRegisteredTriggers } from '../events/trigger-registry.js';
import { GuardExhaustionError } from '../errors/engine-errors.js';
import { dispatchTriggers } from './dispatch.js';
import { recomputeAurasWithEvents } from './aura-recompute.js';
import { stampGameEvents } from './event-envelope.js';

export interface StabilizationOptions {
  /** Snapshot taken before the atomic change, preserving removed trigger sources. */
  readonly triggerPool?: readonly RegisteredTrigger[];
  readonly actionId?: string;
  readonly transactionId?: string;
}

export interface StabilizationResult {
  readonly state: GameState;
  readonly events: readonly GameEvent[];
}

function mergeTriggerPools(
  prior: readonly RegisteredTrigger[] | undefined,
  current: readonly RegisteredTrigger[],
): readonly RegisteredTrigger[] {
  if (prior === undefined) return current;
  const merged = new Map(prior.map((trigger) => [trigger.id, trigger]));
  for (const trigger of current) merged.set(trigger.id, trigger);
  return [...merged.values()];
}

/**
 * Reach the aura/state-based fixed point and dispatch every resulting event.
 * Trigger effects can alter HP or aura contributions, so the cycle repeats until
 * stable. A player choice pauses the cycle with its continuation intact.
 */
export function stabilizeStateBased(
  state: GameState,
  options: StabilizationOptions = {},
): StabilizationResult {
  let current = state;
  let triggerPool = options.triggerPool;
  const events: GameEvent[] = [];

  for (let pass = 0; pass < 32; pass++) {
    const before = current;
    const recomputed = recomputeAurasWithEvents(before);
    current = recomputed.state;
    if (recomputed.events.length === 0) return { state: current, events };

    const stamped = stampGameEvents(current, recomputed.events, {
      ...(options.actionId !== undefined ? { actionId: options.actionId } : {}),
      ...(options.transactionId !== undefined
        ? { transactionId: options.transactionId }
        : {}),
      timing: 'state_based',
    });
    const dispatched = dispatchTriggers(
      stamped.state,
      stamped.events,
      0,
      mergeTriggerPools(triggerPool, getAllRegisteredTriggers(before)),
    );
    events.push(...stamped.events, ...dispatched.events);
    current = dispatched.newState;
    if (current.pendingChoice !== null || current.winner !== null) {
      return { state: current, events };
    }
    triggerPool = undefined;
  }

  throw new GuardExhaustionError(
    'State-based trigger stabilization guard exhausted after 32 passes',
  );
}
