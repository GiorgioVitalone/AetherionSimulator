/**
 * G-test (likelihood-ratio) and Pearson chi-square test of uniformity for a
 * vector of category counts. Used to ask "are faction win counts consistent
 * with all factions being equally likely to win?" — a single imbalance
 * p-value that replaces the upward-biased bare max-min spread.
 */
import { chiSquareUpperP } from './normal.js';

/** Result of a goodness-of-fit test against expected counts. */
export interface GoodnessOfFitResult {
  /** The G (or chi-square) statistic. */
  readonly statistic: number;
  /** Degrees of freedom (categories - 1). */
  readonly df: number;
  /** Upper-tail p-value under the chi-square distribution. */
  readonly pValue: number;
}

/**
 * G-test of uniformity: are the `counts` consistent with every category
 * being equally likely? Expected count per category is total / k. Categories
 * with zero observed count contribute nothing (0·ln0 → 0). Fewer than two
 * categories or zero total => no evidence (statistic 0, p = 1).
 */
export function gTestUniform(counts: readonly number[]): GoodnessOfFitResult {
  const k = counts.length;
  const total = counts.reduce((a, b) => a + b, 0);
  if (k < 2 || total <= 0) {
    return { statistic: 0, df: Math.max(0, k - 1), pValue: 1 };
  }
  const expected = total / k;
  let g = 0;
  for (const o of counts) {
    if (o > 0) g += o * Math.log(o / expected);
  }
  g *= 2;
  const df = k - 1;
  return { statistic: g, df, pValue: chiSquareUpperP(g, df) };
}

/**
 * Pearson chi-square test of uniformity over `counts`. Provided alongside the
 * G-test for cross-checking; same df and tail distribution.
 */
export function chiSquareUniform(
  counts: readonly number[],
): GoodnessOfFitResult {
  const k = counts.length;
  const total = counts.reduce((a, b) => a + b, 0);
  if (k < 2 || total <= 0) {
    return { statistic: 0, df: Math.max(0, k - 1), pValue: 1 };
  }
  const expected = total / k;
  let chi = 0;
  for (const o of counts) {
    const d = o - expected;
    chi += (d * d) / expected;
  }
  const df = k - 1;
  return { statistic: chi, df, pValue: chiSquareUpperP(chi, df) };
}
