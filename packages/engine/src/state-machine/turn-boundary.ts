/**
 * Authoritative turn-boundary lifecycle.
 *
 * This module owns end-of-turn cleanup, hand-limit continuation, scheduled
 * effects, TURN_END/TURN_START dispatch, player rotation, and turn-scoped
 * resets. Action declaration/resolution remains in actions.ts.
 */
import type {
  CardInstance,
  GameEvent,
  GameState,
  PendingChoice,
  PlayerState,
  TurnBoundaryContinuation,
} from '../types/game-state.js';
import { MAX_HAND_SIZE } from '../types/game-state.js';
import type { ScheduledTiming } from '../types/effects.js';
import { processScheduledEffects } from '../effects/scheduled-handler.js';
import { runAbilityEffects } from '../effects/effect-runner.js';
import { getAllRegisteredTriggers } from '../events/trigger-registry.js';
import { dispatchTriggers } from '../runtime/dispatch.js';
import { stabilizeStateBased } from '../runtime/state-based-stabilizer.js';
import { stampGameEvents } from '../runtime/event-envelope.js';
import { expireModifiers } from '../runtime/modifier-expiry.js';

export function removeTemporaryResources(state: GameState): GameState {
  return updateActivePlayer(state, (player) => ({
    ...player,
    temporaryResources: [],
  }));
}

export function expireEndOfTurnModifiersWithEvents(
  state: GameState,
  actionId = [
    'end-expiry',
    state.rng.seed,
    state.turnNumber,
    state.activePlayerIndex,
  ].join(':'),
): { readonly state: GameState; readonly events: readonly GameEvent[] } {
  const triggerPool = getAllRegisteredTriggers(state);
  const cleared = expireModifiers(
    expireModifiers(state, 0, 'until_end_of_turn'),
    1,
    'until_end_of_turn',
  );
  return stabilizeStateBased(cleared, {
    triggerPool,
    actionId,
    transactionId: actionId,
  });
}

export function expireEndOfTurnModifiers(state: GameState): GameState {
  return expireEndOfTurnModifiersWithEvents(state).state;
}

export function checkHandSize(state: GameState): {
  readonly needsDiscard: boolean;
  readonly count: number;
} {
  const player = state.players[state.activePlayerIndex];
  const excess = player.hand.length - MAX_HAND_SIZE;
  return { needsDiscard: excess > 0, count: Math.max(0, excess) };
}

export function discardCards(
  state: GameState,
  cardIds: readonly string[],
): GameState {
  return updateActivePlayer(state, (player) => {
    const discarded: CardInstance[] = [];
    const remaining = player.hand.filter((card) => {
      if (cardIds.includes(card.instanceId)) {
        discarded.push(card);
        return false;
      }
      return true;
    });
    return {
      ...player,
      hand: remaining,
      discardPile: [...player.discardPile, ...discarded],
    };
  });
}

function withTurnBoundaryContinuation(
  state: GameState,
  stage: TurnBoundaryContinuation['stage'],
  actionId: string,
): GameState {
  if (state.pendingChoice === null) return state;
  return {
    ...state,
    pendingChoice: {
      ...state.pendingChoice,
      turnBoundaryContinuation: { stage, actionId },
    },
  };
}

function continueAfterHandLimit(
  state: GameState,
  actionId: string,
): { readonly state: GameState; readonly events: readonly GameEvent[] } {
  const scheduledRaw = runScheduledEffects(state, 'end_of_turn');
  const scheduled = stampGameEvents(scheduledRaw.state, scheduledRaw.events, {
    actionId,
    transactionId: actionId,
    timing: 'turn_boundary',
  });
  if (scheduled.state.pendingChoice !== null) {
    return {
      state: withTurnBoundaryContinuation(
        scheduled.state,
        'after_end_scheduled',
        actionId,
      ),
      events: scheduled.events,
    };
  }
  if (scheduled.state.winner !== null) return scheduled;
  const boundary = executeTurnBoundary(scheduled.state);
  return {
    state: boundary.state,
    events: [...scheduled.events, ...boundary.events],
  };
}

export function continueEndPhaseBoundary(
  state: GameState,
  actionId: string,
): { readonly state: GameState; readonly events: readonly GameEvent[] } {
  const hand = checkHandSize(state);
  if (!hand.needsDiscard) return continueAfterHandLimit(state, actionId);

  const interactionId = [
    'hand',
    state.rng.seed,
    state.turnNumber,
    state.activePlayerIndex,
    state.eventSequence ?? 0,
  ].join(':');
  const player = state.players[state.activePlayerIndex];
  const choice: PendingChoice = {
    interactionId,
    validationToken: interactionId,
    type: 'discard_to_hand_limit',
    playerId: state.activePlayerIndex,
    options: player.hand.map((card) => ({
      id: card.instanceId,
      label: card.name,
      instanceId: card.instanceId,
    })),
    minSelections: hand.count,
    maxSelections: hand.count,
    context: `Discard ${String(hand.count)} card(s) to meet hand size limit.`,
    optional: false,
    visibility: 'controller',
    turnBoundaryContinuation: { stage: 'after_hand_limit', actionId },
  };
  const requested = stampGameEvents(
    { ...state, pendingChoice: choice },
    [
      {
        type: 'CHOICE_REQUESTED',
        interactionId,
        playerId: choice.playerId,
        choiceType: choice.type,
      },
    ],
    { actionId, transactionId: actionId, timing: 'interaction' },
  );
  return { state: requested.state, events: requested.events };
}

export function passTurn(state: GameState): GameState {
  const nextPlayer = state.activePlayerIndex === 0 ? 1 : 0;
  return {
    ...state,
    activePlayerIndex: nextPlayer,
    turnNumber: state.turnNumber + 1,
    turnState: { discardedForEnergy: false, firstPlayerFirstTurn: false },
    players: resetTurnScopedPlayers(
      rechargeTurnScopedState(clearCostReductions(state.players), state.config),
      state.config,
    ),
  };
}

function resetTurnScopedPlayers(
  players: [PlayerState, PlayerState],
  config: GameState['config'],
): [PlayerState, PlayerState] {
  if (config?.scopedTurnResets !== true) return players;
  const reset = (player: PlayerState): PlayerState => ({
    ...player,
    turnCounters: {
      spellsCast: 0,
      equipmentPlayed: 0,
      charactersDeployed: 0,
      abilitiesActivated: 0,
    },
  });
  return [reset(players[0]), reset(players[1])];
}

export function executeTurnBoundary(state: GameState): {
  readonly state: GameState;
  readonly events: readonly GameEvent[];
} {
  const actionId = [
    'turn-boundary',
    state.rng.seed,
    state.turnNumber,
    state.activePlayerIndex,
  ].join(':');
  const stampedEnd = stampGameEvents(
    state,
    [
      {
        type: 'TURN_END',
        playerId: state.activePlayerIndex,
        turnNumber: state.turnNumber,
      },
    ],
    { actionId, transactionId: actionId, timing: 'turn_boundary' },
  );
  const turnEnd = stampedEnd.events[0]!;
  const endPool = getAllRegisteredTriggers(state);
  const ended = dispatchTriggers(stampedEnd.state, [turnEnd], 0, endPool);
  if (ended.newState.pendingChoice !== null) {
    return {
      state: {
        ...ended.newState,
        pendingChoice: {
          ...ended.newState.pendingChoice,
          turnBoundaryContinuation: { stage: 'after_turn_end', actionId },
        },
      },
      events: [turnEnd, ...ended.events],
    };
  }
  const stabilizedEnd = stabilizeStateBased(ended.newState, {
    triggerPool: endPool,
    actionId,
    transactionId: actionId,
  });
  if (stabilizedEnd.state.pendingChoice !== null) {
    return {
      state: {
        ...stabilizedEnd.state,
        pendingChoice: {
          ...stabilizedEnd.state.pendingChoice,
          turnBoundaryContinuation: { stage: 'after_turn_end', actionId },
        },
      },
      events: [turnEnd, ...ended.events, ...stabilizedEnd.events],
    };
  }
  const continued = resumeTurnBoundary(stabilizedEnd.state, {
    stage: 'after_turn_end',
    actionId,
  });
  return {
    state: continued.state,
    events: [
      turnEnd,
      ...ended.events,
      ...stabilizedEnd.events,
      ...continued.events,
    ],
  };
}

export function resumeTurnBoundary(
  state: GameState,
  continuation: NonNullable<PendingChoice['turnBoundaryContinuation']>,
): { readonly state: GameState; readonly events: readonly GameEvent[] } {
  if (continuation.stage === 'after_end_expiry') {
    return continueEndPhaseBoundary(state, continuation.actionId);
  }
  if (continuation.stage === 'after_hand_limit') {
    return continueAfterHandLimit(state, continuation.actionId);
  }
  if (continuation.stage === 'after_end_scheduled') {
    return executeTurnBoundary(state);
  }
  if (continuation.stage === 'after_turn_start') {
    return stabilizeStateBased(state, {
      actionId: continuation.actionId,
      transactionId: continuation.actionId,
    });
  }
  const next = passTurn(state);
  const stampedStart = stampGameEvents(
    next,
    [
      {
        type: 'TURN_START',
        playerId: next.activePlayerIndex,
        turnNumber: next.turnNumber,
      },
    ],
    {
      actionId: continuation.actionId,
      transactionId: continuation.actionId,
      timing: 'turn_boundary',
    },
  );
  const turnStart = stampedStart.events[0]!;
  const startPool = getAllRegisteredTriggers(next);
  const started = dispatchTriggers(stampedStart.state, [turnStart], 0, startPool);
  if (started.newState.pendingChoice !== null) {
    return {
      state: {
        ...started.newState,
        pendingChoice: {
          ...started.newState.pendingChoice,
          turnBoundaryContinuation: {
            stage: 'after_turn_start',
            actionId: continuation.actionId,
          },
        },
      },
      events: [turnStart, ...started.events],
    };
  }
  const stabilizedStart = stabilizeStateBased(started.newState, {
    triggerPool: startPool,
    actionId: continuation.actionId,
    transactionId: continuation.actionId,
  });
  if (stabilizedStart.state.pendingChoice !== null) {
    return {
      state: {
        ...stabilizedStart.state,
        pendingChoice: {
          ...stabilizedStart.state.pendingChoice,
          turnBoundaryContinuation: {
            stage: 'after_turn_start',
            actionId: continuation.actionId,
          },
        },
      },
      events: [turnStart, ...started.events, ...stabilizedStart.events],
    };
  }
  return {
    state: stabilizedStart.state,
    events: [turnStart, ...started.events, ...stabilizedStart.events],
  };
}

function rechargeTurnScopedState(
  players: [PlayerState, PlayerState],
  config: GameState['config'],
): [PlayerState, PlayerState] {
  const arm = config?.armFirstInstanceOnly === true;
  const shield = config?.shieldFirstInstanceOnly === true;
  const forceCap = (config?.defenderForceCap ?? 0) > 0;
  if (!arm && !shield && !forceCap) return players;
  const clearCard = (card: CardInstance | null): CardInstance | null => {
    if (card === null) return card;
    const armDirty = arm && card.armMitigatedThisTurn === true;
    const shieldDirty = shield && card.shieldMitigatedThisTurn === true;
    const forceDirty = forceCap && (card.forcedAttacksThisTurn ?? 0) !== 0;
    if (!armDirty && !shieldDirty && !forceDirty) return card;
    return {
      ...card,
      ...(armDirty ? { armMitigatedThisTurn: false } : {}),
      ...(shieldDirty ? { shieldMitigatedThisTurn: false } : {}),
      ...(forceDirty ? { forcedAttacksThisTurn: 0 } : {}),
    };
  };
  const clearPlayer = (player: PlayerState): PlayerState => ({
    ...player,
    hero:
      arm && player.hero.armMitigatedThisTurn === true
        ? { ...player.hero, armMitigatedThisTurn: false }
        : player.hero,
    zones: {
      reserve: player.zones.reserve.map(clearCard),
      frontline: player.zones.frontline.map(clearCard),
      highGround: player.zones.highGround.map(clearCard),
    },
  });
  return [clearPlayer(players[0]), clearPlayer(players[1])];
}

function clearCostReductions(
  players: readonly [PlayerState, PlayerState],
): [PlayerState, PlayerState] {
  return [
    { ...players[0], costReductions: undefined },
    { ...players[1], costReductions: undefined },
  ];
}

export function runScheduledEffects(
  state: GameState,
  timing: ScheduledTiming['type'],
): { readonly state: GameState; readonly events: readonly GameEvent[] } {
  const triggerPool = getAllRegisteredTriggers(state);
  const processed = processScheduledEffects(
    state,
    timing,
    (current, sourceId, controllerId, effects) =>
      runAbilityEffects(current, sourceId, effects, controllerId),
  );
  if (processed.events.length === 0 && processed.state === state) {
    return { state, events: [] };
  }
  const dispatched = dispatchTriggers(
    processed.state,
    processed.events,
    0,
    triggerPool,
  );
  if (dispatched.newState.pendingChoice !== null) {
    return {
      state: dispatched.newState,
      events: [...processed.events, ...dispatched.events],
    };
  }
  const stabilized = stabilizeStateBased(dispatched.newState, { triggerPool });
  return {
    state: stabilized.state,
    events: [...processed.events, ...dispatched.events, ...stabilized.events],
  };
}

function setPlayer(
  state: GameState,
  index: 0 | 1,
  player: PlayerState,
): GameState {
  const players = [...state.players] as [PlayerState, PlayerState];
  players[index] = player;
  return { ...state, players };
}

function updateActivePlayer(
  state: GameState,
  updater: (player: PlayerState) => PlayerState,
): GameState {
  return setPlayer(
    state,
    state.activePlayerIndex,
    updater(state.players[state.activePlayerIndex]),
  );
}
