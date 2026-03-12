import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerScheduledEffect,
  processScheduledEffects,
  decrementScheduledTimers,
  resetScheduledCounter,
} from '../../src/effects/scheduled-processor.js';
import type { ScheduledEffect } from '../../src/types/effects.js';
import type { EffectContext, GameState } from '../../src/types/game-state.js';
import {
  mockGameState,
  mockPlayerState,
  mockCard,
  resetInstanceCounter,
  zonesWithCards,
} from '../helpers/card-factory.js';

let state: GameState;
let context: EffectContext;

beforeEach(() => {
  resetInstanceCounter();
  resetScheduledCounter();
  context = { sourceInstanceId: 'src_1', controllerId: 0, triggerDepth: 0 };
});

describe('registerScheduledEffect', () => {
  it('should add a scheduled entry to state', () => {
    state = mockGameState();
    const scheduled: ScheduledEffect = {
      type: 'scheduled',
      timing: { type: 'next_upkeep' },
      effects: [{ type: 'draw_cards', count: { type: 'fixed', value: 1 }, player: 'allied' }],
    };

    const result = registerScheduledEffect(state, scheduled, context);
    expect(result.scheduledEffects).toHaveLength(1);
    expect(result.scheduledEffects[0]!.timing.type).toBe('next_upkeep');
  });
});

describe('processScheduledEffects', () => {
  it('should fire a next_upkeep effect when turnsRemaining is 0', () => {
    const card = mockCard({ owner: 0 });
    state = mockGameState({
      players: [
        mockPlayerState(0, {
          zones: zonesWithCards({ frontline: [card, null, null] }),
          mainDeck: [mockCard({ owner: 0 }), mockCard({ owner: 0 })],
        }),
        mockPlayerState(1),
      ],
      scheduledEffects: [{
        id: 'sched_1',
        timing: { type: 'next_upkeep' },
        turnsRemaining: 0,
        effects: [{ type: 'draw_cards', count: { type: 'fixed', value: 1 }, player: 'allied' }],
        sourceInstanceId: card.instanceId,
        controllerId: 0,
        oneShot: true,
      }],
    });

    const result = processScheduledEffects(state, 'next_upkeep');

    // Draw event should fire
    expect(result.events.some(e => e.type === 'CARD_DRAWN')).toBe(true);
    // oneShot entry should be removed
    expect(result.state.scheduledEffects).toHaveLength(0);
  });

  it('should fire end_of_turn effect during end phase', () => {
    state = mockGameState({
      players: [
        mockPlayerState(0, {
          mainDeck: [mockCard({ owner: 0 })],
        }),
        mockPlayerState(1),
      ],
      scheduledEffects: [{
        id: 'sched_2',
        timing: { type: 'end_of_turn' },
        turnsRemaining: 0,
        effects: [{ type: 'draw_cards', count: { type: 'fixed', value: 1 }, player: 'allied' }],
        sourceInstanceId: 'src_1',
        controllerId: 0,
        oneShot: true,
      }],
    });

    const result = processScheduledEffects(state, 'end_of_turn');

    expect(result.events.some(e => e.type === 'CARD_DRAWN')).toBe(true);
    expect(result.state.scheduledEffects).toHaveLength(0);
  });

  it('should skip effects with turnsRemaining > 0', () => {
    state = mockGameState({
      scheduledEffects: [{
        id: 'sched_3',
        timing: { type: 'next_upkeep' },
        turnsRemaining: 1,
        effects: [{ type: 'draw_cards', count: { type: 'fixed', value: 1 }, player: 'allied' }],
        sourceInstanceId: 'src_1',
        controllerId: 0,
        oneShot: true,
      }],
    });

    const result = processScheduledEffects(state, 'next_upkeep');

    expect(result.events).toHaveLength(0);
    expect(result.state.scheduledEffects).toHaveLength(1);
  });

  it('should skip conditional scheduled effect when condition is false', () => {
    state = mockGameState({
      players: [
        mockPlayerState(0, {
          mainDeck: [mockCard({ owner: 0 })],
        }),
        mockPlayerState(1),
      ],
      scheduledEffects: [{
        id: 'sched_4',
        timing: { type: 'next_upkeep' },
        turnsRemaining: 0,
        effects: [{ type: 'draw_cards', count: { type: 'fixed', value: 1 }, player: 'allied' }],
        sourceInstanceId: 'src_1',
        controllerId: 0,
        condition: { type: 'is_transformed' }, // Hero is not transformed
        oneShot: true,
      }],
    });

    const result = processScheduledEffects(state, 'next_upkeep');

    // Should not draw (condition false)
    expect(result.events.filter(e => e.type === 'CARD_DRAWN')).toHaveLength(0);
    // oneShot should still be removed
    expect(result.state.scheduledEffects).toHaveLength(0);
  });
});

describe('decrementScheduledTimers', () => {
  it('should decrement turnsRemaining by 1', () => {
    state = mockGameState({
      scheduledEffects: [{
        id: 'sched_5',
        timing: { type: 'next_upkeep' },
        turnsRemaining: 2,
        effects: [],
        sourceInstanceId: 'src_1',
        controllerId: 0,
        oneShot: true,
      }],
    });

    const result = decrementScheduledTimers(state);
    expect(result.scheduledEffects[0]!.turnsRemaining).toBe(1);
  });
});
