/**
 * Wave 6 A30 — SPELL_CAST fires on RESOLUTION (resolveStack), not at cast-push.
 * A countered spell is removed from the stack before resolving, so its
 * on_spell_cast watchers must never see a SPELL_CAST event (Rulebook 14).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { resolveStack } from '../../src/effects/stack-resolver.js';
import { executeCounterSpell } from '../../src/effects/counter-handler.js';
import {
  mockCard,
  mockGameState,
  mockPlayerState,
  resetInstanceCounter,
} from '../helpers/card-factory.js';
import type { GameState, StackItem, EffectContext } from '../../src/types/game-state.js';
import type { Effect } from '../../src/types/effects.js';

const ctx: EffectContext = { sourceInstanceId: 'COUNTER', controllerId: 0, triggerDepth: 0 };

function spellItem(id: string, controller: 0 | 1): StackItem {
  return {
    id,
    type: 'spell',
    sourceInstanceId: `src_${id}`,
    controllerId: controller,
    effects: [{ type: 'draw_cards', count: { type: 'fixed', value: 1 }, player: 'allied' }],
    targets: [],
  };
}

describe('SPELL_CAST on resolution', () => {
  beforeEach(() => {
    resetInstanceCounter();
  });

  it('a resolving spell emits exactly one SPELL_CAST', () => {
    const state = mockGameState({
      stack: [spellItem('s1', 0)],
      players: [
        mockPlayerState(0, { mainDeck: [mockCard({ owner: 0, name: 'Top' })] }),
        mockPlayerState(1),
      ],
    });
    const r = resolveStack(state);
    const casts = r.events.filter(e => e.type === 'SPELL_CAST');
    expect(casts).toHaveLength(1);
    expect(casts[0]).toMatchObject({ cardInstanceId: 'src_s1', playerId: 0 });
  });

  it('a countered spell never emits SPELL_CAST', () => {
    // Stack: enemy spell s1 (bottom), our Counter that removes s1 (top).
    const enemy = spellItem('s1', 1);
    const counter: StackItem = {
      id: 'c1',
      type: 'spell',
      sourceInstanceId: 'src_c1',
      controllerId: 0,
      effects: [{ type: 'counter_spell', target: { type: 'target_spell' } } as Effect],
      targets: ['s1'],
    };
    const state: GameState = mockGameState({ stack: [enemy, counter] });
    const r = resolveStack(state);
    // The Counter resolves first (LIFO), removing s1. Both s1 (countered) and the
    // counter itself resolve, but only the surviving spell emits SPELL_CAST.
    const casts = r.events.filter(e => e.type === 'SPELL_CAST');
    expect(casts.map(c => c.type === 'SPELL_CAST' && c.cardInstanceId)).toEqual(['src_c1']);
    expect(casts.some(c => c.type === 'SPELL_CAST' && c.cardInstanceId === 'src_s1')).toBe(false);
  });

  it('counter handler still emits SPELL_COUNTERED, not SPELL_CAST', () => {
    const state = mockGameState({ stack: [spellItem('s1', 1)] });
    const r = executeCounterSpell(
      state,
      { type: 'counter_spell', target: { type: 'target_spell' } } as Extract<Effect, { type: 'counter_spell' }>,
      { ...ctx, selectedTargets: ['s1'] },
    );
    expect(r.events.some(e => e.type === 'SPELL_COUNTERED')).toBe(true);
    expect(r.events.some(e => e.type === 'SPELL_CAST')).toBe(false);
  });
});
