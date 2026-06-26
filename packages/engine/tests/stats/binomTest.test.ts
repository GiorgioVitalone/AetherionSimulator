import { describe, it, expect } from 'vitest';
import { binomTest, twoProportionZ } from '../../src/stats/binomTest.js';

describe('binomTest', () => {
  it('gives p = 1 for the most likely outcome (50/100 vs 0.5)', () => {
    const r = binomTest(50, 100, 0.5);
    expect(r.phat).toBe(0.5);
    expect(r.pValue).toBeCloseTo(1, 6);
  });

  it('matches the known two-sided p for 60/100 vs 0.5', () => {
    const r = binomTest(60, 100, 0.5);
    expect(r.pValue).toBeCloseTo(0.0569, 3);
  });

  it('matches the known two-sided p for 8/10 vs 0.5', () => {
    const r = binomTest(8, 10, 0.5);
    expect(r.pValue).toBeCloseTo(0.1094, 3);
  });

  it('is symmetric about 0.5 for symmetric counts', () => {
    expect(binomTest(60, 100).pValue).toBeCloseTo(
      binomTest(40, 100).pValue,
      6,
    );
  });

  it('returns p = 1 with no trials', () => {
    expect(binomTest(0, 0).pValue).toBe(1);
  });
});

describe('twoProportionZ', () => {
  it('matches the pooled-variance z for 60/100 vs 40/100', () => {
    const r = twoProportionZ(60, 100, 40, 100);
    expect(r.diff).toBeCloseTo(0.2, 10);
    expect(r.z).toBeCloseTo(2.82843, 4);
    expect(r.pValue).toBeCloseTo(0.004678, 4);
  });

  it('gives z = 0 for equal proportions', () => {
    const r = twoProportionZ(50, 100, 50, 100);
    expect(r.z).toBe(0);
    expect(r.pValue).toBeCloseTo(1, 6);
  });

  it('returns a null result when either arm has no trials', () => {
    expect(twoProportionZ(5, 0, 5, 10)).toEqual({ diff: 0, z: 0, pValue: 1 });
    expect(twoProportionZ(5, 10, 5, 0)).toEqual({ diff: 0, z: 0, pValue: 1 });
  });
});
