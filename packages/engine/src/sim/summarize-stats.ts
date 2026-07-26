/**
 * Schedule-aware balance inference.
 *
 * The old summary tested raw faction win totals for uniformity, bootstrapped
 * four already-aggregated rates, and selected a worst faction with an
 * unadjusted overlapping z-test. Those quantities ignored exposure, game
 * coupling, clustering, and selection. This module keeps Wilson intervals as
 * explicitly descriptive marginals and uses the actual decided-game schedule
 * for inference:
 *
 * - one decided game always contributes exactly one winner and one loser;
 * - the null randomizes the winner within each scheduled matchup;
 * - maxT permutation p-values adjust all pairwise faction contrasts together;
 * - spread uncertainty resamples declared matchup×replicate clusters.
 */
import { mulberry32 } from '../stats/bootstrap.js';
import { wilsonInterval } from '../stats/wilson.js';

export interface FactionCount {
  readonly w: number;
  readonly n: number;
}

export type FactionCounts = Readonly<Record<string, FactionCount>>;

export interface ExperimentGame {
  readonly fA: string;
  readonly fB: string;
  readonly winner: 0 | 1 | 'draw';
  readonly decided: boolean;
  readonly seed?: number;
  readonly replicate?: number;
  /** Predeclared common-random/seat block. Games in one block are resampled
   * together so seat and first-player counterbalancing is never broken. */
  readonly scheduleBlockId?: number | string;
  readonly matchupId?: string;
  readonly terminalReason?: string;
}

export interface FactionWilson {
  readonly faction: string;
  readonly wins: number;
  readonly games: number;
  readonly winPct: number;
  readonly loPct: number;
  readonly hiPct: number;
  readonly halfWidthPct: number;
  readonly interpretation: 'descriptive_marginal';
}

export interface SimultaneousContrast {
  readonly factionA: string;
  readonly factionB: string;
  readonly differencePct: number;
  readonly maxTAdjustedP: number;
}

export interface StatsSummary {
  readonly mode: string;
  readonly validForInference: boolean;
  readonly validityBlockers: readonly string[];
  readonly method: 'schedule_preserving_permutation_maxT';
  readonly observationUnit: 'decided_game';
  readonly clusterUnit: 'matchup_x_schedule_block';
  readonly estimand: 'faction_marginal_win_rate_difference_in_supplied_schedule';
  readonly decidedGames: number;
  readonly schedulePermutationP: number | null;
  readonly spread: {
    readonly rawSpreadPct: number;
    readonly clusterBootstrapLoPct: number | null;
    readonly clusterBootstrapHiPct: number | null;
    readonly resamples: number;
  };
  readonly simultaneousContrasts: readonly SimultaneousContrast[];
  readonly perFactionWilson: readonly FactionWilson[];
}

interface ScheduledGame {
  readonly fA: string;
  readonly fB: string;
  readonly winner: 0 | 1;
  readonly clusterId: string;
}

const RESAMPLES = 2000;

export function summarizeStats(
  factionCounts: FactionCounts,
  mode = 'win',
  games: readonly ExperimentGame[] = [],
  externalValidityBlockers: readonly string[] = [],
): StatsSummary {
  assertFactionCounts(factionCounts);
  const factions = Object.keys(factionCounts).sort();
  const perFactionWilson = factions.map((faction) =>
    factionWilson(faction, factionCounts[faction]!),
  );
  const scheduled = normalizeGames(games);
  const rawSpreadPct = r1(100 * spreadFromCounts(factionCounts));
  const validityBlockers = [
    ...new Set([
      ...externalValidityBlockers,
      ...(scheduled.length === 0 ? ['insufficient_decided_schedule'] : []),
      ...(factions.length < 2 ? ['insufficient_faction_population'] : []),
    ]),
  ];
  if (scheduled.length === 0 || factions.length < 2) {
    return {
      mode,
      validForInference: false,
      validityBlockers,
      method: 'schedule_preserving_permutation_maxT',
      observationUnit: 'decided_game',
      clusterUnit: 'matchup_x_schedule_block',
      estimand: 'faction_marginal_win_rate_difference_in_supplied_schedule',
      decidedGames: scheduled.length,
      schedulePermutationP: null,
      spread: {
        rawSpreadPct,
        clusterBootstrapLoPct: null,
        clusterBootstrapHiPct: null,
        resamples: 0,
      },
      simultaneousContrasts: [],
      perFactionWilson,
    };
  }

  const observedRates = ratesFromGames(scheduled, factions);
  const observedSpread = spreadOfRates(observedRates);
  const contrastDefs = pairwise(factions);
  const observedContrasts = contrastDefs.map(([a, b]) =>
    Math.abs((observedRates.get(a) ?? 0) - (observedRates.get(b) ?? 0)),
  );
  const exceedContrast = new Array<number>(contrastDefs.length).fill(0);
  let exceedSpread = 0;
  const random = mulberry32(0x51ced123);
  for (let replicate = 0; replicate < RESAMPLES; replicate++) {
    const permuted = scheduled.map((game): ScheduledGame => {
      const winner: 0 | 1 = random() < 0.5 ? 0 : 1;
      return { ...game, winner };
    });
    const rates = ratesFromGames(permuted, factions);
    const maxDifference = maxPairwiseDifference(rates, contrastDefs);
    if (maxDifference >= observedSpread - 1e-12) exceedSpread++;
    for (let index = 0; index < observedContrasts.length; index++) {
      if (maxDifference >= observedContrasts[index]! - 1e-12) {
        exceedContrast[index]!++;
      }
    }
  }

  const bootstrap = clusterBootstrapSpread(scheduled, factions);
  return {
    mode,
    validForInference: validityBlockers.length === 0,
    validityBlockers,
    method: 'schedule_preserving_permutation_maxT',
    observationUnit: 'decided_game',
    clusterUnit: 'matchup_x_schedule_block',
    estimand: 'faction_marginal_win_rate_difference_in_supplied_schedule',
    decidedGames: scheduled.length,
    schedulePermutationP: (exceedSpread + 1) / (RESAMPLES + 1),
    spread: {
      rawSpreadPct: r1(100 * observedSpread),
      clusterBootstrapLoPct: r1(100 * bootstrap.lo),
      clusterBootstrapHiPct: r1(100 * bootstrap.hi),
      resamples: RESAMPLES,
    },
    simultaneousContrasts: contrastDefs.map(([factionA, factionB], index) => ({
      factionA,
      factionB,
      differencePct: r1(
        100 *
          ((observedRates.get(factionA) ?? 0) -
            (observedRates.get(factionB) ?? 0)),
      ),
      maxTAdjustedP: (exceedContrast[index]! + 1) / (RESAMPLES + 1),
    })),
    perFactionWilson,
  };
}

function normalizeGames(games: readonly ExperimentGame[]): ScheduledGame[] {
  return games.flatMap((game, index) => {
    if (!game.decided || (game.winner !== 0 && game.winner !== 1) || game.fA === game.fB) {
      return [];
    }
    const matchup =
      game.matchupId ?? [game.fA, game.fB].sort().join('|');
    const replicate =
      game.scheduleBlockId ?? game.replicate ?? game.seed ?? index;
    return [
      {
        fA: game.fA,
        fB: game.fB,
        winner: game.winner,
        clusterId: `${matchup}|${String(replicate)}`,
      },
    ];
  });
}

function ratesFromGames(
  games: readonly ScheduledGame[],
  factions: readonly string[],
): Map<string, number> {
  const counts = new Map<string, { wins: number; games: number }>(
    factions.map((faction) => [faction, { wins: 0, games: 0 }]),
  );
  for (const game of games) {
    const a = counts.get(game.fA);
    const b = counts.get(game.fB);
    if (a === undefined || b === undefined) continue;
    a.games++;
    b.games++;
    if (game.winner === 0) a.wins++;
    else b.wins++;
  }
  return new Map(
    [...counts].map(([faction, count]) => [
      faction,
      count.games === 0 ? 0 : count.wins / count.games,
    ]),
  );
}

function clusterBootstrapSpread(
  games: readonly ScheduledGame[],
  factions: readonly string[],
): { readonly lo: number; readonly hi: number } {
  const byCluster = new Map<string, ScheduledGame[]>();
  for (const game of games) {
    const cluster = byCluster.get(game.clusterId) ?? [];
    cluster.push(game);
    byCluster.set(game.clusterId, cluster);
  }
  const clusters = [...byCluster.values()];
  const random = mulberry32(0xc1a57e12);
  const values: number[] = [];
  for (let replicate = 0; replicate < RESAMPLES; replicate++) {
    const sample: ScheduledGame[] = [];
    for (let index = 0; index < clusters.length; index++) {
      const selected = clusters[Math.floor(random() * clusters.length)]!;
      sample.push(...selected);
    }
    values.push(spreadOfRates(ratesFromGames(sample, factions)));
  }
  values.sort((a, b) => a - b);
  return {
    lo: percentile(values, 0.025),
    hi: percentile(values, 0.975),
  };
}

function factionWilson(faction: string, count: FactionCount): FactionWilson {
  const interval = wilsonInterval(count.w, count.n);
  return {
    faction,
    wins: count.w,
    games: count.n,
    winPct: r1(100 * (count.n === 0 ? 0 : count.w / count.n)),
    loPct: r1(100 * interval.lo),
    hiPct: r1(100 * interval.hi),
    halfWidthPct: r1(100 * interval.halfWidth),
    interpretation: 'descriptive_marginal',
  };
}

function pairwise(factions: readonly string[]): readonly (readonly [string, string])[] {
  const pairs: [string, string][] = [];
  for (let a = 0; a < factions.length; a++) {
    for (let b = a + 1; b < factions.length; b++) {
      pairs.push([factions[a]!, factions[b]!]);
    }
  }
  return pairs;
}

function maxPairwiseDifference(
  rates: ReadonlyMap<string, number>,
  pairs: readonly (readonly [string, string])[],
): number {
  return pairs.reduce(
    (max, [a, b]) =>
      Math.max(max, Math.abs((rates.get(a) ?? 0) - (rates.get(b) ?? 0))),
    0,
  );
}

function spreadOfRates(rates: ReadonlyMap<string, number>): number {
  const values = [...rates.values()];
  return values.length < 2 ? 0 : Math.max(...values) - Math.min(...values);
}

function spreadFromCounts(counts: FactionCounts): number {
  const rates = Object.values(counts)
    .filter((count) => count.n > 0)
    .map((count) => count.w / count.n);
  return rates.length < 2 ? 0 : Math.max(...rates) - Math.min(...rates);
}

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]!;
}

function assertFactionCounts(counts: FactionCounts): void {
  for (const [faction, count] of Object.entries(counts)) {
    if (
      !Number.isSafeInteger(count.w) ||
      !Number.isSafeInteger(count.n) ||
      count.w < 0 ||
      count.n < 0 ||
      count.w > count.n
    ) {
      throw new RangeError(`Invalid faction counts for ${faction}`);
    }
  }
}

function r1(value: number): number {
  return +value.toFixed(1);
}
