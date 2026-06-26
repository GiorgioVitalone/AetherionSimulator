/**
 * Student-t confidence interval for the mean of a small sample, plus a
 * zero-dependency table of two-sided t critical values. Used for the
 * multi-seed mean ± CI where the number of seeds is small (S ≈ 12).
 */

/** A two-sided confidence interval on a sample mean. */
export interface TIntervalResult {
  /** Sample mean. */
  readonly mean: number;
  /** Lower bound of the CI. */
  readonly lo: number;
  /** Upper bound of the CI. */
  readonly hi: number;
  /** Half the interval width (mean ± halfWidth). */
  readonly halfWidth: number;
  /** Sample standard deviation (n-1 denominator). */
  readonly stdDev: number;
  /** Standard error of the mean. */
  readonly stdErr: number;
  /** Degrees of freedom (n - 1). */
  readonly df: number;
}

/** Supported two-sided confidence levels for the critical-value table. */
export type ConfidenceLevel = 0.9 | 0.95 | 0.99;

// Two-sided Student-t critical values. Rows are degrees of freedom 1..30;
// the `inf` row (df >= 31) uses the normal approximation. Columns are the
// supported confidence levels. Values from standard statistical tables.
const T_TABLE: Readonly<Record<ConfidenceLevel, readonly number[]>> = {
  0.9: [
    6.314, 2.92, 2.353, 2.132, 2.015, 1.943, 1.895, 1.86, 1.833, 1.812, 1.796,
    1.782, 1.771, 1.761, 1.753, 1.746, 1.74, 1.734, 1.729, 1.725, 1.721, 1.717,
    1.714, 1.711, 1.708, 1.706, 1.703, 1.701, 1.699, 1.697,
  ],
  0.95: [
    12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228,
    2.201, 2.179, 2.16, 2.145, 2.131, 2.12, 2.11, 2.101, 2.093, 2.086, 2.08,
    2.074, 2.069, 2.064, 2.06, 2.056, 2.052, 2.048, 2.045, 2.042,
  ],
  0.99: [
    63.657, 9.925, 5.841, 4.604, 4.032, 3.707, 3.499, 3.355, 3.25, 3.169,
    3.106, 3.055, 3.012, 2.977, 2.947, 2.921, 2.898, 2.878, 2.861, 2.845,
    2.831, 2.819, 2.807, 2.797, 2.787, 2.779, 2.771, 2.763, 2.756, 2.75,
  ],
};

// Normal-approximation critical values used when df >= 31.
const Z_INF: Readonly<Record<ConfidenceLevel, number>> = {
  0.9: 1.645,
  0.95: 1.96,
  0.99: 2.576,
};

/**
 * Two-sided Student-t critical value for `df` degrees of freedom at the given
 * confidence level. For df <= 0 returns Infinity (no information); for
 * df >= 31 falls back to the normal critical value.
 */
export function tCritical(df: number, conf: ConfidenceLevel): number {
  if (df <= 0) return Infinity;
  const row = T_TABLE[conf];
  if (df <= row.length) {
    const v = row[df - 1];
    return v ?? Z_INF[conf];
  }
  return Z_INF[conf];
}

/**
 * Student-t confidence interval for the mean of `samples` at confidence
 * level `conf` (default 0.95). With fewer than 2 samples the spread is
 * undefined: returns a degenerate interval centered on the mean (or 0).
 */
export function studentTInterval(
  samples: readonly number[],
  conf: ConfidenceLevel = 0.95,
): TIntervalResult {
  const n = samples.length;
  if (n === 0) {
    return zeroResult(0, 0);
  }
  const mean = samples.reduce((a, b) => a + b, 0) / n;
  if (n === 1) {
    return zeroResult(mean, 0);
  }
  const ss = samples.reduce((a, b) => a + (b - mean) * (b - mean), 0);
  const variance = ss / (n - 1);
  const stdDev = Math.sqrt(variance);
  const stdErr = stdDev / Math.sqrt(n);
  const df = n - 1;
  const halfWidth = tCritical(df, conf) * stdErr;
  return {
    mean,
    lo: mean - halfWidth,
    hi: mean + halfWidth,
    halfWidth,
    stdDev,
    stdErr,
    df,
  };
}

function zeroResult(mean: number, df: number): TIntervalResult {
  return {
    mean,
    lo: mean,
    hi: mean,
    halfWidth: 0,
    stdDev: 0,
    stdErr: 0,
    df,
  };
}
