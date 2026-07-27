import { describe, it, expect, beforeEach } from 'vitest';
import { resolveTargets } from '../../src/effects/target-resolver.js';
import type { TargetExpr } from '../../src/types/targets.js';
import type { EffectContext } from '../../src/types/game-state.js';
import {
  mockCard,
  mockGameState,
  mockPlayerState,
  resetInstanceCounter,
  zonesWithCards,
} from '../helpers/card-factory.js';
import { CURRENT_GAME_CONFIG } from '../../src/rules/manifest.js';

function ctx(controllerId: 0 | 1 = 0): EffectContext {
  return { sourceInstanceId: 'SRC', controllerId, triggerDepth: 0 };
}

describe('resolveTargets — target_card_in_discard', () => {
  beforeEach(() => {
    resetInstanceCounter();
  });

  it('returns a pendingChoice listing matching cards from the controller discard pile', () => {
    const match = mockCard({ name: 'CheapChar', cardType: 'C', cost: { mana: 2, energy: 0, flexible: 0 } });
    const tooExpensive = mockCard({ name: 'PriceyChar', cardType: 'C', cost: { mana: 5, energy: 0, flexible: 0 } });
    const wrongType = mockCard({ name: 'CheapSpell', cardType: 'S', cost: { mana: 1, energy: 0, flexible: 0 } });

    const state = mockGameState({
      players: [
        mockPlayerState(0, { discardPile: [match, tooExpensive, wrongType] }),
        mockPlayerState(1),
      ],
    });

    const target: TargetExpr = {
      type: 'target_card_in_discard',
      side: 'allied',
      filter: { maxCost: 3, cardType: 'C' },
    };

    const result = resolveTargets(state, target, ctx(0));
    expect(result.resolved).toBe(false);
    if (result.resolved) throw new Error('expected pendingChoice');
    expect(result.pendingChoice.type).toBe('select_targets');
    expect(result.pendingChoice.options.map(o => o.id)).toEqual([match.instanceId]);
  });

  it('reads the enemy discard pile when side is enemy', () => {
    const enemyCard = mockCard({ name: 'EnemyDiscard', cardType: 'C', cost: { mana: 1, energy: 0, flexible: 0 } });
    const state = mockGameState({
      players: [
        mockPlayerState(0),
        mockPlayerState(1, { discardPile: [enemyCard] }),
      ],
    });

    const target: TargetExpr = { type: 'target_card_in_discard', side: 'enemy' };
    const result = resolveTargets(state, target, ctx(0));
    expect(result.resolved).toBe(false);
    if (result.resolved) throw new Error('expected pendingChoice');
    expect(result.pendingChoice.options.map(o => o.id)).toEqual([enemyCard.instanceId]);
  });

  it('resolves to empty (no choice) when the discard pile has no match', () => {
    const state = mockGameState({
      players: [mockPlayerState(0, { discardPile: [] }), mockPlayerState(1)],
    });
    const target: TargetExpr = { type: 'target_card_in_discard', side: 'allied' };
    const result = resolveTargets(state, target, ctx(0));
    expect(result.resolved).toBe(true);
    if (!result.resolved) throw new Error('expected resolved');
    expect(result.targetIds).toEqual([]);
  });

  it('is deterministic — repeated calls yield identical option ids', () => {
    const a = mockCard({ name: 'A', cardType: 'C', cost: { mana: 1, energy: 0, flexible: 0 } });
    const b = mockCard({ name: 'B', cardType: 'C', cost: { mana: 2, energy: 0, flexible: 0 } });
    const state = mockGameState({
      players: [mockPlayerState(0, { discardPile: [a, b] }), mockPlayerState(1)],
    });
    const target: TargetExpr = { type: 'target_card_in_discard', side: 'allied', filter: { maxCost: 3 } };

    const r1 = resolveTargets(state, target, ctx(0));
    const r2 = resolveTargets(state, target, ctx(0));
    if (r1.resolved || r2.resolved) throw new Error('expected pendingChoice');
    expect(r1.pendingChoice.options).toEqual(r2.pendingChoice.options);
    expect(r1.pendingChoice.options.map(o => o.id)).toEqual([a.instanceId, b.instanceId]);
  });
});

describe('resolveTargets — target_character zone', () => {
  it('offers only characters in the authored battlefield zone', () => {
    const reserve = mockCard({ instanceId: 'reserve', owner: 0 });
    const frontline = mockCard({ instanceId: 'frontline', owner: 0 });
    const highGround = mockCard({ instanceId: 'high-ground', owner: 0 });
    const state = mockGameState({
      config: CURRENT_GAME_CONFIG,
      players: [
        mockPlayerState(0, {
          zones: zonesWithCards({
            reserve: [reserve],
            frontline: [frontline],
            highGround: [highGround],
          }),
        }),
        mockPlayerState(1),
      ],
    });

    const result = resolveTargets(
      state,
      { type: 'target_character', side: 'allied', zone: 'reserve' },
      ctx(0),
    );
    if (result.resolved) throw new Error('expected pendingChoice');
    expect(result.pendingChoice.options.map((option) => option.id)).toEqual([
      reserve.instanceId,
    ]);
  });
});

describe('current hero target identity', () => {
  it('uses a seat namespace disjoint from hero ability source IDs', () => {
    const state = mockGameState({ config: CURRENT_GAME_CONFIG });
    const allied = resolveTargets(
      state,
      { type: 'hero', side: 'allied' },
      ctx(0),
    );
    const any = resolveTargets(state, { type: 'hero', side: 'any' }, ctx(0));
    expect(allied).toEqual({ resolved: true, targetIds: ['hero_player_0'] });
    if (any.resolved) throw new Error('expected hero choice');
    expect(any.pendingChoice.options.map((option) => option.id)).toEqual([
      'hero_player_0',
      'hero_player_1',
    ]);
    expect(any.pendingChoice.options.map((option) => option.id)).not.toContain(
      `hero_${String(state.players[0].hero.cardDefId)}`,
    );
  });
});
