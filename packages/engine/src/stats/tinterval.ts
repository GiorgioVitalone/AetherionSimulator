/**
 * Student-t confidence interval for the mean of a small sample, plus a
 * zero-dependency inverse Student-t calculation. Used for the multi-seed mean
 * interval where the number of independent experimental clusters is small.
 */
import { lnGamma } from './normal.js';

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

/**
 * Two-sided Student-t critical value for `df` degrees of freedom at the given
 * confidence level. Values are inverted from the exact Student-t CDF for every
 * finite df; there is no df>30 normal-approximation discontinuity.
 */
export function tCritical(df: number, conf: ConfidenceLevel): number {
  if (!Number.isSafeInteger(df) || df <= 0) {
    throw new RangeError('df must be a positive safe integer');
  }
  if (![0.9, 0.95, 0.99].includes(conf as number)) {
    throw new RangeError('Unsupported confidence level');
  }
  const target = (1 + conf) / 2;
  let lo = 0;
  let hi = 1;
  while (studentTCdf(hi, df) < target) hi *= 2;
  for (let iteration = 0; iteration < 100; iteration++) {
    const mid = (lo + hi) / 2;
    if (studentTCdf(mid, df) < target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
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
  if (samples.some((sample) => !Number.isFinite(sample))) {
    throw new RangeError('samples must contain only finite values');
  }
  if (n === 0) {
    throw new RangeError('at least one sample is required');
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

function studentTCdf(t: number, df: number): number {
  if (t === 0) return 0.5;
  const x = df / (df + t * t);
  const tail = 0.5 * regularizedBeta(x, df / 2, 0.5);
  return t > 0 ? 1 - tail : tail;
}

function regularizedBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const logBt =
    lnGamma(a + b) -
    lnGamma(a) -
    lnGamma(b) +
    a * Math.log(x) +
    b * Math.log1p(-x);
  const bt = Math.exp(logBt);
  if (x < (a + 1) / (a + b + 2)) {
    return (bt * betaFraction(x, a, b)) / a;
  }
  return 1 - (bt * betaFraction(1 - x, b, a)) / b;
}

function betaFraction(x: number, a: number, b: number): number {
  const maxIterations = 300;
  const epsilon = 3e-14;
  const tiny = 1e-300;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < tiny) d = tiny;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= maxIterations; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < tiny) d = tiny;
    c = 1 + aa / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < tiny) d = tiny;
    c = 1 + aa / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < epsilon) break;
  }
  return h;
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
