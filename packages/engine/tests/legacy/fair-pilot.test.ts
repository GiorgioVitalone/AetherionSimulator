// Historical compatibility oracle; never evidence for current correctness.
/**
 * Fair-pilot opt-in flag at the runSim level. Proves the no-op guarantee that the
 * whole design rests on: with `fairPilot` absent/false the runHash is byte-identical
 * to the baseline (for BOTH the heuristic and rollout pilots), and with it ON the
 * behavior changes deterministically (hash differs, and equals itself across calls).
 *
 * Skips gracefully if dist / cards JSON are absent (mirrors the other sim tests).
 */
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const runnerPath = join(here, '..', '..', 'sim-runner.mjs');
const distPath = join(here, '..', '..', 'dist', 'index.js');
const cardsPath = new URL('../../sim-data/aetherion-cards.json', import.meta.url);
const ready = existsSync(runnerPath) && existsSync(distPath) && existsSync(cardsPath);
const d = ready ? describe : describe.skip;

interface SimResult {
  runHash: string;
}

const realDecks = { Onyx: 'Onyx', Radiant: 'Radiant', Sapphire: 'Sapphire', Verdant: 'Verdant' };
const base = {
  // This is a historical diagnostic-knob contract. Pin the archived transition
  // profile explicitly instead of inheriting the evolving current rules.
  rulesProfile: 'legacy-v1' as const,
  decks: realDecks,
  matchups: ['Onyx', 'Radiant'] as const, // all-pairs over the subset (incl. mirrors), fast
  gamesPerPairing: 6,
  turnCap: 60,
  abilitiesOn: true,
  firstPlayer: 'alternating' as const,
  fixHandSizeStall: true,
  termination: 'tiebreak' as const,
  seedBase: 12345,
};

d('fair-pilot opt-in flag (runSim)', () => {
  it('heuristic: flag OFF (absent and explicit-false) is byte-identical to baseline', async () => {
    const { runSim } = (await import(runnerPath)) as { runSim: (c: unknown) => SimResult };
    const baseline = runSim({ ...base, botPolicy: 'heuristic' });
    const explicitFalse = runSim({ ...base, botPolicy: 'heuristic', fairPilot: false });
    expect(explicitFalse.runHash).toBe(baseline.runHash);
  }, 30000);

  it('heuristic: flag ON diverges from OFF and is deterministic', async () => {
    const { runSim } = (await import(runnerPath)) as { runSim: (c: unknown) => SimResult };
    const off = runSim({ ...base, botPolicy: 'heuristic' });
    const on1 = runSim({ ...base, botPolicy: 'heuristic', fairPilot: true });
    const on2 = runSim({ ...base, botPolicy: 'heuristic', fairPilot: true });
    expect(on1.runHash).toBe(on2.runHash); // deterministic under the flag
    expect(on1.runHash).not.toBe(off.runHash); // behavior actually changed
  }, 30000);

  it('rollout: flag OFF byte-identical, flag ON diverges (depth pinned for speed)', async () => {
    const { runSim } = (await import(runnerPath)) as { runSim: (c: unknown) => SimResult };
    const r = {
      ...base,
      matchups: [{ p0Deck: 'Onyx', p1Deck: 'Radiant' }],
      gamesPerPairing: 2,
      botPolicy: 'rollout' as const,
      rollouts: 4,
      maxCandidates: 5,
      rolloutDepth: 2, // pin so the ON run stays fast (don't take the fair depth-0 default)
    };
    const off = runSim(r);
    const explicitFalse = runSim({ ...r, fairPilot: false });
    const on = runSim({ ...r, fairPilot: true });
    expect(explicitFalse.runHash).toBe(off.runHash);
    expect(on.runHash).not.toBe(off.runHash);
  }, 60000);
});
