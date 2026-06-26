import { describe, it, expect } from 'vitest';
import { gTestUniform, chiSquareUniform } from '../../src/stats/gtest.js';
import { chiSquareUpperP } from '../../src/stats/normal.js';

describe('chiSquareUpperP', () => {
  it('matches known critical-value tail probabilities', () => {
    expect(chiSquareUpperP(3.841, 1)).toBeCloseTo(0.05, 3);
    expect(chiSquareUpperP(7.815, 3)).toBeCloseTo(0.05, 3);
    expect(chiSquareUpperP(11.345, 3)).toBeCloseTo(0.01, 3);
  });

  it('returns 1 for a zero statistic or non-positive df', () => {
    expect(chiSquareUpperP(0, 3)).toBe(1);
    expect(chiSquareUpperP(5, 0)).toBe(1);
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
