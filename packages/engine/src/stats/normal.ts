/**
 * Standard-normal helpers (CDF / survival) and a chi-square upper-tail
 * p-value, all dependency-free closed-form approximations. Shared by the
 * binomial, two-proportion, and G-test modules.
 */

/** Standard-normal cumulative distribution function Φ(z). */
export function normalCdf(z: number): number {
  assertFinite(z, 'z');
  return z < 0 ? normalSurvival(-z) : 1 - normalSurvival(z);
}

/** Numerically stable upper-tail probability P(Z >= z). */
export function normalSurvival(z: number): number {
  assertFinite(z, 'z');
  if (z < 0) return normalCdf(-z);
  if (z >= 8) return Math.exp(normalLogSurvival(z));
  return 0.5 * erfc(z / Math.SQRT2);
}

/** Log upper-tail probability, stable well beyond ordinary double tail range. */
export function normalLogSurvival(z: number): number {
  assertFinite(z, 'z');
  if (z < 0) return Math.log(normalCdf(-z));
  if (z < 8) return Math.log(normalSurvival(z));
  const inverseSquare = 1 / (z * z);
  const millsSeries =
    1 -
    inverseSquare +
    3 * inverseSquare ** 2 -
    15 * inverseSquare ** 3 +
    105 * inverseSquare ** 4 -
    945 * inverseSquare ** 5 +
    10_395 * inverseSquare ** 6 -
    135_135 * inverseSquare ** 7 +
    2_027_025 * inverseSquare ** 8;
  return (
    -0.5 * z * z -
    Math.log(z) -
    0.5 * Math.log(2 * Math.PI) +
    Math.log(millsSeries)
  );
}

/** Two-sided standard-normal tail probability: P(|Z| >= |z|). */
export function normalTwoSidedP(z: number): number {
  assertFinite(z, 'z');
  return Math.min(1, 2 * normalSurvival(Math.abs(z)));
}

/**
 * Upper-tail p-value of the chi-square distribution: P(X > x) with `df`
 * degrees of freedom. Uses the regularized upper incomplete gamma Q(df/2, x/2).
 */
export function chiSquareUpperP(x: number, df: number): number {
  if (!Number.isFinite(x) || x < 0 || !Number.isSafeInteger(df) || df <= 0) {
    throw new RangeError('x must be finite/nonnegative and df must be a positive safe integer');
  }
  if (x <= 0) return 1;
  return gammaincUpper(df / 2, x / 2);
}

/** Numerical Recipes erfc approximation; stable because it never subtracts from 1. */
function erfc(x: number): number {
  const z = Math.abs(x);
  const t = 1 / (1 + 0.5 * z);
  let polynomial = 0.17087277;
  polynomial = -0.82215223 + t * polynomial;
  polynomial = 1.48851587 + t * polynomial;
  polynomial = -1.13520398 + t * polynomial;
  polynomial = 0.27886807 + t * polynomial;
  polynomial = -0.18628806 + t * polynomial;
  polynomial = 0.09678418 + t * polynomial;
  polynomial = 0.37409196 + t * polynomial;
  polynomial = 1.00002368 + t * polynomial;
  const ans = t * Math.exp(-z * z - 1.26551223 + t * polynomial);
  return x >= 0 ? ans : 2 - ans;
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
  if (!Number.isFinite(z) || z <= 0) {
    throw new RangeError('z must be finite and positive');
  }
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

function assertFinite(value: number, name: string): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${name} must be finite`);
  }
}
