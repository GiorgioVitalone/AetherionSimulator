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
} from '../helpers/card-factory.js';

let state: GameState;

beforeEach(() => {
  resetInstanceCounter();
});

function makeStackItem(overrides?: Partial<StackItem>): StackItem {
  return {
    id: 'stack_1',
    type: 'spell',
    sourceInstanceId: 'src_1',
    controllerId: 0,
    effects: [],
    targets: [],
    ...overrides,
  };
}

describe('pushToStack', () => {
  it('should add an item to the stack', () => {
    state = mockGameState();
    const item = makeStackItem();

    const result = pushToStack(state, item);
    expect(result.stack).toHaveLength(1);
    expect(result.stack[0]!.id).toBe('stack_1');
  });
});

describe('counterStackItem', () => {
  it('should mark the target item as countered', () => {
    state = mockGameState({
      stack: [makeStackItem({ id: 'stack_1' }), makeStackItem({ id: 'stack_2' })],
    });

    const result = counterStackItem(state, 'stack_1');
    expect(result.stack[0]!.countered).toBe(true);
    expect(result.stack[1]!.countered).toBeUndefined();
  });
});

describe('resolveStack', () => {
  it('should resolve items in LIFO order', () => {
    const card1 = mockCard({ owner: 0 });
    const card2 = mockCard({ owner: 0 });

    state = mockGameState({
      players: [
        mockPlayerState(0, {
          mainDeck: [card1, card2],
        }),
        mockPlayerState(1),
      ],
      stack: [
        makeStackItem({
          id: 'first',
          effects: [{ type: 'draw_cards', count: { type: 'fixed', value: 1 }, player: 'allied' }],
        }),
        makeStackItem({
          id: 'second',
          effects: [{ type: 'draw_cards', count: { type: 'fixed', value: 1 }, player: 'allied' }],
        }),
      ],
    });

    const result = resolveStack(state);

    // Both draws should resolve
    const drawEvents = result.events.filter(e => e.type === 'CARD_DRAWN');
    expect(drawEvents).toHaveLength(2);
    // Stack should be empty
    expect(result.state.stack).toHaveLength(0);
  });

  it('should skip countered items', () => {
    const card = mockCard({ owner: 0 });
    state = mockGameState({
      players: [
        mockPlayerState(0, { mainDeck: [card] }),
        mockPlayerState(1),
      ],
      stack: [
        makeStackItem({
          id: 'countered_spell',
          countered: true,
          effects: [{ type: 'draw_cards', count: { type: 'fixed', value: 1 }, player: 'allied' }],
        }),
      ],
    });

    const result = resolveStack(state);

    // No draw should happen
    expect(result.events.filter(e => e.type === 'CARD_DRAWN')).toHaveLength(0);
    expect(result.state.stack).toHaveLength(0);
  });

  it('should handle empty stack', () => {
    state = mockGameState();
    const result = resolveStack(state);
    expect(result.events).toHaveLength(0);
  });
});
