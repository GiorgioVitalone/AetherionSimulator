/**
 * Game State Machine (XState v5) — orchestrates the full game lifecycle.
 *
 * States: setup → mulligan → playing (upkeep → strategy → action → end) → game_over
 *
 * The machine holds GameState in context and transforms it via pure actions.
 * When player input is needed, a PendingChoice is stored in context.
 */
import { setup, assign, not } from 'xstate';
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
  resolveTriggeredEvents,
} from '../events/index.js';
import { applyMulligan } from '../setup/game-setup.js';
import { applyPendingChoiceResponse, beginResponseChain } from './player-response.js';
import { pushToStack } from '../stack/stack-resolver.js';
import {
  discardCardsFromHand,
  normalizeGameState,
} from '../state/index.js';

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
    hasReserveExhaustChoice: ({ context }) =>
      context.pendingChoice?.type === 'reserve_exhaust',
    canTransformThisTurn: ({ context }) =>
      context.gameState.phase === 'transform' &&
      context.gameState.pendingChoice === null &&
      context.gameState.winner === null &&
      context.gameState.players[context.gameState.activePlayerIndex] !== undefined &&
      (() => {
        const player = context.gameState.players[context.gameState.activePlayerIndex]!;
        const hero = player.hero;
        if (
          hero.transformed ||
          !hero.canTransformThisGame ||
          hero.transformedThisTurn ||
          hero.transformedCardDefId === null
        ) {
          return false;
        }
        if (hero.currentLp <= 10) {
          return true;
        }
        const opponentIndex = context.gameState.activePlayerIndex === 0 ? 1 : 0;
        const opponent = context.gameState.players[opponentIndex]!;
        const resourceGap = opponent.resourceBank.length - player.resourceBank.length;
        return resourceGap >= 5 && player.zones.reserve.every(card => card === null) &&
          player.zones.frontline.every(card => card === null) &&
          player.zones.highGround.every(card => card === null);
      })(),
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
      const normalized = normalizeGameState(result.state);
      const resolved = resolveTriggeredEvents(normalized.state, [...result.events, ...normalized.events]);
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
      const normalized = normalizeGameState(result.state);
      const resolved = resolveTriggeredEvents(normalized.state, [...result.events, ...normalized.events]);
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
      const normalized = normalizeGameState(result.state);
      const stackResult = result.stackItem === undefined
        ? null
        : beginResponseChain(
          pushToStack(normalized.state, result.stackItem),
          context.gameState.activePlayerIndex,
          [...result.events, ...normalized.events],
        );
      const resolved = result.stackItem === undefined
        ? resolveTriggeredEvents(normalized.state, [...result.events, ...normalized.events])
        : {
            state: stackResult!.state,
            events: stackResult!.events,
          };
      const nextPendingChoice = result.stackItem === undefined
        ? resolved.state.pendingChoice
        : stackResult!.pendingChoice;
      const newState = {
        ...resolved.state,
        log: [...resolved.state.log, ...resolved.events],
      };
      return {
        gameState: newState,
        pendingChoice: newState.winner !== null
          ? null
          : nextPendingChoice !== undefined
            ? nextPendingChoice
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
      const normalized = normalizeGameState(result.state);
      const resolved = resolveTriggeredEvents(normalized.state, [...result.events, ...normalized.events]);
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
      const normalized = normalizeGameState(currentState);
      if (allEvents.length > 0) {
        const resolved = resolveTriggeredEvents(normalized.state, [...allEvents, ...normalized.events]);
        return {
          gameState: {
            ...resolved.state,
            log: [...resolved.state.log, ...resolved.events],
          },
          pendingChoice: resolved.state.pendingChoice,
        };
      }
      return { gameState: normalized.state };
    }),
    processScheduledEndPhase: assign(({ context }) => {
      const result = processScheduledEffects(context.gameState, 'end_of_turn');
      const normalized = normalizeGameState(result.state);
      if (result.events.length > 0) {
        const resolved = resolveTriggeredEvents(normalized.state, [...result.events, ...normalized.events]);
        return {
          gameState: {
            ...resolved.state,
            log: [...resolved.state.log, ...resolved.events],
          },
          pendingChoice: resolved.state.pendingChoice,
        };
      }
      return { gameState: normalized.state };
    }),
    expireModifiers: assign(({ context }) => {
      const result = expireEndOfTurnModifiers(context.gameState);
      const normalized = normalizeGameState(result.state);
      const resolved = resolveTriggeredEvents(normalized.state, [...result.events, ...normalized.events]);
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
    checkReserveExhaust: assign(({ context }) => {
      const player = context.gameState.players[context.gameState.activePlayerIndex]!;
      const readyReserveCards = player.zones.reserve.filter(
        (card): card is NonNullable<typeof card> => card !== null && !card.exhausted,
      );
      if (readyReserveCards.length === 0) {
        return { pendingChoice: null };
      }
      const choice: PendingChoice = {
        type: 'reserve_exhaust',
        playerId: context.gameState.activePlayerIndex,
        options: readyReserveCards.map(c => ({
          id: c.instanceId,
          label: c.name,
          instanceId: c.instanceId,
        })),
        minSelections: 0,
        maxSelections: readyReserveCards.length,
        context: 'Exhaust reserve characters to generate resources.',
      };
      return {
        gameState: { ...context.gameState, pendingChoice: choice },
        pendingChoice: choice,
      };
    }),
    clearPendingChoice: assign({ pendingChoice: null }),
    executeTurnPass: assign(({ context }) => {
      const newState = passTurn(context.gameState);
      const normalized = normalizeGameState(newState);
      const resolved = resolveTriggeredEvents(normalized.state, [
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
        ...normalized.events,
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
      const responseResult = applyPendingChoiceResponse(context.gameState, event.response);
      const shouldResolveResponseEvents =
        responseResult.events.length > 0 &&
        responseResult.state.pendingChoice === null;
      const normalized = normalizeGameState(responseResult.state);
      const resolved = shouldResolveResponseEvents
        ? resolveTriggeredEvents(normalized.state, [...responseResult.events, ...normalized.events])
        : { state: normalized.state, events: [] as readonly never[] };
      return {
        gameState: {
          ...resolved.state,
          log: [...resolved.state.log, ...resolved.events],
        },
        pendingChoice: shouldResolveResponseEvents
          ? resolved.state.pendingChoice
          : responseResult.pendingChoice,
      };
    }),
  },
}).createMachine({
  id: 'aetherionGame',
  context: ({ input }) => {
    const initializedState = registerInitialTriggers(normalizeGameState(input.gameState).state);
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
      always: [
        {
          target: 'chooseFirstPlayer',
          guard: ({ context }) => context.gameState.phase === 'setup',
        },
        {
          target: 'playing',
          guard: ({ context }) => context.gameState.phase === 'upkeep',
        },
      ],
    },

    chooseFirstPlayer: {
      on: {
        PLAYER_RESPONSE: {
          actions: 'applyPlayerResponse',
        },
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
              target: 'reserveExhaust',
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
              target: 'reserveExhaust',
              actions: 'drawMainCard',
            },
          ],
        },

        reserveExhaust: {
          entry: 'checkReserveExhaust',
          always: [
            {
              target: 'transformWindow',
              guard: not('hasReserveExhaustChoice'),
            },
          ],
          on: {
            PLAYER_RESPONSE: {
              target: 'transformWindow',
              actions: ['applyPlayerResponse', 'clearPendingChoice'],
            },
          },
        },

        transformWindow: {
          entry: { type: 'setPhase', params: { phase: 'transform' as const } },
          always: [
            {
              target: 'strategy',
              guard: not('canTransformThisTurn'),
            },
          ],
          on: {
            PLAYER_ACTION: {
              target: 'strategy',
              actions: 'applyPlayerAction',
            },
            END_PHASE: {
              target: 'strategy',
            },
          },
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
          ],
          always: [
            {
              target: 'handSizeCheck',
              guard: { type: 'handExceedsLimit' },
            },
            { target: 'resolveEndPhase' },
          ],
        },

        handSizeCheck: {
          entry: 'setHandSizeChoice',
          on: {
            PLAYER_RESPONSE: {
              target: 'resolveEndPhase',
              actions: [
                assign(({ context, event }) => {
                  if (event.type !== 'PLAYER_RESPONSE') return {};
                  const discarded = discardCardsFromHand(
                    context.gameState,
                    context.gameState.activePlayerIndex,
                    event.response.selectedOptionIds,
                  );
                  return {
                    gameState: discarded.state,
                    pendingChoice: null,
                  };
                }),
              ],
            },
          },
        },

        resolveEndPhase: {
          entry: [
            'expireModifiers',
            'processScheduledEndPhase',
          ],
          always: {
            target: 'passTurn',
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
