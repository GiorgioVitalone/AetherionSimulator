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
const PINNED_HASH = 'd3e0878929a5c6e1';

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

  it('resolved config omits rolloutSeedMode when unset; "actionKey" both hashes and diverges (T3)', async () => {
    const { runSim } = (await import(runnerPath)) as { runSim: (c: unknown) => RunSimResult };
    const legacy = runSim(TINY_ROLLOUT_BASE);
    expect(legacy.config).not.toHaveProperty('rolloutSeedMode');
    expect(legacy.runHash).toBe(PINNED_HASH);

    const keyed = runSim({ ...TINY_ROLLOUT_BASE, rolloutSeedMode: 'actionKey' });
    expect(keyed.config).toHaveProperty('rolloutSeedMode', 'actionKey');
    expect(keyed.runHash).not.toBe(legacy.runHash);
  }, 30000);

  // T7 — the headline backend-equivalence check: the snapshot backend must
  // reproduce the actor backend's pinned hash EXACTLY (playoutBackend is a
  // harness dimension like WORKERS, hash-exempt by design — identical hashes
  // ARE the equivalence claim, so it must never enter the hashed config).
  it('playoutBackend:"snapshot" replays to the SAME pinned runHash; the knob is recorded but hash-exempt', async () => {
    const { runSim } = (await import(runnerPath)) as { runSim: (c: unknown) => RunSimResult };
    const legacy = runSim(TINY_ROLLOUT_BASE);
    expect(legacy.config).not.toHaveProperty('playoutBackend');
    expect(legacy.runHash).toBe(PINNED_HASH);

    const snapshot = runSim({ ...TINY_ROLLOUT_BASE, playoutBackend: 'snapshot' });
    expect(snapshot.config).toHaveProperty('playoutBackend', 'snapshot');
    expect(snapshot.runHash).toBe(PINNED_HASH);
  }, 60000);

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

// T3 — seed-derivation helpers: the load-bearing position-independence property.
// In 'actionKey' mode a branch seed is mix(gameSeed, di, hashActionKey(key), r):
// the ONLY candidate-specific input is the action's stable key string, so the
// stream cannot depend on which other candidates exist or where this one sits.
d('rolloutSeedMode helpers (T3)', () => {
  // Realistic keyOf-shaped strings across every kind the pilot orders.
  const KEYS = [
    'c-onyx-17>c-rad-3',
    'c-onyx-17>hero',
    'c-onyx-9>c-rad-3',
    'c-onyx-4@frontline:0',
    'c-onyx-4@frontline:1',
    'c-onyx-4@frontline:2',
    'c-onyx-4@reserve:0',
    'c-onyx-4@high_ground:1',
    'c-onyx-21@reserve:1',
    'c-rad-8',
    'c-rad-11',
    'c-onyx-2#0',
    'c-onyx-2#1',
    'c-rad-5#0',
    'c-onyx-13->c-onyx-4',
    'c-onyx-13->high_ground',
    'c-rad-19->frontline',
    'discard_for_energy',
    'tap_reserve',
    'declare_transform',
    'end_phase',
  ];

  it('same action key -> same branch seed, regardless of hypothetical position; index mode differs by position', async () => {
    const pilot = (await import(join(here, '..', '..', 'pilot-rollout.mjs'))) as {
      hashActionKey: (k: string) => number;
      rolloutBranchSeed: (gameSeed: number, di: number, slot: number, r: number) => number;
    };
    const { hashActionKey, rolloutBranchSeed } = pilot;
    const [gameSeed, di, r] = [31337, 5, 1];
    for (const k of KEYS) {
      // Position-independent: the derivation consumes no candidate index at all.
      const a = rolloutBranchSeed(gameSeed, di, hashActionKey(k), r);
      const b = rolloutBranchSeed(gameSeed, di, hashActionKey(k), r);
      expect(a).toBe(b);
      expect(Number.isInteger(a) && a >= 0 && a <= 0xffffffff).toBe(true);
    }
    // Contrast: index mode is position-dependent (slot 0 vs slot 7 diverge).
    expect(rolloutBranchSeed(gameSeed, di, 0, r)).not.toBe(rolloutBranchSeed(gameSeed, di, 7, r));
  });

  it('distinct realistic keys yield distinct hashes and distinct branch seeds (no collisions in sample)', async () => {
    const pilot = (await import(join(here, '..', '..', 'pilot-rollout.mjs'))) as {
      hashActionKey: (k: string) => number;
      rolloutBranchSeed: (gameSeed: number, di: number, slot: number, r: number) => number;
    };
    const { hashActionKey, rolloutBranchSeed } = pilot;
    const hashes = new Set(KEYS.map((k) => hashActionKey(k)));
    expect(hashes.size).toBe(KEYS.length);
    const seeds = new Set(KEYS.map((k) => rolloutBranchSeed(31337, 5, hashActionKey(k), 1)));
    expect(seeds.size).toBe(KEYS.length);
  });

  // T4 — seedKeyOf fixes a flagged collision: keyOf's `default: return a.type`
  // collapses every tap_reserve (and discard_for_energy) candidate onto one
  // bare string, so under candidateGen:'full' + seedMode:'actionKey' distinct
  // candidates of those kinds shared one seed stream. seedKeyOf keys those two
  // kinds on cardInstanceId instead, while staying identical to keyOf for every
  // kind keyOf already distinguishes.
  it('seedKeyOf distinguishes tap_reserve/discard_for_energy candidates that keyOf collapses', async () => {
    const pilot = (await import(join(here, '..', '..', 'pilot-rollout.mjs'))) as {
      hashActionKey: (k: string) => number;
      rolloutBranchSeed: (gameSeed: number, di: number, slot: number, r: number) => number;
      seedKeyOf: (a: { type: string; cardInstanceId?: string }) => string;
    };
    const { hashActionKey, rolloutBranchSeed, seedKeyOf } = pilot;

    const tapA = { type: 'tap_reserve', cardInstanceId: 'c-onyx-4' };
    const tapB = { type: 'tap_reserve', cardInstanceId: 'c-onyx-9' };
    expect(seedKeyOf(tapA)).not.toBe(seedKeyOf(tapB));
    const tapSeedA = rolloutBranchSeed(31337, 5, hashActionKey(seedKeyOf(tapA)), 1);
    const tapSeedB = rolloutBranchSeed(31337, 5, hashActionKey(seedKeyOf(tapB)), 1);
    expect(tapSeedA).not.toBe(tapSeedB);

    const dfeA = { type: 'discard_for_energy', cardInstanceId: 'c-onyx-4' };
    const dfeB = { type: 'discard_for_energy', cardInstanceId: 'c-onyx-9' };
    expect(seedKeyOf(dfeA)).not.toBe(seedKeyOf(dfeB));
    const dfeSeedA = rolloutBranchSeed(31337, 5, hashActionKey(seedKeyOf(dfeA)), 1);
    const dfeSeedB = rolloutBranchSeed(31337, 5, hashActionKey(seedKeyOf(dfeB)), 1);
    expect(dfeSeedA).not.toBe(dfeSeedB);
  });

  it('seedKeyOf matches keyOf output for every legacy kind keyOf already distinguishes', async () => {
    const pilot = (await import(join(here, '..', '..', 'pilot-rollout.mjs'))) as {
      seedKeyOf: (a: Record<string, unknown>) => string;
    };
    const { seedKeyOf } = pilot;
    // One representative action per legacy kind keyOf special-cases, plus the
    // `default` fallback kind (declare_transform) that keyOf also leaves as
    // the bare type string — unaffected by the seedKeyOf override.
    const reps: Array<[Record<string, unknown>, string]> = [
      [
        { type: 'declare_attack', attackerInstanceId: 'c-onyx-17', targetId: 'c-rad-3' },
        'c-onyx-17>c-rad-3',
      ],
      [
        { type: 'deploy', cardInstanceId: 'c-onyx-4', zone: 'frontline', slotIndex: 0 },
        'c-onyx-4@frontline:0',
      ],
      [
        { type: 'attach_equipment', cardInstanceId: 'c-onyx-13', targetInstanceId: 'c-onyx-4' },
        'c-onyx-13->c-onyx-4',
      ],
      [{ type: 'activate_ability', cardInstanceId: 'c-onyx-2', abilityIndex: 0 }, 'c-onyx-2#0'],
      [
        { type: 'move', cardInstanceId: 'c-onyx-13', toZone: 'high_ground' },
        'c-onyx-13->high_ground',
      ],
      [{ type: 'cast_spell', cardInstanceId: 'c-rad-8' }, 'c-rad-8'],
      [{ type: 'declare_transform' }, 'declare_transform'],
    ];
    for (const [action, expected] of reps) {
      expect(seedKeyOf(action)).toBe(expected);
    }
  });
});
