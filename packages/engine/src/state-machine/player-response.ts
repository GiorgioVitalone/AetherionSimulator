import type {
  ChoiceOption,
  GameEvent,
  GameState,
  PendingChoice,
  PlayerResponse,
} from '../types/game-state.js';
import { resumePendingResolution } from '../events/index.js';
import { resolveStack } from '../stack/stack-resolver.js';

interface PlayerResponseResult {
  readonly state: GameState;
  readonly pendingChoice: PendingChoice | null;
  readonly events: readonly GameEvent[];
}

export function applyPendingChoiceResponse(
  state: GameState,
  response: PlayerResponse,
): PlayerResponseResult {
  const choice = state.pendingChoice;
  if (choice === null) {
    return { state, pendingChoice: null, events: [] };
  }

  if (choice.type === 'reserve_exhaust') {
    const player = state.players[choice.playerId]!;
    const selectedInstanceIds = getSelectedChoiceOptions(choice, response.selectedOptionIds)
      .flatMap(option => option.instanceId !== undefined ? [option.instanceId] : []);
    const selectedSet = new Set(selectedInstanceIds);
    const newReserve = player.zones.reserve.map(card => {
      if (card !== null && selectedSet.has(card.instanceId)) {
        return { ...card, exhausted: true };
      }
      return card;
    });
    const newPlayers = [...state.players] as [
      typeof state.players[0],
      typeof state.players[1],
    ];
    newPlayers[choice.playerId] = {
      ...player,
      zones: { ...player.zones, reserve: newReserve },
    };

    return {
      state: {
        ...state,
        players: newPlayers,
        pendingChoice: null,
        pendingResolution: null,
      },
      pendingChoice: null,
      events: [],
    };
  }

  if (
    choice.type === 'select_targets' ||
    choice.type === 'choose_one' ||
    choice.type === 'choose_discard'
  ) {
    const resolved = resumePendingResolution(state, response);
    return {
      state: resolved.state,
      pendingChoice: resolved.state.pendingChoice,
      events: resolved.events,
    };
  }

  // Response window: player chose pass or a Counter/Flash card
  if (choice.type === 'response_window') {
    const selectedId = response.selectedOptionIds[0];
    if (selectedId === undefined || selectedId === 'pass') {
      // Pass: resolve the stack
      const resolved = resolveStack({ ...state, pendingChoice: null });
      return {
        state: resolved.state,
        pendingChoice: null,
        events: [...resolved.events],
      };
    }
    // Player selected a Counter/Flash card — for now resolve the stack
    // Full counter chain (push counter to stack, open new window) is a future enhancement
    const resolved = resolveStack({ ...state, pendingChoice: null });
    return {
      state: resolved.state,
      pendingChoice: null,
      events: [...resolved.events],
    };
  }

  return {
    state: {
      ...state,
      pendingChoice: null,
      pendingResolution: null,
    },
    pendingChoice: null,
    events: [],
  };
}

function getSelectedChoiceOptions(
  choice: PendingChoice,
  selectedOptionIds: readonly string[],
): readonly ChoiceOption[] {
  const optionMap = new Map(choice.options.map(option => [option.id, option] as const));
  return selectedOptionIds.flatMap(optionId => {
    const option = optionMap.get(optionId);
    return option === undefined ? [] : [option];
  });
}
