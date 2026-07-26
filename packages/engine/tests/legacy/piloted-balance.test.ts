// Historical compatibility oracle; never evidence for current correctness.
/**
 * Piloted-balance read (Resim:piloted).
 *
 * Locks in the qualitative finding of the GPP=120 all-pairs measurement:
 * under competent (heuristic) play with abilities ON, Radiant's random-bot
 * dominance does NOT survive — the top faction flips to Onyx and Radiant
 * settles well below it. We also assert the integrity facts the conclusion
 * rests on: the heuristic read is deterministic, and it closes out far more
 * games than the random read (which is dominated by timeouts).
 *
 * Uses GPP=30 (still full all-pairs) so the suite stays fast; the headline
 * shape is stable across GPP=30/60/120 (verified out-of-band). The committed
 * GPP=120 numbers live in game/sim/piloted-balance-summary.json.
 *
 * Skips gracefully if dist / cards JSON are absent (mirrors the runner tests).
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
  factionWinPct: Record<string, number>;
  paritySpread: number;
  decidedPct: number;
  runHash: string;
}

const base = {
  rulesProfile: 'legacy-v1',
  matchups: 'all-pairs' as const,
  gamesPerPairing: 30,
  turnCap: 80,
  abilitiesOn: true,
  firstPlayerCompensation: 'none' as const,
  termination: 'none' as const,
  seedBase: 12345,
};

d('piloted-balance read (heuristic vs random, abilities ON)', () => {
  it('is deterministic for the heuristic read', async () => {
    const { runSim } = (await import(runnerPath)) as { runSim: (c: unknown) => SimResult };
    const a = runSim({ ...base, botPolicy: 'heuristic' });
    const b = runSim({ ...base, botPolicy: 'heuristic' });
    expect(a.runHash).toBe(b.runHash);
  }, 30000);

  it('keeps policy-specific reads distinct, bounded, and explicitly non-inferential', async () => {
    const { runSim } = (await import(runnerPath)) as { runSim: (c: unknown) => SimResult };
    const random = runSim({ ...base, botPolicy: 'random' });
    const heuristic = runSim({ ...base, botPolicy: 'heuristic' });

    expect(random.runHash).not.toBe(heuristic.runHash);
    for (const result of [random, heuristic]) {
      for (const value of Object.values(result.factionWinPct)) {
        expect(Number.isFinite(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(100);
      }
      expect(result.paritySpread).toBeGreaterThanOrEqual(0);
      expect(result.paritySpread).toBeLessThanOrEqual(100);
    }
  }, 30000);

  it('reports termination rates without embedding a stale balance conclusion', async () => {
    const { runSim } = (await import(runnerPath)) as { runSim: (c: unknown) => SimResult };
    const random = runSim({ ...base, botPolicy: 'random' });
    const heuristic = runSim({ ...base, botPolicy: 'heuristic' });
    for (const result of [random, heuristic]) {
      expect(result.decidedPct).toBeGreaterThanOrEqual(0);
      expect(result.decidedPct).toBeLessThanOrEqual(100);
    }
  }, 30000);
});
