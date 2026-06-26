/**
 * Compose the stats core into a balance-read summary over per-faction win
 * counts. ADDITIVE reporting only — never consumed by the hashed sim path, so
 * it cannot perturb determinism. Given { faction: { w, n } } it reports:
 *   - gTestP:          a single imbalance p-value (G-test of win-count uniformity)
 *   - adjustedSpread:  bias-corrected max-min win% spread + bootstrap CI
 *   - perFactionWilson: per-faction win% with a Wilson 95% CI
 *   - worstOffenderZ:  the faction furthest from the field, vs the pooled rest
 */
import { wilsonInterval } from '../stats/wilson.js';
import { bootstrapCI } from '../stats/bootstrap.js';
import { twoProportionZ } from '../stats/binomTest.js';
import { gTestUniform } from '../stats/gtest.js';

/** Successes/trials for one faction. */
export interface FactionCount {
  /** Wins. */
  readonly w: number;
  /** Games (trials). */
  readonly n: number;
}

/** Map of faction name -> its win/game counts. */
export type FactionCounts = Readonly<Record<string, FactionCount>>;

/** Per-faction win-rate point estimate plus a Wilson confidence interval. */
export interface FactionWilson {
  readonly faction: string;
  readonly wins: number;
  readonly games: number;
  /** Raw win% (0..100). */
  readonly winPct: number;
  /** Wilson lower bound as a percentage. */
  readonly loPct: number;
  /** Wilson upper bound as a percentage. */
  readonly hiPct: number;
  /** Wilson interval half-width as percentage points. */
  readonly halfWidthPct: number;
}

/** Bias-corrected spread of win rates with a bootstrap CI (percentage points). */
export interface AdjustedSpread {
  /** Raw max-min win% spread. */
  readonly rawSpreadPct: number;
  /** Expected max-min spread if all factions were truly equal (null bias). */
  readonly expectedNullSpreadPct: number;
  /** rawSpread - expectedNull, floored at 0 (the de-biased estimate). */
  readonly adjustedSpreadPct: number;
  /** Bootstrap CI lower bound on the raw spread (percentage points). */
  readonly bootLoPct: number;
  /** Bootstrap CI upper bound on the raw spread (percentage points). */
  readonly bootHiPct: number;
}

/** The faction whose rate is most extreme vs the pooled remainder. */
export interface WorstOffender {
  readonly faction: string;
  /** Two-proportion z of this faction vs the pooled rest. */
  readonly z: number;
  /** Two-sided p-value. */
  readonly pValue: number;
  /** This faction's win% minus the pooled-rest win% (percentage points). */
  readonly diffPct: number;
}

/** The full additive stats summary for one metric mode. */
export interface StatsSummary {
  /** Which metric these counts represent (e.g. 'win'). Echoed for reporting. */
  readonly mode: string;
  /** G-test imbalance p-value (small => not all factions equally likely). */
  readonly gTestP: number;
  readonly adjustedSpread: AdjustedSpread;
  readonly perFactionWilson: readonly FactionWilson[];
  /** Null when fewer than two factions have games. */
  readonly worstOffenderZ: WorstOffender | null;
}

/** Round to one decimal place, matching the existing summarize() convention. */
function r1(x: number): number {
  return +x.toFixed(1);
}

/**
 * Build the additive stats summary from per-faction counts. `mode` is a free
 * label for the metric (echoed back); it has no effect on the math, keeping
 * this a pure no-op relative to the simulation hash.
 */
export function summarizeStats(
  factionCounts: FactionCounts,
  mode = 'win',
): StatsSummary {
  const factions = Object.keys(factionCounts).sort();
  const perFactionWilson = factions.map((f) =>
    factionWilson(f, factionCounts[f]),
  );

  const counts = factions.map((f) => factionCounts[f]?.w ?? 0);
  const gTestP = gTestUniform(counts).pValue;

  const rates = factions
    .map((f) => factionCounts[f])
    .filter((c): c is FactionCount => !!c && c.n > 0)
    .map((c) => c.w / c.n);

  const adjustedSpread = computeAdjustedSpread(factions, factionCounts, rates);
  const worstOffenderZ = computeWorstOffender(factions, factionCounts);

  return { mode, gTestP, adjustedSpread, perFactionWilson, worstOffenderZ };
}

function factionWilson(faction: string, c: FactionCount | undefined): FactionWilson {
  const wins = c?.w ?? 0;
  const games = c?.n ?? 0;
  const wi = wilsonInterval(wins, games);
  return {
    faction,
    wins,
    games,
    winPct: r1(100 * (games > 0 ? wins / games : 0)),
    loPct: r1(100 * wi.lo),
    hiPct: r1(100 * wi.hi),
    halfWidthPct: r1(100 * wi.halfWidth),
  };
}

function spreadOf(rates: readonly number[]): number {
  if (rates.length < 2) return 0;
  return Math.max(...rates) - Math.min(...rates);
}

function computeAdjustedSpread(
  factions: readonly string[],
  fc: FactionCounts,
  rates: readonly number[],
): AdjustedSpread {
  const rawSpread = spreadOf(rates);
  const expectedNull = expectedNullSpread(factions, fc);
  const boot = bootstrapCI(rates, spreadOf, 0.95, 2000, 0x5eed1234);
  return {
    rawSpreadPct: r1(100 * rawSpread),
    expectedNullSpreadPct: r1(100 * expectedNull),
    adjustedSpreadPct: r1(100 * Math.max(0, rawSpread - expectedNull)),
    bootLoPct: r1(100 * boot.lo),
    bootHiPct: r1(100 * boot.hi),
  };
}

/**
 * Expected max-min spread under the null that every faction shares the pooled
 * win rate, estimated by a deterministic parametric bootstrap: resample each
 * faction's wins ~ Binomial(n_f, pPool) and record the spread. This is the
 * upward bias of bare max-min that we subtract off.
 */
function expectedNullSpread(
  factions: readonly string[],
  fc: FactionCounts,
): number {
  const active = factions
    .map((f) => fc[f])
    .filter((c): c is FactionCount => !!c && c.n > 0);
  if (active.length < 2) return 0;
  const totW = active.reduce((a, c) => a + c.w, 0);
  const totN = active.reduce((a, c) => a + c.n, 0);
  const pPool = totN > 0 ? totW / totN : 0;
  const reps = 2000;
  let a = 0x1234abcd >>> 0;
  const rand = (): number => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  let sum = 0;
  for (let r = 0; r < reps; r++) {
    const sim = active.map((c) => binomDraw(c.n, pPool, rand));
    sum += spreadOf(sim);
  }
  return sum / reps;
}

/** Draw a Binomial(n, p) proportion using `n` Bernoulli trials from `rand`. */
function binomDraw(n: number, p: number, rand: () => number): number {
  if (n <= 0) return 0;
  let k = 0;
  for (let i = 0; i < n; i++) if (rand() < p) k++;
  return k / n;
}

function computeWorstOffender(
  factions: readonly string[],
  fc: FactionCounts,
): WorstOffender | null {
  const active = factions.filter((f) => (fc[f]?.n ?? 0) > 0);
  if (active.length < 2) return null;
  const totW = active.reduce((a, f) => a + (fc[f]?.w ?? 0), 0);
  const totN = active.reduce((a, f) => a + (fc[f]?.n ?? 0), 0);

  let worst: WorstOffender | null = null;
  for (const f of active) {
    const c = fc[f]!;
    const restW = totW - c.w;
    const restN = totN - c.n;
    if (restN <= 0) continue;
    const tp = twoProportionZ(c.w, c.n, restW, restN);
    if (worst === null || Math.abs(tp.z) > Math.abs(worst.z)) {
      worst = {
        faction: f,
        z: tp.z,
        pValue: tp.pValue,
        diffPct: r1(100 * tp.diff),
      };
    }
  }
  return worst;
}
