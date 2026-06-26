/**
 * Standard-normal helpers (CDF / survival) and a chi-square upper-tail
 * p-value, all dependency-free closed-form approximations. Shared by the
 * binomial, two-proportion, and G-test modules.
 */

/** Standard-normal cumulative distribution function Φ(z). */
export function normalCdf(z: number): number {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

/** Two-sided standard-normal tail probability: P(|Z| >= |z|). */
export function normalTwoSidedP(z: number): number {
  return 2 * (1 - normalCdf(Math.abs(z)));
}

/**
 * Upper-tail p-value of the chi-square distribution: P(X > x) with `df`
 * degrees of freedom. Uses the regularized upper incomplete gamma Q(df/2, x/2).
 */
export function chiSquareUpperP(x: number, df: number): number {
  if (df <= 0) return 1;
  if (x <= 0) return 1;
  return gammaincUpper(df / 2, x / 2);
}

/** Abramowitz & Stegun 7.1.26 error function (|error| < 1.5e-7). */
function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) *
      t +
      0.254829592) *
      t *
      Math.exp(-ax * ax);
  return sign * y;
}

/**
 * Regularized upper incomplete gamma Q(s, x) = Γ(s, x) / Γ(s).
 * Series expansion for x < s+1, continued fraction otherwise (Numerical
 * Recipes gser/gcf). `s` and `x` are assumed positive.
 */
function gammaincUpper(s: number, x: number): number {
  const lng = lnGamma(s);
  if (x < s + 1) {
    return 1 - gser(s, x, lng);
  }
  return gcf(s, x, lng);
}

function gser(s: number, x: number, lng: number): number {
  let sum = 1 / s;
  let term = sum;
  let ap = s;
  for (let i = 0; i < 200; i++) {
    ap += 1;
    term *= x / ap;
    sum += term;
    if (Math.abs(term) < Math.abs(sum) * 1e-15) break;
  }
  return sum * Math.exp(-x + s * Math.log(x) - lng);
}

function gcf(s: number, x: number, lng: number): number {
  const tiny = 1e-300;
  let b = x + 1 - s;
  let c = 1 / tiny;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < 200; i++) {
    const an = -i * (i - s);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < tiny) d = tiny;
    c = b + an / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-15) break;
  }
  return Math.exp(-x + s * Math.log(x) - lng) * h;
}

/** Lanczos approximation of ln Γ(z). */
export function lnGamma(z: number): number {
  const g = [
    76.18009172947146, -86.50532032941677, 24.01409824083091,
    -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5,
  ];
  let x = z;
  let tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (let j = 0; j < 6; j++) {
    x += 1;
    ser += (g[j] ?? 0) / x;
  }
  return -tmp + Math.log((2.5066282746310005 * ser) / z);
}
