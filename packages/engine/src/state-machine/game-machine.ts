/**
 * Game State Machine (XState v5) — orchestrates the full game lifecycle.
 *
 * States: setup → mulligan → playing (upkeep → strategy → action → end) → game_over
 *
 * The machine holds GameState in context and transforms it via pure actions.
 * When player input is needed, a PendingChoice is stored in context.
 */
import { setup, assign } from 'xstate';
import type { GameMachineContext, GameMachineEvent } from './types.js';
import type { GameState, PendingChoice } from '../types/game-state.js';
import { MAX_HAND_SIZE } from '../types/game-state.js';
import {
  refreshCards,
  tickUpkeepStatuses,
  generateReserveEnergy,
  drawResourceCard,
  drawMainDeckCard,
  executePlayerAction,
  executeReactiveResponse,
  executePriorityPass,
  expireUpkeepModifiersWithEvents,
} from './actions.js';
import {
  removeTemporaryResources,
  passTurn,
  executeTurnBoundary,
  discardCards,
  runScheduledEffects,
  expireEndOfTurnModifiersWithEvents,
} from './turn-boundary.js';
import type { ScheduledTiming } from '../types/effects.js';
import { applyMulligan } from '../setup/game-setup.js';
import { transition } from '../transitions/transition.js';

export const gameMachine = setup({
  types: {
    context: {} as GameMachineContext,
    events: {} as GameMachineEvent,
    input: {} as { readonly gameState: GameState },
  },
  guards: {
    isFirstPlayerFirstTurn: ({ context }) => context.gameState.turnState.firstPlayerFirstTurn,
    // CANDIDATE RULE VARIANT (config.firstPlayerDrawsNormally, §13r): gates ONLY the
    // main-draw skip below — the attack restriction (available-actions.ts,
    // combat-resolver.ts) reads turnState.firstPlayerFirstTurn directly and is
    // untouched. Absent/false ⇒ semantically invariant no-op.
    skipMainDrawFirstPlayer: ({ context }) =>
      context.gameState.turnState.firstPlayerFirstTurn &&
      context.gameState.config?.firstPlayerDrawsNormally !== true,
    handExceedsLimit: ({ context }) => {
      const player = context.gameState.players[context.gameState.activePlayerIndex];
      return player.hand.length > MAX_HAND_SIZE;
    },
    validHandSizeResponse: ({ context, event }) => {
      if (event.type !== 'PLAYER_RESPONSE') return false;
      const choice =
        context.gameState.pendingChoice ??
        (context.gameState.config?.observableInteractions !== true
          ? context.pendingChoice
          : null);
      if (choice === null || choice.type !== 'discard_to_hand_limit') return false;
      if (
        (event.interactionId !== undefined &&
          event.interactionId !== choice.interactionId) ||
        (event.playerId !== undefined && event.playerId !== choice.playerId)
      ) {
        return false;
      }
      const selected = event.response.selectedOptionIds;
      if (
        selected.length !== choice.minSelections ||
        selected.length !== choice.maxSelections ||
        new Set(selected).size !== selected.length
      ) {
        return false;
      }
      const legal = new Set(choice.options.map((option) => option.id));
      return selected.every((id) => legal.has(id));
    },
    hasWinner: ({ context }) => context.gameState.winner !== null,
    hasPendingChoice: ({ context }) => context.gameState.pendingChoice !== null,
    windowOpen: ({ context }) => context.gameState.pendingPriority != null,
    mainDeckEmpty: ({ context }) => {
      const player = context.gameState.players[context.gameState.activePlayerIndex];
      return player.mainDeck.length === 0;
    },
    // RULES-ACCURACY FIX (config.transformAtStartOfTurn): gates entry into the
    // new startOfTurnTransform state (between Reserve Energy and Strategy).
    // Absent/false ⇒ semantically invariant no-op — reserveEnergy always goes straight
    // to strategy.
    transformAtStartOfTurnEnabled: ({ context }) =>
      context.gameState.config?.transformAtStartOfTurn === true,
    authoritativeTransitionsEnabled: ({ context }) =>
      context.gameState.config?.authoritativeTransitions === true,
  },
  actions: {
    refreshAllCards: assign({
      gameState: ({ context }) => refreshCards(context.gameState),
    }),
    tickStatuses: assign(({ context }) => {
      const result = tickUpkeepStatuses(context.gameState);
      return {
        gameState: {
          ...result.state,
          log: [...result.state.log, ...result.events],
        },
      };
    }),
    expireUpkeepMods: assign(({ context }) => {
      const result = expireUpkeepModifiersWithEvents(context.gameState);
      return {
        gameState: {
          ...result.state,
          log: [...result.state.log, ...result.events],
        },
        pendingChoice: result.state.pendingChoice,
      };
    }),
    expireEndOfTurnMods: assign(({ context }) => {
      const result = expireEndOfTurnModifiersWithEvents(context.gameState);
      return {
        gameState: {
          ...result.state,
          log: [...result.state.log, ...result.events],
        },
        pendingChoice: result.state.pendingChoice,
      };
    }),
    reserveEnergy: assign(({ context }) => {
      const result = generateReserveEnergy(context.gameState);
      return {
        gameState: {
          ...result.state,
          log: [...result.state.log, ...result.events],
        },
      };
    }),
    drawResource: assign(({ context }) => {
      const result = drawResourceCard(context.gameState);
      return {
        gameState: {
          ...result.state,
          log: [...result.state.log, ...result.events],
        },
      };
    }),
    drawMainCard: assign(({ context }) => {
      const result = drawMainDeckCard(context.gameState);
      if (result.deckEmpty) {
        return {
          gameState: {
            ...result.state,
            log: [...result.state.log, ...result.events],
          },
          pendingChoice: null,
        };
      }
      return {
        gameState: {
          ...result.state,
          log: [...result.state.log, ...result.events],
        },
        pendingChoice: context.pendingChoice,
      };
    }),
    applyPlayerAction: assign(({ context, event }) => {
      if (event.type !== 'PLAYER_ACTION') return {};
      if (context.gameState.config?.authoritativeTransitions !== true) {
        const legacy = executePlayerAction(context.gameState, event.action);
        return {
          gameState: {
            ...legacy.state,
            log: [...legacy.state.log, ...legacy.events],
          },
          pendingChoice: legacy.state.winner !== null ? null : context.pendingChoice,
        };
      }
      const result = transition(context.gameState, {
        type: 'player_action',
        action: event.action,
      });
      if (result.status === 'rejected' || result.status === 'failed') {
        return { lastTransition: result };
      }
      return {
        gameState: {
          ...result.state,
          log: [...result.state.log, ...result.events],
        },
        pendingChoice: result.state.winner !== null ? null : result.state.pendingChoice,
        lastTransition: result,
      };
    }),
    applyReactiveAction: assign(({ context, event }) => {
      if (event.type !== 'REACTIVE_ACTION') return {};
      if (context.gameState.config?.authoritativeTransitions !== true) {
        const legacy = executeReactiveResponse(context.gameState, event.action);
        return {
          gameState: {
            ...legacy.state,
            log: [...legacy.state.log, ...legacy.events],
          },
          pendingChoice: legacy.state.winner !== null ? null : context.pendingChoice,
        };
      }
      const windowId = context.gameState.pendingPriority?.baseStackItemId ?? 'no-window';
      const result = transition(context.gameState, {
        type: 'reactive_action',
        windowId,
        action: event.action,
      });
      if (result.status === 'rejected' || result.status === 'failed') {
        return { lastTransition: result };
      }
      return {
        gameState: {
          ...result.state,
          log: [...result.state.log, ...result.events],
        },
        pendingChoice: result.state.winner !== null ? null : result.state.pendingChoice,
        lastTransition: result,
      };
    }),
    applyPriorityPass: assign(({ context }) => {
      if (context.gameState.config?.authoritativeTransitions !== true) {
        const legacy = executePriorityPass(context.gameState);
        return {
          gameState: {
            ...legacy.state,
            log: [...legacy.state.log, ...legacy.events],
          },
          pendingChoice: legacy.state.winner !== null ? null : context.pendingChoice,
        };
      }
      const result = transition(context.gameState, {
        type: 'priority_pass',
        windowId: context.gameState.pendingPriority?.baseStackItemId ?? 'no-window',
      });
      if (result.status === 'rejected' || result.status === 'failed') {
        return { lastTransition: result };
      }
      return {
        gameState: {
          ...result.state,
          log: [...result.state.log, ...result.events],
        },
        pendingChoice: result.state.winner !== null ? null : result.state.pendingChoice,
        lastTransition: result,
      };
    }),
    applyChoiceResponse: assign(({ context, event }) => {
      if (event.type !== 'PLAYER_RESPONSE') return {};
      const choice =
        context.gameState.pendingChoice ??
        (context.gameState.config?.observableInteractions !== true
          ? context.pendingChoice
          : null);
      if (choice === null) return {};

      if (context.gameState.config?.authoritativeTransitions === true) {
        if (choice.interactionId === undefined) return {};
        const result = transition(context.gameState, {
          type: 'choice_response',
          interactionId: event.interactionId ?? choice.interactionId,
          playerId: event.playerId ?? choice.playerId,
          response: event.response,
        });
        if (result.status === 'rejected' || result.status === 'failed') {
          return { lastTransition: result };
        }
        return {
          gameState: {
            ...result.state,
            log: [...result.state.log, ...result.events],
          },
          pendingChoice: result.state.winner !== null ? null : result.state.pendingChoice,
          lastTransition: result,
        };
      }

      if (choice.type !== 'discard_to_hand_limit') return {};
      const next = discardCards(context.gameState, event.response.selectedOptionIds);
      return {
        gameState: { ...next, pendingChoice: null },
        pendingChoice: null,
      };
    }),
    applyMulliganDecision: assign(({ context, event }) => {
      if (event.type !== 'MULLIGAN_DECISION') return {};
      if (context.gameState.config?.authoritativeTransitions !== true) {
        const newState = applyMulligan(context.gameState, event.playerId, event.keep);
        return {
          gameState: newState,
          pendingChoice: newState.pendingChoice,
        };
      }
      const choice = context.gameState.pendingChoice;
      if (choice?.interactionId === undefined) return {};
      const result = transition(context.gameState, {
        type: 'mulligan_decision',
        interactionId: choice.interactionId,
        playerId: event.playerId,
        keep: event.keep,
      });
      if (result.status === 'rejected' || result.status === 'failed') {
        return { lastTransition: result };
      }
      return {
        gameState: {
          ...result.state,
          log: [...result.state.log, ...result.events],
        },
        pendingChoice: result.state.pendingChoice,
        lastTransition: result,
      };
    }),
    applyPhaseAdvance: assign(({ context }) => {
      const result = transition(context.gameState, {
        type: 'advance_phase',
        playerId: context.gameState.activePlayerIndex,
      });
      if (result.status === 'rejected' || result.status === 'failed') {
        return { lastTransition: result };
      }
      return {
        gameState: {
          ...result.state,
          log: [...result.state.log, ...result.events],
        },
        pendingChoice: result.state.pendingChoice,
        lastTransition: result,
      };
    }),
    setPhase: assign(({ context }, params: { readonly phase: GameState['phase'] }) => ({
      ...(context.gameState.phase === params.phase
        ? {}
        : {
            gameState: {
              ...context.gameState,
              phase: params.phase,
              log: [
                ...context.gameState.log,
                {
                  type: 'PHASE_CHANGED' as const,
                  phase: params.phase,
                  playerId: context.gameState.activePlayerIndex,
                },
              ],
            },
          }),
    })),
    removeTemps: assign({
      gameState: ({ context }) => removeTemporaryResources(context.gameState),
    }),
    fireScheduled: assign(({ context }, params: { readonly timing: ScheduledTiming['type'] }) => {
      const result = runScheduledEffects(context.gameState, params.timing);
      return {
        gameState: {
          ...result.state,
          log: [...result.state.log, ...result.events],
        },
      };
    }),
    // RULES-ACCURACY FIX (config.startOfTurnTriggerAfterReserve): fires the
    // 'next_turn_start'/'next_upkeep' scheduled triggers during Upkeep, in the
    // LEGACY position (before Reserve Energy Generation). No-ops when the flag
    // is ON (the fixed-order action below runs instead, after Reserve Energy).
    // Absent/false ⇒ semantically invariant no-op.
    fireNextTurnStartLegacyOrder: assign(({ context }) => {
      if (context.gameState.config?.startOfTurnTriggerAfterReserve === true) return {};
      const result = runScheduledEffects(context.gameState, 'next_turn_start');
      return {
        gameState: {
          ...result.state,
          log: [...result.state.log, ...result.events],
        },
        pendingChoice: result.state.pendingChoice,
      };
    }),
    fireNextUpkeepLegacyOrder: assign(({ context }) => {
      if (context.gameState.config?.startOfTurnTriggerAfterReserve === true) return {};
      const result = runScheduledEffects(context.gameState, 'next_upkeep');
      return {
        gameState: {
          ...result.state,
          log: [...result.state.log, ...result.events],
        },
        pendingChoice: result.state.pendingChoice,
      };
    }),
    // RULES-ACCURACY FIX (config.startOfTurnTriggerAfterReserve): fires the same
    // triggers in the FIXED position (after Reserve Energy Generation). No-ops
    // when the flag is OFF (the legacy-order action above runs instead, during
    // Upkeep). Absent/false ⇒ semantically invariant no-op.
    fireNextTurnStartFixedOrder: assign(({ context }) => {
      if (context.gameState.config?.startOfTurnTriggerAfterReserve !== true) return {};
      const result = runScheduledEffects(context.gameState, 'next_turn_start');
      return {
        gameState: {
          ...result.state,
          log: [...result.state.log, ...result.events],
        },
        pendingChoice: result.state.pendingChoice,
      };
    }),
    fireNextUpkeepFixedOrder: assign(({ context }) => {
      if (context.gameState.config?.startOfTurnTriggerAfterReserve !== true) return {};
      const result = runScheduledEffects(context.gameState, 'next_upkeep');
      return {
        gameState: {
          ...result.state,
          log: [...result.state.log, ...result.events],
        },
        pendingChoice: result.state.pendingChoice,
      };
    }),
    // RULES-ACCURACY FIX (config.endPhaseOrderFix): fires the 'end_of_turn'
    // scheduled triggers in the LEGACY position (before Remove Temporary
    // Resources / Hand Size Limit, during endPhase entry). No-ops when the flag
    // is ON. Absent/false ⇒ semantically invariant no-op.
    fireScheduledEndOfTurnLegacyOrder: assign(({ context }) => {
      if (context.gameState.config?.endPhaseOrderFix === true) return {};
      const result = runScheduledEffects(context.gameState, 'end_of_turn');
      return { gameState: { ...result.state, log: [...result.state.log, ...result.events] } };
    }),
    // RULES-ACCURACY FIX (config.endPhaseOrderFix): fires the same triggers in
    // the FIXED position (after Remove Temporary Resources / Hand Size Limit,
    // just before passTurn). No-ops when the flag is OFF. Absent/false ⇒
    // semantically invariant no-op.
    fireScheduledEndOfTurnFixedOrder: assign(({ context }) => {
      if (context.gameState.config?.endPhaseOrderFix !== true) return {};
      const result = runScheduledEffects(context.gameState, 'end_of_turn');
      return { gameState: { ...result.state, log: [...result.state.log, ...result.events] } };
    }),
    setHandSizeChoice: assign(({ context }) => {
      const player = context.gameState.players[context.gameState.activePlayerIndex];
      const excess = player.hand.length - MAX_HAND_SIZE;
      const choice: PendingChoice = {
        ...(context.gameState.config?.observableInteractions === true
          ? {
              interactionId: [
                'hand',
                context.gameState.turnNumber,
                context.gameState.activePlayerIndex,
                context.gameState.log.length,
              ].join(':'),
            }
          : {}),
        type: 'discard_to_hand_limit',
        playerId: context.gameState.activePlayerIndex,
        options: player.hand.map((c) => ({
          id: c.instanceId,
          label: c.name,
          instanceId: c.instanceId,
        })),
        minSelections: excess,
        maxSelections: excess,
        context: `Discard ${String(excess)} card(s) to meet hand size limit.`,
        optional: false,
        visibility: 'controller',
        ...(context.gameState.config?.observableInteractions === true
          ? {
              validationToken: [
                'hand',
                context.gameState.turnNumber,
                context.gameState.activePlayerIndex,
                context.gameState.log.length,
              ].join(':'),
            }
          : {}),
      };
      return {
        gameState:
          context.gameState.config?.observableInteractions === true
            ? {
                ...context.gameState,
                pendingChoice: choice,
                log: [
                  ...context.gameState.log,
                  {
                    type: 'CHOICE_REQUESTED' as const,
                    interactionId: choice.interactionId!,
                    playerId: choice.playerId,
                    choiceType: choice.type,
                  },
                ],
              }
            : context.gameState,
        pendingChoice: choice,
      };
    }),
    clearPendingChoice: assign({ pendingChoice: null }),
    executeTurnPass: assign(({ context }) => {
      if (context.gameState.config?.dispatchTurnBoundaryTriggers === true) {
        const boundary = executeTurnBoundary(context.gameState);
        return {
          gameState: {
            ...boundary.state,
            log: [...boundary.state.log, ...boundary.events],
          },
          pendingChoice: boundary.state.pendingChoice,
        };
      }
      const newState = passTurn(context.gameState);
      return {
        gameState: {
          ...newState,
          log: [
            ...newState.log,
            {
              type: 'TURN_END' as const,
              playerId: context.gameState.activePlayerIndex,
              turnNumber: context.gameState.turnNumber,
            },
            {
              type: 'TURN_START' as const,
              playerId: newState.activePlayerIndex,
              turnNumber: newState.turnNumber,
            },
          ],
        },
        pendingChoice: null,
      };
    }),
    concede: assign(({ context, event }) => {
      if (event.type !== 'CONCEDE') return {};
      if (context.gameState.config?.authoritativeTransitions === true) {
        const result = transition(context.gameState, {
          type: 'concede',
          playerId: event.playerId,
        });
        if (result.status === 'rejected' || result.status === 'failed') {
          return { lastTransition: result };
        }
        return {
          gameState: {
            ...result.state,
            log: [...result.state.log, ...result.events],
          },
          pendingChoice: null,
          lastTransition: result,
        };
      }
      return {
        gameState: {
          ...context.gameState,
          winner: event.playerId === 0 ? 1 : 0,
        },
      };
    }),
    applyMulliganKeep: assign(({ context }) => ({
      gameState: context.gameState,
      pendingChoice: context.gameState.pendingChoice,
    })),
  },
}).createMachine({
  id: 'aetherionGame',
  context: ({ input }) => ({
    gameState: input.gameState,
    pendingChoice: input.gameState.pendingChoice,
    lastTransition: null,
  }),
  initial: 'mulligan',
  on: {
    CONCEDE: {
      target: '.gameOver',
      actions: 'concede',
    },
  },
  states: {
    mulligan: {
      on: {
        MULLIGAN_DECISION: [
          {
            actions: 'applyMulliganDecision',
          },
        ],
      },
      always: {
        target: 'playing',
        guard: ({ context }) => context.gameState.phase === 'upkeep',
      },
    },

    playing: {
      initial: 'upkeep',
      on: {
        PLAYER_RESPONSE: {
          actions: 'applyChoiceResponse',
        },
      },
      states: {
        upkeep: {
          entry: [
            { type: 'setPhase', params: { phase: 'upkeep' as const } },
            'expireUpkeepMods',
          ],
          always: [
            {
              target: '#aetherionGame.gameOver',
              guard: { type: 'hasWinner' },
            },
            {
              target: 'upkeepExpiryInteraction',
              guard: { type: 'hasPendingChoice' },
            },
            { target: 'upkeepStatus' },
          ],
        },

        upkeepExpiryInteraction: {
          on: {
            PLAYER_RESPONSE: {
              actions: 'applyChoiceResponse',
            },
          },
          always: [
            {
              target: '#aetherionGame.gameOver',
              guard: { type: 'hasWinner' },
            },
            {
              target: 'upkeepStatus',
              guard: ({ context }) => context.gameState.pendingChoice === null,
            },
          ],
        },

        upkeepStatus: {
          entry: ['refreshAllCards', 'tickStatuses'],
          always: [
            {
              target: '#aetherionGame.gameOver',
              guard: { type: 'hasWinner' },
            },
            {
              target: 'upkeepStatusInteraction',
              guard: { type: 'hasPendingChoice' },
            },
            { target: 'upkeepLegacyTurnStart' },
          ],
        },

        upkeepStatusInteraction: {
          on: {
            PLAYER_RESPONSE: {
              actions: 'applyChoiceResponse',
            },
          },
          always: [
            {
              target: '#aetherionGame.gameOver',
              guard: { type: 'hasWinner' },
            },
            {
              target: 'upkeepLegacyTurnStart',
              guard: ({ context }) => context.gameState.pendingChoice === null,
            },
          ],
        },

        upkeepLegacyTurnStart: {
          entry: 'fireNextTurnStartLegacyOrder',
          always: [
            {
              target: '#aetherionGame.gameOver',
              guard: { type: 'hasWinner' },
            },
            {
              target: 'upkeepLegacyTurnStartInteraction',
              guard: { type: 'hasPendingChoice' },
            },
            { target: 'upkeepLegacyNextUpkeep' },
          ],
        },

        upkeepLegacyTurnStartInteraction: {
          on: {
            PLAYER_RESPONSE: {
              actions: 'applyChoiceResponse',
            },
          },
          always: [
            {
              target: '#aetherionGame.gameOver',
              guard: { type: 'hasWinner' },
            },
            {
              target: 'upkeepLegacyNextUpkeep',
              guard: ({ context }) => context.gameState.pendingChoice === null,
            },
          ],
        },

        upkeepLegacyNextUpkeep: {
          entry: 'fireNextUpkeepLegacyOrder',
          always: [
            {
              target: '#aetherionGame.gameOver',
              guard: { type: 'hasWinner' },
            },
            {
              target: 'upkeepLegacyNextUpkeepInteraction',
              guard: { type: 'hasPendingChoice' },
            },
            { target: 'upkeepResourceDraw' },
          ],
        },

        upkeepLegacyNextUpkeepInteraction: {
          on: {
            PLAYER_RESPONSE: {
              actions: 'applyChoiceResponse',
            },
          },
          always: [
            {
              target: '#aetherionGame.gameOver',
              guard: { type: 'hasWinner' },
            },
            {
              target: 'upkeepResourceDraw',
              guard: ({ context }) => context.gameState.pendingChoice === null,
            },
          ],
        },

        upkeepResourceDraw: {
          entry: 'drawResource',
          always: { target: 'drawMain' },
        },

        drawMain: {
          always: [
            {
              // First player first turn skips main draw (unless firstPlayerDrawsNormally)
              target: 'reserveEnergy',
              guard: { type: 'skipMainDrawFirstPlayer' },
            },
            {
              target: '#aetherionGame.gameOver',
              guard: { type: 'mainDeckEmpty' },
              actions: assign(({ context }) => ({
                gameState: {
                  ...context.gameState,
                  winner: context.gameState.activePlayerIndex === 0 ? 1 : 0,
                },
              })),
            },
            {
              target: 'reserveEnergy',
              actions: 'drawMainCard',
            },
          ],
        },

        // Upkeep step 4 — Reserve Energy Generation (Rulebook 8). Runs after the
        // draws (steps 2/3) and before the Strategy Phase.
        reserveEnergy: {
          entry: 'reserveEnergy',
          always: { target: 'upkeepFixedTurnStart' },
        },

        upkeepFixedTurnStart: {
          entry: 'fireNextTurnStartFixedOrder',
          always: [
            {
              target: '#aetherionGame.gameOver',
              guard: { type: 'hasWinner' },
            },
            {
              target: 'upkeepFixedTurnStartInteraction',
              guard: { type: 'hasPendingChoice' },
            },
            { target: 'upkeepFixedNextUpkeep' },
          ],
        },

        upkeepFixedTurnStartInteraction: {
          on: {
            PLAYER_RESPONSE: {
              actions: 'applyChoiceResponse',
            },
          },
          always: [
            {
              target: '#aetherionGame.gameOver',
              guard: { type: 'hasWinner' },
            },
            {
              target: 'upkeepFixedNextUpkeep',
              guard: ({ context }) => context.gameState.pendingChoice === null,
            },
          ],
        },

        upkeepFixedNextUpkeep: {
          entry: 'fireNextUpkeepFixedOrder',
          always: [
            {
              target: '#aetherionGame.gameOver',
              guard: { type: 'hasWinner' },
            },
            {
              target: 'upkeepFixedNextUpkeepInteraction',
              guard: { type: 'hasPendingChoice' },
            },
            {
              target: 'startOfTurnTransform',
              guard: { type: 'transformAtStartOfTurnEnabled' },
            },
            { target: 'strategy' },
          ],
        },

        upkeepFixedNextUpkeepInteraction: {
          on: {
            PLAYER_RESPONSE: {
              actions: 'applyChoiceResponse',
            },
          },
          always: [
            {
              target: '#aetherionGame.gameOver',
              guard: { type: 'hasWinner' },
            },
            {
              target: 'startOfTurnTransform',
              guard: ({ context }) =>
                context.gameState.pendingChoice === null &&
                context.gameState.config?.transformAtStartOfTurn === true,
            },
            {
              target: 'strategy',
              guard: ({ context }) => context.gameState.pendingChoice === null,
            },
          ],
        },

        // RULES-ACCURACY FIX (config.transformAtStartOfTurn) — a start-of-turn
        // window, after Reserve Energy Generation and before Strategy, during
        // which the active player may declare a Hero transformation. Only
        // entered when the flag is ON (see transformAtStartOfTurnEnabled
        // guard); OFF ⇒ this state is never reached (semantically invariant no-op).
        startOfTurnTransform: {
          on: {
            PLAYER_ACTION: {
              actions: 'applyPlayerAction',
            },
            END_PHASE: {
              target: 'strategy',
            },
          },
          always: {
            target: '#aetherionGame.gameOver',
            guard: { type: 'hasWinner' },
          },
        },

        strategy: {
          entry: { type: 'setPhase', params: { phase: 'strategy' as const } },
          on: {
            PLAYER_ACTION: {
              actions: 'applyPlayerAction',
            },
            END_PHASE: [
              {
                target: 'action',
                actions: 'applyPhaseAdvance',
                guard: { type: 'authoritativeTransitionsEnabled' },
              },
              { target: 'action' },
            ],
          },
          always: [
            {
              target: '#aetherionGame.gameOver',
              guard: { type: 'hasWinner' },
            },
            {
              target: 'priorityWindow',
              guard: { type: 'windowOpen' },
            },
          ],
        },

        // Reactive response window (Rulebook 14). The responder casts a Counter/
        // Flash (REACTIVE_ACTION) or passes (PRIORITY_PASS); two passes close the
        // window and resolve the chain LIFO, clearing pendingPriority. Then we
        // return to the phase the window opened from (strategy for casts; the
        // action phase under config.responseWindowsOnAllActions / flashAtWill)
        // so the active player continues their turn.
        priorityWindow: {
          on: {
            REACTIVE_ACTION: {
              actions: 'applyReactiveAction',
            },
            PRIORITY_PASS: {
              actions: 'applyPriorityPass',
            },
          },
          always: [
            {
              target: '#aetherionGame.gameOver',
              guard: { type: 'hasWinner' },
            },
            {
              // The window opened during the Action Phase (gs.phase is unchanged
              // while a window is open) — return there, mirroring the strategy
              // return below. Off-flag + flashAtWill off this never fires, since
              // only strategy-phase casts open windows.
              target: 'action',
              guard: ({ context }) =>
                context.gameState.pendingPriority == null &&
                context.gameState.phase === 'action',
            },
            {
              target: 'strategy',
              guard: ({ context }) => context.gameState.pendingPriority == null,
            },
          ],
        },

        action: {
          entry: { type: 'setPhase', params: { phase: 'action' as const } },
          on: {
            PLAYER_ACTION: {
              actions: 'applyPlayerAction',
            },
            END_PHASE: [
              {
                target: 'boundaryInteraction',
                guard: { type: 'authoritativeTransitionsEnabled' },
                actions: 'applyPhaseAdvance',
              },
              { target: 'endPhase' },
            ],
          },
          always: [
            {
              target: '#aetherionGame.gameOver',
              guard: { type: 'hasWinner' },
            },
            {
              // TIER 4 (config.responseWindowsOnAllActions): Action-Phase actions
              // (declare_attack, and activate_ability/attach_equipment/move under
              // the same flag — plus flashAtWill Flash casts) can open a priority
              // window; route to it exactly like the strategy phase does. Never
              // fires when no window can open (pendingPriority stays null).
              target: 'priorityWindow',
              guard: { type: 'windowOpen' },
            },
          ],
        },

        endPhase: {
          entry: [
            { type: 'setPhase', params: { phase: 'end' as const } },
            'fireScheduledEndOfTurnLegacyOrder',
            'removeTemps',
            'expireEndOfTurnMods',
          ],
          always: [
            {
              target: 'handSizeCheck',
              guard: { type: 'handExceedsLimit' },
            },
            { target: 'passTurn' },
          ],
        },

        handSizeCheck: {
          entry: 'setHandSizeChoice',
          on: {
            PLAYER_RESPONSE: [
              {
                guard: 'validHandSizeResponse',
                target: 'passTurn',
                actions: 'applyChoiceResponse',
              },
              {},
            ],
          },
        },

        passTurn: {
          entry: ['fireScheduledEndOfTurnFixedOrder', 'executeTurnPass'],
          always: [
            { target: 'boundaryInteraction', guard: 'hasPendingChoice' },
            { target: 'upkeep' },
          ],
        },

        boundaryInteraction: {
          on: {
            PLAYER_RESPONSE: {
              actions: 'applyChoiceResponse',
            },
          },
          always: {
            target: 'upkeep',
            guard: ({ context }) => context.gameState.pendingChoice === null,
          },
        },
      },
    },

    gameOver: {
      type: 'final',
      entry: { type: 'setPhase', params: { phase: 'game_over' as const } },
    },
  },
});
