/**
 * Deterministic bootstrap resampling. Randomness comes solely from a seeded
 * mulberry32 stream (the same generator the .mjs harnesses use), so a given
 * (data, seed, resamples) triple always yields byte-identical bounds.
 */

/** A percentile bootstrap confidence interval on a statistic. */
export interface BootstrapResult {
  /** The statistic evaluated on the original sample. */
  readonly point: number;
  /** Lower percentile bound. */
  readonly lo: number;
  /** Upper percentile bound. */
  readonly hi: number;
  /** Mean of the bootstrap replicate statistics. */
  readonly mean: number;
  /** Number of resamples performed. */
  readonly resamples: number;
}

/** Mulberry32 PRNG factory — identical to the runner's `rngf`. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Percentile bootstrap CI for `statistic` over `data`. Draws `resamples`
 * with-replacement resamples of the same size as `data` using a mulberry32
 * stream seeded by `seed`, applies `statistic` to each, and reports the
 * lower/upper percentile bounds at confidence `conf` (default 0.95).
 *
 * Empty data yields an all-zero degenerate result.
 */
export function bootstrapCI(
  data: readonly number[],
  statistic: (sample: readonly number[]) => number,
  conf = 0.95,
  resamples = 2000,
  seed = 0x9e3779b9,
): BootstrapResult {
  const n = data.length;
  if (n === 0 || resamples <= 0) {
    return { point: 0, lo: 0, hi: 0, mean: 0, resamples: 0 };
  }
  const point = statistic(data);
  const rand = mulberry32(seed);
  const reps = new Array<number>(resamples);
  const buf = new Array<number>(n);
  for (let r = 0; r < resamples; r++) {
    for (let i = 0; i < n; i++) {
      const idx = Math.floor(rand() * n);
      buf[i] = data[idx] ?? 0;
    }
    reps[r] = statistic(buf);
  }
  reps.sort((x, y) => x - y);
  const alpha = (1 - conf) / 2;
  const lo = percentileOfSorted(reps, alpha);
  const hi = percentileOfSorted(reps, 1 - alpha);
  const mean = reps.reduce((a, b) => a + b, 0) / resamples;
  return { point, lo, hi, mean, resamples };
}

/** Linear-interpolated percentile `p` (in [0,1]) of an ascending array. */
function percentileOfSorted(sorted: readonly number[], p: number): number {
  const n = sorted.length;
  if (n === 0) return 0;
  if (n === 1) return sorted[0] ?? 0;
  const rank = p * (n - 1);
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  const lv = sorted[lower] ?? 0;
  const uv = sorted[upper] ?? 0;
  if (lower === upper) return lv;
  return lv + (uv - lv) * (rank - lower);
}
