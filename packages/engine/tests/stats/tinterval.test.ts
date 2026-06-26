import { describe, it, expect } from 'vitest';
import { studentTInterval, tCritical } from '../../src/stats/tinterval.js';

describe('tCritical', () => {
  it('returns known table values for 95%', () => {
    expect(tCritical(1, 0.95)).toBe(12.706);
    expect(tCritical(10, 0.95)).toBe(2.228);
    expect(tCritical(30, 0.95)).toBe(2.042);
  });

  it('returns known table values for 90% and 99%', () => {
    expect(tCritical(1, 0.9)).toBe(6.314);
    expect(tCritical(1, 0.99)).toBe(63.657);
  });

  it('falls back to the normal critical value for large df', () => {
    expect(tCritical(1000, 0.95)).toBe(1.96);
    expect(tCritical(1000, 0.9)).toBe(1.645);
    expect(tCritical(1000, 0.99)).toBe(2.576);
  });

  it('returns Infinity for non-positive df', () => {
    expect(tCritical(0, 0.95)).toBe(Infinity);
    expect(tCritical(-3, 0.95)).toBe(Infinity);
  });
});

describe('studentTInterval', () => {
  it('matches a hand-computed interval for [1,2,3,4,5]', () => {
    const r = studentTInterval([1, 2, 3, 4, 5]);
    expect(r.mean).toBe(3);
    expect(r.stdDev).toBeCloseTo(1.5811388, 5);
    expect(r.stdErr).toBeCloseTo(0.7071068, 5);
    expect(r.df).toBe(4);
    // t(4, .95) = 2.776 -> halfWidth = 2.776 * 0.70711 = 1.96293
    expect(r.halfWidth).toBeCloseTo(1.96293, 4);
    expect(r.lo).toBeCloseTo(1.03707, 4);
    expect(r.hi).toBeCloseTo(4.96293, 4);
  });

  it('is degenerate (zero width) for a single sample', () => {
    const r = studentTInterval([7]);
    expect(r.mean).toBe(7);
    expect(r.lo).toBe(7);
    expect(r.hi).toBe(7);
    expect(r.halfWidth).toBe(0);
  });

  it('returns zeros for an empty sample', () => {
    const r = studentTInterval([]);
    expect(r.mean).toBe(0);
    expect(r.halfWidth).toBe(0);
  });

  it('produces a wider interval at higher confidence', () => {
    const c95 = studentTInterval([1, 2, 3, 4, 5], 0.95);
    const c99 = studentTInterval([1, 2, 3, 4, 5], 0.99);
    expect(c99.halfWidth).toBeGreaterThan(c95.halfWidth);
  });
});
