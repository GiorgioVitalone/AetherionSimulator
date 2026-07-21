// pilot-value.mjs — the `valueGreedy` neural-inference pilot.
//
// A ONE-PLY greedy pilot: at each of the active player's decision points it (1)
// enumerates the *legal* candidate actions via the engine's canonical
// `enumerateConcretePlayerActions(gs, 'full')` (plus the END_PHASE "hold"), (2)
// computes each candidate's AFTERSTATE by a pure `transition()` fork of the
// hydrated snapshot (no rollouts, no live-actor mutation — same mechanism as
// pilot-rollout.mjs's `hydratePersistedSnapshot` / `makeSnapshotFork`), (3)
// featurizes every afterstate with the shared `featurize()` (src/neural/
// featurizer.ts) and batch-scores them with a neural value net (which predicts
// P(the afterstate's ACTIVE player wins)), and (4) picks the candidate maximizing
// OUR win probability. Because this game has MULTI-ACTION turns, most afterstates
// are still our turn (net output = our win prob); only when the action passes the
// turn (e.g. END_PHASE → opponent) is the net's output inverted (1 − p).
//
// DETERMINISM: no Math.random, no wall clock, no rollouts — the only inputs are
// the current game state and the injected/loaded scorer. Ties break to the
// lowest candidate index (the enumerator's stable order), mirroring
// pilot-rollout.mjs's tie-break discipline.
//
// SCORER: `score` is `(Float32Array[]) -> number[]` (win-prob per position,
// same order as the input batch) — ALWAYS SYNCHRONOUS. Tests inject a mock
// `score` so the decision logic and determinism are fully verifiable with no
// model file. The default scorer (used when `modelPath` is given and `score`
// is not) is a small hand-rolled JS forward pass over `value-net.json` (see
// `forward()` / `loadValueNet()` below) — NOT onnxruntime-node: that package's
// JS API (`InferenceSession.create` / `session.run`) is Promise-only, which is
// incompatible with sim-runner.mjs's fully synchronous per-decision dispatch
// loop. A plain JS MLP forward pass has no such constraint, so `chooseAction`
// is synchronous end-to-end, exactly like the rollout pilot.
import {
  gameMachine,
  enumerateConcretePlayerActions,
  featurize,
  FEATURE_LENGTH,
  FEATURE_SCHEMA_VERSION,
} from './dist/index.js';
import { hydratePersistedSnapshot, makeSnapshotFork } from './pilot-rollout.mjs';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

// sha256 of the model file (first 16 hex chars, matching the run-hash convention
// elsewhere in this package). Returns null when the file cannot be read (e.g. no
// model wired yet) so callers can still report `meta` without a model present.
export function computeModelSha(modelPath) {
  try {
    return createHash('sha256').update(readFileSync(modelPath)).digest('hex').slice(0, 16);
  } catch {
    return null;
  }
}

// ── The JS forward pass ──────────────────────────────────────────────────────
// `layers` is an ordered array of `{ W: number[out][in], b: number[out] }` —
// one entry per Linear layer. Every layer but the last is followed by ReLU;
// the last is followed by sigmoid (matches value-net.json's documented
// arch: "relu-hidden-sigmoid-out"). Returns the final scalar in [0, 1].
export function forward(layers, input) {
  let a = input;
  for (let i = 0; i < layers.length; i++) {
    const { W, b } = layers[i];
    const out = new Array(W.length);
    for (let o = 0; o < W.length; o++) {
      let z = b[o];
      const row = W[o];
      for (let k = 0; k < row.length; k++) z += row[k] * a[k];
      out[o] = z;
    }
    const isLast = i === layers.length - 1;
    for (let o = 0; o < out.length; o++) {
      out[o] = isLast ? 1 / (1 + Math.exp(-out[o])) : Math.max(0, out[o]);
    }
    a = out;
  }
  return a[0];
}

// Load + validate a value-net.json. THROWS (fail fast, at pilot construction —
// never silently swallowed) when the file's featureLength/featureSchemaVersion
// don't match this build's featurizer, or when ANY of its paritySamples fails
// to reproduce (within 1e-4) under THIS forward() — the parity check is the
// guard against weight-format/transpose bugs (W is read as [out][in]).
export function loadValueNet(modelPath) {
  const net = JSON.parse(readFileSync(modelPath, 'utf8'));
  if (net.featureLength !== FEATURE_LENGTH) {
    throw new Error(
      `value-net.json featureLength ${String(net.featureLength)} !== engine FEATURE_LENGTH ${String(FEATURE_LENGTH)}`,
    );
  }
  if (net.featureSchemaVersion !== FEATURE_SCHEMA_VERSION) {
    throw new Error(
      `value-net.json featureSchemaVersion ${String(net.featureSchemaVersion)} !== engine FEATURE_SCHEMA_VERSION ${String(FEATURE_SCHEMA_VERSION)}`,
    );
  }
  for (const sample of net.paritySamples || []) {
    const got = forward(net.layers, sample.f);
    if (Math.abs(got - sample.prob) > 1e-4) {
      throw new Error(
        `value-net.json parity sample failed: forward()=${String(got)} expected=${String(sample.prob)}`,
      );
    }
  }
  return net;
}

// Default scorer: a synchronous JS forward pass over a loaded+validated
// value-net.json. Loaded (and parity-checked) EAGERLY at pilot construction —
// a bad model file throws immediately rather than mid-game.
function makeJsScorer(modelPath) {
  const net = loadValueNet(modelPath);
  return function score(featureVectors) {
    return featureVectors.map((v) => forward(net.layers, v));
  };
}

// The pilot: choose one action by one-ply value-net greedy search, or null to
// END_PHASE. Pure w.r.t. the live actor: it only reads its persisted snapshot
// and forks pure `transition()` copies from it (never mutates the live actor).
export function makeValuePilot(opts = {}) {
  const modelPath = opts.modelPath ?? null;
  const score = opts.score ?? (modelPath ? makeJsScorer(modelPath) : null);
  if (!score) throw new Error('makeValuePilot requires either opts.score or opts.modelPath');

  let decisionIndex = 0;
  const diag = { decisions: 0, candidatesSeen: 0 };

  function reset() {
    decisionIndex = 0;
    diag.decisions = 0;
    diag.candidatesSeen = 0;
  }

  function chooseAction(actor, gs, gameSeed, turnCap) {
    void gameSeed; // no rollout randomness — one-ply search needs no seed
    void turnCap;
    decisionIndex++;
    diag.decisions++;

    const cands = enumerateConcretePlayerActions(gs, 'full');
    // The "stop" candidate (END_PHASE) is always evaluated: holding is a real option.
    const options = [...cands.map((a) => ({ action: a })), { action: null }];
    diag.candidatesSeen += options.length;

    const me = gs.activePlayerIndex; // the deciding player (perspective anchor)
    const persisted = actor.getPersistedSnapshot();
    const hydrated = hydratePersistedSnapshot(gameMachine, persisted);

    // For each candidate, the afterstate AND whose turn it is there. This game has
    // multi-action turns, so most afterstates are STILL our turn.
    const afterActive = [];
    const vectors = options.map((opt) => {
      const fork = makeSnapshotFork(gameMachine, hydrated);
      try {
        if (opt.action != null) fork.send({ type: 'PLAYER_ACTION', action: opt.action });
        else fork.send({ type: 'END_PHASE' });
      } catch {
        // Illegal in this fork: score the unchanged (current) state, treating it
        // as a pass-equivalent afterstate — mirrors pilot-rollout.mjs's handling
        // of an illegal candidate inside a rollout branch.
      }
      const after = fork.getSnapshot().context.gameState;
      afterActive.push(after.activePlayerIndex);
      return featurize(after);
    });

    // SYNCHRONOUS — `score` (mock or the default JS forward pass) never returns a
    // Promise, so `chooseAction` never does either. The value net predicts P(the
    // afterstate's ACTIVE player wins). When the afterstate is still our turn
    // (active === me) that IS our win prob; when the action passed the turn (e.g.
    // END_PHASE → opponent) we invert. Pick the candidate maximizing OUR win prob.
    const probs = score(vectors);
    let bestIdx = 0;
    let bestOurWin = -Infinity;
    for (let i = 0; i < options.length; i++) {
      const ourWin = afterActive[i] === me ? probs[i] : 1 - probs[i];
      // Strict '>' so ties keep the earlier (lowest-index) candidate — the
      // enumerator's stable order — as the deterministic tie-break.
      if (ourWin > bestOurWin) {
        bestOurWin = ourWin;
        bestIdx = i;
      }
    }
    return options[bestIdx].action;
  }

  return {
    chooseAction,
    reset,
    diag,
    meta: {
      modelPath,
      modelSha: modelPath ? computeModelSha(modelPath) : null,
      featureSchemaVersion: FEATURE_SCHEMA_VERSION,
    },
  };
}
