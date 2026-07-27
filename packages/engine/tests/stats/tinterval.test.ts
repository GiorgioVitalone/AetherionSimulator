import { describe, it, expect } from 'vitest';
import { studentTInterval, tCritical } from '../../src/stats/tinterval.js';

describe('tCritical', () => {
  it('returns known table values for 95%', () => {
    expect(tCritical(1, 0.95)).toBeCloseTo(12.7062, 3);
    expect(tCritical(10, 0.95)).toBeCloseTo(2.2281, 3);
    expect(tCritical(30, 0.95)).toBeCloseTo(2.0423, 3);
  });

  it('returns known table values for 90% and 99%', () => {
    expect(tCritical(1, 0.9)).toBeCloseTo(6.3138, 3);
    expect(tCritical(1, 0.99)).toBeCloseTo(63.6567, 3);
  });

  it('uses finite-df Student-t values rather than a normal fallback', () => {
    expect(tCritical(1000, 0.95)).toBeCloseTo(1.96234, 5);
    expect(tCritical(1000, 0.9)).toBeCloseTo(1.64638, 5);
    expect(tCritical(1000, 0.99)).toBeCloseTo(2.58075, 5);
  });

  it('rejects non-positive or non-integral df', () => {
    expect(() => tCritical(0, 0.95)).toThrow(RangeError);
    expect(() => tCritical(-3, 0.95)).toThrow(RangeError);
    expect(() => tCritical(2.5, 0.95)).toThrow(RangeError);
  });
});

describe('studentTInterval', () => {
  it('matches a hand-computed interval for [1,2,3,4,5]', () => {
    const r = studentTInterval([1, 2, 3, 4, 5]);
    expect(r.mean).toBe(3);
    expect(r.stdDev).toBeCloseTo(1.5811388, 5);
    expect(r.stdErr).toBeCloseTo(0.7071068, 5);
    expect(r.df).toBe(4);
    // Exact t(4, .95) = 2.776445... (not the old 3-decimal table value).
    expect(r.halfWidth).toBeCloseTo(1.963243, 5);
    expect(r.lo).toBeCloseTo(1.036757, 5);
    expect(r.hi).toBeCloseTo(4.963243, 5);
  });

  it('is degenerate (zero width) for a single sample', () => {
    const r = studentTInterval([7]);
    expect(r.mean).toBe(7);
    expect(r.lo).toBe(7);
    expect(r.hi).toBe(7);
    expect(r.halfWidth).toBe(0);
  });

  it('rejects an empty or non-finite sample', () => {
    expect(() => studentTInterval([])).toThrow(RangeError);
    expect(() => studentTInterval([1, Number.NaN])).toThrow(RangeError);
  });

  it('produces a wider interval at higher confidence', () => {
    const c95 = studentTInterval([1, 2, 3, 4, 5], 0.95);
    const c99 = studentTInterval([1, 2, 3, 4, 5], 0.99);
    expect(c99.halfWidth).toBeGreaterThan(c95.halfWidth);
  });
});
