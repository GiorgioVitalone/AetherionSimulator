/**
 * Reactive bot policy (chooseReactiveAction) — deterministic hold/counter logic.
 *
 * The bot counters a high-value enemy spell on the stack (removal/burst) with the
 * cheapest held Counter, holds against low-value chaff, and passes when it has no
 * legal Counter. Pure function of GameState (no RNG).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { chooseReactiveAction } from '../../src/bot/heuristic.js';
import {
  mockCard,
  mockGameState,
  mockPlayerState,
  resetInstanceCounter,
} from '../helpers/card-factory.js';
import type { ResourceCard, StackItem, PendingPriority } from '../../src/types/game-state.js';
import type { AbilityDSL } from '../../src/types/ability.js';

function manaBank(n: number, prefix = 'm'): ResourceCard[] {
  return Array.from({ length: n }, (_, i) => ({
    instanceId: `${prefix}${String(i)}`,
    resourceType: 'mana' as const,
    exhausted: false,
  }));
}

function counterCard(id: string, cost: number): ReturnType<typeof mockCard> {
  const ability: AbilityDSL = {
    type: 'triggered',
    trigger: { type: 'on_counter' },
    effects: [{ type: 'counter_spell', target: { type: 'target_spell' } }],
  };
  return mockCard({ instanceId: id, cardType: 'S', owner: 1, cost: { mana: cost, energy: 0, flexible: 0 }, abilities: [ability] });
}

// An enemy (player 0) spell on the stack with the given burn amount to the hero.
function enemyBurnOnStack(amount: number, sourceId: string): StackItem {
  return {
    id: `spell_${sourceId}`,
    type: 'spell',
    sourceInstanceId: sourceId,
    controllerId: 0,
    effects: [{ type: 'deal_damage', amount: { type: 'fixed', value: amount }, target: { type: 'hero', side: 'enemy' } }],
    targets: [],
  };
}

const window1: PendingPriority = {
  type: 'priority',
  toRespondPlayerId: 1,
  window: 'cast',
  baseStackItemId: 'spell_X',
  passes: 0,
};

describe('chooseReactiveAction', () => {
  beforeEach(() => resetInstanceCounter());

  it('counters a high-value enemy burn with the cheapest held counter', () => {
    // The burn card must be findable for scoring — put it in player 0's discard.
    const burnCard = mockCard({ instanceId: 'BURN', cardType: 'S', owner: 0, abilities: [{ type: 'triggered', trigger: { type: 'on_cast' }, effects: [{ type: 'deal_damage', amount: { type: 'fixed', value: 5 }, target: { type: 'hero', side: 'enemy' } }] }] });
    const cheap = counterCard('CHEAP', 1);
    const pricey = counterCard('PRICEY', 3);
    const p0 = mockPlayerState(0, { discardPile: [burnCard] });
    const p1 = mockPlayerState(1, { hand: [pricey, cheap], resourceBank: manaBank(4, 'e') });
    const state = mockGameState({
      phase: 'strategy',
      players: [p0, p1],
      stack: [enemyBurnOnStack(5, 'BURN')],
      pendingPriority: window1,
    });
    const action = chooseReactiveAction(state);
    expect(action).not.toBeNull();
    expect(action).toMatchObject({ type: 'cast_spell', cardInstanceId: 'CHEAP', selectedTargetIds: ['spell_BURN'] });
  });

  it('holds (passes) against a low-value enemy spell', () => {
    const chaff = mockCard({ instanceId: 'CHAFF', cardType: 'S', owner: 0, abilities: [{ type: 'triggered', trigger: { type: 'on_cast' }, effects: [{ type: 'deal_damage', amount: { type: 'fixed', value: 1 }, target: { type: 'hero', side: 'enemy' } }] }] });
    const cheap = counterCard('CHEAP', 1);
    const p0 = mockPlayerState(0, { discardPile: [chaff] });
    const p1 = mockPlayerState(1, { hand: [cheap], resourceBank: manaBank(4, 'e') });
    const state = mockGameState({
      phase: 'strategy',
      players: [p0, p1],
      stack: [enemyBurnOnStack(1, 'CHAFF')],
      pendingPriority: window1,
    });
    expect(chooseReactiveAction(state)).toBeNull();
  });

  it('passes when it holds no counter', () => {
    const burnCard = mockCard({ instanceId: 'BURN', cardType: 'S', owner: 0, abilities: [{ type: 'triggered', trigger: { type: 'on_cast' }, effects: [{ type: 'deal_damage', amount: { type: 'fixed', value: 5 }, target: { type: 'hero', side: 'enemy' } }] }] });
    const p0 = mockPlayerState(0, { discardPile: [burnCard] });
    const p1 = mockPlayerState(1, { hand: [], resourceBank: manaBank(4, 'e') });
    const state = mockGameState({
      phase: 'strategy',
      players: [p0, p1],
      stack: [enemyBurnOnStack(5, 'BURN')],
      pendingPriority: window1,
    });
    expect(chooseReactiveAction(state)).toBeNull();
  });

  it('returns null when no window is open', () => {
    const state = mockGameState({ phase: 'strategy', stack: [] });
    expect(chooseReactiveAction(state)).toBeNull();
  });

  it('is deterministic (identical decision across calls)', () => {
    const burnCard = mockCard({ instanceId: 'BURN', cardType: 'S', owner: 0, abilities: [{ type: 'triggered', trigger: { type: 'on_cast' }, effects: [{ type: 'deal_damage', amount: { type: 'fixed', value: 5 }, target: { type: 'hero', side: 'enemy' } }] }] });
    const p0 = mockPlayerState(0, { discardPile: [burnCard] });
    const p1 = mockPlayerState(1, { hand: [counterCard('CHEAP', 1)], resourceBank: manaBank(4, 'e') });
    const state = mockGameState({
      phase: 'strategy',
      players: [p0, p1],
      stack: [enemyBurnOnStack(5, 'BURN')],
      pendingPriority: window1,
    });
    expect(chooseReactiveAction(state)).toEqual(chooseReactiveAction(state));
  });
});
