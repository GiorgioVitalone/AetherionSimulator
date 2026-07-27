import { describe, expect, it } from 'vitest';
import {
  summarizeStats,
  type ExperimentGame,
  type FactionCounts,
} from '../../src/sim/summarize-stats.js';
import { mulberry32 } from '../../src/stats/bootstrap.js';

function scheduledGames(
  factionA: string,
  factionB: string,
  games: number,
  winsA: number,
  offset = 0,
): ExperimentGame[] {
  return Array.from({ length: games }, (_, replicate) => ({
    fA: factionA,
    fB: factionB,
    winner: replicate < winsA ? 0 : 1,
    decided: true,
    replicate: replicate + offset,
    matchupId: [factionA, factionB].sort().join('|'),
  }));
}

function countsFromGames(games: readonly ExperimentGame[]): FactionCounts {
  const mutable: Record<string, { w: number; n: number }> = {};
  for (const game of games) {
    if (!game.decided || (game.winner !== 0 && game.winner !== 1)) continue;
    mutable[game.fA] ??= { w: 0, n: 0 };
    mutable[game.fB] ??= { w: 0, n: 0 };
    mutable[game.fA]!.n++;
    mutable[game.fB]!.n++;
    mutable[game.winner === 0 ? game.fA : game.fB]!.w++;
  }
  return mutable;
}

describe('schedule-aware experiment statistics', () => {
  it('is deterministic and names its observation/cluster/estimand contract', () => {
    const games = scheduledGames('Onyx', 'Radiant', 100, 50);
    const counts = countsFromGames(games);
    const a = summarizeStats(counts, 'win', games);
    const b = summarizeStats(counts, 'win', games);
    expect(a).toEqual(b);
    expect(a).toMatchObject({
      validForInference: true,
      method: 'schedule_preserving_permutation_maxT',
      observationUnit: 'decided_game',
      clusterUnit: 'matchup_x_schedule_block',
      estimand: 'faction_marginal_win_rate_difference_in_supplied_schedule',
    });
  });

  it('does not mistake unequal exposure for faction imbalance', () => {
    const games = [
      ...scheduledGames('Onyx', 'Radiant', 200, 100),
      ...scheduledGames('Onyx', 'Verdant', 20, 10, 1_000),
    ];
    const summary = summarizeStats(countsFromGames(games), 'win', games);
    expect(summary.schedulePermutationP).toBeGreaterThan(0.5);
    expect(summary.spread.rawSpreadPct).toBe(0);
  });

  it('recovers a strong injected schedule-preserving faction effect', () => {
    const games = scheduledGames('Onyx', 'Radiant', 120, 96);
    const summary = summarizeStats(countsFromGames(games), 'win', games);
    expect(summary.schedulePermutationP).toBeLessThan(0.01);
    expect(summary.spread.rawSpreadPct).toBe(60);
    expect(summary.simultaneousContrasts[0]).toMatchObject({
      factionA: 'Onyx',
      factionB: 'Radiant',
      differencePct: 60,
    });
    expect(summary.simultaneousContrasts[0]!.maxTAdjustedP).toBeLessThan(0.01);
  });

  it('controls selected-worst family error under the predeclared four-faction null', () => {
    const factions = ['Onyx', 'Radiant', 'Sapphire', 'Verdant'];
    const random = mulberry32(0x4d415854);
    const studies = 160;
    let familyRejections = 0;
    for (let study = 0; study < studies; study++) {
      const games: ExperimentGame[] = [];
      for (let left = 0; left < factions.length; left++) {
        for (let right = left + 1; right < factions.length; right++) {
          for (let block = 0; block < 3; block++) {
            for (let withinBlock = 0; withinBlock < 4; withinBlock++) {
              games.push({
                fA: factions[left]!,
                fB: factions[right]!,
                winner: random() < 0.5 ? 0 : 1,
                decided: true,
                matchupId: `${factions[left]}|${factions[right]}`,
                scheduleBlockId: block,
              });
            }
          }
        }
      }
      const summary = summarizeStats(countsFromGames(games), 'win', games);
      if (
        summary.simultaneousContrasts.some(
          (contrast) => contrast.maxTAdjustedP <= 0.05,
        )
      ) {
        familyRejections++;
      }
    }

    // A deterministic operating-characteristic check. The small allowance
    // above alpha covers finite Monte Carlo resolution without weakening the
    // predeclared production threshold.
    expect(familyRejections / studies).toBeLessThanOrEqual(0.075);
  }, 15_000);

  it('keeps per-faction Wilson intervals explicitly descriptive', () => {
    const games = scheduledGames('Onyx', 'Radiant', 100, 65);
    const summary = summarizeStats(countsFromGames(games), 'win', games);
    const onyx = summary.perFactionWilson.find(
      (faction) => faction.faction === 'Onyx',
    );
    expect(onyx).toMatchObject({
      winPct: 65,
      interpretation: 'descriptive_marginal',
    });
    expect(onyx!.loPct).toBeLessThan(65);
    expect(onyx!.hiPct).toBeGreaterThan(65);
  });

  it('refuses inferential fields when only aggregate counts are supplied', () => {
    const summary = summarizeStats({
      Onyx: { w: 65, n: 100 },
      Radiant: { w: 35, n: 100 },
    });
    expect(summary.validForInference).toBe(false);
    expect(summary.validityBlockers).toContain('insufficient_decided_schedule');
    expect(summary.schedulePermutationP).toBeNull();
    expect(summary.simultaneousContrasts).toEqual([]);
  });

  it('retains estimates but blocks inference when an upstream validity gate is red', () => {
    const games = scheduledGames('Onyx', 'Radiant', 100, 50);
    const counts = countsFromGames(games);
    const summary = summarizeStats(
      counts,
      'win',
      games,
      ['rules_artifact_status:experimental'],
    );
    expect(summary.validForInference).toBe(false);
    expect(summary.validityBlockers).toEqual([
      'rules_artifact_status:experimental',
    ]);
    expect(summary.schedulePermutationP).not.toBeNull();
  });

  it('resamples declared seat/seed blocks as clusters instead of independent games', () => {
    const independent = scheduledGames('Onyx', 'Radiant', 40, 24);
    const blocked = independent.map((game, index) => ({
      ...game,
      winner: Math.floor(index / 4) < 6 ? 0 as const : 1 as const,
      scheduleBlockId: Math.floor(index / 4),
    }));
    const independentSummary = summarizeStats(
      countsFromGames(independent),
      'win',
      independent,
    );
    const blockedSummary = summarizeStats(
      countsFromGames(blocked),
      'win',
      blocked,
    );
    const independentWidth =
      independentSummary.spread.clusterBootstrapHiPct! -
      independentSummary.spread.clusterBootstrapLoPct!;
    const blockedWidth =
      blockedSummary.spread.clusterBootstrapHiPct! -
      blockedSummary.spread.clusterBootstrapLoPct!;
    expect(blockedWidth).toBeGreaterThan(independentWidth);
  });

  it('rejects incoherent aggregate domains', () => {
    expect(() =>
      summarizeStats({ Onyx: { w: 11, n: 10 } }),
    ).toThrow(RangeError);
  });
});
