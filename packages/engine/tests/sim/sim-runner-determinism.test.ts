/**
 * Determinism of the parameterized sim runner (sim-runner.mjs).
 *
 * The dashboard calls runSim(config); the same config + seedBase MUST produce
 * byte-identical results (including the deterministic runHash) across calls and
 * across processes. We verify:
 *   1. two in-process calls with the same config are identical,
 *   2. distinct configs (seedBase / policy / compensation) diverge,
 *   3. the structured result has the documented shape.
 *
 * The runner depends on the built dist + the cards JSON, so we skip gracefully if
 * the build artifacts aren't present (mirrors how other sim scripts consume dist).
 */
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const runnerPath = join(here, '..', '..', 'sim-runner.mjs');
const distPath = join(here, '..', '..', 'dist', 'index.js');
const cardsPath = '/Users/gvitalone/Projects/personal/temp/aetherion-cards.json';

const ready = existsSync(runnerPath) && existsSync(distPath) && existsSync(cardsPath);
const d = ready ? describe : describe.skip;

// Small, fast config — a single non-mirror pairing, few games.
const baseConfig = {
  matchups: ['Onyx', 'Radiant'] as string[],
  gamesPerPairing: 6,
  turnCap: 60,
  abilitiesOn: true,
  botPolicy: 'heuristic' as const,
  firstPlayerCompensation: 'none' as const,
  termination: 'none' as const,
  seedBase: 31337,
};

d('sim-runner runSim determinism', () => {
  it('produces identical results for identical config across two calls', async () => {
    const { runSim } = (await import(runnerPath)) as { runSim: (c: unknown) => Record<string, unknown> };
    const a = runSim(baseConfig);
    const b = runSim(baseConfig);
    expect(a.runHash).toBe(b.runHash);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  }, 30000);

  it('changing seedBase changes the runHash (config is actually threaded)', async () => {
    const { runSim } = (await import(runnerPath)) as { runSim: (c: unknown) => Record<string, unknown> };
    const a = runSim(baseConfig);
    const b = runSim({ ...baseConfig, seedBase: baseConfig.seedBase + 1 });
    expect(a.runHash).not.toBe(b.runHash);
  }, 30000);

  it('compensation and policy are reflected in the resolved config and the hash', async () => {
    const { runSim } = (await import(runnerPath)) as { runSim: (c: unknown) => { config: Record<string, unknown>; runHash: string } };
    const a = runSim(baseConfig);
    const comp = runSim({ ...baseConfig, firstPlayerCompensation: 'card' });
    expect(comp.config.firstPlayerCompensation).toBe('card');
    expect(comp.runHash).not.toBe(a.runHash);
  }, 30000);

  it('returns the documented structured shape', async () => {
    interface SimResult {
      factionWinPct: Record<string, number>;
      paritySpread: number;
      firstPlayerPct: number;
      mirrorFirstPlayerPct: number;
      gameLength: { histogram: Record<string, number>; median: number; avg: number };
      snowball: { leaderAtTurn10WinPct: number; comebackPct: number };
      decidedPct: number;
      timeoutPct: number;
      runHash: string;
      config: Record<string, unknown>;
    }
    const { runSim } = (await import(runnerPath)) as { runSim: (c: unknown) => SimResult };
    const r = runSim(baseConfig);
    expect(typeof r.factionWinPct).toBe('object');
    expect(typeof r.paritySpread).toBe('number');
    expect(typeof r.firstPlayerPct).toBe('number');
    expect(typeof r.mirrorFirstPlayerPct).toBe('number');
    expect(typeof r.gameLength.median).toBe('number');
    expect(typeof r.gameLength.avg).toBe('number');
    expect(typeof r.gameLength.histogram).toBe('object');
    expect(typeof r.snowball.leaderAtTurn10WinPct).toBe('number');
    expect(typeof r.snowball.comebackPct).toBe('number');
    expect(typeof r.decidedPct).toBe('number');
    expect(typeof r.timeoutPct).toBe('number');
    expect(typeof r.runHash).toBe('string');
    expect(r.config).toMatchObject({ botPolicy: 'heuristic', seedBase: 31337 });
  }, 30000);
});
