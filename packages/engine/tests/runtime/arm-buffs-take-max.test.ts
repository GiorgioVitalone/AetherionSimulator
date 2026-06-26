/**
 * EC-001 — `armBuffsTakeMax` rule-variant semantics.
 *
 * When the toggle is ON, a body's ACTIVE ARM BUFFS combine by `max` instead of
 * `sum`: effective ARM = baseArm + max(active positive ARM buffs) (0 if none).
 * Spans both timed `modify_stats` modifiers and aura ARM bonuses (all tracked in
 * `card.modifiers`). ATK/HP are untouched. Default OFF = additive (unchanged).
 *
 * The card's incoming `currentArm` mirrors the running engine scalar
 * (baseArm + Σ tracked arm buffs); the tail normalization at the end of
 * recomputeAuras rewrites it to baseArm + max.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { recomputeAuras } from '../../src/runtime/aura-recompute.js';
import { findCardInState } from '../../src/effects/state-helpers.js';
import {
  mockCard,
  mockGameState,
  mockPlayerState,
  zonesWithCards,
  resetInstanceCounter,
} from '../helpers/card-factory.js';
import type { ActiveModifier, GameConfig } from '../../src/types/game-state.js';

const TAKE_MAX: GameConfig = { terminationMode: 'turn_cap', armBuffsTakeMax: true };

function armMod(id: string, arm: number): ActiveModifier {
  return {
    id,
    sourceInstanceId: 'src',
    modifier: { arm },
    duration: { type: 'until_next_upkeep' },
  };
}

/** Build a single-character state whose currentArm already reflects baseArm plus
 * the summed ARM buffs (the running-scalar invariant the engine maintains). */
function stateWith(baseArm: number, buffs: readonly number[], config?: GameConfig): ReturnType<typeof mockGameState> {
  const sum = buffs.reduce((a, b) => a + b, 0);
  const card = mockCard({
    owner: 0,
    name: 'Wall',
    baseArm,
    currentArm: baseArm + sum,
    modifiers: buffs.map((arm, i) => armMod(`mod_${String(i)}`, arm)),
  });
  return mockGameState({
    players: [
      mockPlayerState(0, { zones: zonesWithCards({ frontline: [card, null, null] }) }),
      mockPlayerState(1),
    ],
    ...(config !== undefined ? { config } : {}),
  });
}

function armOf(state: ReturnType<typeof mockGameState>): number {
  const card = state.players[0]!.zones.frontline[0]!;
  return findCardInState(state, card.instanceId)!.currentArm;
}

describe('EC-001 armBuffsTakeMax — ARM buffs combine by max (toggle ON)', () => {
  beforeEach(() => {
    resetInstanceCounter();
  });

  it('+1 & +2 → +2 (max, not sum of +3)', () => {
    expect(armOf(recomputeAuras(stateWith(1, [1, 2], TAKE_MAX)))).toBe(3); // base 1 + max 2
  });

  it('+1 & +1 → +1 (max, not sum of +2)', () => {
    expect(armOf(recomputeAuras(stateWith(0, [1, 1], TAKE_MAX)))).toBe(1); // base 0 + max 1
  });

  it('single +2 → +2 (one buff, unchanged)', () => {
    expect(armOf(recomputeAuras(stateWith(2, [2], TAKE_MAX)))).toBe(4); // base 2 + buff 2
  });

  it('no buffs → base (unchanged)', () => {
    expect(armOf(recomputeAuras(stateWith(3, [], TAKE_MAX)))).toBe(3);
  });

  it('three buffs +1 +2 +3 → +3 (max across the full set)', () => {
    expect(armOf(recomputeAuras(stateWith(0, [1, 2, 3], TAKE_MAX)))).toBe(3);
  });

  it('ATK and HP are unaffected by the ARM rule', () => {
    const card = mockCard({
      owner: 0,
      baseArm: 0,
      currentArm: 3,
      currentAtk: 7,
      baseAtk: 2,
      currentHp: 9,
      baseHp: 3,
      modifiers: [
        { id: 'm0', sourceInstanceId: 's', modifier: { atk: 3, hp: 4, arm: 1 }, duration: { type: 'until_next_upkeep' } },
        { id: 'm1', sourceInstanceId: 's', modifier: { atk: 2, hp: 2, arm: 2 }, duration: { type: 'until_next_upkeep' } },
      ],
    });
    const state = mockGameState({
      players: [
        mockPlayerState(0, { zones: zonesWithCards({ frontline: [card, null, null] }) }),
        mockPlayerState(1),
      ],
      config: TAKE_MAX,
    });
    const after = findCardInState(recomputeAuras(state), card.instanceId)!;
    expect(after.currentArm).toBe(2); // base 0 + max(1,2) = 2 (not 3)
    expect(after.currentAtk).toBe(7); // unchanged
    expect(after.currentHp).toBe(9); // unchanged
  });
});

describe('EC-001 armBuffsTakeMax — default OFF is additive (unchanged)', () => {
  beforeEach(() => {
    resetInstanceCounter();
  });

  it('+1 & +2 stays +3 when the toggle is absent', () => {
    expect(armOf(recomputeAuras(stateWith(1, [1, 2])))).toBe(4); // base 1 + sum 3
  });

  it('+1 & +1 stays +2 when the toggle is absent', () => {
    expect(armOf(recomputeAuras(stateWith(0, [1, 1])))).toBe(2);
  });
});
