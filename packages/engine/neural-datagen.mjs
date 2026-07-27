// neural-datagen.mjs — value-net TRAINING-DATA generator (chunked + streaming).
//
// Runs the rollout-heuristic teacher (the trustworthy bot: rollout pilot backed by
// a heuristic playout) across the 4 starter decks IN PARALLEL (8 workers), collecting
// one featurized row per turn start per game (config.collectTrainingData, see
// sim-runner.mjs), and STREAMS them to NDJSON in small chunks.
//
// Why chunked: buffering the whole dataset (~100k×374-float rows) in the main thread
// alongside 8 rollout workers peaks near jetsam AND loses everything if interrupted.
// Each chunk runs a small gamesPerPairing, appends its rows, then frees them — memory
// stays flat and a kill only loses the in-flight chunk. Each chunk uses a distinct
// seedBase (so games differ across chunks) and its game ids are offset to stay globally
// unique (required for the trainer's game-grouped split).
//
// Usage: node neural-datagen.mjs [totalGamesPerPairing=4] [out.ndjson] [chunkGpp=25]
import { writeFileSync, appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { FEATURE_SCHEMA_VERSION, FEATURE_LENGTH } from './dist/index.js';

const ENGINE = new URL('.', import.meta.url).pathname;
process.env.AETHERION_CARDS = process.env.AETHERION_CARDS || ENGINE + 'generated-pools/aetherion-CURRENT.json';
const { runSimParallel } = await import(pathToFileURL(ENGINE + 'sim-parallel.mjs').href);

const totalGpp = +(process.argv[2] || 4);
const outPath = process.argv[3] || 'training-data.ndjson';
const chunkGpp = +(process.argv[4] || 25); // games/pairing per chunk — bounds peak memory
const BASE_SEED = 700000;

// Standard rule flags (copied from t2-gate.mjs's RULES block).
const RULES = {
  rulesProfile: 'current',
  reachDiscard: true, termination: 'tiebreak',
  firstPlayer: 'alternating', seatAlternation: true, turnCap: 80,
};
const baseConfig = {
  ...RULES,
  botPolicy: 'rollout', rollouts: 8, rolloutDepth: 3, maxCandidates: 8,
  candidateGen: 'full', playoutBackend: 'snapshot', rolloutPlayout: 'heuristic',
  collectTrainingData: true,
  decks: { Radiant: 'Radiant', Verdant: 'Verdant', Onyx: 'Onyx', Sapphire: 'Sapphire' },
};

// Header line (truncates any prior file).
writeFileSync(
  outPath,
  JSON.stringify({ schemaVersion: FEATURE_SCHEMA_VERSION, featureLength: FEATURE_LENGTH, teacher: 'rollout-heuristic-r8', targetGpp: totalGpp }) + '\n',
);

let doneGpp = 0, chunk = 0, gameOffset = 0, totalRows = 0, sumY = 0;
const t0 = Date.now();
while (doneGpp < totalGpp) {
  const gpp = Math.min(chunkGpp, totalGpp - doneGpp);
  const result = await runSimParallel({ ...baseConfig, gamesPerPairing: gpp, seedBase: BASE_SEED + chunk }, 8);
  const rows = result.trainingRows || [];
  if (rows.length) {
    const lines = rows.map(r => JSON.stringify({ f: r.f, y: r.y, game: r.game + gameOffset, turn: r.turn, faction: r.faction }));
    appendFileSync(outPath, lines.join('\n') + '\n');
  }
  const distinct = new Set(rows.map(r => r.game)).size;
  gameOffset += distinct;
  totalRows += rows.length;
  sumY += rows.reduce((a, r) => a + r.y, 0);
  doneGpp += gpp;
  chunk += 1;
  const mins = ((Date.now() - t0) / 60000).toFixed(1);
  console.log(`chunk ${chunk}: +${rows.length} rows (${distinct} games) | total ${totalRows} rows / ${gameOffset} games | gpp ${doneGpp}/${totalGpp} | ${mins}m`);
}
console.log(`DONE: ${totalRows} rows, ${gameOffset} games, label mean ${(totalRows ? sumY / totalRows : 0).toFixed(4)} -> ${outPath}`);
