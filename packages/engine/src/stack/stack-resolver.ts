/**
 * Stack Resolver — LIFO resolution of stacked spells, abilities, and attacks.
 * Handles counter chains and effect execution.
 */
import type {
  GameState,
  GameEvent,
  StackItem,
  EffectContext,
} from '../types/game-state.js';
import { executeEffect } from '../effects/interpreter.js';

/**
 * Push a StackItem onto the stack.
 */
export function pushToStack(state: GameState, item: StackItem): GameState {
  return {
    ...state,
    stack: [...state.stack, item],
  };
}

/**
 * Mark a stack item as countered.
 */
export function counterStackItem(
  state: GameState,
  targetItemId: string,
): GameState {
  return {
    ...state,
    stack: state.stack.map(item =>
      item.id === targetItemId
        ? { ...item, countered: true }
        : item,
    ),
  };
}

/**
 * Resolve the stack in LIFO order.
 * Countered items are skipped (their effects don't execute).
 */
export function resolveStack(
  state: GameState,
): { readonly state: GameState; readonly events: readonly GameEvent[] } {
  if (state.stack.length === 0) return { state, events: [] };

  const allEvents: GameEvent[] = [];
  let currentState = state;

  // Process in LIFO order (pop from the end)
  const stack = [...currentState.stack];

  while (stack.length > 0) {
    const item = stack.pop()!;

    if (item.countered === true) {
      // Skip countered items
      continue;
    }

    // Execute the item's effects
    const context: EffectContext = {
      sourceInstanceId: item.sourceInstanceId,
      controllerId: item.controllerId,
      triggerDepth: 0,
      selectedTargets: item.targets.length > 0 ? item.targets : undefined,
    };

    for (const effect of item.effects) {
      const result = executeEffect(currentState, effect, context);
      currentState = result.newState;
      allEvents.push(...result.events);
    }
  }

  // Clear the stack after resolution
  currentState = { ...currentState, stack: [] };

  return { state: currentState, events: allEvents };
}
