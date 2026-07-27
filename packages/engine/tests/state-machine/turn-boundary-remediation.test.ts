import { describe, expect, it } from 'vitest';
import { executeTurnBoundary, passTurn } from '../../src/state-machine/actions.js';
import { transition } from '../../src/transitions/index.js';
import { CURRENT_GAME_CONFIG } from '../../src/rules/index.js';
import {
  mockCard,
  mockGameState,
  mockPlayerState,
  zonesWithCards,
} from '../helpers/card-factory.js';

describe('current-rules turn boundary', () => {
  it('resets every turn-scoped counter', () => {
    const counters = {
      spellsCast: 3,
      equipmentPlayed: 2,
      charactersDeployed: 4,
      abilitiesActivated: 5,
    };
    const state = mockGameState({
      config: {
        terminationMode: 'resource_deck_empty_transform',
        scopedTurnResets: true,
      },
      players: [
        mockPlayerState(0, { turnCounters: counters }),
        mockPlayerState(1, { turnCounters: counters }),
      ],
    });
    const next = passTurn(state);
    expect(next.players[0].turnCounters).toEqual({
      spellsCast: 0,
      equipmentPlayed: 0,
      charactersDeployed: 0,
      abilitiesActivated: 0,
    });
    expect(next.players[1].turnCounters).toEqual(next.players[0].turnCounters);
  });

  it('dispatches printed turn-start triggers through the ordinary runtime', () => {
    const source = mockCard({
      instanceId: 'turn-source',
      owner: 1,
      registeredTriggers: [
        {
          id: 'turn-source:start',
          sourceInstanceId: 'turn-source',
          ownerPlayerId: 1,
          trigger: { type: 'on_turn_start' },
          effects: [
            {
              type: 'gain_resource',
              resourceType: 'mana',
              amount: 1,
              temporary: true,
            },
          ],
          abilityIndex: 0,
        },
      ],
    });
    const state = mockGameState({
      activePlayerIndex: 0,
      turnNumber: 7,
      config: {
        ...CURRENT_GAME_CONFIG,
      },
      players: [
        mockPlayerState(0),
        mockPlayerState(1, {
          zones: zonesWithCards({ reserve: [source, null] }),
        }),
      ],
    });

    const result = executeTurnBoundary(state);
    expect(result.state.activePlayerIndex).toBe(1);
    expect(result.events.map((event) => event.type)).toContain('TURN_START');
    expect(result.events.map((event) => event.type)).toContain('RESOURCE_GAINED');
    expect(result.state.players[1].temporaryResources).toEqual([
      { resourceType: 'mana', amount: 1 },
    ]);
    expect(result.events.every((event) => event.eventId !== undefined)).toBe(true);
    expect(
      result.events.filter(
        (event) => event.type === 'TURN_END' || event.type === 'TURN_START',
      ).every((event) => event.timing === 'turn_boundary'),
    ).toBe(true);
  });

  it('pauses a turn-end trigger choice before switching players, then resumes the boundary once', () => {
    const source = mockCard({
      instanceId: 'turn-choice-source',
      owner: 0,
      registeredTriggers: [
        {
          id: 'trigger:turn-choice-source:0',
          sourceInstanceId: 'turn-choice-source',
          ownerPlayerId: 0,
          trigger: { type: 'on_turn_end' },
          effects: [
            {
              type: 'choose_one',
              options: [
                {
                  label: 'One',
                  effects: [
                    {
                      type: 'heal',
                      amount: { type: 'fixed', value: 1 },
                      target: { type: 'owner_hero' },
                    },
                  ],
                },
                {
                  label: 'Two',
                  effects: [
                    {
                      type: 'heal',
                      amount: { type: 'fixed', value: 2 },
                      target: { type: 'owner_hero' },
                    },
                  ],
                },
              ],
            },
          ],
          abilityIndex: 0,
        },
      ],
    });
    const state = mockGameState({
      activePlayerIndex: 0,
      turnNumber: 7,
      config: CURRENT_GAME_CONFIG,
      players: [
        mockPlayerState(0, {
          hero: { ...mockPlayerState(0).hero, currentLp: 10 },
          zones: zonesWithCards({ reserve: [source, null] }),
        }),
        mockPlayerState(1),
      ],
    });
    const paused = executeTurnBoundary(state);
    expect(paused.state.activePlayerIndex).toBe(0);
    expect(paused.state.turnNumber).toBe(7);
    expect(paused.state.pendingChoice?.turnBoundaryContinuation?.stage).toBe(
      'after_turn_end',
    );

    const choice = paused.state.pendingChoice!;
    const resumed = transition(paused.state, {
      type: 'choice_response',
      interactionId: choice.interactionId!,
      playerId: 0,
      response: { selectedOptionIds: ['1'] },
    });
    expect(resumed.status).toBe('resolved');
    expect(resumed.state.activePlayerIndex).toBe(1);
    expect(resumed.state.turnNumber).toBe(8);
    expect(resumed.state.players[0].hero.currentLp).toBe(12);
    expect(
      resumed.events.filter((event) => event.type === 'TURN_START'),
    ).toHaveLength(1);
  });
});
