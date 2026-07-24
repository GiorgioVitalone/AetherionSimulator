import { describe, expect, it } from 'vitest';
import { pearson, spearman } from '../../src/stats/correlation.js';

describe('correlation', () => {
  it('pearson is +1 for a perfect positive linear relationship', () => {
    expect(pearson([1, 2, 3, 4], [2, 4, 6, 8]).r).toBeCloseTo(1);
  });

  it('pearson is -1 for a perfect negative linear relationship', () => {
    expect(pearson([1, 2, 3, 4], [4, 3, 2, 1]).r).toBeCloseTo(-1);
  });

  it('spearman is 1 for a monotone-nonlinear relationship while pearson is < 1', () => {
    const xs = [1, 2, 3, 4];
    const ys = [1, 4, 9, 16];
    expect(spearman(xs, ys).r).toBeCloseTo(1);
    expect(pearson(xs, ys).r).toBeLessThan(1);
  });

  it('returns r=0 for constant input or n<2', () => {
    expect(pearson([1, 1, 1], [1, 2, 3]).r).toBe(0);
    expect(pearson([1], [1]).r).toBe(0);
  });

  it('handles ties via average ranks', () => {
    expect(spearman([1, 1, 2, 3], [1, 1, 2, 3]).r).toBeCloseTo(1);
  });
});
