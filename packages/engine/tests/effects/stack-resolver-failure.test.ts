import { describe, expect, it } from 'vitest';
import { GuardExhaustionError } from '../../src/errors/engine-errors.js';
import { resolveStack } from '../../src/effects/stack-resolver.js';
import { CURRENT_GAME_CONFIG } from '../../src/rules/manifest.js';
import { transition } from '../../src/transitions/transition.js';
import type { StackItem } from '../../src/types/game-state.js';
import {
  mockCard,
  mockGameState,
  mockPlayerState,
} from '../helpers/card-factory.js';

describe('stack resolution failure contracts', () => {
  it('pauses the LIFO chain until an effect choice is answered', () => {
    const lower: StackItem = {
      id: 'lower-burn',
      type: 'spell',
      sourceInstanceId: 'burn',
      controllerId: 0,
      effects: [
        {
          type: 'deal_damage',
          amount: { type: 'fixed', value: 4 },
          target: { type: 'hero', side: 'enemy' },
        },
      ],
      targets: [],
    };
    const upper: StackItem = {
      id: 'upper-choice',
      type: 'spell',
      sourceInstanceId: 'choice',
      controllerId: 1,
      effects: [
        {
          type: 'choose_one',
          options: [
            {
              label: 'Heal 5',
              effects: [
                {
                  type: 'heal',
                  amount: { type: 'fixed', value: 5 },
                  target: { type: 'owner_hero' },
                },
              ],
            },
            { label: 'Do nothing', effects: [] },
          ],
        },
      ],
      targets: [],
    };
    const state = mockGameState({
      config: CURRENT_GAME_CONFIG,
      players: [
        mockPlayerState(0),
        mockPlayerState(1, {
          hero: {
            ...mockPlayerState(1).hero,
            currentLp: 22,
            maxLp: 25,
          },
        }),
      ],
      stack: [lower, upper],
    });

    const paused = resolveStack(state);
    expect(paused.state.pendingChoice?.type).toBe('choose_one');
    expect(paused.state.stack.map((item) => item.id)).toEqual(['lower-burn']);
    expect(paused.state.players[1].hero.currentLp).toBe(22);

    const choice = paused.state.pendingChoice!;
    const resumed = transition(paused.state, {
      type: 'choice_response',
      interactionId: choice.interactionId!,
      playerId: choice.playerId,
      response: { selectedOptionIds: ['0'] },
    });
    expect(resumed.status).toBe('resolved');
    expect(resumed.state.stack).toEqual([]);
    // Correct LIFO: heal 22→25, then lower burn 25→21. Resolving the lower
    // item before the choice would instead produce 22→18→23.
    expect(resumed.state.players[1].hero.currentLp).toBe(21);
  });

  it('discards a transactionally declared equipment whose target became illegal', () => {
    const equipment = mockCard({
      instanceId: 'declared-equipment',
      cardType: 'E',
      owner: 0,
    });
    const state = mockGameState({
      config: CURRENT_GAME_CONFIG,
      stack: [
        {
          id: 'equip-item',
          type: 'equip',
          sourceInstanceId: equipment.instanceId,
          sourceCardDefId: equipment.cardDefId,
          controllerId: 0,
          effects: [],
          targets: ['missing-target'],
          declaredCard: equipment,
        },
      ],
    });

    const result = resolveStack(state);
    expect(result.state.stack).toEqual([]);
    expect(result.state.players[0].discardPile).toContainEqual(
      expect.objectContaining({ instanceId: equipment.instanceId }),
    );
    expect(result.events.map((event) => event.type)).toEqual([
      'EQUIPMENT_DISCARDED',
      'STACK_ITEM_FIZZLED',
    ]);
  });

  it('exposes guard exhaustion as a typed error class', () => {
    const error = new GuardExhaustionError('bounded loop exhausted');
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('GuardExhaustionError');
    expect(error.message).toBe('bounded loop exhausted');
  });
});
