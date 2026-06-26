import { describe, it, expect } from 'vitest';
import { bootstrapCI, mulberry32 } from '../../src/stats/bootstrap.js';

const mean = (a: readonly number[]): number =>
  a.reduce((x, y) => x + y, 0) / a.length;

describe('mulberry32', () => {
  it('is deterministic for a fixed seed', () => {
    const r1 = mulberry32(12345);
    const r2 = mulberry32(12345);
    const a = [r1(), r1(), r1()];
    const b = [r2(), r2(), r2()];
    expect(a).toEqual(b);
  });

  it('emits floats in [0,1)', () => {
    const r = mulberry32(1);
    for (let i = 0; i < 200; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('bootstrapCI', () => {
  const data = [0.4, 0.5, 0.6, 0.5, 0.45];

  it('is byte-identical across repeated calls (deterministic)', () => {
    const a = bootstrapCI(data, mean);
    const b = bootstrapCI(data, mean);
    expect(a).toEqual(b);
  });

  it('brackets the point estimate with lo <= point <= hi', () => {
    const r = bootstrapCI(data, mean);
    expect(r.point).toBeCloseTo(0.49, 10);
    expect(r.lo).toBeLessThanOrEqual(r.point);
    expect(r.hi).toBeGreaterThanOrEqual(r.point);
    expect(r.resamples).toBe(2000);
  });

  it('changes with the seed', () => {
    const a = bootstrapCI(data, mean, 0.95, 2000, 1);
    const b = bootstrapCI(data, mean, 0.95, 2000, 2);
    expect(a.lo === b.lo && a.hi === b.hi).toBe(false);
  });

  it('returns a degenerate result for empty data', () => {
    expect(bootstrapCI([], mean)).toEqual({
      point: 0,
      lo: 0,
      hi: 0,
      mean: 0,
      resamples: 0,
    });
  });

  it('collapses to the constant for a one-valued constant sample', () => {
    const r = bootstrapCI([0.5, 0.5, 0.5], mean);
    expect(r.lo).toBeCloseTo(0.5, 10);
    expect(r.hi).toBeCloseTo(0.5, 10);
  });
});
