/**
 * Effect Runner — runs a list of Effect DSL nodes through the interpreter with
 * auto-selected (or caller-chosen) targets. Extracted from state-machine/actions
 * so both the player-action path and the stack resolver share one resolution
 * pipeline (threading xPaid / controllerId).
 */
import type {
  EffectContext,
  GameState,
  GameEvent,
  PendingChoice,
} from '../types/game-state.js';
import type { Effect } from '../types/effects.js';
import { executeEffect } from './interpreter.js';

// When an effect needs a player choice, auto-pick from the actual offered options
// (the bot's policy). Picks the required count from the front of the option list.
function pickAutoTargets(choice: PendingChoice): readonly string[] {
  const ids = choice.options
    .map(o => o.instanceId ?? o.id)
    .filter((x): x is string => typeof x === 'string');
  const want = Math.min(ids.length, Math.max(choice.minSelections, 0));
  const capped = choice.maxSelections > 0 ? Math.min(want, choice.maxSelections) : want;
  return ids.slice(0, capped);
}

// Resolve a choice using caller-chosen targets when they are legal for THIS
// effect's offered options, else fall back to the auto-target.
function pickChosenTargets(
  choice: PendingChoice,
  chosen: readonly string[] | undefined,
): readonly string[] {
  if (chosen === undefined) return pickAutoTargets(choice);
  const legal = new Set(
    choice.options.map(o => o.instanceId ?? o.id).filter((x): x is string => typeof x === 'string'),
  );
  const valid = chosen.filter(id => legal.has(id));
  if (valid.length < Math.max(choice.minSelections, 0)) return pickAutoTargets(choice);
  const cap = choice.maxSelections > 0 ? choice.maxSelections : valid.length;
  return valid.slice(0, cap);
}

/** Consume targets already committed by a transactional declaration only when
 * they satisfy this exact interaction. A declaration for a later effect must
 * not auto-answer an unrelated modal or target choice. */
function pickDeclaredTargets(
  choice: PendingChoice,
  chosen: readonly string[] | undefined,
): readonly string[] | null {
  if (chosen === undefined) return null;
  const legal = new Set(
    choice.options
      .map((option) => option.instanceId ?? option.id)
      .filter((id): id is string => typeof id === 'string'),
  );
  if (new Set(chosen).size !== chosen.length) return null;
  if (chosen.some((id) => !legal.has(id))) return null;
  if (
    chosen.length < Math.max(choice.minSelections, 0) ||
    chosen.length > choice.maxSelections
  ) {
    return null;
  }
  return chosen;
}

export function runAbilityEffects(
  state: GameState,
  sourceInstanceId: string,
  effects: readonly Effect[],
  controllerId: 0 | 1 = state.activePlayerIndex,
  xPaid?: number,
  chosenTargets?: readonly string[],
): { readonly state: GameState; readonly events: readonly GameEvent[] } {
  return runEffectSequence(
    state,
    effects,
    {
      sourceInstanceId,
      controllerId,
      triggerDepth: 0,
      ...(xPaid !== undefined ? { xPaid } : {}),
    },
    chosenTargets,
  );
}

export function runEffectSequence(
  state: GameState,
  effects: readonly Effect[],
  baseContext: EffectContext,
  chosenTargets?: readonly string[],
): { readonly state: GameState; readonly events: readonly GameEvent[] } {
  const context = baseContext;
  let current = state;
  let declaredTargets = chosenTargets;
  const events: GameEvent[] = [];
  for (let effectIndex = 0; effectIndex < effects.length; effectIndex++) {
    const effect = effects[effectIndex]!;
    let result = executeEffect(current, effect, context);
    if (result.pendingChoice !== undefined) {
      const committed = pickDeclaredTargets(
        result.pendingChoice,
        declaredTargets,
      );
      if (committed !== null) {
        result = executeEffect(current, effect, {
          ...context,
          selectedTargets: committed,
        });
        declaredTargets = undefined;
      }
      if (result.pendingChoice !== undefined) {
        if (
          current.config?.observableInteractions === true &&
          current.config.explicitEffectChoices === true
        ) {
          const choice = withContinuation(
            current,
            result.pendingChoice,
            effect,
            effects.slice(effectIndex + 1),
            context,
            effectIndex,
          );
          current = { ...result.newState, pendingChoice: choice };
          events.push(...result.events);
          events.push({
            type: 'CHOICE_REQUESTED',
            interactionId: choice.interactionId!,
            playerId: choice.playerId,
            choiceType: choice.type,
            sourceInstanceId: context.sourceInstanceId,
          });
          return { state: current, events };
        }
        const selectedTargets = pickChosenTargets(
          result.pendingChoice,
          declaredTargets,
        );
        result = executeEffect(current, effect, {
          ...context,
          selectedTargets,
        });
        declaredTargets = undefined;
      }
    }
    current = result.newState;
    events.push(...result.events);
    if (current.winner !== null) break;
  }
  return { state: current, events };
}

function withContinuation(
  state: GameState,
  choice: PendingChoice,
  currentEffect: Effect,
  remainingEffects: readonly Effect[],
  context: {
    readonly sourceInstanceId: string;
    readonly controllerId: 0 | 1;
    readonly triggerDepth: number;
    readonly xPaid?: number;
  },
  effectIndex: number,
): PendingChoice {
  const existing = choice.continuation;
  const resolvedContext = choice.resolutionContext ?? context;
  const interactionId = [
    'choice',
    state.turnNumber,
    state.phase,
    state.activePlayerIndex,
    state.rng.counter,
    state.log.length,
    state.stack.length,
    context.sourceInstanceId,
    effectIndex,
    choice.type,
  ].join(':');
  return {
    ...choice,
    interactionId,
    sourceInstanceId: choice.sourceInstanceId ?? context.sourceInstanceId,
    effectPath: choice.effectPath ?? [effectIndex],
    optional: choice.minSelections === 0,
    visibility: choice.visibility ?? 'controller',
    validationToken: interactionId,
    continuation:
      existing === undefined
        ? {
            currentEffect,
            remainingEffects,
            context: resolvedContext,
            effectIndex,
          }
        : {
            ...existing,
            remainingEffects: [...existing.remainingEffects, ...remainingEffects],
          },
  };
}

export function resumeAbilityEffects(
  state: GameState,
  choice: PendingChoice,
  selectedOptionIds: readonly string[],
): { readonly state: GameState; readonly events: readonly GameEvent[] } {
  const continuation = choice.continuation;
  if (continuation === undefined) return { state, events: [] };
  const cleared: GameState = { ...state, pendingChoice: null };
  let result = executeEffect(cleared, continuation.currentEffect, {
    ...continuation.context,
    selectedTargets:
      choice.type === 'pay_counter_tax'
        ? continuation.context.selectedTargets
        : selectedOptionIds,
    selectedOptionIds,
  });
  const events: GameEvent[] = [...result.events];
  if (result.pendingChoice !== undefined) {
    const pending = withContinuation(
      result.newState,
      result.pendingChoice,
      continuation.currentEffect,
      continuation.remainingEffects,
      continuation.context,
      continuation.effectIndex,
    );
    events.push({
      type: 'CHOICE_REQUESTED',
      interactionId: pending.interactionId!,
      playerId: pending.playerId,
      choiceType: pending.type,
      sourceInstanceId: pending.sourceInstanceId,
    });
    return { state: { ...result.newState, pendingChoice: pending }, events };
  }

  let current = result.newState;
  for (
    let index = 0;
    index < continuation.remainingEffects.length;
    index++
  ) {
    const effect = continuation.remainingEffects[index]!;
    result = executeEffect(current, effect, continuation.context);
    events.push(...result.events);
    if (result.pendingChoice !== undefined) {
      const pending = withContinuation(
        result.newState,
        result.pendingChoice,
        effect,
        continuation.remainingEffects.slice(index + 1),
        continuation.context,
        continuation.effectIndex + index + 1,
      );
      events.push({
        type: 'CHOICE_REQUESTED',
        interactionId: pending.interactionId!,
        playerId: pending.playerId,
        choiceType: pending.type,
        sourceInstanceId: pending.sourceInstanceId,
      });
      return {
        state: { ...result.newState, pendingChoice: pending },
        events,
      };
    }
    current = result.newState;
    if (current.winner !== null) break;
  }
  return { state: { ...current, pendingChoice: null }, events };
}
