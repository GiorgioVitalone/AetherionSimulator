import { describe, it, expect } from 'vitest';
import { gTestUniform, chiSquareUniform } from '../../src/stats/gtest.js';
import {
  chiSquareUpperP,
  normalLogSurvival,
  normalSurvival,
  normalTwoSidedP,
} from '../../src/stats/normal.js';

describe('chiSquareUpperP', () => {
  it('matches known critical-value tail probabilities', () => {
    expect(chiSquareUpperP(3.841, 1)).toBeCloseTo(0.05, 3);
    expect(chiSquareUpperP(7.815, 3)).toBeCloseTo(0.05, 3);
    expect(chiSquareUpperP(11.345, 3)).toBeCloseTo(0.01, 3);
  });

  it('returns 1 for a zero statistic and rejects invalid domains', () => {
    expect(chiSquareUpperP(0, 3)).toBe(1);
    expect(() => chiSquareUpperP(5, 0)).toThrow(RangeError);
    expect(() => chiSquareUpperP(-1, 2)).toThrow(RangeError);
  });
});

describe('stable normal tails', () => {
  it('matches high-precision references without cancellation to zero', () => {
    const sf8 = 6.22096057427178e-16;
    const sf10 = 7.61985302416047e-24;
    expect(normalSurvival(8) / sf8).toBeCloseTo(1, 7);
    expect(normalSurvival(10) / sf10).toBeCloseTo(1, 7);
    expect(normalTwoSidedP(10)).toBeGreaterThan(0);
    expect(normalLogSurvival(10)).toBeCloseTo(-53.2312851505125, 7);
  });

  it('keeps a finite log tail when the probability itself underflows', () => {
    expect(Number.isFinite(normalLogSurvival(40))).toBe(true);
    expect(normalLogSurvival(40)).toBeLessThan(-800);
  });
});

describe('gTestUniform', () => {
  it('gives statistic 0 and p = 1 for a perfectly uniform vector', () => {
    const r = gTestUniform([25, 25, 25, 25]);
    expect(r.statistic).toBe(0);
    expect(r.df).toBe(3);
    expect(r.pValue).toBe(1);
  });

  it('matches the known G for [40,20,20,20]', () => {
    const r = gTestUniform([40, 20, 20, 20]);
    expect(r.statistic).toBeCloseTo(10.8231, 3);
    expect(r.df).toBe(3);
    expect(r.pValue).toBeCloseTo(0.01272, 4);
  });

  it('ignores empty categories (0 ln 0 -> 0)', () => {
    const r = gTestUniform([10, 0, 0, 10]);
    expect(Number.isFinite(r.statistic)).toBe(true);
  });

  it('returns no-evidence for fewer than two categories or zero total', () => {
    expect(gTestUniform([5]).pValue).toBe(1);
    expect(gTestUniform([0, 0, 0]).pValue).toBe(1);
  });
});

describe('chiSquareUniform', () => {
  it('matches the known chi-square for [40,20,20,20]', () => {
    const r = chiSquareUniform([40, 20, 20, 20]);
    expect(r.statistic).toBeCloseTo(12, 6);
    expect(r.df).toBe(3);
    expect(r.pValue).toBeCloseTo(0.00738, 4);
  });

  it('agrees in direction with the G-test on imbalance', () => {
    const g = gTestUniform([40, 20, 20, 20]);
    const c = chiSquareUniform([40, 20, 20, 20]);
    expect(g.pValue).toBeLessThan(0.05);
    expect(c.pValue).toBeLessThan(0.05);
  });
});
