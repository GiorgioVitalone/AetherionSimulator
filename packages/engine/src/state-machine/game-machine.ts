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
  drawResourceCard,
  drawMainDeckCard,
  executePlayerAction,
  removeTemporaryResources,
  passTurn,
  decrementHeroCooldowns,
} from './actions.js';
import { processStatusTicks } from './status-processing.js';
import { expireEndOfTurnModifiers } from './modifier-expiry.js';
import {
  processScheduledEffects,
  decrementScheduledTimers,
} from '../effects/scheduled-processor.js';
import {
  registerInitialTriggers,
  resolveEffectWorkItem,
  resolveTriggeredEvents,
} from '../events/index.js';
import { applyMulligan } from '../setup/game-setup.js';
import { applyPendingChoiceResponse } from './player-response.js';

export const gameMachine = setup({
  types: {
    context: {} as GameMachineContext,
    events: {} as GameMachineEvent,
    input: {} as { readonly gameState: GameState },
  },
  guards: {
    isFirstPlayerFirstTurn: ({ context }) =>
      context.gameState.turnState.firstPlayerFirstTurn,
    handExceedsLimit: ({ context }) => {
      const player = context.gameState.players[context.gameState.activePlayerIndex]!;
      return player.hand.length > MAX_HAND_SIZE;
    },
    hasWinner: ({ context }) => context.gameState.winner !== null,
    mainDeckEmpty: ({ context }) => {
      const player = context.gameState.players[context.gameState.activePlayerIndex]!;
      return player.mainDeck.length === 0;
    },
  },
  actions: {
    refreshAllCards: assign({
      gameState: ({ context }) => {
        const refreshed = refreshCards(context.gameState);
        return decrementHeroCooldowns(refreshed);
      },
    }),
    drawResource: assign(({ context }) => {
      const result = drawResourceCard(context.gameState);
      const resolved = resolveTriggeredEvents(result.state, result.events);
      return {
        gameState: {
          ...resolved.state,
          log: [...resolved.state.log, ...resolved.events],
        },
        pendingChoice: resolved.state.pendingChoice,
      };
    }),
    drawMainCard: assign(({ context }) => {
      const result = drawMainDeckCard(context.gameState);
      if (result.deckEmpty) {
      return {
        gameState: {
          ...context.gameState,
          winner: (context.gameState.activePlayerIndex === 0 ? 1 : 0) as 0 | 1,
          pendingResolution: null,
        },
        pendingChoice: null,
      };
    }
      const resolved = resolveTriggeredEvents(result.state, result.events);
      const newState = {
        ...resolved.state,
        log: [...resolved.state.log, ...resolved.events],
      };
      return {
        gameState: newState,
        pendingChoice: newState.pendingChoice !== undefined
          ? newState.pendingChoice
          : context.pendingChoice,
      };
    }),
    applyPlayerAction: assign(({ context, event }) => {
      if (event.type !== 'PLAYER_ACTION') return {};
      const result = executePlayerAction(context.gameState, event.action);
      const resolved = result.effectWorkItem !== undefined
        ? resolveEffectWorkItem(result.state, result.effectWorkItem, result.events)
        : resolveTriggeredEvents(result.state, result.events);
      const newState = {
        ...resolved.state,
        log: [...resolved.state.log, ...resolved.events],
      };
      return {
        gameState: newState,
        pendingChoice: newState.winner !== null
          ? null
          : newState.pendingChoice !== undefined
            ? newState.pendingChoice
            : context.pendingChoice,
      };
    }),
    setPhase: assign(({ context }, params: { readonly phase: GameState['phase'] }) => ({
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
    })),
    processStatuses: assign(({ context }) => {
      const result = processStatusTicks(context.gameState);
      const resolved = resolveTriggeredEvents(result.state, result.events);
      return {
        gameState: {
          ...resolved.state,
          log: [...resolved.state.log, ...resolved.events],
        },
        pendingChoice: resolved.state.pendingChoice,
      };
    }),
    removeTemps: assign({
      gameState: ({ context }) => removeTemporaryResources(context.gameState),
    }),
    processScheduledUpkeep: assign(({ context }) => {
      let currentState = context.gameState;
      // Process next_upkeep and next_turn_start scheduled effects
      const upkeepResult = processScheduledEffects(currentState, 'next_upkeep');
      currentState = upkeepResult.state;
      const turnStartResult = processScheduledEffects(currentState, 'next_turn_start');
      currentState = turnStartResult.state;
      // Decrement timers for next cycle
      currentState = decrementScheduledTimers(currentState);
      const allEvents = [...upkeepResult.events, ...turnStartResult.events];
      if (allEvents.length > 0) {
        const resolved = resolveTriggeredEvents(currentState, allEvents);
        return {
          gameState: {
            ...resolved.state,
            log: [...resolved.state.log, ...resolved.events],
          },
          pendingChoice: resolved.state.pendingChoice,
        };
      }
      return { gameState: currentState };
    }),
    processScheduledEndPhase: assign(({ context }) => {
      const result = processScheduledEffects(context.gameState, 'end_of_turn');
      if (result.events.length > 0) {
        const resolved = resolveTriggeredEvents(result.state, result.events);
        return {
          gameState: {
            ...resolved.state,
            log: [...resolved.state.log, ...resolved.events],
          },
          pendingChoice: resolved.state.pendingChoice,
        };
      }
      return { gameState: result.state };
    }),
    expireModifiers: assign(({ context }) => {
      const result = expireEndOfTurnModifiers(context.gameState);
      const resolved = resolveTriggeredEvents(result.state, result.events);
      return {
        gameState: {
          ...resolved.state,
          log: [...resolved.state.log, ...resolved.events],
        },
        pendingChoice: resolved.state.pendingChoice,
      };
    }),
    setHandSizeChoice: assign(({ context }) => {
      const player = context.gameState.players[context.gameState.activePlayerIndex]!;
      const excess = player.hand.length - MAX_HAND_SIZE;
      const choice: PendingChoice = {
        type: 'discard_to_hand_limit',
        playerId: context.gameState.activePlayerIndex,
        options: player.hand.map(c => ({
          id: c.instanceId,
          label: c.name,
          instanceId: c.instanceId,
        })),
        minSelections: excess,
        maxSelections: excess,
        context: `Discard ${String(excess)} card(s) to meet hand size limit.`,
      };
      return { pendingChoice: choice };
    }),
    clearPendingChoice: assign({ pendingChoice: null }),
    executeTurnPass: assign(({ context }) => {
      const newState = passTurn(context.gameState);
      const resolved = resolveTriggeredEvents(newState, [
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
      ]);
      return {
        gameState: {
          ...resolved.state,
          log: [...resolved.state.log, ...resolved.events],
        },
        pendingChoice: resolved.state.pendingChoice,
      };
    }),
    concede: assign(({ context, event }) => {
      if (event.type !== 'CONCEDE') return {};
      return {
        gameState: {
          ...context.gameState,
          winner: (event.playerId === 0 ? 1 : 0) as 0 | 1,
          pendingResolution: null,
        },
      };
    }),
    applyMulliganKeep: assign(({ context }) => ({
      gameState: context.gameState,
      pendingChoice: context.gameState.pendingChoice,
    })),
    applyPlayerResponse: assign(({ context, event }) => {
      if (event.type !== 'PLAYER_RESPONSE') return {};
      const resolved = applyPendingChoiceResponse(context.gameState, event.response);
      return {
        gameState: {
          ...resolved.state,
          log: [...resolved.state.log, ...resolved.events],
        },
        pendingChoice: resolved.pendingChoice,
      };
    }),
  },
}).createMachine({
  id: 'aetherionGame',
  context: ({ input }) => {
    const initializedState = registerInitialTriggers(input.gameState);
    return {
      gameState: initializedState,
      pendingChoice: initializedState.pendingChoice,
    };
  },
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
            // After player 1 decides, transition based on game state
            actions: assign(({ context, event }) => {
              const newState = applyMulligan(
                context.gameState,
                event.playerId,
                event.keep,
              );
              return {
                gameState: newState,
                pendingChoice: newState.pendingChoice,
              };
            }),
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
      states: {
        upkeep: {
          entry: [
            { type: 'setPhase', params: { phase: 'upkeep' as const } },
            'refreshAllCards',
            'processStatuses',
            'processScheduledUpkeep',
            'drawResource',
          ],
          always: [
            {
              target: 'drawMain',
              guard: { type: 'isFirstPlayerFirstTurn' },
              // Skip main draw on first player's first turn
            },
            { target: 'drawMain' },
          ],
        },

        drawMain: {
          always: [
            {
              // First player first turn skips main draw
              target: 'strategy',
              guard: { type: 'isFirstPlayerFirstTurn' },
            },
            {
              target: '#aetherionGame.gameOver',
              guard: { type: 'mainDeckEmpty' },
              actions: assign(({ context }) => ({
                gameState: {
                  ...context.gameState,
                  winner: (context.gameState.activePlayerIndex === 0 ? 1 : 0) as 0 | 1,
                },
              })),
            },
            {
              target: 'strategy',
              actions: 'drawMainCard',
            },
          ],
        },

        strategy: {
          entry: { type: 'setPhase', params: { phase: 'strategy' as const } },
          on: {
            PLAYER_ACTION: {
              actions: 'applyPlayerAction',
            },
            PLAYER_RESPONSE: {
              actions: 'applyPlayerResponse',
            },
            END_PHASE: {
              target: 'action',
            },
          },
          always: {
            target: '#aetherionGame.gameOver',
            guard: { type: 'hasWinner' },
          },
        },

        action: {
          entry: { type: 'setPhase', params: { phase: 'action' as const } },
          on: {
            PLAYER_ACTION: {
              actions: 'applyPlayerAction',
            },
            PLAYER_RESPONSE: {
              actions: 'applyPlayerResponse',
            },
            END_PHASE: {
              target: 'endPhase',
            },
          },
          always: {
            target: '#aetherionGame.gameOver',
            guard: { type: 'hasWinner' },
          },
        },

        endPhase: {
          entry: [
            { type: 'setPhase', params: { phase: 'end' as const } },
            'removeTemps',
            'expireModifiers',
            'processScheduledEndPhase',
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
            PLAYER_RESPONSE: {
              target: 'passTurn',
              actions: [
                assign(({ context, event }) => {
                  if (event.type !== 'PLAYER_RESPONSE') return {};
                  const player = context.gameState.players[context.gameState.activePlayerIndex]!;
                  const discardIds = event.response.selectedOptionIds;
                  const discarded = player.hand.filter(c =>
                    discardIds.includes(c.instanceId),
                  );
                  const remaining = player.hand.filter(
                    c => !discardIds.includes(c.instanceId),
                  );
                  const newPlayers = [...context.gameState.players] as [
                    typeof context.gameState.players[0],
                    typeof context.gameState.players[1],
                  ];
                  newPlayers[context.gameState.activePlayerIndex] = {
                    ...player,
                    hand: remaining,
                    discardPile: [...player.discardPile, ...discarded],
                  };
                  return {
                    gameState: { ...context.gameState, players: newPlayers },
                    pendingChoice: null,
                  };
                }),
              ],
            },
          },
        },

        passTurn: {
          entry: 'executeTurnPass',
          always: {
            target: 'upkeep',
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
