/**
 * Pearson + Spearman correlation — pure, dependency-free. Used only as a post-hoc
 * DIAGNOSTIC (e.g. does a first-principles deck score track measured win rates?);
 * never to fit weights. ADDITIVE: nothing here touches the hashed sim path.
 */

export interface CorrelationResult {
  readonly r: number;
  readonly n: number;
}

/** Pearson product-moment correlation. r=0 when n<2 or either series is constant. */
export function pearson(xs: readonly number[], ys: readonly number[]): CorrelationResult {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return { r: 0, n };
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < n; i++) {
    sx += xs[i]!;
    sy += ys[i]!;
  }
  const mx = sx / n;
  const my = sy / n;
  let cov = 0;
  let vx = 0;
  let vy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i]! - mx;
    const dy = ys[i]! - my;
    cov += dx * dy;
    vx += dx * dx;
    vy += dy * dy;
  }
  if (vx === 0 || vy === 0) return { r: 0, n };
  return { r: cov / Math.sqrt(vx * vy), n };
}

/** Fractional (average-for-ties) 1-based ranks. */
function ranks(xs: readonly number[]): number[] {
  const order = xs.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const out = new Array<number>(xs.length).fill(0);
  let k = 0;
  while (k < order.length) {
    let j = k;
    while (j + 1 < order.length && order[j + 1]!.v === order[k]!.v) j++;
    const avgRank = (k + j) / 2 + 1;
    for (let m = k; m <= j; m++) out[order[m]!.i] = avgRank;
    k = j + 1;
  }
  return out;
}

/** Spearman rank correlation = Pearson on the rank-transformed series. */
export function spearman(xs: readonly number[], ys: readonly number[]): CorrelationResult {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return { r: 0, n };
  return pearson(ranks(xs.slice(0, n)), ranks(ys.slice(0, n)));
}
