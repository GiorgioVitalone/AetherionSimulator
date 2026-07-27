// decision-datagen.mjs — DECISION-LOG generator (chunked + streaming).
//
// Runs the rollout-heuristic teacher (the trustworthy bot: rollout pilot backed by
// a heuristic playout) across the 4 starter decks IN PARALLEL (8 workers), collecting
// one record per rollout decision (config.collectDecisionLog, see pilot-rollout.mjs /
// sim-runner.mjs), and STREAMS them to NDJSON in small chunks.
//
// This is the foundation for pilotability analysis + policy-net distillation: each
// row captures the candidates the bot weighed at a decision point, their rollout
// values, and which it chose — a hand-crafted move-feature encoding is DEFERRED to a
// later phase, so `candidates[i].action` is the engine's raw PlayerAction as-is.
//
// Why chunked: buffering the whole dataset in the main thread alongside 8 rollout
// workers peaks near jetsam AND loses everything if interrupted. Each chunk runs a
// small gamesPerPairing, appends its rows, then frees them — memory stays flat and a
// kill only loses the in-flight chunk. Each chunk uses a distinct seedBase (so games
// differ across chunks) and its game ids are offset to stay globally unique.
//
// Usage: node decision-datagen.mjs [totalGamesPerPairing=4] [out.ndjson] [chunkGpp=25] [--smoke]
import { writeFileSync, appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { FEATURE_SCHEMA_VERSION, FEATURE_LENGTH } from './dist/index.js';

const ENGINE = new URL('.', import.meta.url).pathname;
// The simulator's canonical current corpus is the only implicit input. Alternate
// pools must be explicitly supplied and pass the same fail-closed validator.
const { runSimParallel } = await import(pathToFileURL(ENGINE + 'sim-parallel.mjs').href);

const totalGpp = +(process.argv[2] || 4);
const outPath = process.argv[3] || 'decision-log.ndjson';
const chunkGpp = +(process.argv[4] || 25); // games/pairing per chunk — bounds peak memory
const smokeMode = process.argv[5] === '--smoke';
const BASE_SEED = 800000;

// Standard rule flags (copied from t2-gate.mjs's RULES block).
const RULES = {
  rulesProfile: 'current',
  reachDiscard: true, termination: 'tiebreak',
  firstPlayer: 'alternating', seatAlternation: true, turnCap: 80,
};
// DATAGEN_CONFIG_OVERRIDE (JSON, merged last): the real teacher config below is
// ~10 pairings of deep rollouts and runs many minutes — far past any smoke-test
// budget — so the CI smoke shrinks it (fewer decks, shallow rollouts) without
// forking the tool. Unset = the real teacher config, unchanged.
const override = process.env.DATAGEN_CONFIG_OVERRIDE
  ? JSON.parse(process.env.DATAGEN_CONFIG_OVERRIDE)
  : {};
const baseConfig = {
  ...RULES,
  ...(smokeMode
    ? {
        turnCap: 10,
        matchups: [{ p0Deck: 'Radiant', p1Deck: 'Onyx' }],
      }
    : {}),
  botPolicy: 'rollout',
  rollouts: smokeMode ? 1 : 8,
  rolloutDepth: smokeMode ? 1 : 3,
  maxCandidates: smokeMode ? 3 : 8,
  candidateGen: 'full', playoutBackend: 'snapshot', rolloutPlayout: 'heuristic',
  collectDecisionLog: true,
  decks: { Radiant: 'Radiant', Verdant: 'Verdant', Onyx: 'Onyx', Sapphire: 'Sapphire' },
  ...override,
};

// Header line (truncates any prior file).
writeFileSync(
  outPath,
  JSON.stringify({ schemaVersion: FEATURE_SCHEMA_VERSION, featureLength: FEATURE_LENGTH, teacher: 'rollout-heuristic-r8', targetGpp: totalGpp }) + '\n',
);

let doneGpp = 0, chunk = 0, gameOffset = 0, totalRows = 0;
const t0 = Date.now();
while (doneGpp < totalGpp) {
  const gpp = Math.min(chunkGpp, totalGpp - doneGpp);
  const result = await runSimParallel(
    { ...baseConfig, gamesPerPairing: gpp, seedBase: BASE_SEED + chunk },
    smokeMode ? 1 : 8,
  );
  const rows = result.decisionLog || [];
  if (rows.length) {
    const lines = rows.map(r => JSON.stringify({
      game: r.game + gameOffset, turn: r.turn, faction: r.faction,
      features: r.features, candidates: r.candidates, chosenIdx: r.chosenIdx,
      heuristicIdx: r.heuristicIdx, passIdx: r.passIdx,
    }));
    appendFileSync(outPath, lines.join('\n') + '\n');
  }
  const distinct = new Set(rows.map(r => r.game)).size;
  gameOffset += distinct;
  totalRows += rows.length;
  doneGpp += gpp;
  chunk += 1;
  const mins = ((Date.now() - t0) / 60000).toFixed(1);
  console.log(`chunk ${chunk}: +${rows.length} rows (${distinct} games) | total ${totalRows} rows / ${gameOffset} games | gpp ${doneGpp}/${totalGpp} | ${mins}m`);
}
console.log(`DONE: ${totalRows} rows, ${gameOffset} games -> ${outPath}`);
