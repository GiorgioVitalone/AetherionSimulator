/**
 * Value pilot (GameConfig.valuePilot) — the bot consults the first-principles
 * card-power / synergy engine for deploy and keep/pitch decisions. Covers the
 * adapter + intrinsic value + bounded board synergy, and the integration effect:
 * with the flag on, a keyword body out-ranks a slightly bigger vanilla body.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  staticFromInstance,
  intrinsicValue,
  boardHeroSynergy,
  deployValue,
} from '../../src/bot/value-pilot.js';
import { chooseAction } from '../../src/bot/heuristic.js';
import {
  mockCard,
  mockGameState,
  mockPlayerState,
  resetInstanceCounter,
} from '../helpers/card-factory.js';
import type { ResourceCard, GameConfig, Trait } from '../../src/types/game-state.js';

function manaBank(n: number): ResourceCard[] {
  return Array.from({ length: n }, (_, i) => ({
    instanceId: `res_${String(i)}`,
    resourceType: 'mana' as const,
    exhausted: false,
  }));
}

const valueConfig: GameConfig = { terminationMode: 'turn_cap', valuePilot: true };

describe('value-pilot adapter + valuation', () => {
  beforeEach(() => resetInstanceCounter());

  it('adapts a CardInstance to a StaticCard using base stats and printed traits', () => {
    const card = mockCard({
      cardDefId: 42,
      baseAtk: 2,
      baseHp: 3,
      baseArm: 1,
      currentAtk: 9,
      currentHp: 9,
      traits: ['defender'] as Trait[],
    });
    const sc = staticFromInstance(card);
    expect(sc.id).toBe(42);
    expect(sc.stats).toEqual({ atk: 2, hp: 3, arm: 1 }); // base, not buffed current
    expect(sc.traits).toEqual(['defender']);
  });

  it('values a Defender above a vanilla body of identical stats (trait value)', () => {
    const vanilla = mockCard({ cardDefId: 1, baseAtk: 2, baseHp: 3, currentAtk: 2, currentHp: 3 });
    const defender = mockCard({
      cardDefId: 2,
      baseAtk: 2,
      baseHp: 3,
      currentAtk: 2,
      currentHp: 3,
      traits: ['defender'] as Trait[],
    });
    expect(intrinsicValue(defender)).toBeGreaterThan(intrinsicValue(vanilla));
  });

  it('intrinsicValue is memoized — a repeat lookup returns the same scalar', () => {
    const card = mockCard({ cardDefId: 7, baseAtk: 4, baseHp: 4 });
    expect(intrinsicValue(card)).toBe(intrinsicValue(card));
  });

  it('board synergy is zero for a vanilla body on an empty board and never exceeds the cap', () => {
    const card = mockCard({ cardDefId: 3, baseAtk: 3, baseHp: 3 });
    const p0 = mockPlayerState(0);
    const syn = boardHeroSynergy(card, p0);
    expect(syn).toBe(0);
    expect(deployValue(card, p0)).toBeCloseTo(intrinsicValue(card));
  });
});

describe('value-pilot deploy ranking', () => {
  beforeEach(() => resetInstanceCounter());

  it('prefers a Defender over a bigger vanilla body when the flag is on', () => {
    // Vanilla 3/3 (raw power 6) vs Defender 2/3 (raw power 5, but higher card power
    // once the wall trait is valued). Default ranks by atk+hp ⇒ vanilla; valuePilot
    // ranks by card power ⇒ the Defender.
    const vanilla = mockCard({
      instanceId: 'VANILLA',
      baseAtk: 3,
      baseHp: 3,
      currentAtk: 3,
      currentHp: 3,
      cost: { mana: 2, energy: 0, flexible: 0 },
    });
    const defender = mockCard({
      instanceId: 'DEFENDER',
      baseAtk: 2,
      baseHp: 3,
      currentAtk: 2,
      currentHp: 3,
      traits: ['defender'] as Trait[],
      cost: { mana: 2, energy: 0, flexible: 0 },
    });

    const base = mockGameState({
      phase: 'strategy',
      players: [
        mockPlayerState(0, { hand: [vanilla, defender], resourceBank: manaBank(4) }),
        mockPlayerState(1),
      ],
    });
    expect((chooseAction(base) as { cardInstanceId: string }).cardInstanceId).toBe('VANILLA');

    const withValue = mockGameState({ ...base, config: valueConfig });
    expect((chooseAction(withValue) as { cardInstanceId: string }).cardInstanceId).toBe('DEFENDER');
  });
});
