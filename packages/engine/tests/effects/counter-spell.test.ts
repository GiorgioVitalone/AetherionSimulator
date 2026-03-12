import { describe, it, expect, beforeEach } from 'vitest';
import {
  pushToStack,
  counterStackItem,
  resolveStack,
} from '../../src/stack/stack-resolver.js';
import type { GameState, StackItem } from '../../src/types/game-state.js';
import {
  mockGameState,
  mockPlayerState,
  mockCard,
  resetInstanceCounter,
  zonesWithCards,
} from '../helpers/card-factory.js';

let state: GameState;

beforeEach(() => {
  resetInstanceCounter();
});

describe('counter spell effect', () => {
  it('should negate a spell on the stack by marking it countered', () => {
    const targetCard = mockCard({ owner: 1 });
    state = mockGameState({
      players: [
        mockPlayerState(0),
        mockPlayerState(1, {
          zones: zonesWithCards({ frontline: [targetCard, null, null] }),
        }),
      ],
      stack: [
        {
          id: 'spell_1',
          type: 'spell',
          sourceInstanceId: 'src_1',
          controllerId: 0,
          effects: [{
            type: 'deal_damage',
            amount: { type: 'fixed', value: 5 },
            target: { type: 'target_character', side: 'enemy' },
          }],
          targets: [targetCard.instanceId],
        },
      ],
    });

    // Counter the spell
    const countered = counterStackItem(state, 'spell_1');

    // Resolve the stack
    const result = resolveStack(countered);

    // No damage should have been dealt
    expect(result.events.filter(e => e.type === 'DAMAGE_DEALT')).toHaveLength(0);
    expect(result.state.stack).toHaveLength(0);
  });

  it('should counter a counter in a chain (counter-war)', () => {
    state = mockGameState({
      players: [
        mockPlayerState(0, { mainDeck: [mockCard({ owner: 0 })] }),
        mockPlayerState(1),
      ],
      stack: [
        {
          id: 'original_spell',
          type: 'spell',
          sourceInstanceId: 'src_1',
          controllerId: 0,
          effects: [{ type: 'draw_cards', count: { type: 'fixed', value: 1 }, player: 'allied' }],
          targets: [],
        },
        {
          id: 'counter_1',
          type: 'counter',
          sourceInstanceId: 'counter_card_1',
          controllerId: 1,
          effects: [],
          targets: [],
        },
      ],
    });

    // Counter the counter (making the original spell resolve)
    let withCounterWar = counterStackItem(state, 'counter_1');
    // Original spell remains uncountered

    const result = resolveStack(withCounterWar);

    // Original spell should resolve (draw card)
    const drawEvents = result.events.filter(e => e.type === 'CARD_DRAWN');
    expect(drawEvents).toHaveLength(1);
  });
});
