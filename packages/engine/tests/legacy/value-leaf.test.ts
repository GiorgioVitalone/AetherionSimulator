// Historical compatibility oracle; never evidence for current correctness.
/**
 * value-leaf — Stage E, "truncated rollout + value-net leaf" (pilot-rollout.mjs).
 *
 * The rollout pilot already truncates playouts at a turn horizon
 * (pilot-rollout.mjs `playout`). A TRUNCATED (non-terminal, `winner == null`)
 * leaf is normally scored by an LP-difference heuristic (`outcomeScore`).
 * Stage E: when `opts.valueLeafModelPath` is configured, a truncated leaf is
 * scored by the value net's win-probability instead, mapped onto
 * outcomeScore's [-1, 1] scale via `2*meWin-1` (`valueLeafScore`). A DECIDED
 * (terminal, `winner` set) leaf ALWAYS uses outcomeScore's +1/-1 — the net is
 * never consulted for a real terminal result (`scoreLeaf`'s selection rule).
 *
 * BYTE-IDENTITY is the top priority here: this extends the battle-tested
 * rollout pilot, whose hash is pinned in rollout-pin.test.ts. With
 * `valueLeafModelPath` unset, every path must be exactly as before.
 *
 * Skips gracefully when dist/ is missing, mirroring rollout-pin.test.ts /
 * value-pilot.test.ts.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const pilotPath = join(here, '..', '..', 'pilot-rollout.mjs');
const valuePilotPath = join(here, '..', '..', 'pilot-value.mjs');
const runnerPath = join(here, '..', '..', 'sim-runner.mjs');
const distPath = join(here, '..', '..', 'dist', 'index.js');

const ready = existsSync(pilotPath) && existsSync(distPath);
const d = ready ? describe : describe.skip;

interface LeafNet {
  layers: { W: number[][]; b: number[] }[];
  featureLength: number;
  featureSchemaVersion: number;
}

interface DistModule {
  createGame: (
    a: Record<string, unknown>,
    b: Record<string, unknown>,
    c: Record<string, unknown>,
    seed?: number,
  ) => { winner: number | null; activePlayerIndex: number };
  FEATURE_LENGTH: number;
  FEATURE_SCHEMA_VERSION: number;
}

interface MinimalRegistry {
  getCard: (id: number) => Record<string, unknown> | undefined;
  getHero: (id: number) => Record<string, unknown>;
}

const RES_ID = 99;
const HERO_ONYX = 100;
const HERO_RADIANT = 101;

function registryFor(alignment: string): MinimalRegistry {
  return {
    getCard: (id: number) => {
      if (id === RES_ID)
        return { id, name: 'Mana', cardType: 'R', cost: { mana: 0, energy: 0, flexible: 0 } };
      return undefined;
    },
    getHero: (id: number) => ({ id, name: `Hero ${String(id)}`, lp: 24, alignment: [alignment] }),
  };
}

function deckFor(heroDefId: number): Record<string, unknown> {
  return {
    heroDefId,
    mainDeckDefIds: [],
    resourceDeckDefIds: Array.from({ length: 15 }, () => RES_ID),
  };
}

// A tiny value-net.json with all-zero weights: forward(anything) = sigmoid(bias)
// REGARDLESS of the input feature vector — isolates the leaf-scoring MATH
// (perspective handling + the [0,1] -> [-1,1] mapping) from the featurizer's
// actual output, which is exactly what "leaf-scoring math" needs to test.
function writeConstantNet(
  dir: string,
  featureLength: number,
  bias: number,
  schemaVersion: number,
): string {
  const p = bias === 0 ? 0.5 : 1 / (1 + Math.exp(-bias));
  const net = {
    featureLength,
    featureSchemaVersion: schemaVersion,
    arch: [featureLength, 1],
    activation: 'relu-hidden-sigmoid-out',
    layers: [{ W: [new Array(featureLength).fill(0)], b: [bias] }],
    paritySamples: [{ f: new Array(featureLength).fill(0), prob: p }],
  };
  const path = join(dir, `const-net-${String(Math.random())}.json`);
  writeFileSync(path, JSON.stringify(net));
  return path;
}

d('value-leaf — leaf-scoring math (valueLeafScore)', () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'value-leaf-test-'));
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('active === meSeat: score = 2*p-1 (no inversion)', async () => {
    const dist = (await import(distPath)) as unknown as DistModule;
    const { loadValueNet } = (await import(valuePilotPath)) as {
      loadValueNet: (p: string) => LeafNet;
    };
    const { valueLeafScore } = (await import(pilotPath)) as {
      valueLeafScore: (net: LeafNet, leafState: unknown, meSeat: number) => number;
    };

    const bias = 1; // p = sigmoid(1)
    const p = 1 / (1 + Math.exp(-bias));
    const netPath = writeConstantNet(dir, dist.FEATURE_LENGTH, bias, dist.FEATURE_SCHEMA_VERSION);
    const net = loadValueNet(netPath);

    const leaf = dist.createGame(deckFor(HERO_ONYX), deckFor(HERO_RADIANT), registryFor('Onyx'), 1);
    const meSeat = leaf.activePlayerIndex; // active === meSeat
    const score = valueLeafScore(net, leaf, meSeat);

    expect(score).toBeCloseTo(2 * p - 1, 10);
  });

  it('active !== meSeat: score = 2*(1-p)-1 (inverted)', async () => {
    const dist = (await import(distPath)) as unknown as DistModule;
    const { loadValueNet } = (await import(valuePilotPath)) as {
      loadValueNet: (p: string) => LeafNet;
    };
    const { valueLeafScore } = (await import(pilotPath)) as {
      valueLeafScore: (net: LeafNet, leafState: unknown, meSeat: number) => number;
    };

    const bias = -0.5; // p = sigmoid(-0.5)
    const p = 1 / (1 + Math.exp(-bias));
    const netPath = writeConstantNet(dir, dist.FEATURE_LENGTH, bias, dist.FEATURE_SCHEMA_VERSION);
    const net = loadValueNet(netPath);

    const leaf = dist.createGame(deckFor(HERO_ONYX), deckFor(HERO_RADIANT), registryFor('Onyx'), 1);
    const oppSeat = leaf.activePlayerIndex === 0 ? 1 : 0; // active !== meSeat

    const score = valueLeafScore(net, leaf, oppSeat);
    expect(score).toBeCloseTo(2 * (1 - p) - 1, 10);
  });

  it('p = 0.5 -> score = 0 (neutral leaf, either perspective)', async () => {
    const dist = (await import(distPath)) as unknown as DistModule;
    const { loadValueNet } = (await import(valuePilotPath)) as {
      loadValueNet: (p: string) => LeafNet;
    };
    const { valueLeafScore } = (await import(pilotPath)) as {
      valueLeafScore: (net: LeafNet, leafState: unknown, meSeat: number) => number;
    };

    const netPath = writeConstantNet(dir, dist.FEATURE_LENGTH, 0, dist.FEATURE_SCHEMA_VERSION);
    const net = loadValueNet(netPath);
    const leaf = dist.createGame(deckFor(HERO_ONYX), deckFor(HERO_RADIANT), registryFor('Onyx'), 1);

    expect(valueLeafScore(net, leaf, 0)).toBeCloseTo(0, 10);
    expect(valueLeafScore(net, leaf, 1)).toBeCloseTo(0, 10);
  });
});

d('value-leaf — scoreLeaf selection rule (terminal vs truncated)', () => {
  // A "poison" net whose `.layers` getter throws — proves whether the net was
  // actually consulted: a DECIDED leaf must never touch it.
  const poisonNet = {
    get layers(): never {
      throw new Error('net must NOT be consulted for a decided (terminal) leaf');
    },
  };

  it('terminal leaf (winner set): net is NEVER consulted, no throw', async () => {
    const { scoreLeaf } = (await import(pilotPath)) as {
      scoreLeaf: (
        fin: unknown,
        meSeat: number,
        turnCap: number,
        closingReward: boolean,
        net: unknown,
      ) => number;
    };
    const fin = {
      winner: 0,
      turnNumber: 5,
      players: [{ hero: { currentLp: 10, maxLp: 10 } }, { hero: { currentLp: 3, maxLp: 10 } }],
    };
    expect(() => scoreLeaf(fin, 0, 20, true, poisonNet)).not.toThrow();
    // +1/-1 dominates regardless of a net being configured or not.
    const withNet = scoreLeaf(fin, 0, 20, true, poisonNet);
    const withoutNet = scoreLeaf(fin, 0, 20, true, null);
    expect(withNet).toBe(withoutNet);
    expect(withNet).toBeGreaterThan(0.5); // meSeat=0 won -> base 1 (+ speed bonus)
  });

  it('truncated leaf (winner == null) WITH a net configured: the net IS consulted', async () => {
    const { scoreLeaf } = (await import(pilotPath)) as {
      scoreLeaf: (
        fin: unknown,
        meSeat: number,
        turnCap: number,
        closingReward: boolean,
        net: unknown,
      ) => number;
    };
    const fin = {
      winner: null,
      turnNumber: 5,
      activePlayerIndex: 0,
      players: [{ hero: { currentLp: 10, maxLp: 10 } }, { hero: { currentLp: 3, maxLp: 10 } }],
    };
    expect(() => scoreLeaf(fin, 0, 20, true, poisonNet)).toThrow(/must NOT be consulted/);
  });

  it('truncated leaf with NO net configured: falls back to outcomeScore (never throws)', async () => {
    const { scoreLeaf } = (await import(pilotPath)) as {
      scoreLeaf: (
        fin: unknown,
        meSeat: number,
        turnCap: number,
        closingReward: boolean,
        net: unknown,
      ) => number;
    };
    const fin = {
      winner: null,
      turnNumber: 5,
      activePlayerIndex: 0,
      players: [{ hero: { currentLp: 10, maxLp: 10 } }, { hero: { currentLp: 3, maxLp: 10 } }],
    };
    expect(() => scoreLeaf(fin, 0, 20, true, null)).not.toThrow();
  });
});

// ── Byte-identical: without valueLeafModelPath, the rollout pilot reproduces
// the pinned runHash from rollout-pin.test.ts exactly (top priority). ────────
const runnerReady = existsSync(runnerPath) && existsSync(distPath);
const dRunner = runnerReady ? describe : describe.skip;

const TINY_ROLLOUT_BASE = {
  rulesProfile: 'legacy-v1',
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
// Same pin as tests/sim/rollout-pin.test.ts — kept in sync deliberately.
const PINNED_HASH = '91e6cf0e84c9adb3';

interface RunSimResult {
  runHash: string;
  config: Record<string, unknown>;
}

dRunner('value-leaf wiring does not disturb the rollout pilot (byte-identical)', () => {
  it('a run WITHOUT valueLeafModelPath hashes identically to the pinned rollout hash', async () => {
    const { runSim } = (await import(runnerPath)) as { runSim: (c: unknown) => RunSimResult };
    const result = runSim(TINY_ROLLOUT_BASE);
    expect(result.config).not.toHaveProperty('valueLeafModelPath');
    expect(result.config).not.toHaveProperty('valueLeafModelSha');
    expect(result.config).not.toHaveProperty('valueLeafFeatureSchemaVersion');
    expect(result.runHash).toBe(PINNED_HASH);
  }, 30000);
});

// ── valueLeafModelPath end-to-end: wired into sim-runner, hashed when set,
// and deterministic. ──────────────────────────────────────────────────────
dRunner('value-leaf wired into sim-runner (valueLeafModelPath)', () => {
  let dir: string;
  let modelPath: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'value-leaf-runner-'));
    const dist = (await import(distPath)) as unknown as DistModule;
    modelPath = writeConstantNet(dir, dist.FEATURE_LENGTH, 0.3, dist.FEATURE_SCHEMA_VERSION);
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('setting valueLeafModelPath hashes it (+ sha + schema version) into the resolved config, diverging from the unset pin', async () => {
    const { runSim } = (await import(runnerPath)) as { runSim: (c: unknown) => RunSimResult };
    const withNet = runSim({ ...TINY_ROLLOUT_BASE, valueLeafModelPath: modelPath });
    expect(withNet.config).toHaveProperty('valueLeafModelPath', modelPath);
    expect(withNet.config).toHaveProperty('valueLeafModelSha');
    expect(withNet.config).toHaveProperty('valueLeafFeatureSchemaVersion');
    expect(withNet.runHash).not.toBe(PINNED_HASH);
  }, 30000);

  it('determinism: same config + seed -> same runHash (same chosen actions) across repeated runs', async () => {
    const { runSim } = (await import(runnerPath)) as { runSim: (c: unknown) => RunSimResult };
    const runA = runSim({ ...TINY_ROLLOUT_BASE, valueLeafModelPath: modelPath });
    const runB = runSim({ ...TINY_ROLLOUT_BASE, valueLeafModelPath: modelPath });
    expect(runA.runHash).toBe(runB.runHash);
  }, 30000);
});
