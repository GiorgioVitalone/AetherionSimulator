import { describe, it, expect } from 'vitest';
import { wilsonInterval } from '../../src/stats/wilson.js';

describe('wilsonInterval', () => {
  it('matches the textbook 50/100 @ 95% interval', () => {
    const r = wilsonInterval(50, 100);
    expect(r.mid).toBeCloseTo(0.5, 6);
    expect(r.lo).toBeCloseTo(0.40383, 4);
    expect(r.hi).toBeCloseTo(0.59617, 4);
    expect(r.halfWidth).toBeCloseTo((r.hi - r.lo) / 2, 12);
  });

  it('handles n = 0 as maximally uncertain [0,1] around 0.5', () => {
    expect(wilsonInterval(0, 0)).toEqual({
      lo: 0,
      hi: 1,
      mid: 0.5,
      halfWidth: 0.5,
    });
  });

  it('stays inside [0,1] for an extreme proportion (8/10)', () => {
    const r = wilsonInterval(8, 10);
    expect(r.lo).toBeGreaterThanOrEqual(0);
    expect(r.hi).toBeLessThanOrEqual(1);
    expect(r.lo).toBeCloseTo(0.49016, 4);
    expect(r.hi).toBeCloseTo(0.94332, 4);
  });

  it('clamps a near-zero count without going negative', () => {
    const r = wilsonInterval(0, 5);
    expect(r.lo).toBe(0);
    expect(r.hi).toBeGreaterThan(0);
  });

  it('narrows as n grows for a fixed proportion', () => {
    const small = wilsonInterval(5, 10);
    const big = wilsonInterval(500, 1000);
    expect(big.halfWidth).toBeLessThan(small.halfWidth);
  });

  it('widens for a larger z multiplier', () => {
    const z95 = wilsonInterval(50, 100, 1.96);
    const z99 = wilsonInterval(50, 100, 2.576);
    expect(z99.halfWidth).toBeGreaterThan(z95.halfWidth);
  });

  it('rejects invalid wins/trials/confidence multipliers', () => {
    expect(() => wilsonInterval(-1, 10)).toThrow(RangeError);
    expect(() => wilsonInterval(11, 10)).toThrow(RangeError);
    expect(() => wilsonInterval(1, -1)).toThrow(RangeError);
    expect(() => wilsonInterval(1, 10, Number.NaN)).toThrow(RangeError);
  });
});
