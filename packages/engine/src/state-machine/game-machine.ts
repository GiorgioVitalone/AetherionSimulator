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
  removeTemporaryResources,
  passTurn,
  runScheduledEffects,
  expireUpkeepModifiers,
  expireEndOfTurnModifiers,
} from './actions.js';
import type { ScheduledTiming } from '../types/effects.js';
import { applyMulligan } from '../setup/game-setup.js';

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
    windowOpen: ({ context }) =>
      context.gameState.pendingPriority != null,
    mainDeckEmpty: ({ context }) => {
      const player = context.gameState.players[context.gameState.activePlayerIndex]!;
      return player.mainDeck.length === 0;
    },
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
    expireUpkeepMods: assign({
      gameState: ({ context }) => expireUpkeepModifiers(context.gameState),
    }),
    expireEndOfTurnMods: assign({
      gameState: ({ context }) => expireEndOfTurnModifiers(context.gameState),
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
            ...context.gameState,
            winner: (context.gameState.activePlayerIndex === 0 ? 1 : 0) as 0 | 1,
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
      const result = executePlayerAction(context.gameState, event.action);
      return {
        gameState: {
          ...result.state,
          log: [...result.state.log, ...result.events],
        },
        pendingChoice: result.state.winner !== null ? null : context.pendingChoice,
      };
    }),
    applyReactiveAction: assign(({ context, event }) => {
      if (event.type !== 'REACTIVE_ACTION') return {};
      const result = executeReactiveResponse(context.gameState, event.action);
      return {
        gameState: {
          ...result.state,
          log: [...result.state.log, ...result.events],
        },
        pendingChoice: result.state.winner !== null ? null : context.pendingChoice,
      };
    }),
    applyPriorityPass: assign(({ context }) => {
      const result = executePriorityPass(context.gameState);
      return {
        gameState: {
          ...result.state,
          log: [...result.state.log, ...result.events],
        },
        pendingChoice: result.state.winner !== null ? null : context.pendingChoice,
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
    removeTemps: assign({
      gameState: ({ context }) => removeTemporaryResources(context.gameState),
    }),
    fireScheduled: assign(
      ({ context }, params: { readonly timing: ScheduledTiming['type'] }) => {
        const result = runScheduledEffects(context.gameState, params.timing);
        return {
          gameState: {
            ...result.state,
            log: [...result.state.log, ...result.events],
          },
        };
      },
    ),
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
      return {
        gameState: {
          ...context.gameState,
          winner: (event.playerId === 0 ? 1 : 0) as 0 | 1,
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
            'expireUpkeepMods',
            'refreshAllCards',
            'tickStatuses',
            { type: 'fireScheduled', params: { timing: 'next_turn_start' as const } },
            { type: 'fireScheduled', params: { timing: 'next_upkeep' as const } },
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
              target: 'reserveEnergy',
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
              target: 'reserveEnergy',
              actions: 'drawMainCard',
            },
          ],
        },

        // Upkeep step 4 — Reserve Energy Generation (Rulebook 8). Runs after the
        // draws (steps 2/3) and before the Strategy Phase.
        reserveEnergy: {
          entry: 'reserveEnergy',
          always: { target: 'strategy' },
        },

        strategy: {
          entry: { type: 'setPhase', params: { phase: 'strategy' as const } },
          on: {
            PLAYER_ACTION: {
              actions: 'applyPlayerAction',
            },
            END_PHASE: {
              target: 'action',
            },
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
        // return to strategy so the active player continues their turn.
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
            { type: 'fireScheduled', params: { timing: 'end_of_turn' as const } },
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
