import { createActor } from 'xstate';
import { describe, expect, it } from 'vitest';
import { CURRENT_GAME_CONFIG } from '../../src/rules/manifest.js';
import {
  expireUpkeepModifiersWithEvents,
} from '../../src/state-machine/actions.js';
import { gameMachine } from '../../src/state-machine/game-machine.js';
import { transition } from '../../src/transitions/transition.js';
import type {
  CardInstance,
  GrantedDuration,
  ResourceCard,
} from '../../src/types/game-state.js';
import {
  mockCard,
  mockGameState,
  mockPlayerState,
  zonesWithCards,
} from '../helpers/card-factory.js';

function resources(prefix: string, count = 4): ResourceCard[] {
  return Array.from({ length: count }, (_, index) => ({
    instanceId: `${prefix}-resource-${String(index)}`,
    resourceType: 'mana',
    exhausted: false,
  }));
}

function expiryVictim(duration: GrantedDuration): CardInstance {
  return mockCard({
    instanceId: `expiry-victim-${duration.type}`,
    owner: 0,
    baseHp: 1,
    currentHp: 2,
    modifiers: [
      {
        id: `expiry-modifier-${duration.type}`,
        sourceInstanceId: 'expiry-buff-source',
        modifier: { hp: 2 },
        duration,
      },
    ],
    registeredTriggers: [
      {
        id: `expiry-victim:${duration.type}:last-breath`,
        sourceInstanceId: `expiry-victim-${duration.type}`,
        ownerPlayerId: 0,
        trigger: { type: 'on_destroy' },
        effects: [
          {
            type: 'choose_one',
            options: [
              {
                label: 'One',
                effects: [{
                  type: 'heal',
                  amount: { type: 'fixed', value: 1 },
                  target: { type: 'owner_hero' },
                }],
              },
              {
                label: 'Two',
                effects: [{
                  type: 'heal',
                  amount: { type: 'fixed', value: 2 },
                  target: { type: 'owner_hero' },
                }],
              },
            ],
          },
        ],
        abilityIndex: 0,
      },
    ],
  });
}

function boundaryState(
  phase: 'upkeep' | 'action',
  victim: CardInstance,
) {
  return mockGameState({
    phase,
    activePlayerIndex: 0,
    turnNumber: 4,
    config: CURRENT_GAME_CONFIG,
    players: [
      mockPlayerState(0, {
        zones: zonesWithCards({ frontline: [victim] }),
        mainDeck: [
          mockCard({ instanceId: 'p0-main-0', owner: 0 }),
          mockCard({ instanceId: 'p0-main-1', owner: 0 }),
        ],
        resourceDeck: resources('p0'),
      }),
      mockPlayerState(1, {
        mainDeck: [
          mockCard({ instanceId: 'p1-main-0', owner: 1 }),
          mockCard({ instanceId: 'p1-main-1', owner: 1 }),
        ],
        resourceDeck: resources('p1'),
      }),
    ],
  });
}

describe('eventful, pause-safe modifier expiry', () => {
  it('emits and dispatches state-based deaths caused by upkeep expiry', () => {
    const result = expireUpkeepModifiersWithEvents(
      boundaryState(
        'upkeep',
        expiryVictim({ type: 'until_next_upkeep' }),
      ),
    );

    expect(result.events.map((event) => event.type)).toContain('CARD_DESTROYED');
    expect(result.events.every((event) => event.eventId !== undefined)).toBe(true);
    expect(result.state.pendingChoice?.type).toBe('choose_one');
  });

  it('pauses automatic upkeep before draws until the expiry choice resolves', () => {
    const initial = boundaryState(
      'upkeep',
      expiryVictim({ type: 'until_next_upkeep' }),
    );
    const initialMainCount = initial.players[0].mainDeck.length;
    const initialResourceCount = initial.players[0].resourceDeck.length;
    const actor = createActor(gameMachine, { input: { gameState: initial } });
    actor.start();

    const paused = actor.getSnapshot();
    expect(paused.matches({ playing: 'upkeepExpiryInteraction' })).toBe(true);
    expect(paused.context.gameState.players[0].mainDeck).toHaveLength(initialMainCount);
    expect(paused.context.gameState.players[0].resourceDeck).toHaveLength(
      initialResourceCount,
    );

    const choice = paused.context.gameState.pendingChoice!;
    actor.send({
      type: 'PLAYER_RESPONSE',
      interactionId: choice.interactionId,
      playerId: choice.playerId,
      response: { selectedOptionIds: [choice.options[0]!.id] },
    });

    const resumed = actor.getSnapshot();
    expect(resumed.matches({ playing: 'reserveEnergyChoice' })).toBe(true);
    expect(resumed.context.gameState.pendingChoice).toBeNull();
    expect(resumed.context.gameState.players[0].mainDeck).toHaveLength(
      initialMainCount - 1,
    );
    expect(resumed.context.gameState.players[0].resourceDeck).toHaveLength(
      initialResourceCount - 1,
    );
    expect(resumed.context.gameState.turnState.upkeepActionWindow).toBe(
      'reserve_energy',
    );
    actor.send({ type: 'END_PHASE' });
    expect(
      actor.getSnapshot().matches({ playing: 'startOfTurnTransform' }),
    ).toBe(true);
  });

  it('pauses authoritative end expiry before passing the turn and resumes once', () => {
    const initial = boundaryState(
      'action',
      expiryVictim({ type: 'until_end_of_turn' }),
    );
    const pending = transition(initial, {
      type: 'advance_phase',
      playerId: 0,
    });

    expect(pending.status).toBe('pending');
    expect(pending.state.phase).toBe('end');
    expect(pending.state.activePlayerIndex).toBe(0);
    expect(pending.state.turnNumber).toBe(4);
    expect(pending.events.map((event) => event.type)).toContain('CARD_DESTROYED');
    const choice = pending.state.pendingChoice!;
    expect(choice.turnBoundaryContinuation?.stage).toBe('after_end_expiry');

    const resumed = transition(pending.state, {
      type: 'choice_response',
      interactionId: choice.interactionId!,
      playerId: choice.playerId,
      response: { selectedOptionIds: [choice.options[0]!.id] },
    });

    expect(resumed.status).toBe('resolved');
    expect(resumed.state.pendingChoice).toBeNull();
    expect(resumed.state.activePlayerIndex).toBe(1);
    expect(resumed.state.turnNumber).toBe(5);
    expect(
      resumed.events.filter((event) => event.type === 'TURN_START'),
    ).toHaveLength(1);
  });
});
