// Historical compatibility oracle; never evidence for current correctness.
/**
 * value-pilot — the `valueGreedy` neural-inference pilot (pilot-value.mjs).
 *
 * Every decision-logic test injects a MOCK `score` function (no value-net.json
 * needed): `chooseAction` must be a pure, deterministic, SYNCHRONOUS function
 * of (gs, scorer), picking the candidate whose afterstate the scorer prefers,
 * with a lowest-candidate-index tie-break. A separate legality check confirms
 * the returned action is always one of the engine's own enumerated candidates
 * (or null / END_PHASE). A byte-identical check confirms wiring `valueGreedy`
 * into sim-runner.mjs did not disturb the pinned `rollout` runHash
 * (rollout-pin.test.ts). The default (no `score` injected) code path — the
 * hand-rolled JS forward pass over a real `value-net.json` file — is covered
 * separately: a hand-computed 2-layer forward() unit test, a load-time
 * parity/schema guard test, and an end-to-end file-backed sync check.
 *
 * Skips gracefully when dist/ is missing, mirroring rollout-pin.test.ts.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createActor } from 'xstate';

const here = dirname(fileURLToPath(import.meta.url));
const pilotPath = join(here, '..', '..', 'pilot-value.mjs');
const rolloutPilotPath = join(here, '..', '..', 'pilot-rollout.mjs');
const runnerPath = join(here, '..', '..', 'sim-runner.mjs');
const distPath = join(here, '..', '..', 'dist', 'index.js');

const ready = existsSync(pilotPath) && existsSync(distPath);
const d = ready ? describe : describe.skip;

// ── Tiny two-faction card registry (same spirit as enumerate-actions.test.ts /
// playout-backend-differential.test.ts) — several deployable + attackable
// bodies so a decision point offers more than one real candidate. ───────────
const CREATURES = [
  { id: 1, name: 'Grunt', hp: 2, atk: 2, cost: 1 },
  { id: 2, name: 'Soldier', hp: 3, atk: 3, cost: 1 },
  { id: 3, name: 'Knight', hp: 5, atk: 4, cost: 2 },
];
const EQUIP_ID = 10;
const SPELL_ID = 11;
const RES_ID = 99;
const HERO_ONYX = 100;
const HERO_RADIANT = 101;

interface MinimalRegistry {
  getCard: (id: number) => Record<string, unknown> | undefined;
  getHero: (id: number) => Record<string, unknown>;
}

function registryFor(alignment: string): MinimalRegistry {
  return {
    getCard: (id: number) => {
      if (id === EQUIP_ID)
        return {
          id,
          name: 'Blade',
          cardType: 'E',
          cost: { mana: 1, energy: 0, flexible: 0 },
          alignment: [alignment],
        };
      if (id === SPELL_ID)
        return {
          id,
          name: 'Zap',
          cardType: 'S',
          cost: { mana: 1, energy: 0, flexible: 0 },
          alignment: [alignment],
        };
      if (id === RES_ID)
        return { id, name: 'Mana', cardType: 'R', cost: { mana: 0, energy: 0, flexible: 0 } };
      const c = CREATURES.find((x) => x.id === id);
      if (c === undefined) return undefined;
      return {
        id: c.id,
        name: c.name,
        cardType: 'C',
        cost: { mana: c.cost, energy: 0, flexible: 0 },
        stats: { hp: c.hp, atk: c.atk, arm: 0 },
        alignment: [alignment],
      };
    },
    getHero: (id: number) => ({ id, name: `Hero ${String(id)}`, lp: 24, alignment: [alignment] }),
  };
}

function pairingRegistry(alignA: string, alignB: string): MinimalRegistry {
  const base = registryFor(alignA);
  return {
    ...base,
    getHero: (id: number) =>
      id === HERO_RADIANT ? registryFor(alignB).getHero(id) : base.getHero(id),
  };
}

function deckFor(heroDefId: number): Record<string, unknown> {
  const main: number[] = [];
  while (main.length < 44) {
    for (const c of CREATURES) main.push(c.id);
    main.push(EQUIP_ID, SPELL_ID);
  }
  return {
    heroDefId,
    mainDeckDefIds: main.slice(0, 44),
    resourceDeckDefIds: Array.from({ length: 15 }, () => RES_ID),
  };
}

interface DistModule {
  createGame: (
    a: Record<string, unknown>,
    b: Record<string, unknown>,
    c: MinimalRegistry,
    seed?: number,
  ) => Record<string, unknown>;
  gameMachine: Parameters<typeof createActor>[0];
  chooseChoiceResponse: (gs: Record<string, unknown>) => number[];
  enumerateConcretePlayerActions: (
    gs: Record<string, unknown>,
    mode: 'full',
  ) => readonly Record<string, unknown>[];
}

interface AnySnap {
  status: string;
  context: {
    gameState: {
      winner: number | null;
      turnNumber: number;
      phase: string;
      pendingChoice: {
        type: string;
        playerId: number;
        options?: { instanceId?: string; id?: string }[];
      } | null;
      pendingPriority: { toRespondPlayerId: number } | null;
      activePlayerIndex: number;
    };
  };
}

// Drive a fresh game forward (mulligans kept, no reactive counters) until the
// active player faces a REAL decision — at least 2 legal candidates besides
// the END_PHASE hold — so the ranking/tie-break tests have something to bite
// on. Returns the live actor at that exact decision point.
async function driveToDecision(
  dist: DistModule,
  seed: number,
): Promise<{ actor: ReturnType<typeof createActor>; gs: AnySnap['context']['gameState'] }> {
  const gsInit = dist.createGame(
    deckFor(HERO_ONYX),
    deckFor(HERO_RADIANT),
    pairingRegistry('Onyx', 'Radiant'),
    seed,
  );
  const actor = createActor(dist.gameMachine, { input: { gameState: gsInit } });
  actor.start();

  for (let step = 0; step < 4000; step++) {
    const snap = actor.getSnapshot() as unknown as AnySnap;
    if (snap.status === 'done') break;
    const gs = snap.context.gameState;
    if (gs.winner !== null) break;
    if (gs.turnNumber > 40) break;

    if (gs.pendingChoice !== null) {
      const pc = gs.pendingChoice;
      if (pc.type === 'mulligan') {
        actor.send({ type: 'MULLIGAN_DECISION', playerId: pc.playerId, keep: true });
      } else {
        const ids = dist.chooseChoiceResponse(gs as never);
        actor.send({ type: 'PLAYER_RESPONSE', response: { selectedOptionIds: ids } });
      }
      continue;
    }
    if (gs.pendingPriority != null) {
      actor.send({ type: 'PRIORITY_PASS' });
      continue;
    }

    const cands = dist.enumerateConcretePlayerActions(gs as never, 'full');
    if ((gs.phase === 'strategy' || gs.phase === 'action') && cands.length >= 2) {
      return { actor, gs };
    }
    if (cands.length === 0) {
      actor.send({ type: 'END_PHASE' });
      continue;
    }
    // Advance with the FIRST candidate (deterministic, no rollout needed) —
    // we only need to reach some decision point with >=2 candidates.
    actor.send({ type: 'PLAYER_ACTION', action: cands[0] });
  }
  throw new Error(`no >=2-candidate decision point found within budget for seed ${seed}`);
}

// Drive a fresh game forward until it reaches a decision point where (a) there
// are >=1 real (non-END_PHASE) candidates whose afterstate is STILL our turn
// (this game has multi-action turns — most actions don't pass priority), AND
// (b) the END_PHASE hold's afterstate DOES pass the turn to the opponent. That
// mix is exactly what exercises both branches of the corrected decision rule:
// `ourWin = afterActive === me ? p : 1 - p`. Returns the live actor there.
async function driveToMixedTurnDecision(
  dist: DistModule,
  seed: number,
): Promise<{ actor: ReturnType<typeof createActor>; gs: AnySnap['context']['gameState'] }> {
  const rollout = (await import(rolloutPilotPath)) as {
    hydratePersistedSnapshot: (machine: unknown, persisted: unknown) => unknown;
    makeSnapshotFork: (
      machine: unknown,
      snap: unknown,
    ) => { send: (e: Record<string, unknown>) => void; getSnapshot: () => AnySnap };
  };

  const gsInit = dist.createGame(
    deckFor(HERO_ONYX),
    deckFor(HERO_RADIANT),
    pairingRegistry('Onyx', 'Radiant'),
    seed,
  );
  const actor = createActor(dist.gameMachine, { input: { gameState: gsInit } });
  actor.start();

  for (let step = 0; step < 4000; step++) {
    const snap = actor.getSnapshot() as unknown as AnySnap;
    if (snap.status === 'done') break;
    const gs = snap.context.gameState;
    if (gs.winner !== null) break;
    if (gs.turnNumber > 40) break;

    if (gs.pendingChoice !== null) {
      const pc = gs.pendingChoice;
      if (pc.type === 'mulligan') {
        actor.send({ type: 'MULLIGAN_DECISION', playerId: pc.playerId, keep: true });
      } else {
        const ids = dist.chooseChoiceResponse(gs as never);
        actor.send({ type: 'PLAYER_RESPONSE', response: { selectedOptionIds: ids } });
      }
      continue;
    }
    if (gs.pendingPriority != null) {
      actor.send({ type: 'PRIORITY_PASS' });
      continue;
    }

    const cands = dist.enumerateConcretePlayerActions(gs as never, 'full');
    if ((gs.phase === 'strategy' || gs.phase === 'action') && cands.length >= 1) {
      const me = gs.activePlayerIndex;
      const persisted = actor.getPersistedSnapshot();
      const hydrated = rollout.hydratePersistedSnapshot(dist.gameMachine, persisted);
      const probe = rollout.makeSnapshotFork(dist.gameMachine, hydrated);
      try {
        probe.send({ type: 'END_PHASE' });
      } catch {
        // Illegal probe send: this candidate point can't demonstrate the
        // turn-passing branch — keep walking forward.
      }
      const afterEnd = probe.getSnapshot().context.gameState;
      if (afterEnd.activePlayerIndex !== me) {
        return { actor, gs };
      }
    }
    if (cands.length === 0) {
      actor.send({ type: 'END_PHASE' });
      continue;
    }
    actor.send({ type: 'PLAYER_ACTION', action: cands[0] });
  }
  throw new Error(
    `no mixed-turn decision point (END_PHASE passes turn, >=1 other candidate) found for seed ${seed}`,
  );
}

d('value pilot (valueGreedy)', () => {
  it('when every afterstate is STILL our turn (active === me), picks the candidate the scorer ranks HIGHEST (uses p directly)', async () => {
    const dist = (await import(distPath)) as unknown as DistModule;
    const { makeValuePilot } = (await import(pilotPath)) as {
      makeValuePilot: (opts: { score: (vectors: Float32Array[]) => number[] }) => {
        chooseAction: (actor: unknown, gs: unknown, seed: number, turnCap: number) => unknown;
      };
    };

    const { actor, gs } = await driveToDecision(dist, 4242);
    const cands = dist.enumerateConcretePlayerActions(gs as never, 'full');
    // At this decision point every candidate's afterstate (including the
    // END_PHASE hold) is STILL our turn — verified: the engine has
    // multi-action turns, so `chooseAction` must read the net's output as our
    // win prob DIRECTLY (no inversion) and pick the HIGHEST-scored option.
    const preferredIndex = 1;
    const score = (vectors: Float32Array[]): number[] =>
      vectors.map((_, i) => (i === preferredIndex ? 0.99 : 0.01));

    const pilot = makeValuePilot({ score });
    const chosen = pilot.chooseAction(actor, gs, 31337, 20);

    expect(chosen).toEqual(cands[preferredIndex]);
  });

  it('exercises BOTH branches: maximizes p for same-turn afterstates and (1 - p) for the turn-passing END_PHASE hold', async () => {
    const dist = (await import(distPath)) as unknown as DistModule;
    const { makeValuePilot } = (await import(pilotPath)) as {
      makeValuePilot: (opts: { score: (vectors: Float32Array[]) => number[] }) => {
        chooseAction: (actor: unknown, gs: unknown, seed: number, turnCap: number) => unknown;
      };
    };

    // Seed 3001 lands on a decision with 2 declare_attack candidates whose
    // afterstate is STILL our turn (SAME) and an END_PHASE hold that PASSES
    // the turn to the opponent (PASS) — verified via a direct trace.
    const { actor, gs } = await driveToMixedTurnDecision(dist, 3001);
    const cands = dist.enumerateConcretePlayerActions(gs as never, 'full');
    expect(cands.length).toBe(2); // 2 declare_attack + the END_PHASE hold (index 2)

    // p per option: [0.8, 0.3, 0.9]. ourWin = [p, p, 1 - p] = [0.8, 0.3, 0.1].
    // Correct pick: index 0 (highest ourWin). A rule that (bug-style) picked
    // argmin(p) globally would instead pick index 1 (p = 0.3, the lowest raw
    // score) — so this discriminates the corrected rule from the old bug.
    const p = [0.8, 0.3, 0.9];
    const score = (vectors: Float32Array[]): number[] => vectors.map((_, i) => p[i]!);

    const pilot = makeValuePilot({ score });
    const chosen = pilot.chooseAction(actor, gs, 31337, 20);

    expect(chosen).toEqual(cands[0]);
  });

  it('the turn-passing END_PHASE hold IS chosen when its inverted (1 - p) score is genuinely the best', async () => {
    const dist = (await import(distPath)) as unknown as DistModule;
    const { makeValuePilot } = (await import(pilotPath)) as {
      makeValuePilot: (opts: { score: (vectors: Float32Array[]) => number[] }) => {
        chooseAction: (actor: unknown, gs: unknown, seed: number, turnCap: number) => unknown;
      };
    };

    const { actor, gs } = await driveToMixedTurnDecision(dist, 3001);
    // p per option: [0.7, 0.6, 0.05]. ourWin = [0.7, 0.6, 1 - 0.05 = 0.95] ->
    // the END_PHASE hold (null) wins: passing the turn here is genuinely our
    // best move under the net's (inverted) opponent-turn read.
    const p = [0.7, 0.6, 0.05];
    const score = (vectors: Float32Array[]): number[] => vectors.map((_, i) => p[i]!);

    const pilot = makeValuePilot({ score });
    const chosen = pilot.chooseAction(actor, gs, 31337, 20);

    expect(chosen).toBeNull();
  });

  it('deterministic tie-break: an all-equal scorer picks the lowest candidate index', async () => {
    const dist = (await import(distPath)) as unknown as DistModule;
    const { makeValuePilot } = (await import(pilotPath)) as {
      makeValuePilot: (opts: { score: (vectors: Float32Array[]) => number[] }) => {
        chooseAction: (actor: unknown, gs: unknown, seed: number, turnCap: number) => unknown;
      };
    };

    const { actor, gs } = await driveToDecision(dist, 4242);
    const cands = dist.enumerateConcretePlayerActions(gs as never, 'full');
    const score = (vectors: Float32Array[]): number[] => vectors.map(() => 0.5);

    const pilot = makeValuePilot({ score });
    const chosen = pilot.chooseAction(actor, gs, 31337, 20);

    expect(chosen).toEqual(cands[0]);
  });

  it('is deterministic: same (gs, seed) -> same action across repeated calls', async () => {
    const dist = (await import(distPath)) as unknown as DistModule;
    const { makeValuePilot } = (await import(pilotPath)) as {
      makeValuePilot: (opts: { score: (vectors: Float32Array[]) => number[] }) => {
        chooseAction: (actor: unknown, gs: unknown, seed: number, turnCap: number) => unknown;
        reset: () => void;
      };
    };

    const { actor, gs } = await driveToDecision(dist, 777);
    // A scorer that is a pure (deterministic) function of the feature vectors
    // themselves, not of call order or wall clock — sums each vector's values.
    const score = (vectors: Float32Array[]): number[] =>
      vectors.map((v) => {
        let s = 0;
        for (let i = 0; i < v.length; i++) s += v[i]!;
        return (Math.sin(s * 999.123) + 1) / 2; // deterministic pseudo-score in [0,1]
      });

    const pilot = makeValuePilot({ score });
    const first = pilot.chooseAction(actor, gs, 31337, 20);
    pilot.reset();
    const second = pilot.chooseAction(actor, gs, 31337, 20);

    expect(second).toEqual(first);
  });

  it('legality: the returned action is always one of the enumerated legal candidates (or null)', async () => {
    const dist = (await import(distPath)) as unknown as DistModule;
    const { makeValuePilot } = (await import(pilotPath)) as {
      makeValuePilot: (opts: { score: (vectors: Float32Array[]) => number[] }) => {
        chooseAction: (actor: unknown, gs: unknown, seed: number, turnCap: number) => unknown;
      };
    };

    for (const seed of [1, 2, 3]) {
      const { actor, gs } = await driveToDecision(dist, seed * 1000 + 1);
      const cands = dist.enumerateConcretePlayerActions(gs as never, 'full');
      const score = (vectors: Float32Array[]): number[] => vectors.map((_, i) => 1 / (i + 1));

      const pilot = makeValuePilot({ score });
      const chosen = pilot.chooseAction(actor, gs, seed, 20);

      if (chosen === null) {
        expect(chosen).toBeNull();
      } else {
        expect(cands.some((c) => JSON.stringify(c) === JSON.stringify(chosen))).toBe(true);
      }
    }
  });

  it('makeValuePilot requires either an injected score or a modelPath', async () => {
    const { makeValuePilot } = (await import(pilotPath)) as {
      makeValuePilot: (opts?: Record<string, unknown>) => unknown;
    };
    expect(() => makeValuePilot({})).toThrow();
  });
});

// ── The JS forward pass — hand-computed 2-layer unit test (small dims, no
// value-net.json needed): W is read as [out][in]; every layer but the last
// gets ReLU, the last gets sigmoid. ───────────────────────────────────────────
d('forward() — hand-rolled JS MLP forward pass', () => {
  it('matches a hand-computed forward pass for a 2 -> 2 -> 1 net', async () => {
    const { forward } = (await import(pilotPath)) as {
      forward: (layers: { W: number[][]; b: number[] }[], input: number[]) => number;
    };
    // Layer 1 (hidden, ReLU): z0 = 1*1 + 2*1 + 0 = 3; z1 = 3*1 + 4*1 + 0 = 7.
    // Layer 2 (output, sigmoid): z = 1*3 + 1*7 + 0 = 10 -> sigmoid(10).
    const layers = [
      {
        W: [
          [1, 2],
          [3, 4],
        ],
        b: [0, 0],
      },
      { W: [[1, 1]], b: [0] },
    ];
    const out = forward(layers, [1, 1]);
    const expected = 1 / (1 + Math.exp(-10));
    expect(out).toBeCloseTo(expected, 10);
  });
});

// ── value-net.json load-time guards — featureLength/featureSchemaVersion
// mismatch and parity-sample failure must all THROW at load time (fail fast,
// never silently swallowed). ─────────────────────────────────────────────────
d('loadValueNet() / makeValuePilot(modelPath) — load-time guards', () => {
  let dir: string;

  function writeNet(overrides: Record<string, unknown> = {}): string {
    // A trivial single-linear-layer net: 2 inputs -> 1 output, weights [1, 1],
    // bias 0 -> forward([a, b]) = sigmoid(a + b). forward([1, 1]) = sigmoid(2).
    const net = {
      featureLength: 2,
      featureSchemaVersion: 1,
      arch: [2, 1],
      activation: 'relu-hidden-sigmoid-out',
      layers: [{ W: [[1, 1]], b: [0] }],
      paritySamples: [{ f: [1, 1], prob: 1 / (1 + Math.exp(-2)) }],
      ...overrides,
    };
    const p = join(dir, `net-${String(Math.random())}.json`);
    writeFileSync(p, JSON.stringify(net));
    return p;
  }

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'value-net-test-'));
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('THROWS when featureLength does not match the engine FEATURE_LENGTH', async () => {
    const dist = (await import(distPath)) as unknown as { FEATURE_SCHEMA_VERSION: number };
    const { loadValueNet } = (await import(pilotPath)) as {
      loadValueNet: (p: string) => unknown;
    };
    const p = writeNet({ featureLength: 999, featureSchemaVersion: dist.FEATURE_SCHEMA_VERSION });
    expect(() => loadValueNet(p)).toThrow(/featureLength/);
  });

  it('THROWS when featureSchemaVersion does not match the engine FEATURE_SCHEMA_VERSION', async () => {
    const dist = (await import(distPath)) as unknown as { FEATURE_LENGTH: number };
    const { loadValueNet } = (await import(pilotPath)) as {
      loadValueNet: (p: string) => unknown;
    };
    const p = writeNet({ featureLength: dist.FEATURE_LENGTH, featureSchemaVersion: 999 });
    expect(() => loadValueNet(p)).toThrow(/featureSchemaVersion/);
  });

  it('THROWS when a paritySample fails to reproduce under forward() (weight/transpose bug guard)', async () => {
    const dist = (await import(distPath)) as unknown as {
      FEATURE_LENGTH: number;
      FEATURE_SCHEMA_VERSION: number;
    };
    const { loadValueNet } = (await import(pilotPath)) as {
      loadValueNet: (p: string) => unknown;
    };
    const p = writeNet({
      featureLength: dist.FEATURE_LENGTH,
      featureSchemaVersion: dist.FEATURE_SCHEMA_VERSION,
      paritySamples: [{ f: [1, 1], prob: 0.1234 }], // deliberately wrong expected prob
    });
    expect(() => loadValueNet(p)).toThrow(/parity/);
  });

  it('a fully consistent net (matching FEATURE_LENGTH, correct parity) loads cleanly', async () => {
    const dist = (await import(distPath)) as unknown as {
      FEATURE_LENGTH: number;
      FEATURE_SCHEMA_VERSION: number;
    };
    const { loadValueNet } = (await import(pilotPath)) as {
      loadValueNet: (p: string) => { featureLength: number };
    };
    const len = dist.FEATURE_LENGTH;
    const f = new Array(len).fill(0);
    f[0] = 1;
    f[1] = 1;
    const net = loadValueNet(
      writeNet({
        featureLength: len,
        featureSchemaVersion: dist.FEATURE_SCHEMA_VERSION,
        layers: [{ W: [new Array(len).fill(0).map((_, i) => (i < 2 ? 1 : 0))], b: [0] }],
        paritySamples: [{ f, prob: 1 / (1 + Math.exp(-2)) }],
      }),
    );
    expect(net.featureLength).toBe(len);
  });
});

// ── End-to-end sync check: a FILE-BACKED model (no injected score) must still
// return a real PlayerAction | null from chooseAction — never a Promise. ────
d('value pilot (valueGreedy) — file-backed model, end-to-end sync check', () => {
  it('chooseAction with a real value-net.json returns a plain action/null, not a Promise', async () => {
    const dist = (await import(distPath)) as unknown as DistModule & {
      FEATURE_LENGTH: number;
      FEATURE_SCHEMA_VERSION: number;
    };
    const { makeValuePilot } = (await import(pilotPath)) as {
      makeValuePilot: (opts: { modelPath: string }) => {
        chooseAction: (actor: unknown, gs: unknown, seed: number, turnCap: number) => unknown;
      };
    };

    const dir = mkdtempSync(join(tmpdir(), 'value-net-e2e-'));
    try {
      // Constant-output net (all-zero weights/bias): forward(anything) =
      // sigmoid(0) = 0.5 for every candidate -> exercises the real tie-break
      // path (lowest index) through the FILE-BACKED default scorer.
      const len = dist.FEATURE_LENGTH;
      const net = {
        featureLength: len,
        featureSchemaVersion: dist.FEATURE_SCHEMA_VERSION,
        arch: [len, 1],
        activation: 'relu-hidden-sigmoid-out',
        layers: [{ W: [new Array(len).fill(0)], b: [0] }],
        paritySamples: [{ f: new Array(len).fill(0), prob: 0.5 }],
      };
      const modelPath = join(dir, 'value-net.json');
      writeFileSync(modelPath, JSON.stringify(net));

      const { actor, gs } = await driveToDecision(dist, 55);
      const cands = dist.enumerateConcretePlayerActions(gs as never, 'full');

      const pilot = makeValuePilot({ modelPath });
      const chosen: unknown = pilot.chooseAction(actor, gs, 31337, 20);

      expect(chosen).not.toBeInstanceOf(Promise);
      expect(typeof (chosen as { then?: unknown } | null)?.then).not.toBe('function');
      expect(chosen).toEqual(cands[0]); // all-equal scores -> lowest-index tie-break
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ── Byte-identical check: wiring valueGreedy into sim-runner.mjs must not
// perturb the pinned `rollout` runHash (rollout-pin.test.ts owns the pin
// itself; this just re-asserts the same pinned value from this test file so a
// regression here is caught alongside the new pilot). ───────────────────────
const runnerReady = existsSync(runnerPath) && existsSync(distPath);
const dRunner = runnerReady ? describe : describe.skip;

dRunner('valueGreedy wiring does not disturb the rollout pilot (byte-identical)', () => {
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

  it('a run WITHOUT valueGreedy hashes identically to the pinned rollout hash', async () => {
    const { runSim } = (await import(runnerPath)) as {
      runSim: (c: unknown) => { runHash: string; config: Record<string, unknown> };
    };
    const result = runSim(TINY_ROLLOUT_BASE);
    expect(result.config).not.toHaveProperty('valueModelPath');
    expect(result.runHash).toBe(PINNED_HASH);
  }, 30000);
});
