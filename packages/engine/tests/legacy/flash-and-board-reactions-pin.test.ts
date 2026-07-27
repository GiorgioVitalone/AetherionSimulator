// Historical compatibility oracle; never evidence for current correctness.
/**
 * runSim contract for the two new engine-ticket Tier 3 flags (flashAtWill,
 * boardReactions): absent/false reproduces a stable baseline runHash across
 * repeated runs (byte-identical, deterministic), while enabling either flag
 * deterministically diverges from that baseline. Mirrors rollout-pin.test.ts.
 *
 * NOTE: this intentionally does NOT assert against the ruleset-v1.json
 * manifest's stored legacyPin runHash. As of this writing that pin is already
 * failing (ruleset-v1-lock.test.ts / rollout-pin.test.ts) due to unrelated,
 * pre-existing uncommitted changes elsewhere in the working tree (deck
 * construction — copyLimit/RESOURCE_DECK_SIZE — outside this ticket's scope).
 * The self-consistency check below (same config -> same hash; flag on ->
 * different hash) is independent of that unrelated breakage.
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
  rulesProfile: 'legacy-v1',
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

d('flashAtWill / boardReactions runSim contract (Tier 3)', () => {
  it('absent (both flags off) is byte-identical across repeated runs and omits both keys from the hashed config', async () => {
    const { runSim } = (await import(runnerPath)) as { runSim: (c: unknown) => RunSimResult };
    const runA = runSim({ ...TINY_BASE });
    const runB = runSim({ ...TINY_BASE });
    expect(runA.config).not.toHaveProperty('flashAtWill');
    expect(runA.config).not.toHaveProperty('boardReactions');
    expect(runA.runHash).toBe(runB.runHash);
  }, 30000);

  it('flashAtWill:true both hashes and deterministically diverges from the legacy baseline', async () => {
    const { runSim } = (await import(runnerPath)) as { runSim: (c: unknown) => RunSimResult };
    const legacy = runSim({ ...TINY_BASE });
    const withFlash = runSim({ ...TINY_BASE, flashAtWill: true });
    expect(withFlash.config).toHaveProperty('flashAtWill', true);
    expect(withFlash.runHash).not.toBe(legacy.runHash);
    // Deterministic: two runs of the same enabled config replay identically.
    const withFlashAgain = runSim({ ...TINY_BASE, flashAtWill: true });
    expect(withFlashAgain.runHash).toBe(withFlash.runHash);
  }, 30000);

  it('boardReactions:true both hashes and deterministically diverges from the legacy baseline', async () => {
    const { runSim } = (await import(runnerPath)) as { runSim: (c: unknown) => RunSimResult };
    const legacy = runSim({ ...TINY_BASE });
    const withBoard = runSim({ ...TINY_BASE, boardReactions: true });
    expect(withBoard.config).toHaveProperty('boardReactions', true);
    expect(withBoard.runHash).not.toBe(legacy.runHash);
    const withBoardAgain = runSim({ ...TINY_BASE, boardReactions: true });
    expect(withBoardAgain.runHash).toBe(withBoard.runHash);
  }, 30000);
});
