/**
 * Exact two-sided binomial test against a hypothesized proportion, and a
 * two-proportion z-test for comparing two independent rates (the worst-
 * offender comparison: one faction vs the pooled rest). Dependency-free.
 */
import { lnGamma, normalCdf, normalTwoSidedP } from './normal.js';

/** Result of a two-sided binomial test. */
export interface BinomTestResult {
  /** Observed successes. */
  readonly k: number;
  /** Number of trials. */
  readonly n: number;
  /** Observed proportion k/n (0 when n = 0). */
  readonly phat: number;
  /** Hypothesized proportion tested against. */
  readonly p0: number;
  /** Two-sided p-value (method of small p-values). */
  readonly pValue: number;
}

/** Result of a two-proportion z-test. */
export interface TwoPropResult {
  /** Difference of observed proportions p1 - p2. */
  readonly diff: number;
  /** z statistic (pooled-variance form). */
  readonly z: number;
  /** Two-sided p-value. */
  readonly pValue: number;
}

/**
 * Exact two-sided binomial test of `k` successes in `n` trials against the
 * null proportion `p0` (default 0.5). The two-sided p-value sums the
 * probabilities of all outcomes no more likely than the observed one.
 */
export function binomTest(k: number, n: number, p0 = 0.5): BinomTestResult {
  if (n <= 0) {
    return { k, n, phat: 0, p0, pValue: 1 };
  }
  const pObs = binomPmf(k, n, p0);
  const tol = pObs * (1 + 1e-9);
  let pValue = 0;
  for (let i = 0; i <= n; i++) {
    const pi = binomPmf(i, n, p0);
    if (pi <= tol) pValue += pi;
  }
  return { k, n, phat: k / n, p0, pValue: Math.min(1, pValue) };
}

/**
 * Two-proportion z-test: w1/n1 versus w2/n2. Uses the pooled proportion for
 * the standard error (test of equality). Zero combined trials => null z.
 */
export function twoProportionZ(
  w1: number,
  n1: number,
  w2: number,
  n2: number,
): TwoPropResult {
  if (n1 <= 0 || n2 <= 0) {
    return { diff: 0, z: 0, pValue: 1 };
  }
  const p1 = w1 / n1;
  const p2 = w2 / n2;
  const pPool = (w1 + w2) / (n1 + n2);
  const se = Math.sqrt(pPool * (1 - pPool) * (1 / n1 + 1 / n2));
  const diff = p1 - p2;
  if (se === 0) {
    return { diff, z: 0, pValue: 1 };
  }
  const z = diff / se;
  return { diff, z, pValue: normalTwoSidedP(z) };
}

/** Binomial PMF P(X = k) for n trials at probability p, via log-gamma. */
function binomPmf(k: number, n: number, p: number): number {
  if (k < 0 || k > n) return 0;
  if (p <= 0) return k === 0 ? 1 : 0;
  if (p >= 1) return k === n ? 1 : 0;
  const logC =
    lnGamma(n + 1) - lnGamma(k + 1) - lnGamma(n - k + 1);
  const logP = logC + k * Math.log(p) + (n - k) * Math.log(1 - p);
  return Math.exp(logP);
}

/** Re-exported so consumers needing the raw normal CDF have one import. */
export { normalCdf };
