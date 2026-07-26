import { describe, expect, it } from 'vitest';
import { GuardExhaustionError } from '../../src/errors/engine-errors.js';
import { resolveStack } from '../../src/effects/stack-resolver.js';
import { CURRENT_GAME_CONFIG } from '../../src/rules/manifest.js';
import { mockCard, mockGameState } from '../helpers/card-factory.js';

describe('stack resolution failure contracts', () => {
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
