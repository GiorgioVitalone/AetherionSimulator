/**
 * runSim contract for the Tier 4 flag (responseWindowsOnAllActions): absent/false
 * reproduces the legacy baseline runHash byte-for-byte (the bare-engine path is
 * unchanged — every handler resolves inline exactly as before), while enabling
 * the flag deterministically diverges (attack/ability/equip/move declarations
 * defer through the stack and open response windows where the opponent holds a
 * reaction). Mirrors flash-and-board-reactions-pin.test.ts / rollout-pin.test.ts.
 *
 * The OFF baseline here equals ruleset-v1.json's legacyPin — the two are the same
 * fixed-seed TINY_BASE config, so this test also re-verifies that pin.
 *
 * Skips gracefully when dist/ is missing, same as the other sim pin tests.
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
// factions, few games).
const TINY_BASE = {
  firstPlayer: 'alternating',
  fixHandSizeStall: true,
  termination: 'tiebreak',
  abilitiesOn: true,
  turnCap: 80,
  seedBase: 31337,
  decks: { Onyx: 'Onyx', Radiant: 'Radiant' },
  matchups: [{ p0Deck: 'Onyx', p1Deck: 'Radiant' }],
  gamesPerPairing: 6,
};

interface RunSimResult {
  runHash: string;
  config: Record<string, unknown>;
}

d('responseWindowsOnAllActions runSim contract (Tier 4)', () => {
  it('absent is byte-identical across repeated runs, omits the key from the hashed config, and replays the legacyPin baseline', async () => {
    const { runSim } = (await import(runnerPath)) as { runSim: (c: unknown) => RunSimResult };
    const runA = runSim({ ...TINY_BASE });
    const runB = runSim({ ...TINY_BASE });
    expect(runA.config).not.toHaveProperty('responseWindowsOnAllActions');
    expect(runA.runHash).toBe(runB.runHash);
    // The OFF path is the untouched legacy path: same fixed-seed config as the
    // ruleset-v1 legacyPin, so it must replay to that exact hash.
    expect(runA.runHash).toBe('b142747b3b47ad87');
  }, 30000);

  it('explicit false matches absent (byte-identical)', async () => {
    const { runSim } = (await import(runnerPath)) as { runSim: (c: unknown) => RunSimResult };
    const off = runSim({ ...TINY_BASE });
    const offFalse = runSim({ ...TINY_BASE, responseWindowsOnAllActions: false });
    expect(offFalse.runHash).toBe(off.runHash);
  }, 30000);

  it('true both hashes and deterministically diverges from the legacy baseline', async () => {
    const { runSim } = (await import(runnerPath)) as { runSim: (c: unknown) => RunSimResult };
    const off = runSim({ ...TINY_BASE });
    const on1 = runSim({ ...TINY_BASE, responseWindowsOnAllActions: true });
    const on2 = runSim({ ...TINY_BASE, responseWindowsOnAllActions: true });
    expect(on1.config.responseWindowsOnAllActions).toBe(true);
    expect(on1.runHash).toBe(on2.runHash); // deterministic
    expect(on1.runHash).not.toBe(off.runHash); // diverges
  }, 30000);
});
