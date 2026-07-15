import { describe, expect, it } from 'vitest';
import { computeCardPower } from '../../src/balance/card-power.js';
import type { Effect } from '../../src/types/effects.js';
import { aura, body, fixed, selfTarget, triggered } from './factory.js';

describe('computeCardPower — stats + traits + abilities + intra-synergy', () => {
  it('scores a vanilla body as atk + hp', () => {
    expect(computeCardPower(body(1, 'Vanilla', 4, 4)).power).toBeCloseTo(8);
  });

  it('weights ARM at parity with HP (§S2: v1 first-instance-per-turn rule, was 1.3x)', () => {
    expect(computeCardPower(body(2, 'Armored', 2, 2, 2)).statBase).toBeCloseTo(6.0);
  });

  it('scales Defender value with HP + ARM', () => {
    const big = computeCardPower(body(3, 'BigWall', 1, 5, 0, { traits: ['defender'] }));
    const small = computeCardPower(body(4, 'SmallWall', 1, 2, 0, { traits: ['defender'] }));
    expect(big.traitValue).toBeGreaterThan(small.traitValue);
    expect(big.traitValue).toBeCloseTo(3.0); // 0.6 * (5 + 0)
  });

  it('scales Flying value with ATK', () => {
    const hi = computeCardPower(body(5, 'BigFlyer', 5, 1, 0, { traits: ['flying'] }));
    const lo = computeCardPower(body(6, 'SmallFlyer', 1, 1, 0, { traits: ['flying'] }));
    expect(hi.traitValue).toBeGreaterThan(lo.traitValue);
  });

  it('treats Volatile as a negative scaling with HP', () => {
    expect(
      computeCardPower(body(7, 'Bomb', 2, 4, 0, { traits: ['volatile'] })).traitValue,
    ).toBeLessThan(0);
  });

  it('lifts a Defender that self-heals above a vanilla Defender of equal stats', () => {
    const heal = triggered(
      { type: 'on_block' },
      [{ type: 'heal', amount: fixed(1), target: selfTarget }],
      {
        oncePerTurn: true,
      },
    );
    const guardian = computeCardPower(
      body(8, 'Guardian', 1, 2, 0, { traits: ['defender'], abilities: [heal] }),
    );
    const vanilla = computeCardPower(body(9, 'PlainWall', 1, 2, 0, { traits: ['defender'] }));
    expect(guardian.intraSynergy).toBeGreaterThan(0);
    expect(guardian.synergyMultiplier).toBeGreaterThan(1);
    expect(guardian.power).toBeGreaterThan(vanilla.power);
  });

  it('is deterministic and does not mutate its input', () => {
    const frozen = Object.freeze(body(10, 'Frozen', 3, 3, 0, { traits: ['defender'] }));
    expect(computeCardPower(frozen)).toEqual(computeCardPower(frozen));
  });

  it('§R2 — flags free_cast for a cost_reduction nested under choose_one inside an aura (auditor repro)', () => {
    const nestedReducer: Effect = {
      type: 'choose_one',
      options: [
        {
          label: 'reduce',
          effects: [
            {
              type: 'cost_reduction',
              reduction: 1,
              appliesTo: { cardType: 'C' },
              duration: { type: 'while_in_play' },
            },
          ],
        },
        { label: 'noop', effects: [] },
      ],
    };
    const c = body(11, 'Nested Reducer', 2, 2, 0, { abilities: [aura([nestedReducer])] });
    const power = computeCardPower(c);
    expect(power.flags).toContain('free_cast');
  });
});
