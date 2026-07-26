import { describe, expect, it } from 'vitest';
import { registerCardTriggers } from '../../src/events/trigger-registry.js';
import { CURRENT_GAME_CONFIG } from '../../src/rules/index.js';
import { dispatchTriggers } from '../../src/runtime/dispatch.js';
import { transition } from '../../src/transitions/index.js';
import type { AbilityDSL } from '../../src/types/ability.js';
import type { GameEvent, GameState } from '../../src/types/game-state.js';
import {
  mockCard,
  mockGameState,
  mockPlayerState,
  zonesWithCards,
} from '../helpers/card-factory.js';

const gain: AbilityDSL = {
  type: 'triggered',
  trigger: { type: 'on_turn_start' },
  effects: [
    {
      type: 'gain_resource',
      resourceType: 'energy',
      amount: 1,
    },
  ],
};

const conditionalDraw: AbilityDSL = {
  type: 'triggered',
  trigger: { type: 'on_turn_start' },
  condition: {
    type: 'resource_check',
    resourceType: 'energy',
    comparison: 'greater_equal',
    value: 1,
  },
  effects: [
    {
      type: 'draw_cards',
      count: { type: 'fixed', value: 1 },
      player: 'allied',
    },
  ],
};

function orderingState(reverse = false): GameState {
  const a = mockCard({
    instanceId: 'a-gain',
    owner: 0,
    abilities: [gain],
  });
  const b = mockCard({
    instanceId: 'b-draw',
    owner: 0,
    abilities: [conditionalDraw],
  });
  const frontline = reverse ? [b, a, null] : [a, b, null];
  let state = mockGameState({
    config: CURRENT_GAME_CONFIG,
    players: [
      mockPlayerState(0, {
        zones: zonesWithCards({ frontline }),
        mainDeck: [mockCard({ instanceId: 'drawn', owner: 0 })],
      }),
      mockPlayerState(1),
    ],
  });
  state = registerCardTriggers(state, 'a-gain');
  state = registerCardTriggers(state, 'b-draw');
  return state;
}

function request(state: GameState) {
  const event: GameEvent = {
    type: 'TURN_START',
    playerId: 0,
    turnNumber: state.turnNumber,
  };
  const result = dispatchTriggers(state, [event], 0);
  expect(result.newState.pendingChoice?.type).toBe('choose_trigger_order');
  return result;
}

function respond(
  state: GameState,
  selectedOptionIds: readonly string[],
) {
  const pending = state.pendingChoice!;
  return transition(state, {
    type: 'choice_response',
    interactionId: pending.interactionId!,
    playerId: pending.playerId,
    response: { selectedOptionIds },
  });
}

describe('APNAP owner-selected simultaneous trigger order', () => {
  it('supports both legal owner orders with observably different outcomes', () => {
    const gainFirst = request(orderingState());
    const gainThenDraw = respond(gainFirst.newState, [
      'trigger:a-gain:0',
      'trigger:b-draw:0',
    ]);
    expect(gainThenDraw.status).toBe('resolved');
    expect(gainThenDraw.state.players[0].hand).toHaveLength(1);

    const drawFirst = request(orderingState());
    const drawThenGain = respond(drawFirst.newState, [
      'trigger:b-draw:0',
      'trigger:a-gain:0',
    ]);
    expect(drawThenGain.status).toBe('resolved');
    expect(drawThenGain.state.players[0].hand).toHaveLength(0);
    expect(drawThenGain.state.players[0].resourceBank).toHaveLength(1);
  });

  it('offers a stable deterministic option surface under battlefield data reordering', () => {
    const normal = request(orderingState(false)).newState.pendingChoice!;
    const reversed = request(orderingState(true)).newState.pendingChoice!;
    expect(normal.options.map((option) => option.id)).toEqual([
      'trigger:a-gain:0',
      'trigger:b-draw:0',
    ]);
    expect(reversed.options).toEqual(normal.options);
    expect(reversed.interactionId).toBe(normal.interactionId);
  });

  it('rejects incomplete trigger permutations without mutation', () => {
    const requested = request(orderingState()).newState;
    const pending = requested.pendingChoice!;
    const result = transition(requested, {
      type: 'choice_response',
      interactionId: pending.interactionId!,
      playerId: pending.playerId,
      response: { selectedOptionIds: ['trigger:a-gain:0'] },
    });
    expect(result.status).toBe('rejected');
    expect(result.state).toBe(requested);
  });

  it('prompts the active player group first, then the non-active player group', () => {
    const watcherAbility: AbilityDSL = {
      type: 'triggered',
      trigger: { type: 'on_stat_modified' },
      effects: [{ type: 'gain_resource', resourceType: 'energy', amount: 1 }],
    };
    const p0a = mockCard({ instanceId: 'p0-a', owner: 0, abilities: [watcherAbility] });
    const p0b = mockCard({ instanceId: 'p0-b', owner: 0, abilities: [watcherAbility] });
    const p1a = mockCard({ instanceId: 'p1-a', owner: 1, abilities: [watcherAbility] });
    const p1b = mockCard({ instanceId: 'p1-b', owner: 1, abilities: [watcherAbility] });
    let state = mockGameState({
      config: CURRENT_GAME_CONFIG,
      activePlayerIndex: 0,
      players: [
        mockPlayerState(0, {
          zones: zonesWithCards({ frontline: [p0a, p0b, null] }),
        }),
        mockPlayerState(1, {
          zones: zonesWithCards({ frontline: [p1a, p1b, null] }),
        }),
      ],
    });
    for (const id of ['p0-a', 'p0-b', 'p1-a', 'p1-b']) {
      state = registerCardTriggers(state, id);
    }
    const dispatched = dispatchTriggers(
      state,
      [
        {
          type: 'STAT_MODIFIED',
          cardInstanceId: 'p0-a',
          modifier: { atk: 1 },
          playerId: 0,
        },
      ],
      0,
    );
    expect(dispatched.newState.pendingChoice?.playerId).toBe(0);
    const activeOrdered = respond(dispatched.newState, [
      'trigger:p0-a:0',
      'trigger:p0-b:0',
    ]);
    expect(activeOrdered.status).toBe('pending');
    expect(activeOrdered.state.pendingChoice?.type).toBe('choose_trigger_order');
    expect(activeOrdered.state.pendingChoice?.playerId).toBe(1);
    const nonActiveOrdered = respond(activeOrdered.state, [
      'trigger:p1-b:0',
      'trigger:p1-a:0',
    ]);
    expect(nonActiveOrdered.status).toBe('resolved');
    expect(nonActiveOrdered.state.players[0].resourceBank).toHaveLength(2);
    expect(nonActiveOrdered.state.players[1].resourceBank).toHaveLength(2);
  });
});
