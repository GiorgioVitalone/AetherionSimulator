import type { GameEvent, GameState } from '../types/game-state.js';
import {
  executePlayerAction,
  executePriorityPass,
  executeReactiveResponse,
  resumeTurnBoundary,
  removeTemporaryResources,
  expireEndOfTurnModifiersWithEvents,
  continueEndPhaseBoundary,
} from '../state-machine/actions.js';
import { keyOfPlayerAction } from '../actions/index.js';
import { resumeAbilityEffects } from '../effects/effect-runner.js';
import { discardCards } from '../state-machine/actions.js';
import type { EngineCommand, TransitionResult } from './types.js';
import { validatePlayerAction, validateReactiveAction } from './validation.js';
import { GuardExhaustionError } from '../errors/engine-errors.js';
import {
  resumeTriggerDispatch,
  resumeTriggerOrdering,
} from '../runtime/dispatch.js';
import { stabilizeStateBased } from '../runtime/state-based-stabilizer.js';
import { recomputeAurasWithEvents } from '../runtime/aura-recompute.js';
import { stampGameEvents } from '../runtime/event-envelope.js';
import { applyMulligan, chooseFirstPlayer } from '../setup/game-setup.js';
import { validateGameStateInvariants } from '../invariants/game-state-invariants.js';
import {
  closeTerminalStack,
  resumeStackAfterChoice,
} from '../effects/stack-resolver.js';

function commandId(state: GameState, command: EngineCommand): string {
  const prefix = [
    state.turnNumber,
    state.phase,
    state.activePlayerIndex,
    state.rng.seed,
    state.rng.counter,
  ].join(':');
  switch (command.type) {
    case 'mulligan_decision':
      return `${prefix}:mulligan:${command.interactionId}:${String(command.playerId)}:${String(command.keep)}`;
    case 'advance_phase':
      return `${prefix}:advance:${String(command.playerId)}`;
    case 'concede':
      return `${prefix}:concede:${String(command.playerId)}`;
    case 'player_action':
      return `${prefix}:action:${keyOfPlayerAction(command.action)}`;
    case 'reactive_action':
      return `${prefix}:react:${command.windowId}:${keyOfPlayerAction(command.action)}`;
    case 'priority_pass':
      return `${prefix}:pass:${command.windowId}`;
    case 'choice_response':
      return `${prefix}:choice:${command.interactionId}:${String(command.playerId)}:${command.response.selectedOptionIds.join(',')}`;
  }
}

function phaseViolation(
  state: GameState,
  actionId: string,
  message: string,
): TransitionResult {
  return {
    status: 'rejected',
    state,
    violations: [{ code: 'phase', path: 'command.type', message }],
    events: [],
    actionId,
  };
}

function withMulliganInteraction(state: GameState): GameState {
  const choice = state.pendingChoice;
  if (choice === null || choice.type !== 'mulligan' || choice.interactionId !== undefined) {
    return state;
  }
  const interactionId = [
    'mulligan',
    state.rng.seed,
    state.turnNumber,
    choice.playerId,
  ].join(':');
  return {
    ...state,
    pendingChoice: {
      ...choice,
      interactionId,
      validationToken: interactionId,
      visibility: 'controller',
      optional: false,
    },
  };
}

function advancePhase(
  state: GameState,
  playerId: 0 | 1,
  actionId: string,
): { readonly state: GameState; readonly events: readonly GameEvent[] } | null {
  if (playerId !== state.activePlayerIndex || state.pendingChoice !== null) return null;
  if (state.phase === 'strategy') {
    const rawState = { ...state, phase: 'action' as const };
    const stamped = stampGameEvents(
      rawState,
      [{ type: 'PHASE_CHANGED', phase: 'action', playerId }],
      { actionId, transactionId: actionId, timing: 'turn_boundary' },
    );
    return { state: stamped.state, events: stamped.events };
  }
  if (state.phase !== 'action') return null;

  const phase = stampGameEvents(
    removeTemporaryResources({ ...state, phase: 'end' }),
    [{ type: 'PHASE_CHANGED', phase: 'end', playerId }],
    { actionId, transactionId: actionId, timing: 'turn_boundary' },
  );
  const expired = expireEndOfTurnModifiersWithEvents(phase.state, actionId);
  if (expired.state.pendingChoice !== null) {
    return {
      state: {
        ...expired.state,
        pendingChoice: {
          ...expired.state.pendingChoice,
          turnBoundaryContinuation: { stage: 'after_end_expiry', actionId },
        },
      },
      events: [...phase.events, ...expired.events],
    };
  }
  if (expired.state.winner !== null) {
    return {
      state: expired.state,
      events: [...phase.events, ...expired.events],
    };
  }
  const boundary = continueEndPhaseBoundary(expired.state, actionId);
  return {
    state: boundary.state,
    events: [...phase.events, ...expired.events, ...boundary.events],
  };
}

function pendingResult(
  state: GameState,
  events: readonly GameEvent[],
  actionId: string,
): TransitionResult | null {
  const interaction = state.pendingChoice ?? state.pendingPriority;
  if (interaction === null || interaction === undefined) return null;
  return {
    status: 'pending',
    state,
    events,
    interaction,
    actionId,
  };
}

function resumeChoicePipeline(
  state: GameState,
  choice: NonNullable<GameState['pendingChoice']>,
  selected: readonly string[],
): { readonly state: GameState; readonly events: readonly GameEvent[] } {
  const stackContinuation = choice.stackResolutionContinuation;
  let result = resumeAbilityEffects(state, choice, selected);
  if (result.state.pendingChoice !== null && stackContinuation !== undefined) {
    result = {
      ...result,
      state: {
        ...result.state,
        pendingChoice: {
          ...result.state.pendingChoice,
          stackResolutionContinuation: stackContinuation,
        },
      },
    };
  }
  if (choice.dispatchContinuation !== undefined) {
    if (result.state.pendingChoice !== null) {
      result = {
        ...result,
        state: {
          ...result.state,
          pendingChoice: {
            ...result.state.pendingChoice,
            dispatchContinuation: choice.dispatchContinuation,
            ...(stackContinuation !== undefined
              ? { stackResolutionContinuation: stackContinuation }
              : {}),
            ...(choice.turnBoundaryContinuation !== undefined
              ? { turnBoundaryContinuation: choice.turnBoundaryContinuation }
              : {}),
          },
        },
      };
      return result;
    }
    const dispatched = resumeTriggerDispatch(
      result.state,
      result.events,
      choice.dispatchContinuation,
    );
    result = { state: dispatched.newState, events: dispatched.events };
  }
  if (result.state.pendingChoice !== null) {
    if (choice.turnBoundaryContinuation === undefined) return result;
    return {
      ...result,
      state: {
        ...result.state,
        pendingChoice: {
          ...result.state.pendingChoice,
          ...(stackContinuation !== undefined
            ? { stackResolutionContinuation: stackContinuation }
            : {}),
          turnBoundaryContinuation: choice.turnBoundaryContinuation,
        },
      },
    };
  }
  if (choice.turnBoundaryContinuation !== undefined) {
    const boundary = resumeTurnBoundary(
      result.state,
      choice.turnBoundaryContinuation,
    );
    result = {
      state: boundary.state,
      events: [...result.events, ...boundary.events],
    };
  }
  if (result.state.pendingChoice !== null) return result;
  if (stackContinuation !== undefined) {
    const resumed = resumeStackAfterChoice(
      result.state,
      stackContinuation.item,
    );
    result = {
      state: resumed.state,
      events: [...result.events, ...resumed.events],
    };
  }
  if (result.state.winner !== null) return result;

  return finalizeAfterChoice(result);
}

function finalizeAfterChoice(
  result: { readonly state: GameState; readonly events: readonly GameEvent[] },
): { readonly state: GameState; readonly events: readonly GameEvent[] } {
  if (result.state.pendingChoice !== null || result.state.winner !== null) return result;
  const actionId = result.events.find((event) => event.actionId !== undefined)?.actionId;
  const transactionId = result.events.find(
    (event) => event.transactionId !== undefined,
  )?.transactionId;
  const stabilized = stabilizeStateBased(result.state, {
    ...(actionId !== undefined ? { actionId } : {}),
    ...(transactionId !== undefined ? { transactionId } : {}),
  });
  return {
    state: stabilized.state,
    events: [...result.events, ...stabilized.events],
  };
}

function resumeTriggerOrderPipeline(
  state: GameState,
  choice: NonNullable<GameState['pendingChoice']>,
  selected: readonly string[],
): { readonly state: GameState; readonly events: readonly GameEvent[] } {
  const result = resumeTriggerOrdering(state, choice, selected);
  return finalizeAfterChoice({ state: result.newState, events: result.events });
}

function rejectedChoiceEvent(
  state: GameState,
  actionId: string,
  interactionId: string,
  playerId: 0 | 1,
  reason: string,
): GameEvent {
  const sequence = state.eventSequence ?? 0;
  return {
    type: 'CHOICE_REJECTED',
    interactionId,
    playerId,
    reason,
    eventId: `rejected:${actionId}`,
    actionId,
    transactionId: actionId,
    sequence,
    turnNumber: state.turnNumber,
    phase: state.phase,
    timing: 'interaction',
    actorPlayerId: playerId,
  };
}

/**
 * The sole public command boundary for current-rules play.
 *
 * Rejections preserve the exact input state object and consume no RNG. Internal
 * exceptions become typed failures instead of indistinguishable no-op states.
 */
function transitionUnchecked(state: GameState, command: EngineCommand): TransitionResult {
  const actionId = commandId(state, command);
  try {
    switch (command.type) {
      case 'mulligan_decision': {
        const choice = state.pendingChoice;
        if (
          state.phase !== 'mulligan' ||
          choice === null ||
          choice.type !== 'mulligan' ||
          choice.interactionId !== command.interactionId ||
          choice.validationToken !== command.interactionId ||
          choice.playerId !== command.playerId
        ) {
          return {
            status: 'rejected',
            state,
            violations: [
              {
                code: 'choice',
                path: 'command.interactionId',
                message: 'The mulligan decision is stale, wrong-owner, or outside mulligan',
              },
            ],
            events: [],
            actionId,
          };
        }
        const applied = withMulliganInteraction(
          applyMulligan(state, command.playerId, command.keep),
        );
        const nextChoice = applied.pendingChoice;
        const lifecycle: GameEvent[] = [
          {
            type: 'CHOICE_SUBMITTED',
            interactionId: command.interactionId,
            playerId: command.playerId,
            selectedOptionIds: [command.keep ? 'keep' : 'mulligan'],
          },
          {
            type: 'CHOICE_ACCEPTED',
            interactionId: command.interactionId,
            playerId: command.playerId,
          },
          {
            type: 'CHOICE_RESOLVED',
            interactionId: command.interactionId,
            playerId: command.playerId,
          },
        ];
        if (nextChoice !== null) {
          lifecycle.push({
            type: 'CHOICE_REQUESTED',
            interactionId: nextChoice.interactionId!,
            playerId: nextChoice.playerId,
            choiceType: nextChoice.type,
          });
        }
        const stamped = stampGameEvents(applied, lifecycle, {
          actionId,
          transactionId: actionId,
          timing: 'interaction',
        });
        const pending = pendingResult(stamped.state, stamped.events, actionId);
        return (
          pending ?? {
            status: 'resolved',
            state: stamped.state,
            events: stamped.events,
            actionId,
          }
        );
      }
      case 'advance_phase': {
        if (state.winner !== null) {
          return {
            status: 'rejected',
            state,
            violations: [
              { code: 'game_over', path: 'state.winner', message: 'The game is over' },
            ],
            events: [],
            actionId,
          };
        }
        const advanced = advancePhase(state, command.playerId, actionId);
        if (advanced === null) {
          return phaseViolation(
            state,
            actionId,
            'Only the active player may advance Strategy or Action with no pending interaction',
          );
        }
        const pending = pendingResult(advanced.state, advanced.events, actionId);
        return (
          pending ?? {
            status: 'resolved',
            state: advanced.state,
            events: advanced.events,
            actionId,
          }
        );
      }
      case 'concede': {
        if (state.winner !== null) {
          return {
            status: 'rejected',
            state,
            violations: [
              { code: 'game_over', path: 'state.winner', message: 'The game is over' },
            ],
            events: [],
            actionId,
          };
        }
        const winnerPlayerId: 0 | 1 = command.playerId === 0 ? 1 : 0;
        const conceded: GameState = {
          ...state,
          winner: winnerPlayerId,
          phase: 'game_over' as const,
          pendingChoice: null,
          pendingPriority: null,
        };
        const stamped = stampGameEvents(
          conceded,
          [
            {
              type: 'GAME_CONCEDED',
              playerId: command.playerId,
              winnerPlayerId,
            },
            {
              type: 'PHASE_CHANGED',
              phase: 'game_over',
              playerId: command.playerId,
            },
          ],
          { actionId, transactionId: actionId, timing: 'declaration' },
        );
        return {
          status: 'resolved',
          state: stamped.state,
          events: stamped.events,
          actionId,
        };
      }
      case 'player_action': {
        const violations = validatePlayerAction(state, command.action);
        if (violations.length > 0) {
          return { status: 'rejected', state, violations, events: [], actionId };
        }
        const result = executePlayerAction(state, command.action, actionId);
        const pending = pendingResult(result.state, result.events, actionId);
        return (
          pending ?? {
            status: 'resolved',
            state: result.state,
            events: result.events,
            actionId,
          }
        );
      }
      case 'reactive_action': {
        const violations = validateReactiveAction(state, command.windowId, command.action);
        if (violations.length > 0) {
          return { status: 'rejected', state, violations, events: [], actionId };
        }
        const result = executeReactiveResponse(state, command.action, actionId);
        const pending = pendingResult(result.state, result.events, actionId);
        return (
          pending ?? {
            status: 'resolved',
            state: result.state,
            events: result.events,
            actionId,
          }
        );
      }
      case 'priority_pass': {
        if (
          state.pendingPriority == null ||
          state.pendingPriority.baseStackItemId !== command.windowId
        ) {
          return {
            status: 'rejected',
            state,
            violations: [
              {
                code: 'stale_window',
                path: 'windowId',
                message: 'The priority pass does not reference the current window',
              },
            ],
            events: [],
            actionId,
          };
        }
        const result = executePriorityPass(state, actionId);
        const pending = pendingResult(result.state, result.events, actionId);
        return (
          pending ?? {
            status: 'resolved',
            state: result.state,
            events: result.events,
            actionId,
          }
        );
      }
      case 'choice_response': {
        const choice = state.pendingChoice;
        const selected = command.response.selectedOptionIds;
        const legal = new Set(choice?.options.map((option) => option.id) ?? []);
        const invalid =
          choice === null ||
          choice.interactionId !== command.interactionId ||
          choice.validationToken !== undefined &&
            choice.validationToken !== command.interactionId ||
          choice.playerId !== command.playerId ||
          selected.length < choice.minSelections ||
          selected.length > choice.maxSelections ||
          new Set(selected).size !== selected.length ||
          selected.some((id) => !legal.has(id));
        if (invalid) {
          return {
            status: 'rejected',
            state,
            violations: [
              {
                code: 'choice',
                path: 'command.response',
                message:
                  'The response is stale, forged, wrong-owner, wrong-count, duplicated, or outside the legal option set',
              },
            ],
            events: [
              rejectedChoiceEvent(
                state,
                actionId,
                command.interactionId,
                command.playerId,
                'stale, forged, wrong-owner, wrong-count, duplicated, or outside the legal option set',
              ),
            ],
            actionId,
          };
        }

        const result =
          choice.triggerOrderContinuation !== undefined
            ? resumeTriggerOrderPipeline(state, choice, selected)
            : choice.continuation !== undefined
            ? resumeChoicePipeline(state, choice, selected)
            : choice.type === 'choose_first_player'
              ? {
                  state: chooseFirstPlayer(
                    state,
                    selected[0] === 'player_0' ? 0 : 1,
                  ),
                  events: [],
                }
            : choice.type === 'discard_to_hand_limit'
              ? choice.turnBoundaryContinuation === undefined
                ? {
                    state: {
                      ...discardCards(state, selected),
                      pendingChoice: null,
                    },
                    events: [],
                  }
                : (() => {
                    const discarded = {
                      ...discardCards(state, selected),
                      pendingChoice: null,
                    };
                    return resumeTurnBoundary(
                      discarded,
                      choice.turnBoundaryContinuation,
                    );
                  })()
              : null;
        if (result === null) {
          return {
            status: 'rejected',
            state,
            violations: [
              {
                code: 'choice',
                path: 'state.pendingChoice',
                message: 'This legacy interaction has no authoritative continuation',
              },
            ],
            events: [
              rejectedChoiceEvent(
                state,
                actionId,
                command.interactionId,
                command.playerId,
                'interaction has no authoritative continuation',
              ),
            ],
            actionId,
          };
        }
        const lifecycleEvents: readonly GameEvent[] = [
          {
            type: 'CHOICE_SUBMITTED',
            interactionId: command.interactionId,
            playerId: command.playerId,
            selectedOptionIds: selected,
          },
          {
            type: 'CHOICE_ACCEPTED',
            interactionId: command.interactionId,
            playerId: command.playerId,
          },
          ...result.events,
          {
            type: 'CHOICE_RESOLVED',
            interactionId: command.interactionId,
            playerId: command.playerId,
          },
        ];
        const stampedLifecycle = stampGameEvents(result.state, lifecycleEvents, {
          actionId,
          transactionId: actionId,
          timing: 'interaction',
        });
        const pending = pendingResult(
          stampedLifecycle.state,
          stampedLifecycle.events,
          actionId,
        );
        return (
          pending ?? {
            status: 'resolved',
            state: stampedLifecycle.state,
            events: stampedLifecycle.events,
            actionId,
          }
        );
      }
    }
  } catch (error) {
    return {
      status: 'failed',
      state,
      failure: {
        code: error instanceof GuardExhaustionError ? 'guard_exhaustion' : 'internal_error',
        message: error instanceof Error ? error.message : String(error),
      },
      actionId,
    };
  }
}

export function transition(state: GameState, command: EngineCommand): TransitionResult {
  let result = transitionUnchecked(state, command);
  if (
    state.config?.authoritativeTransitions !== true ||
    (result.status !== 'resolved' && result.status !== 'pending')
  ) {
    return result;
  }
  if (result.state.winner !== null) {
    const closed = closeTerminalStack(result.state);
    const stampedClosures = stampGameEvents(closed.state, closed.events, {
      actionId: result.actionId,
      transactionId: result.actionId,
      timing: 'resolution',
    });
    // Game end stops trigger dispatch, but it must not preserve stale
    // continuous contributions from sources removed earlier in the same
    // declaration/trigger batch. Normalize without firing post-game triggers.
    const normalized = recomputeAurasWithEvents(stampedClosures.state);
    const stampedStateBased = stampGameEvents(
      normalized.state,
      normalized.events,
      {
        actionId: result.actionId,
        transactionId: result.actionId,
        timing: 'state_based',
      },
    );
    result = {
      status: 'resolved',
      state: stampedStateBased.state,
      events: [
        ...result.events,
        ...stampedClosures.events,
        ...stampedStateBased.events,
      ],
      actionId: result.actionId,
    };
  }
  const violations = validateGameStateInvariants(result.state);
  if (violations.length === 0) return result;
  return {
    status: 'failed',
    state,
    failure: {
      code: 'invariant_failure',
      message: violations
        .map(
          (violation) =>
            `${violation.code}@${violation.path}: ${violation.message}`,
        )
        .join('; '),
    },
    actionId: result.actionId,
  };
}
