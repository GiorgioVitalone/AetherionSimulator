import { describe, it, expect, beforeEach } from 'vitest';
import { openResponseWindow, computeAvailableResponses } from '../../src/stack/response-window.js';
import type { GameState } from '../../src/types/game-state.js';
import {
  mockGameState,
  mockPlayerState,
  mockCard,
  resetInstanceCounter,
  ZERO_COST,
} from '../helpers/card-factory.js';

let state: GameState;

beforeEach(() => {
  resetInstanceCounter();
});

function counterSpell(overrides?: Partial<ReturnType<typeof mockCard>>) {
  return mockCard({
    cardType: 'S',
    cost: { mana: 2, energy: 0, flexible: 0 },
    abilities: [{
      type: 'triggered',
      trigger: { type: 'on_counter' },
      effects: [{
        type: 'counter_spell',
        target: { type: 'target_spell' },
      }],
    }],
    ...overrides,
  });
}

function flashSpell(overrides?: Partial<ReturnType<typeof mockCard>>) {
  return mockCard({
    cardType: 'S',
    cost: ZERO_COST,
    abilities: [{
      type: 'triggered',
      trigger: { type: 'on_flash' },
      effects: [{
        type: 'draw_cards',
        count: { type: 'fixed', value: 1 },
        player: 'allied',
      }],
    }],
    ...overrides,
  });
}

describe('openResponseWindow', () => {
  it('should create a PendingChoice when opponent has Counter cards', () => {
    const counter = counterSpell({ owner: 1 });
    state = mockGameState({
      activePlayerIndex: 0,
      players: [
        mockPlayerState(0),
        mockPlayerState(1, {
          hand: [counter],
          resourceBank: [
            { instanceId: 'r1', resourceType: 'mana', exhausted: false },
            { instanceId: 'r2', resourceType: 'mana', exhausted: false },
          ],
        }),
      ],
    });

    const result = openResponseWindow(state, 'stack_1');

    expect(result.pendingChoice).toBeDefined();
    expect(result.pendingChoice!.type).toBe('response_window');
    expect(result.pendingChoice!.playerId).toBe(1);
    // Should have counter card + pass option
    expect(result.pendingChoice!.options).toHaveLength(2);
  });

  it('should auto-pass when no Counter/Flash available', () => {
    state = mockGameState({
      activePlayerIndex: 0,
      players: [
        mockPlayerState(0),
        mockPlayerState(1, { hand: [] }),
      ],
    });

    const result = openResponseWindow(state, 'stack_1');

    expect(result.pendingChoice).toBeUndefined();
  });

  it('should auto-pass when opponent cannot afford Counter cards', () => {
    const counter = counterSpell({ owner: 1 });
    state = mockGameState({
      activePlayerIndex: 0,
      players: [
        mockPlayerState(0),
        mockPlayerState(1, {
          hand: [counter],
          resourceBank: [], // No resources
        }),
      ],
    });

    const result = openResponseWindow(state, 'stack_1');

    expect(result.pendingChoice).toBeUndefined();
  });
});

describe('computeAvailableResponses', () => {
  it('should find Counter and Flash cards in hand', () => {
    const counter = counterSpell({ owner: 1 });
    const flash = flashSpell({ owner: 1 });
    state = mockGameState({
      players: [
        mockPlayerState(0),
        mockPlayerState(1, {
          hand: [counter, flash],
          resourceBank: [
            { instanceId: 'r1', resourceType: 'mana', exhausted: false },
            { instanceId: 'r2', resourceType: 'mana', exhausted: false },
          ],
        }),
      ],
    });

    const responses = computeAvailableResponses(state, 1);

    expect(responses).toHaveLength(2);
    expect(responses[0]!.label).toContain('Counter');
    expect(responses[1]!.label).toContain('Flash');
  });

  it('should exclude non-spell cards', () => {
    const character = mockCard({
      cardType: 'C',
      owner: 1,
      abilities: [{
        type: 'triggered',
        trigger: { type: 'on_counter' },
        effects: [],
      }],
    });
    state = mockGameState({
      players: [
        mockPlayerState(0),
        mockPlayerState(1, { hand: [character] }),
      ],
    });

    const responses = computeAvailableResponses(state, 1);
    expect(responses).toHaveLength(0);
  });
});
