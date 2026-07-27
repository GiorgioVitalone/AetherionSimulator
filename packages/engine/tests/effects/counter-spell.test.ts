/**
 * counter_spell tests — verify the minimal stack/response model (Rulebook 14).
 * A spell queued on GameState.stack can be negated by a Counter so it never
 * resolves; the targeted stack item is removed (LIFO chain skips it).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { executeEffect, executeCounterSpell } from '../../src/effects/index.js';
import { resolveTargets } from '../../src/effects/target-resolver.js';
import { triggerMatchesEvent } from '../../src/events/trigger-matcher.js';
import {
  mockGameState,
  mockPlayerState,
  resetInstanceCounter,
} from '../helpers/card-factory.js';
import type { GameState, StackItem, EffectContext } from '../../src/types/game-state.js';
import type { Effect } from '../../src/types/effects.js';
import type { Trigger } from '../../src/types/triggers.js';
import type { ResourceCard } from '../../src/types/game-state.js';

const ctx = (over: Partial<EffectContext> = {}): EffectContext => ({
  sourceInstanceId: 'COUNTER',
  controllerId: 0,
  triggerDepth: 0,
  ...over,
});

const enemySpell = (id: string): StackItem => ({
  id,
  type: 'spell',
  sourceInstanceId: `src_${id}`,
  controllerId: 1,
  effects: [{ type: 'deal_damage', amount: { type: 'fixed', value: 4 }, target: { type: 'hero', side: 'enemy' } }],
  targets: ['hero_0'],
});

const counter = (over: Partial<Extract<Effect, { type: 'counter_spell' }>> = {}): Effect => ({
  type: 'counter_spell',
  target: { type: 'target_spell' },
  ...over,
}) as Effect;

function stateWithStack(stack: StackItem[]): GameState {
  return mockGameState({ stack });
}

describe('counter_spell', () => {
  beforeEach(() => {
    resetInstanceCounter();
  });

  it('negates a queued enemy spell so it is removed from the stack', () => {
    const spell = enemySpell('s1');
    const state = stateWithStack([spell]);
    const r = executeCounterSpell(state, counter() as Extract<Effect, { type: 'counter_spell' }>, ctx({ selectedTargets: ['s1'] }));
    expect(r.newState.stack).toHaveLength(0);
    // A countered spell emits SPELL_COUNTERED, NOT SPELL_CAST — so on_spell_cast
    // triggers do not mis-fire on a spell that never resolved.
    expect(r.events.some(e => e.type === 'SPELL_COUNTERED')).toBe(true);
    expect(r.events.some(e => e.type === 'SPELL_CAST')).toBe(false);
    const countered = r.events.find(e => e.type === 'SPELL_COUNTERED');
    expect(countered).toMatchObject({ cardInstanceId: 'src_s1', playerId: 1 });
  });

  it('on_spell_cast trigger does NOT fire on a countered spell', () => {
    const spell = enemySpell('s1');
    const state = stateWithStack([spell]);
    const r = executeCounterSpell(state, counter() as Extract<Effect, { type: 'counter_spell' }>, ctx({ selectedTargets: ['s1'] }));
    // An observer with an on_spell_cast trigger (watching enemy spells) must not
    // match any emitted event, because the spell was countered, not cast.
    const trigger: Trigger = { type: 'on_spell_cast', side: 'enemy' };
    const fired = r.events.some(e =>
      triggerMatchesEvent(trigger, e, 'OBSERVER', 0),
    );
    expect(fired).toBe(false);
  });

  it('only removes the targeted stack item, leaving others', () => {
    const state = stateWithStack([enemySpell('s1'), enemySpell('s2')]);
    const r = executeCounterSpell(state, counter() as Extract<Effect, { type: 'counter_spell' }>, ctx({ selectedTargets: ['s2'] }));
    expect(r.newState.stack.map(i => i.id)).toEqual(['s1']);
  });

  it('auto-resolves target_spell to enemy spells and pauses for choice', () => {
    const state = stateWithStack([enemySpell('s1')]);
    const resolved = resolveTargets(state, { type: 'target_spell' }, ctx());
    expect(resolved.resolved).toBe(false);
    if (!resolved.resolved) {
      expect(resolved.pendingChoice.options.map(o => o.id)).toEqual(['s1']);
    }
  });

  it('is a no-op when the stack has no enemy spell to counter', () => {
    const state = stateWithStack([]);
    const r = executeEffect(state, counter(), ctx());
    expect(r.newState.stack).toHaveLength(0);
    expect(r.events).toHaveLength(0);
    expect(r.newState).toEqual(state);
  });

  it('with unlessPay, does NOT counter when the controller can afford the cost', () => {
    const spell = enemySpell('s1');
    const bank: ResourceCard[] = [
      { instanceId: 'm1', resourceType: 'mana', exhausted: false },
      { instanceId: 'm2', resourceType: 'mana', exhausted: false },
    ];
    const state = mockGameState({
      stack: [spell],
      players: [mockPlayerState(0), mockPlayerState(1, { resourceBank: bank })],
    });
    const eff = counter({ unlessPay: { mana: 2, energy: 0, flexible: 0 } }) as Extract<Effect, { type: 'counter_spell' }>;
    const r = executeCounterSpell(state, eff, ctx({ selectedTargets: ['s1'] }));
    expect(r.newState.stack).toHaveLength(1);
    expect(r.newState.players[1].resourceBank.every((resource) => !resource.exhausted)).toBe(true);
  });

  it('with unlessPay, counters when the controller cannot afford the cost', () => {
    const spell = enemySpell('s1');
    const state = mockGameState({
      stack: [spell],
      players: [mockPlayerState(0), mockPlayerState(1, { resourceBank: [] })],
    });
    const eff = counter({ unlessPay: { mana: 2, energy: 0, flexible: 0 } }) as Extract<Effect, { type: 'counter_spell' }>;
    const r = executeCounterSpell(state, eff, ctx({ selectedTargets: ['s1'] }));
    expect(r.newState.stack).toHaveLength(0);
  });

  it('is deterministic (identical result across runs)', () => {
    const build = () => executeCounterSpell(stateWithStack([enemySpell('s1'), enemySpell('s2')]), counter() as Extract<Effect, { type: 'counter_spell' }>, ctx({ selectedTargets: ['s1'] }));
    expect(build().newState.stack).toEqual(build().newState.stack);
  });
});
