import type { GameEvent, GameState } from '../types/game-state.js';

export interface EventCause {
  readonly parentEventId?: string;
  readonly actionId?: string;
  readonly transactionId?: string;
  readonly timing?: NonNullable<GameEvent['timing']>;
}

/** Stamp a current-rules event batch with immutable, replay-safe causal metadata. */
export function stampGameEvents(
  state: GameState,
  events: readonly GameEvent[],
  cause: EventCause = {},
): { readonly state: GameState; readonly events: readonly GameEvent[] } {
  if (events.length === 0 || state.config?.authoritativeTransitions !== true) {
    return { state, events };
  }
  let sequence = state.eventSequence ?? 0;
  const stamped = events.map((event): GameEvent => {
    const alreadyStamped = event.eventId !== undefined && event.sequence !== undefined;
    const eventSequence = event.sequence ?? sequence;
    sequence = alreadyStamped
      ? Math.max(sequence, eventSequence + 1)
      : Math.max(sequence + 1, eventSequence + 1);
    const eventId =
      event.eventId ??
      [
        'event',
        state.rng.seed,
        state.turnNumber,
        eventSequence,
        event.type,
      ].join(':');
    const playerId = 'playerId' in event ? event.playerId : undefined;
    const cardInstanceId =
      'cardInstanceId' in event ? event.cardInstanceId : undefined;
    const sourceId =
      'sourceId' in event
        ? event.sourceId
        : 'attackerId' in event
          ? event.attackerId
          : cardInstanceId;
    const affected = affectedIds(event);
    return {
      ...event,
      eventId,
      sequence: eventSequence,
      turnNumber: event.turnNumber ?? state.turnNumber,
      phase: event.phase ?? state.phase,
      timing: event.timing ?? cause.timing ?? inferTiming(event),
      ...(event.parentEventId !== undefined || cause.parentEventId === undefined
        ? {}
        : { parentEventId: cause.parentEventId }),
      ...(event.actionId !== undefined || cause.actionId === undefined
        ? {}
        : { actionId: cause.actionId }),
      ...(event.transactionId !== undefined || cause.transactionId === undefined
        ? {}
        : { transactionId: cause.transactionId }),
      ...(event.actorPlayerId !== undefined || playerId === undefined
        ? {}
        : { actorPlayerId: playerId }),
      ...(event.sourceInstanceId !== undefined || sourceId === undefined
        ? {}
        : { sourceInstanceId: sourceId }),
      ...(event.sourceCardDefId !== undefined ||
      !('cardDefId' in event) ||
      event.cardDefId === undefined
        ? {}
        : { sourceCardDefId: event.cardDefId }),
      ...(event.affectedInstanceIds !== undefined || affected.length === 0
        ? {}
        : { affectedInstanceIds: affected }),
    };
  });
  return {
    state: sequence === state.eventSequence ? state : { ...state, eventSequence: sequence },
    events: stamped,
  };
}

function affectedIds(event: GameEvent): readonly string[] {
  if (
    'equipmentId' in event &&
    typeof event.equipmentId === 'string' &&
    'targetId' in event &&
    typeof event.targetId === 'string'
  ) {
    return [event.equipmentId, event.targetId];
  }
  if ('targetId' in event && typeof event.targetId === 'string') return [event.targetId];
  if ('equipmentId' in event && typeof event.equipmentId === 'string') {
    return [event.equipmentId];
  }
  if ('cardInstanceId' in event && typeof event.cardInstanceId === 'string') {
    return [event.cardInstanceId];
  }
  if (
    'blockerId' in event &&
    typeof event.blockerId === 'string' &&
    'attackerId' in event &&
    typeof event.attackerId === 'string'
  ) {
    return [event.blockerId, event.attackerId];
  }
  return [];
}

function inferTiming(event: GameEvent): NonNullable<GameEvent['timing']> {
  if (
    event.type === 'SPELL_CAST' ||
    event.type === 'ABILITY_ACTIVATED' ||
    event.type === 'HERO_TRANSFORMED' ||
    event.type === 'CHARACTER_ATTACKED'
  ) {
    return 'declaration';
  }
  if (
    event.type === 'TURN_START' ||
    event.type === 'TURN_END' ||
    event.type === 'PHASE_CHANGED'
  ) {
    return 'turn_boundary';
  }
  if (event.type.startsWith('CHOICE_')) return 'interaction';
  return 'resolution';
}
