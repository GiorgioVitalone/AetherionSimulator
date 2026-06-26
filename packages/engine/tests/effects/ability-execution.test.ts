/**
 * Ability execution tests — verify the DSL effect interpreter actually mutates
 * game state for the covered effect families, and does so deterministically.
 * These guard the "abilities fire in the sim" wiring.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { executeEffect } from '../../src/effects/index.js';
import {
  mockCard,
  mockGameState,
  mockPlayerState,
  zonesWithCards,
  resetInstanceCounter,
} from '../helpers/card-factory.js';
import type { GameState } from '../../src/types/game-state.js';
import type { Effect } from '../../src/types/effects.js';

const ctx = (over: Record<string, unknown> = {}) => ({
  sourceInstanceId: 'SRC',
  controllerId: 0 as const,
  triggerDepth: 0,
  ...over,
});

function buildState(): { state: GameState; enemyId: string } {
  const source = mockCard({ instanceId: 'SRC', owner: 0, name: 'Source' });
  const ally = mockCard({ owner: 0, name: 'Ally' });
  const enemy = mockCard({ instanceId: 'ENEMY', owner: 1, name: 'Enemy', currentHp: 5, baseHp: 5 });
  const p0 = mockPlayerState(0, {
    zones: zonesWithCards({ frontline: [source, ally, null] }),
    hand: [mockCard({ owner: 0 })],
    mainDeck: [mockCard({ owner: 0 }), mockCard({ owner: 0 }), mockCard({ owner: 0 })],
  });
  const p1 = mockPlayerState(1, { zones: zonesWithCards({ frontline: [enemy, null, null] }) });
  return { state: mockGameState({ players: [p0, p1] }), enemyId: 'ENEMY' };
}

function findCard(state: GameState, id: string) {
  for (const p of state.players)
    for (const zone of [p.zones.reserve, p.zones.frontline, p.zones.highGround])
      for (const c of zone) if (c && c.instanceId === id) return c;
  return null;
}

describe('ability execution (DSL effects mutate state)', () => {
  beforeEach(() => resetInstanceCounter());

  it('deal_damage reduces the target character HP', () => {
    const { state, enemyId } = buildState();
    const effect = {
      type: 'deal_damage',
      amount: { type: 'fixed', value: 3 },
      target: { side: 'enemy', type: 'target_character' },
    } as unknown as Effect;
    const r = executeEffect(state, effect, ctx({ selectedTargets: [enemyId] }));
    const enemy = findCard(r.newState, enemyId);
    expect(enemy?.currentHp).toBe(2);
    expect(r.events.length).toBeGreaterThan(0);
  });

  it('draw_cards increases the controller hand size', () => {
    const { state } = buildState();
    const before = state.players[0].hand.length;
    const effect = { type: 'draw_cards', count: { type: 'fixed', value: 2 }, player: 'allied' } as unknown as Effect;
    const r = executeEffect(state, effect, ctx());
    expect(r.newState.players[0].hand.length).toBe(before + 2);
  });

  it('composite (sacrifice self + draw) removes the source and draws', () => {
    const { state } = buildState();
    const before = state.players[0].hand.length;
    const effect = {
      type: 'composite',
      effects: [
        { type: 'sacrifice', target: { type: 'self' } },
        { type: 'draw_cards', count: { type: 'fixed', value: 1 }, player: 'allied' },
      ],
    } as unknown as Effect;
    const r = executeEffect(state, effect, ctx());
    expect(findCard(r.newState, 'SRC')).toBeNull();
    expect(r.newState.players[0].hand.length).toBe(before + 1);
  });

  it('lethal deal_damage to a hero sets the winner', () => {
    const { state } = buildState();
    const effect = {
      type: 'deal_damage',
      amount: { type: 'fixed', value: 999 },
      target: { side: 'enemy', type: 'hero' },
    } as unknown as Effect;
    const r = executeEffect(state, effect, ctx({ selectedTargets: ['hero_1'] }));
    expect(r.newState.winner).toBe(0);
  });

  it('is deterministic — identical inputs produce identical output', () => {
    const effect = {
      type: 'deal_damage',
      amount: { type: 'fixed', value: 3 },
      target: { side: 'enemy', type: 'target_character' },
    } as unknown as Effect;
    const a = executeEffect(buildState().state, effect, ctx({ selectedTargets: ['ENEMY'] }));
    const b = executeEffect(buildState().state, effect, ctx({ selectedTargets: ['ENEMY'] }));
    expect(findCard(a.newState, 'ENEMY')?.currentHp).toBe(findCard(b.newState, 'ENEMY')?.currentHp);
  });
});
