/**
 * Decision-log regression tests — the foundation for pilotability analysis +
 * policy-net distillation. `config.collectDecisionLog` is an opt-in harness
 * knob (mirrors `collectTrainingData`) that buffers one record per rollout
 * decision: the candidates weighed, their rollout values, and which was
 * chosen. It defends three things:
 *   1. Byte-identical when OFF — a rollout run without collectDecisionLog
 *      reproduces rollout-pin.test.ts's pinned hash exactly.
 *   2. When ON, `decisionLog` is attached to the result with the documented
 *      shape (374-length features, non-empty candidates with numeric
 *      value/playouts, chosenIdx pointing at the argmax candidate).
 *   3. A tiny decision-datagen.mjs run writes valid NDJSON.
 *
 * Skips gracefully when dist/ is missing, mirroring rollout-pin.test.ts.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const here = dirname(fileURLToPath(import.meta.url));
const runnerPath = join(here, '..', '..', 'sim-runner.mjs');
const distPath = join(here, '..', '..', 'dist', 'index.js');
const datagenPath = join(here, '..', '..', 'decision-datagen.mjs');

const ready = existsSync(runnerPath) && existsSync(distPath);
const d = ready ? describe : describe.skip;

// Same TINY_BASE shape as rollout-pin.test.ts (fixed seed 31337, two factions,
// few games) plus a minimal rollout configuration so the search stays fast.
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

// Same pinned hash as rollout-pin.test.ts — collectDecisionLog must be
// hash-exempt, so unset it reproduces exactly this value.
const PINNED_HASH = 'd3e0878929a5c6e1';

interface DecisionCandidate {
  action: unknown;
  value: number | null;
  playouts: number;
}
interface DecisionRow {
  turn: number;
  mover: number;
  features: number[];
  candidates: DecisionCandidate[];
  chosenIdx: number;
  heuristicIdx: number;
  passIdx: number;
}
interface RunSimResult {
  runHash: string;
  config: Record<string, unknown>;
  decisionLog?: DecisionRow[];
}

d('decision log (opt-in)', () => {
  it('OFF: unset collectDecisionLog reproduces the pinned rollout-pin runHash (byte-identical)', async () => {
    const { runSim } = (await import(runnerPath)) as { runSim: (c: unknown) => RunSimResult };
    const result = runSim(TINY_ROLLOUT_BASE);
    expect(result.runHash).toBe(PINNED_HASH);
    expect(result.config).not.toHaveProperty('collectDecisionLog');
    expect(result.decisionLog).toBeUndefined();
  }, 30000);

  it('ON: collectDecisionLog is hash-exempt (same runHash) and attaches well-formed rows', async () => {
    const { runSim } = (await import(runnerPath)) as { runSim: (c: unknown) => RunSimResult };
    const off = runSim(TINY_ROLLOUT_BASE);
    const on = runSim({ ...TINY_ROLLOUT_BASE, collectDecisionLog: true });

    expect(on.runHash).toBe(off.runHash);
    expect(on.runHash).toBe(PINNED_HASH);
    expect(on.config).toHaveProperty('collectDecisionLog', true);

    const rows = on.decisionLog ?? [];
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.features.length).toBe(374);
      expect(row.candidates.length).toBeGreaterThan(0);
      for (const c of row.candidates) {
        expect(typeof c.value === 'number' || c.value === null).toBe(true);
        expect(typeof c.playouts).toBe('number');
      }
      expect(row.chosenIdx).toBeGreaterThanOrEqual(0);
      expect(row.chosenIdx).toBeLessThan(row.candidates.length);
      // chosenIdx must point at the argmax candidate (ties broken toward the
      // earliest index, mirroring pilot-rollout.mjs's chooseAction).
      let bestIdx = 0;
      let bestMean = -Infinity;
      for (let i = 0; i < row.candidates.length; i++) {
        const c = row.candidates[i]!;
        const mean = c.playouts > 0 ? (c.value as number) : -Infinity;
        if (mean > bestMean + 1e-12) {
          bestMean = mean;
          bestIdx = i;
        }
      }
      expect(row.chosenIdx).toBe(bestIdx);
      // heuristicIdx: an integer in [-1, candidates.length-1]. -1 is valid and
      // expected (the heuristic can target a candidate the rollout never
      // enumerated).
      expect(Number.isInteger(row.heuristicIdx)).toBe(true);
      expect(row.heuristicIdx).toBeGreaterThanOrEqual(-1);
      expect(row.heuristicIdx).toBeLessThan(row.candidates.length);
      // passIdx: the index of the null-action (END_PHASE) candidate.
      expect(row.passIdx).toBeGreaterThanOrEqual(0);
      expect(row.candidates[row.passIdx]!.action).toBeNull();
    }
  }, 30000);
});

describe('actionsEqual (unit)', () => {
  // Re-imports the helper by re-requiring the module's internals is not
  // possible (not exported); instead this exercises it indirectly through a
  // tiny local re-implementation mirroring pilot-rollout.mjs's semantics, to
  // pin the documented contract independently of the integration test above.
  const ACTION_ID_FIELDS = [
    'cardInstanceId',
    'attackerInstanceId',
    'targetId',
    'targetInstanceId',
    'toZone',
    'zone',
    'slotIndex',
    'abilityIndex',
    'xValue',
    'selectedTargetIds',
    'equipmentInstanceId',
  ] as const;
  function fieldEqual(x: unknown, y: unknown): boolean {
    if (Array.isArray(x) || Array.isArray(y)) {
      const xa = (x as unknown[]) ?? [];
      const ya = (y as unknown[]) ?? [];
      return xa.length === ya.length && xa.every((v, i) => v === ya[i]);
    }
    return x === y;
  }
  function actionsEqual(
    a: Record<string, unknown> | null,
    b: Record<string, unknown> | null,
  ): boolean {
    if (a == null && b == null) return true;
    if (a == null || b == null) return false;
    if (a['type'] !== b['type']) return false;
    return ACTION_ID_FIELDS.every((f) => fieldEqual(a[f], b[f]));
  }

  it('null vs null matches', () => {
    expect(actionsEqual(null, null)).toBe(true);
  });

  it('null vs non-null does not match', () => {
    expect(actionsEqual(null, { type: 'move', cardInstanceId: 'c1', toZone: 'frontline' })).toBe(
      false,
    );
    expect(actionsEqual({ type: 'move', cardInstanceId: 'c1', toZone: 'frontline' }, null)).toBe(
      false,
    );
  });

  it('same type but different ids does not match', () => {
    expect(
      actionsEqual(
        { type: 'declare_attack', attackerInstanceId: 'a1', targetId: 't1' },
        { type: 'declare_attack', attackerInstanceId: 'a1', targetId: 't2' },
      ),
    ).toBe(false);
  });

  it('identical actions match', () => {
    expect(
      actionsEqual(
        { type: 'deploy', cardInstanceId: 'c1', zone: 'frontline', slotIndex: 0 },
        { type: 'deploy', cardInstanceId: 'c1', zone: 'frontline', slotIndex: 0 },
      ),
    ).toBe(true);
  });
});

d('decision-datagen.mjs (smoke)', () => {
  it('writes valid NDJSON: a header row + per-decision rows', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'decision-datagen-'));
    const outPath = join(dir, 'decision-log.ndjson');
    try {
      // Async spawn, NOT execFileSync: the datagen child runs ~2min, and a sync
      // wait starves the vitest worker's event loop past its 60s RPC timeout —
      // "Timeout calling onTaskUpdate" fails the run with zero test failures.
      await execFileAsync('node', [datagenPath, '1', outPath, '1'], {
        cwd: join(here, '..', '..'),
        timeout: 120000,
        maxBuffer: 32 * 1024 * 1024,
      });
      const lines = readFileSync(outPath, 'utf8').trim().split('\n');
      expect(lines.length).toBeGreaterThan(1);

      const header = JSON.parse(lines[0]!) as { schemaVersion: number; featureLength: number };
      expect(header.featureLength).toBe(374);
      expect(typeof header.schemaVersion).toBe('number');

      const row = JSON.parse(lines[1]!) as DecisionRow & { game: number; faction: string };
      expect(typeof row.game).toBe('number');
      expect(typeof row.turn).toBe('number');
      expect(typeof row.faction).toBe('string');
      expect(row.features.length).toBe(374);
      expect(row.candidates.length).toBeGreaterThan(0);
      expect(row.chosenIdx).toBeGreaterThanOrEqual(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 150000);
});
