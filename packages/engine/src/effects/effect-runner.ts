/**
 * Effect Runner — runs a list of Effect DSL nodes through the interpreter with
 * auto-selected (or caller-chosen) targets. Extracted from state-machine/actions
 * so both the player-action path and the stack resolver share one resolution
 * pipeline (threading xPaid / controllerId).
 */
import type { GameState, GameEvent, PendingChoice } from '../types/game-state.js';
import type { Effect } from '../types/effects.js';
import { executeEffect } from './interpreter.js';

// When an effect needs a player choice, auto-pick from the actual offered options
// (the bot's policy). Picks the required count from the front of the option list.
function pickAutoTargets(choice: PendingChoice): readonly string[] {
  const ids = choice.options
    .map(o => o.instanceId ?? o.id)
    .filter((x): x is string => typeof x === 'string');
  const want = Math.min(ids.length, Math.max(choice.minSelections, 1));
  const capped = choice.maxSelections > 0 ? Math.min(want, choice.maxSelections) : want;
  return ids.slice(0, capped);
}

// Resolve a choice using caller-chosen targets when they are legal for THIS
// effect's offered options, else fall back to the auto-target.
function pickChosenTargets(
  choice: PendingChoice,
  chosen: readonly string[] | undefined,
): readonly string[] {
  if (chosen === undefined || chosen.length === 0) return pickAutoTargets(choice);
  const legal = new Set(
    choice.options.map(o => o.instanceId ?? o.id).filter((x): x is string => typeof x === 'string'),
  );
  const valid = chosen.filter(id => legal.has(id));
  if (valid.length < Math.max(choice.minSelections, 1)) return pickAutoTargets(choice);
  const cap = choice.maxSelections > 0 ? choice.maxSelections : valid.length;
  return valid.slice(0, cap);
}

export function runAbilityEffects(
  state: GameState,
  sourceInstanceId: string,
  effects: readonly Effect[],
  controllerId: 0 | 1 = state.activePlayerIndex,
  xPaid?: number,
  chosenTargets?: readonly string[],
): { readonly state: GameState; readonly events: readonly GameEvent[] } {
  const baseContext = {
    sourceInstanceId,
    controllerId,
    triggerDepth: 0,
    ...(xPaid !== undefined ? { xPaid } : {}),
  };
  let current = state;
  const events: GameEvent[] = [];
  for (const effect of effects) {
    let result = executeEffect(current, effect, baseContext);
    if (result.pendingChoice !== undefined) {
      const selectedTargets = pickChosenTargets(result.pendingChoice, chosenTargets);
      result = executeEffect(current, effect, { ...baseContext, selectedTargets });
    }
    current = result.newState;
    events.push(...result.events);
    if (current.winner !== null) break;
  }
  return { state: current, events };
}
