/**
 * Wilson score interval for a binomial proportion.
 * More accurate than the normal (Wald) approximation for small n and
 * extreme proportions, and never escapes [0, 1]. Pure, dependency-free.
 */

/** A symmetric-about-the-Wilson-center confidence interval on a proportion. */
export interface WilsonResult {
  /** Lower bound, clamped to [0, 1]. */
  readonly lo: number;
  /** Upper bound, clamped to [0, 1]. */
  readonly hi: number;
  /** Wilson center (the adjusted point estimate), in [0, 1]. */
  readonly mid: number;
  /** Half the interval width, i.e. (hi - lo) / 2. */
  readonly halfWidth: number;
}

/**
 * Wilson interval for `w` successes out of `n` trials at z-multiplier `z`
 * (default 1.96 ≈ 95%). With n = 0 the interval is the whole [0, 1] line
 * and mid = 0.5 (maximally uncertain).
 */
export function wilsonInterval(w: number, n: number, z = 1.96): WilsonResult {
  if (n <= 0) {
    return { lo: 0, hi: 1, mid: 0.5, halfWidth: 0.5 };
  }
  const phat = w / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (phat + z2 / (2 * n)) / denom;
  const margin =
    (z * Math.sqrt((phat * (1 - phat)) / n + z2 / (4 * n * n))) / denom;
  const lo = clamp01(center - margin);
  const hi = clamp01(center + margin);
  return { lo, hi, mid: center, halfWidth: (hi - lo) / 2 };
}

function clamp01(x: number): number {
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}
