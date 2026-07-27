/**
 * Per-seat bot policy (botPolicySeat) — lets seat 0 and seat 1 run DIFFERENT
 * bot policies for bot-vs-bot head-to-heads. Defends three things:
 *   1. Equivalence: a UNIFORM per-seat spec ({ 0: 'rollout', 1: 'rollout' })
 *      folds into the monolithic `botPolicy` field and replays to the SAME
 *      runHash as `botPolicy: 'rollout'` alone — no regression.
 *   2. Unset ⇒ omitted: a config without botPolicySeat never carries the key
 *      in the resolved (hashed) config — byte-identical to before.
 *   3. Mixed: { 0: 'heuristic', 1: 'random' } runs without error, and each
 *      seat's actions come from its own policy.
 *
 * Skips gracefully when dist/ is missing, mirroring rollout-pin.test.ts.
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

// Same TINY_BASE shape as rollout-pin.test.ts.
const TINY_BASE = {
  firstPlayer: 'alternating',
  fixHandSizeStall: true,
  termination: 'tiebreak',
  abilitiesOn: true,
  turnCap: 20,
  seedBase: 31337,
  decks: { Onyx: 'Onyx', Radiant: 'Radiant' },
  matchups: [{ p0Deck: 'Onyx', p1Deck: 'Radiant' }],
  gamesPerPairing: 4,
};

const TINY_ROLLOUT_BASE = {
  ...TINY_BASE,
  rollouts: 2,
  rolloutDepth: 1,
  maxCandidates: 5,
};

interface RunSimResult {
  runHash: string;
  config: Record<string, unknown>;
  actionCounts?: unknown;
}

d('botPolicySeat (per-seat bot policy)', () => {
  it('uniform botPolicySeat folds into botPolicy: same runHash as monolithic botPolicy', async () => {
    const { runSim } = (await import(runnerPath)) as { runSim: (c: unknown) => RunSimResult };

    // Yield between the sync sims so one event-loop block stays under vitest's
    // fixed 60s worker-RPC timeout (fatal unhandled error otherwise).
    const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
    const monolithic = runSim({ ...TINY_ROLLOUT_BASE, botPolicy: 'rollout' });
    await tick();
    const perSeat = runSim({ ...TINY_ROLLOUT_BASE, botPolicySeat: { 0: 'rollout', 1: 'rollout' } });

    expect(perSeat.config).not.toHaveProperty('botPolicySeat');
    expect(perSeat.config.botPolicy).toBe('rollout');
    expect(perSeat.runHash).toBe(monolithic.runHash);
  }, 90000);

  it('unset botPolicySeat is omitted from the resolved (hashed) config', async () => {
    const { runSim } = (await import(runnerPath)) as { runSim: (c: unknown) => RunSimResult };

    const before = runSim(TINY_BASE);
    expect(before.config).not.toHaveProperty('botPolicySeat');

    const after = runSim(TINY_BASE);
    expect(after.runHash).toBe(before.runHash);
  }, 90000);

  it('mixed botPolicySeat ({0: heuristic, 1: random}) runs without error', async () => {
    const { runSim } = (await import(runnerPath)) as { runSim: (c: unknown) => RunSimResult };

    const mixed = runSim({ ...TINY_BASE, botPolicySeat: { 0: 'heuristic', 1: 'random' } });
    expect(mixed.config).toHaveProperty('botPolicySeat', { 0: 'heuristic', 1: 'random' });
    expect(mixed.config.botPolicy).toBe('heuristic'); // unaffected default; unused when botPolicySeat is a split
    expect(typeof mixed.runHash).toBe('string');

    // Deterministic: replaying the same mixed config reproduces the same runHash.
    const mixedAgain = runSim({ ...TINY_BASE, botPolicySeat: { 0: 'heuristic', 1: 'random' } });
    expect(mixedAgain.runHash).toBe(mixed.runHash);

    // A seat-0-heuristic/seat-1-random run should diverge from an all-heuristic
    // run of the same base config (seat 1's actions now come from a different
    // policy) — proving each seat actually reads its OWN policy.
    const allHeuristic = runSim(TINY_BASE);
    expect(mixed.runHash).not.toBe(allHeuristic.runHash);
  }, 90000);
});
