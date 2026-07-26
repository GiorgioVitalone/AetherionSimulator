/**
 * Dynamic amount / dynamic stat evaluation.
 *
 * Covers the four card-pool dynamic kinds that previously evaluated to 0:
 *  - equals_stat  (Seraphina Radiant Valkyrie: ATK = ARM)
 *  - multiply     (RIA-09 Verdant Vanguard: double ATK & HP)
 *  - x_cost       (Steel-Root Armor: +0/+X HP where X = Energy spent)
 *  - per_count    (Haunting: -1 ATK per character destroyed this turn)
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { evaluateAmount, evaluateDynamicStat } from '../../src/effects/amount-evaluator.js';
import { executeEffect } from '../../src/effects/interpreter.js';
import type { AmountExpr, DynamicStatSource } from '../../src/types/common.js';
import type { Effect } from '../../src/types/effects.js';
import type { EffectContext, GameEvent } from '../../src/types/game-state.js';
import {
  mockCard,
  mockGameState,
  mockPlayerState,
  zonesWithCards,
  resetInstanceCounter,
} from '../helpers/card-factory.js';

function ctx(over: Partial<EffectContext> = {}): EffectContext {
  return { sourceInstanceId: 'src', controllerId: 0, triggerDepth: 0, ...over };
}

const destroyed = (id: string): GameEvent => ({
  type: 'CARD_DESTROYED', cardInstanceId: id, cause: 'effect', playerId: 0,
});
const turnStart = (): GameEvent => ({ type: 'TURN_START', playerId: 0, turnNumber: 2 });

describe('evaluateAmount — x_cost', () => {
  it('reads the X paid from context', () => {
    const amount: AmountExpr = { type: 'x_cost', resource: 'energy' };
    expect(evaluateAmount(mockGameState(), amount, ctx({ xPaid: 4 }))).toBe(4);
  });

  it('is 0 when no X was paid', () => {
    const amount: AmountExpr = { type: 'x_cost', resource: 'energy' };
    expect(evaluateAmount(mockGameState(), amount, ctx())).toBe(0);
  });
});

describe('evaluateAmount — characters_destroyed_this_turn', () => {
  it('counts CARD_DESTROYED events in the log', () => {
    const state = mockGameState({ log: [destroyed('a'), destroyed('b'), destroyed('c')] });
    const amount: AmountExpr = { type: 'count', counting: { type: 'characters_destroyed_this_turn' } };
    expect(evaluateAmount(state, amount, ctx())).toBe(3);
  });

  it('only counts destructions after the most recent TURN_START (this turn)', () => {
    // Two destroyed last turn, then a turn boundary, then one this turn.
    const state = mockGameState({
      log: [destroyed('old1'), destroyed('old2'), turnStart(), destroyed('new1')],
    });
    const amount: AmountExpr = { type: 'count', counting: { type: 'characters_destroyed_this_turn' } };
    expect(evaluateAmount(state, amount, ctx())).toBe(1);
  });
});

describe('evaluateDynamicStat — equals_stat (Seraphina)', () => {
  it('grants ATK equal to the target ARM', () => {
    const target = mockCard({ currentArm: 4, baseArm: 4, currentAtk: 2, baseAtk: 2 });
    const dyn: DynamicStatSource = { type: 'equals_stat', stat: 'atk', sourceRef: 'arm' };
    expect(evaluateDynamicStat(mockGameState(), dyn, target, ctx())).toEqual({ atk: 4 });
  });
});

describe('evaluateDynamicStat — multiply (RIA-09)', () => {
  it('returns the delta that doubles current ATK and HP', () => {
    const target = mockCard({ currentAtk: 2, currentHp: 4, currentArm: 0 });
    const dyn: DynamicStatSource = { type: 'multiply', factor: 2, stats: ['atk', 'hp'] };
    // factor-1 = 1 -> delta equals current stats (doubling on apply).
    expect(evaluateDynamicStat(mockGameState(), dyn, target, ctx())).toEqual({ atk: 2, hp: 4 });
  });
});

describe('evaluateDynamicStat — x_cost (Steel-Root Armor)', () => {
  it('grants +X HP where X is the energy paid', () => {
    const target = mockCard();
    const dyn: DynamicStatSource = { type: 'x_cost', stat: 'hp', resource: 'energy' };
    expect(evaluateDynamicStat(mockGameState(), dyn, target, ctx({ xPaid: 3 }))).toEqual({ hp: 3 });
  });
});

describe('evaluateDynamicStat — per_count (Haunting)', () => {
  it('returns -1 ATK per character destroyed this turn', () => {
    const target = mockCard();
    const state = mockGameState({ log: [destroyed('a'), destroyed('b')] });
    const dyn: DynamicStatSource = {
      type: 'per_count', stat: 'atk',
      counting: { type: 'characters_destroyed_this_turn' }, valuePerCount: -1,
    };
    expect(evaluateDynamicStat(state, dyn, target, ctx())).toEqual({ atk: -2 });
  });
});

describe('executeModifyStats — applies dynamic modifiers to the board', () => {
  beforeEach(() => {
    resetInstanceCounter();
  });

  it('Seraphina: target gains ATK equal to ARM, plus the static modifier', () => {
    const target = mockCard({ owner: 0, currentAtk: 2, baseAtk: 2, currentArm: 3, baseArm: 3 });
    const state = mockGameState({
      players: [
        mockPlayerState(0, { zones: zonesWithCards({ frontline: [target, null, null] }) }),
        mockPlayerState(1),
      ],
    });
    const effect: Effect = {
      type: 'modify_stats',
      target: { type: 'all_characters', side: 'allied' },
      duration: { type: 'while_in_play' },
      modifier: { atk: 0 },
      dynamicModifier: { type: 'equals_stat', stat: 'atk', sourceRef: 'arm' },
    };
    const result = executeEffect(state, effect, ctx());
    const buffed = result.newState.players[0].zones.frontline[0]!;
    expect(buffed.currentAtk).toBe(5); // base 2 + arm 3
    expect(result.events).toContainEqual({
      type: 'STAT_MODIFIED', cardInstanceId: target.instanceId, modifier: { atk: 3, hp: 0, arm: 0 }, playerId: 0,
    });
  });

  it('RIA-09 Ultimate: doubles ATK and HP of the target', () => {
    const target = mockCard({ owner: 0, currentAtk: 2, currentHp: 4, baseAtk: 2, baseHp: 4 });
    const state = mockGameState({
      players: [
        mockPlayerState(0, { zones: zonesWithCards({ frontline: [target, null, null] }) }),
        mockPlayerState(1),
      ],
    });
    const effect: Effect = {
      type: 'modify_stats',
      target: { type: 'all_characters', side: 'allied' },
      duration: { type: 'until_next_upkeep' },
      modifier: { hp: 0, atk: 0 },
      dynamicModifier: { type: 'multiply', factor: 2, stats: ['atk', 'hp'] },
    };
    const result = executeEffect(state, effect, ctx());
    const buffed = result.newState.players[0].zones.frontline[0]!;
    expect(buffed.currentAtk).toBe(4);
    expect(buffed.currentHp).toBe(8);
  });

  it('Steel-Root: target gains +X HP from energy paid', () => {
    const target = mockCard({ owner: 0, currentHp: 4, baseHp: 4 });
    const state = mockGameState({
      players: [
        mockPlayerState(0, { zones: zonesWithCards({ frontline: [target, null, null] }) }),
        mockPlayerState(1),
      ],
    });
    const effect: Effect = {
      type: 'modify_stats',
      target: { type: 'all_characters', side: 'allied' },
      duration: { type: 'while_in_play' },
      modifier: { hp: 0 },
      dynamicModifier: { type: 'x_cost', stat: 'hp', resource: 'energy' },
    };
    const result = executeEffect(state, effect, ctx({ xPaid: 3 }));
    const buffed = result.newState.players[0].zones.frontline[0]!;
    expect(buffed.currentHp).toBe(7); // 4 + 3 energy
  });

  it('Haunting: target loses 1 ATK per character destroyed this turn', () => {
    const target = mockCard({ owner: 1, currentAtk: 5, baseAtk: 5 });
    const state = mockGameState({
      players: [
        mockPlayerState(0),
        mockPlayerState(1, { zones: zonesWithCards({ frontline: [target, null, null] }) }),
      ],
      log: [destroyed('x'), destroyed('y')],
    });
    const effect: Effect = {
      type: 'modify_stats',
      target: { type: 'all_characters', side: 'enemy' },
      duration: { type: 'until_end_of_turn' },
      modifier: { atk: 0 },
      dynamicModifier: {
        type: 'per_count', stat: 'atk',
        counting: { type: 'characters_destroyed_this_turn' }, valuePerCount: -1,
      },
    };
    const result = executeEffect(state, effect, ctx());
    const debuffed = result.newState.players[1].zones.frontline[0]!;
    expect(debuffed.currentAtk).toBe(3); // 5 - 2 destroyed
  });
});
