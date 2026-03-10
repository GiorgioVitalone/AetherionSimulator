import type {
  ChoiceOption,
  GameEvent,
  GameState,
  PendingChoice,
  PlayerResponse,
  CardInstance,
  StackItem,
  TemporaryResource,
} from '../types/game-state.js';
import type { ResourceType } from '../types/common.js';
import type { Effect } from '../types/effects.js';
import { resumePendingResolution } from '../events/index.js';
import { resolveStack, pushToStack, counterStackItem } from '../stack/stack-resolver.js';
import { canAfford, payCost } from '../actions/cost-checker.js';
import { openResponseWindow } from '../stack/response-window.js';

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
    const events: GameEvent[] = [];
    const generatedResources: TemporaryResource[] = [];
    const newReserve = player.zones.reserve.map(card => {
      if (card !== null && selectedSet.has(card.instanceId)) {
        const resourceType = deriveReserveResourceType(card);
        generatedResources.push({ resourceType, amount: 1 });
        events.push({
          type: 'RESOURCE_GAINED',
          playerId: choice.playerId,
          resourceType,
          amount: 1,
        });
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
      temporaryResources: [
        ...player.temporaryResources,
        ...generatedResources,
      ],
    };

    return {
      state: {
        ...state,
        players: newPlayers,
        pendingChoice: null,
        pendingResolution: null,
      },
      pendingChoice: null,
      events,
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

    // Player selected a Counter/Flash card — play it onto the stack
    const respondingPlayerId = choice.playerId;
    const player = state.players[respondingPlayerId]!;
    const cardIndex = player.hand.findIndex(c => c.instanceId === selectedId);
    if (cardIndex === -1) {
      // Card not found, fall back to resolving the stack
      const resolved = resolveStack({ ...state, pendingChoice: null });
      return { state: resolved.state, pendingChoice: null, events: [...resolved.events] };
    }

    const card = player.hand[cardIndex]!;
    if (!canAfford(player, card.cost)) {
      const resolved = resolveStack({ ...state, pendingChoice: null });
      return { state: resolved.state, pendingChoice: null, events: [...resolved.events] };
    }

    // Pay cost and remove from hand
    const paidPlayer = payCost(player, card.cost);
    const newHand = paidPlayer.hand.filter((_, i) => i !== cardIndex);
    const newPlayer = {
      ...paidPlayer,
      hand: newHand,
      discardPile: [...paidPlayer.discardPile, card],
    };

    const newPlayers = [...state.players] as [typeof state.players[0], typeof state.players[1]];
    newPlayers[respondingPlayerId] = newPlayer;
    let nextState: GameState = { ...state, players: newPlayers, pendingChoice: null };

    // Extract effects from counter/flash abilities
    const responseEffects = extractResponseEffects(card);

    // Check if this is a counter — mark the top stack item as countered
    const isCounter = card.abilities.some(
      a => a.type === 'triggered' && a.trigger.type === 'on_counter',
    );
    if (isCounter && choice.responseContext !== undefined) {
      nextState = counterStackItem(nextState, choice.responseContext.stackItemId);
    }

    // Push counter/flash effects onto the stack
    if (responseEffects.length > 0) {
      const stackItem: StackItem = {
        id: `response_${card.instanceId}`,
        type: isCounter ? 'counter' : 'flash',
        sourceInstanceId: card.instanceId,
        controllerId: respondingPlayerId,
        effects: responseEffects,
        targets: [],
      };
      nextState = pushToStack(nextState, stackItem);
    }

    // Open response window for the other player
    const otherPlayerId = respondingPlayerId === 0 ? 1 : 0;
    const topStackItem = nextState.stack[nextState.stack.length - 1];
    if (topStackItem !== undefined) {
      const windowResult = openResponseWindow(
        { ...nextState, activePlayerIndex: otherPlayerId as 0 | 1 },
        topStackItem.id,
      );
      if (windowResult.pendingChoice !== undefined) {
        // Other player has responses available
        return {
          state: windowResult.newState,
          pendingChoice: windowResult.pendingChoice ?? null,
          events: [{
            type: 'SPELL_CAST',
            cardInstanceId: card.instanceId,
            playerId: respondingPlayerId,
          }],
        };
      }
    }

    // No responses available — resolve the full stack
    const resolved = resolveStack(nextState);
    return {
      state: resolved.state,
      pendingChoice: null,
      events: [
        {
          type: 'SPELL_CAST',
          cardInstanceId: card.instanceId,
          playerId: respondingPlayerId,
        },
        ...resolved.events,
      ],
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

function deriveReserveResourceType(card: CardInstance): ResourceType {
  return card.cost.energy > card.cost.mana ? 'energy' : 'mana';
}

function extractResponseEffects(card: CardInstance): readonly Effect[] {
  const effects: Effect[] = [];
  for (const ability of card.abilities) {
    if (ability.type !== 'triggered') continue;
    if (ability.trigger.type !== 'on_counter' && ability.trigger.type !== 'on_flash') continue;
    effects.push(...ability.effects);
  }
  return effects;
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
