/**
 * Defends the frozen ruleset-v1 lock (sim-data/ruleset-v1.json), written by
 * balance-lock.mjs once a ratification panel PASSes every pre-registered
 * acceptance criterion. Per docs/balance-framework.md §1, v1 never mutates —
 * any edit to the manifest's `rules` must fail here AND against the inline
 * EXPECTED_RULES literal (two independent trip-wires).
 *
 * The whole suite skips gracefully when the manifest doesn't exist yet (no
 * ratified lock) or when dist/ is missing (runSim needs the built engine) —
 * mirrors sim-runner-determinism.test.ts.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const manifestPath = join(here, '..', '..', 'sim-data', 'ruleset-v1.json');
const runnerPath = join(here, '..', '..', 'sim-runner.mjs');
const distPath = join(here, '..', '..', 'dist', 'index.js');
const runsDir = join(here, '..', '..', 'balance-runs', 'runs');

const manifestReady = existsSync(manifestPath);
const ready = manifestReady && existsSync(runnerPath) && existsSync(distPath);
const d = ready ? describe : describe.skip;

// Any manifest edit must fail BOTH this literal AND the archived ratification
// re-grade (test (d)) — two independent trip-wires on the same 9 flags.
const EXPECTED_RULES = {
  armFirstInstanceOnly: true,
  terminationMode: 'resource_deck_empty_transform',
  costFloor: true,
  reserveTapChoice: true,
  reserveTapStrain: true,
  exileDiscardForEnergy: true,
  resourceDeckSize: 12,
  firstPlayerCompensation: 'card',
  apnapAnyOrderFix: true,
};

interface RulesetManifest {
  version: string;
  rules: Record<string, unknown>;
  ratification: {
    ledgerId: string;
    date: string;
    poolSha: string;
    rungRunHashes: Record<string, string | null>;
    grades: { criterion: string; measured: string; verdict: string }[];
  };
  gameplayPin: { configDescription: string; runHash: string };
  legacyPin: { configDescription: string; runHash: string };
  amendment: string;
}

function readManifest(): RulesetManifest {
  return JSON.parse(readFileSync(manifestPath, 'utf8')) as RulesetManifest;
}

// Same tiny deterministic config balance-lock.mjs used to compute the pins.
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

d('ruleset-v1 lock', () => {
  it('manifest rules deep-equal the inline EXPECTED_RULES literal', () => {
    const manifest = readManifest();
    expect(manifest.rules).toEqual(EXPECTED_RULES);
  });

  it('RESOURCE_DECK_SIZE constants match the ratified resourceDeckSize rule', async () => {
    const manifest = readManifest();
    const distLegalityPath = join(here, '..', '..', 'dist', 'sim', 'deck-legality.js');
    const samplerPath = join(here, '..', '..', 'deck-sampler.mjs');
    const { RESOURCE_DECK_SIZE: legalitySize } = (await import(distLegalityPath)) as {
      RESOURCE_DECK_SIZE: number;
    };
    const { RESOURCE_DECK_SIZE: samplerSize } = (await import(samplerPath)) as {
      RESOURCE_DECK_SIZE: number;
    };
    expect(legalitySize).toBe(manifest.rules.resourceDeckSize);
    expect(samplerSize).toBe(manifest.rules.resourceDeckSize);
  });

  it('gameplayPin replays to the exact stored runHash', async () => {
    const manifest = readManifest();
    const { runSim } = (await import(runnerPath)) as {
      runSim: (c: unknown) => { runHash: string };
    };
    const result = runSim({ ...TINY_BASE, ...manifest.rules });
    expect(result.runHash).toBe(manifest.gameplayPin.runHash);
  }, 30000);

  it('legacyPin (flags off) replays to the exact stored runHash — byte-identity persists', async () => {
    const manifest = readManifest();
    const { runSim } = (await import(runnerPath)) as {
      runSim: (c: unknown) => { runHash: string };
    };
    const result = runSim({ ...TINY_BASE });
    expect(result.runHash).toBe(manifest.legacyPin.runHash);
  }, 30000);

  it('envelope: the archived ratification panel still grades as ALL PASS', () => {
    const manifest = readManifest();
    const archivePath = join(runsDir, `${manifest.ratification.ledgerId}.json`);
    if (!existsSync(archivePath)) {
      // Archive is gitignored (balance-runs/runs/ is reproducible, not tracked
      // source of truth) — skip when it isn't present locally.
      return;
    }
    const archive = JSON.parse(readFileSync(archivePath, 'utf8')) as {
      pilots: {
        label: string;
        kind: string;
        games: number;
        mirrorFp: number;
        decidedPct: number;
        runHash?: string;
        marg: Record<string, { w: number; n: number }>;
        matchupDetail: Record<string, { fA: string; fB: string; wA: number; wB: number }>;
      }[];
    };

    // Duplicate of balance-lock.mjs's grading math (inline — importing the
    // .mjs CLI from vitest TS is awkward since it also runs main() on import
    // detection quirks across module systems; this ~30-line duplicate keeps
    // the test self-contained and honest about what it checks).
    function wilson(w: number, n: number, z = 1.96): [number, number, number] {
      if (n <= 0) return [0, 0, 0];
      const p = w / n,
        dd = 1 + (z * z) / n;
      const c = (p + (z * z) / (2 * n)) / dd;
      const h = (z / dd) * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
      return [100 * (c - h), 100 * p, 100 * (c + h)];
    }
    const overlap = ([lo1, , hi1]: number[], [lo2, , hi2]: number[]) =>
      lo1! <= hi2! && lo2! <= hi1!;
    const FACTIONS = ['Onyx', 'Radiant', 'Sapphire', 'Verdant'];
    const T = JSON.parse(
      readFileSync(join(here, '..', '..', 'sim-data', 'balance-targets.json'), 'utf8'),
    ).thresholds;

    const r8 = archive.pilots.find((p) => p.kind === 'agg' && p.label.includes('r8'))!;
    const r12 = archive.pilots.find((p) => p.kind === 'agg' && p.label.includes('r12'))!;
    expect(r8).toBeTruthy();
    expect(r12).toBeTruthy();

    const pooledMarg: Record<string, [number, number, number]> = {};
    for (const f of FACTIONS) {
      const w = r8.marg[f]!.w + r12.marg[f]!.w;
      const n = r8.marg[f]!.n + r12.marg[f]!.n;
      pooledMarg[f] = wilson(w, n);
    }
    const mids = FACTIONS.map((f) => pooledMarg[f]![1]);
    const pooledSpread = Math.max(...mids) - Math.min(...mids);
    expect(pooledSpread).toBeLessThanOrEqual(T.spreadPp.failAbove);

    for (const f of FACTIONS) {
      const [lo, , hi] = pooledMarg[f]!;
      expect(hi).toBeGreaterThanOrEqual(T.factionWinPct.failBelow);
      expect(lo).toBeLessThanOrEqual(T.factionWinPct.failAbove);
    }

    const pairs: Record<string, { wA: number; n: number }> = {};
    for (const p of [r8, r12]) {
      for (const cell of Object.values(p.matchupDetail)) {
        if (cell.fA === cell.fB) continue;
        const key = `${cell.fA}|${cell.fB}`;
        const t = (pairs[key] ??= { wA: 0, n: 0 });
        t.wA += cell.wA;
        t.n += cell.wA + cell.wB;
      }
    }
    let worstDev = 0;
    for (const { wA, n } of Object.values(pairs)) {
      if (n <= 0) continue;
      worstDev = Math.max(worstDev, Math.abs((100 * wA) / n - 50));
    }
    expect(worstDev).toBeLessThanOrEqual(T.worstCellDevPp.flagAbove);

    const pooledMirrorFp =
      (r8.mirrorFp * r8.games + r12.mirrorFp * r12.games) / (r8.games + r12.games);
    expect(Math.abs(pooledMirrorFp - 50)).toBeLessThanOrEqual(T.mirrorFpEdgePp.flagAbove);

    expect(Math.min(r8.decidedPct, r12.decidedPct)).toBeGreaterThanOrEqual(T.decidedPct.flagBelow);

    for (const f of FACTIONS) {
      const r8w = wilson(r8.marg[f]!.w, r8.marg[f]!.n);
      const r12w = wilson(r12.marg[f]!.w, r12.marg[f]!.n);
      const drift = Math.abs(r12w[1] - r8w[1]);
      expect(drift <= 3 || overlap(r8w, r12w)).toBe(true);
    }
  });
});
