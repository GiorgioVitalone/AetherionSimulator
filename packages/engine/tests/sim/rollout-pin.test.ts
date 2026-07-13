/**
 * Pinned rollout regression test — T2. All prior pins in
 * `ruleset-v1-lock.test.ts` cover the `heuristic` bot policy only; this is the
 * first regression pin that exercises `botPolicy: 'rollout'`. It defends two
 * things at once:
 *   1. The rollout pilot's byte-identical determinism (a fixed-seed, tiny
 *      config always replays to the same runHash).
 *   2. The T2 hash-preservation contract: `candidateGen` / `candidateKindCaps`
 *      are OMITTED from the resolved (hashed) config when unset — so this test
 *      would fail loudly if a future change accidentally hashed a legacy-mode
 *      default — while an explicit `candidateGen: 'full'` run both surfaces
 *      the key AND produces a different runHash (the new dimension is live).
 *
 * Skips gracefully when dist/ is missing, mirroring ruleset-v1-lock.test.ts /
 * sim-runner-determinism.test.ts.
 *
 * To recompute PINNED_HASH after an intentional rollout-pilot change: run the
 * `TINY_ROLLOUT_BASE` config below through `runSim` once, read `.runHash` off
 * the result, and paste it in. (Do NOT hand-edit the hash to make a test pass
 * — that defeats the point of a regression pin.)
 */
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const runnerPath = join(here, '..', '..', 'sim-runner.mjs');
const distPath = join(here, '..', '..', 'dist', 'index.js');

const ready = existsSync(runnerPath) && existsSync(distPath);
const d = ready ? describe : describe.skip;

// Same TINY_BASE shape as ruleset-v1-lock.test.ts (fixed seed 31337, two
// factions, few games) plus a minimal rollout configuration so the search stays
// fast: rollouts:2, rolloutDepth:1, maxCandidates:5, 4 games.
const TINY_ROLLOUT_BASE = {
  firstPlayer: 'alternating',
  fixHandSizeStall: true,
  termination: 'tiebreak',
  abilitiesOn: true,
  turnCap: 20,
  seedBase: 31337,
  decks: { Onyx: 'Onyx', Radiant: 'Radiant' },
  matchups: [{ p0Deck: 'Onyx', p1Deck: 'Radiant' }],
  gamesPerPairing: 4,
  botPolicy: 'rollout',
  rollouts: 2,
  rolloutDepth: 1,
  maxCandidates: 5,
};

// Computed once via runSim(TINY_ROLLOUT_BASE).runHash — see recompute note above.
const PINNED_HASH = '75445f3d041917bc';

interface RunSimResult {
  runHash: string;
  config: Record<string, unknown>;
  candidatePruning?: { raw: number; retained: number; prunedByKind: Record<string, number> };
}

d('rollout pin (T2)', () => {
  it('LEGACY rollout config replays to the pinned runHash', async () => {
    const { runSim } = (await import(runnerPath)) as { runSim: (c: unknown) => RunSimResult };
    const result = runSim(TINY_ROLLOUT_BASE);
    expect(result.runHash).toBe(PINNED_HASH);
  }, 30000);

  it('resolved config omits candidateGen/candidateKindCaps when unset; candidateGen:"full" both hashes and diverges', async () => {
    const { runSim } = (await import(runnerPath)) as { runSim: (c: unknown) => RunSimResult };
    const legacy = runSim(TINY_ROLLOUT_BASE);
    expect(legacy.config).not.toHaveProperty('candidateGen');
    expect(legacy.config).not.toHaveProperty('candidateKindCaps');

    const full = runSim({ ...TINY_ROLLOUT_BASE, candidateGen: 'full' });
    expect(full.config).toHaveProperty('candidateGen', 'full');
    expect(full.runHash).not.toBe(legacy.runHash);
  }, 30000);

  it('__diag-style candidatePruning telemetry is present for a rollout run and never affects runHash', async () => {
    const { runSim } = (await import(runnerPath)) as { runSim: (c: unknown) => RunSimResult };
    const runA = runSim(TINY_ROLLOUT_BASE);
    const runB = runSim(TINY_ROLLOUT_BASE);

    expect(runA.candidatePruning).toBeDefined();
    expect(runA.candidatePruning!.raw).toBeGreaterThan(0);
    expect(runA.candidatePruning!.retained).toBeGreaterThan(0);
    expect(typeof runA.candidatePruning!.prunedByKind).toBe('object');

    // Two runs, identical config, telemetry inspected in between — same runHash.
    expect(runA.runHash).toBe(runB.runHash);
  }, 30000);
});
