// balance-ab-candidates.mjs — candidate-COVERAGE A/B: how much of the rollout
// pilot's quality ceiling was candidate ENUMERATION (candidateGen 'legacy' vs
// 'full', T2) vs simply branching WIDER (maxCandidates 8 vs 16)? Four same-seed
// r8 rollout arms — {candidateGen: legacy|full} x {maxCandidates: 8|16} — run
// against the real starter decks with paired per-game outcome comparison: since
// every game's seed is a pure function of (seedBase, pairing, gameIndex) and all
// four arms share seedBase/decks/matchups/gamesPerPairing, arm A's i-th game and
// arm B's i-th game ARE the same seed — a "flip" (different faction wins) is
// attributable to the enumeration/cap axis alone, not sampling noise.
//
// BASE mirrors balance-verify.mjs's rollout-rung BASE (ruleset v1 manifest, real
// starter decks, all-pairs incl. mirrors, seatAlternation) so this A/B panel is
// statistically comparable to prior panel history. rolloutSeedMode 'actionKey'
// (T3) is fixed ON for every arm — it's what keeps legacy/full candidate
// playouts drawing from a position-independent seed stream for the SAME action,
// a prerequisite for the enumeration axis to be isolated at all.
//
// Env knobs: AB_GPP (required — games per pairing, per arm), WORKERS (default
// <=8, sim-parallel worker-count convention), AB_OUT (output JSON path; default
// balance-runs/runs/tmp-ab-candidates-<ts>.json, archived by appendRun).
// --label <s> / AB_LABEL env: ledger label (default 'ab-candidates').
//
// Ledger: one entry (kind 'ab-candidates') via appendRun, with the four arms as
// pilot rows (see balance-ledger.mjs's headlinePilot / balance-cli.mjs usage).
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import path from 'node:path';
import { runSimShard, finalizeResults } from './sim-runner.mjs';
import { appendRun } from './balance-ledger.mjs';

const ENGINE_DIR = fileURLToPath(new URL('.', import.meta.url));
const RUNS_DIR = `${ENGINE_DIR}balance-runs/runs/`;
// sim-worker.mjs (unmodified) posts back the RAW per-game results array (see
// its own header) — runSimParallel (sim-parallel.mjs) discards that array after
// finalizing, but paired-flip analysis needs the per-game rows themselves, so
// this driver spawns the same worker directly and keeps both the raw array and
// the finalized summary. Mirrors sim-parallel.mjs's worker-spawn shape exactly
// (same heap cap, same work-stealing counter) — it must never move a number.
const SIM_WORKER = new URL('./sim-worker.mjs', import.meta.url);
const WORKER_HEAP_MB = +(process.env.WORKER_HEAP_MB || 1024);

// Pool provenance (same convention as balance-verify.mjs).
const POOL_PATH = process.env.AETHERION_CARDS || new URL('./sim-data/aetherion-cards.json', import.meta.url);
const POOL_SHA = createHash('sha256')
  .update(JSON.stringify(JSON.parse(readFileSync(POOL_PATH, 'utf8'))))
  .digest('hex')
  .slice(0, 16);

// Locked ruleset manifest (same as balance-verify.mjs) — v1 never mutates.
const MANIFEST_PATH = new URL('./sim-data/ruleset-v1.json', import.meta.url);
const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
const manifestRules = manifest.rules;

const FACTIONS = ['Onyx', 'Radiant', 'Sapphire', 'Verdant'];
const realDecks = Object.fromEntries(FACTIONS.map(f => [f, f]));

const AB_GPP = +(process.env.AB_GPP || 0);
if (!Number.isInteger(AB_GPP) || AB_GPP <= 0) {
  console.error('AB_GPP is required (positive integer — games per pairing, per arm)');
  process.exit(1);
}
const WORKERS = +(process.env.WORKERS || Math.min(availableParallelism(), 8));

function getArg(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const LABEL = getArg('--label') || process.env.AB_LABEL || 'ab-candidates';
const EXPLICIT_OUT = process.env.AB_OUT;
const AB_OUT = EXPLICIT_OUT || `${RUNS_DIR}tmp-ab-candidates-${Date.now()}.json`;

// Measurement fields identical to balance-verify.mjs's rollout-rung BASE.
const BASE = {
  firstPlayer: 'alternating',
  fixHandSizeStall: true,
  termination: 'tiebreak',
  abilitiesOn: true,
  turnCap: 80,
  seedBase: 12345,
  ...manifestRules,
  seatAlternation: true,
  botPolicy: 'rollout',
  rollouts: 8,
  rolloutDepth: 3,
  rolloutSeedMode: 'actionKey',
  decks: realDecks,
  matchups: 'all-pairs',
  gamesPerPairing: AB_GPP,
};

// ── Arms (fixed, per §14 pre-registration) ───────────────────────────────────
const ARMS = [
  { key: 'legacy-c8', candidateGen: 'legacy', maxCandidates: 8 },
  { key: 'legacy-c16', candidateGen: 'legacy', maxCandidates: 16 },
  { key: 'full-c8', candidateGen: 'full', maxCandidates: 8 },
  { key: 'full-c16', candidateGen: 'full', maxCandidates: 16 },
];
const armLabel = (a) => `r8 ${a.candidateGen} c${a.maxCandidates}`;

// ── Running an arm: raw per-game rows + the standard finalized summary ───────
function runArmSerial(config) {
  const raw = runSimShard(config, 0, 1); // shardIndex 0 of 1 shard == every game, serial
  return { raw, summary: finalizeResults(config, raw) };
}
function runArmParallel(config, workers) {
  const n = Math.max(1, Math.min(workers, 64));
  const counterBuffer = new SharedArrayBuffer(4);
  return new Promise((resolve, reject) => {
    const all = [];
    let done = 0, failed = false;
    const fail = (e) => { if (!failed) { failed = true; reject(e); } };
    for (let i = 0; i < n; i++) {
      const w = new Worker(fileURLToPath(SIM_WORKER), {
        argv: [],
        workerData: { config, counterBuffer },
        resourceLimits: { maxOldGenerationSizeMb: WORKER_HEAP_MB, maxYoungGenerationSizeMb: 64 },
      });
      w.on('message', (results) => {
        for (const r of results) all.push(r);
        if (++done === n && !failed) {
          all.sort((a, b) => a.__gi - b.__gi);
          try {
            resolve({ raw: all, summary: finalizeResults(config, all) });
          } catch (e) {
            fail(e);
          }
        }
      });
      w.on('error', fail);
      w.on('exit', (code) => { if (code !== 0) fail(new Error(`sim worker ${String(i)} exited with code ${String(code)}`)); });
    }
  });
}
async function runArm(config, workers) {
  const t0 = Date.now();
  const result = workers > 1 ? await runArmParallel(config, workers) : runArmSerial(config);
  return { ...result, wallSec: (Date.now() - t0) / 1000 };
}

// Wilson 95% score interval -> [lowPct, pPct, highPct] (same as balance-verify.mjs).
function wilson(w, n, z = 1.96) {
  if (n <= 0) return [0, 0, 0];
  const p = w / n, d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const h = (z / d) * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [100 * (c - h), 100 * p, 100 * (c + h)];
}
const pct = (x) => `${x.toFixed(1)}%`;
const ci = (w, n) => { const [lo, p, hi] = wilson(w, n); return `${pct(p)} [${pct(lo)}–${pct(hi)}]`; };

function margFromSummary(summary) {
  const marg = {};
  for (const f of FACTIONS) {
    const c = summary.factionCounts[f] || { w: 0, n: 0 };
    marg[f] = { ...c, wilson: wilson(c.w, c.n) };
  }
  return marg;
}

function buildArmResult(arm, runResult) {
  const { summary, wallSec } = runResult;
  const marg = margFromSummary(summary);
  const wps = FACTIONS.map((f) => marg[f].wilson[1]);
  return {
    key: arm.key,
    label: armLabel(arm),
    candidateGen: arm.candidateGen,
    maxCandidates: arm.maxCandidates,
    games: summary.games,
    decidedPct: summary.decidedPct,
    mirrorFp: summary.mirrorFirstPlayerPct,
    runHash: summary.runHash,
    wallSec: +wallSec.toFixed(1),
    spread: +(Math.max(...wps) - Math.min(...wps)).toFixed(1),
    marg,
    candidatePruning: summary.candidatePruning ?? null,
  };
}

// ── Paired flip analysis ─────────────────────────────────────────────────────
// Align two arms' raw per-game rows by index (both sorted by __gi, both built
// from the identical plan — same seedBase/decks/matchups/gamesPerPairing — so
// index i IS (pairing, gameIndex) in both). Verified, not just assumed: any
// misalignment throws rather than silently comparing the wrong games.
function pairRows(rawA, rawB) {
  if (rawA.length !== rawB.length) throw new Error(`pairRows: length mismatch (${rawA.length} vs ${rawB.length})`);
  const rows = [];
  for (let i = 0; i < rawA.length; i++) {
    const a = rawA[i], b = rawB[i];
    if (a.fA !== b.fA || a.fB !== b.fB || a.seed !== b.seed) {
      throw new Error(`pairRows: misalignment at index ${i} (${a.fA}|${a.fB}|${a.seed} vs ${b.fA}|${b.fB}|${b.seed})`);
    }
    rows.push({ fA: a.fA, fB: a.fB, mirror: a.fA === a.fB, decidedA: a.decided, decidedB: b.decided, winnerA: a.winner, winnerB: b.winner });
  }
  return rows;
}

// `fromArm`/`toArm` label the direction of "switching" for the net-effect
// readout (winsGained/winsLost are framed as fromArm -> toArm). Non-mirror,
// both-decided games only — a mirror has no faction-level "winner" and an
// undecided game on either side isn't a comparable outcome.
function flipAnalysis(label, rawFrom, rawTo) {
  const rows = pairRows(rawFrom, rawTo);
  let comparable = 0, flips = 0;
  const byPairing = {};
  const winsGained = Object.fromEntries(FACTIONS.map((f) => [f, 0])); // wins gained switching from->to
  const winsLost = Object.fromEntries(FACTIONS.map((f) => [f, 0]));
  for (const r of rows) {
    if (r.mirror || !r.decidedA || !r.decidedB) continue;
    comparable++;
    const winnerFrom = r.winnerA === 0 ? r.fA : r.fB;
    const winnerTo = r.winnerB === 0 ? r.fA : r.fB;
    const key = `${r.fA}|${r.fB}`;
    (byPairing[key] ??= { n: 0, flips: 0 }).n++;
    if (winnerFrom !== winnerTo) {
      flips++;
      byPairing[key].flips++;
      winsGained[winnerTo]++;
      winsLost[winnerFrom]++;
    }
  }
  return {
    label,
    n: comparable,
    flips,
    flipRatePct: +(100 * flips / Math.max(comparable, 1)).toFixed(1),
    byPairing,
    winsGained,
    winsLost,
    netEffect: Object.fromEntries(FACTIONS.map((f) => [f, winsGained[f] - winsLost[f]])),
  };
}

function gitRev() {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: ENGINE_DIR, encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

// ── Run the panel ─────────────────────────────────────────────────────────────
console.log(`Config: AB_GPP=${AB_GPP}  WORKERS=${WORKERS}  label=${LABEL}`);
console.log(`Pool: ${POOL_PATH}  sha256/16 ${POOL_SHA}`);
console.log(`Ruleset: manifest v${manifest.version} (locked)`);

const armResults = {};
const rawByArm = {};
for (const arm of ARMS) {
  console.log(`\nRunning ${armLabel(arm)} (candidateGen=${arm.candidateGen}, maxCandidates=${arm.maxCandidates})…`);
  const config = { ...BASE, candidateGen: arm.candidateGen, maxCandidates: arm.maxCandidates };
  const runResult = await runArm(config, WORKERS);
  rawByArm[arm.key] = runResult.raw;
  const r = (armResults[arm.key] = buildArmResult(arm, runResult));
  console.log(`  games=${r.games}  decided=${pct(r.decidedPct)}  runHash=${r.runHash}  wall=${r.wallSec}s`);
  for (const f of FACTIONS) console.log(`    ${f.padEnd(9)} ${ci(r.marg[f].w, r.marg[f].n)}`);
  if (r.candidatePruning) {
    console.log(`    candidatePruning: raw=${r.candidatePruning.raw}  retained=${r.candidatePruning.retained}  prunedByKind=${JSON.stringify(r.candidatePruning.prunedByKind)}`);
  }
}

const pairC8 = flipAnalysis('legacy-c8 -> full-c8', rawByArm['legacy-c8'], rawByArm['full-c8']);
const pairC16 = flipAnalysis('legacy-c16 -> full-c16', rawByArm['legacy-c16'], rawByArm['full-c16']);
const crossCapLegacy = flipAnalysis('legacy-c8 -> legacy-c16', rawByArm['legacy-c8'], rawByArm['legacy-c16']);

console.log('\n══ PAIRED FLIPS (same-cap: legacy vs full) ══');
for (const p of [pairC8, pairC16]) {
  console.log(`  ${p.label}: n=${p.n}  flips=${p.flips}  flipRate=${pct(p.flipRatePct)}`);
  console.log(`    by pairing: ${JSON.stringify(p.byPairing)}`);
  console.log(`    net effect (wins gained/lost switching to full): ${JSON.stringify(p.netEffect)}`);
}
console.log('\n══ CROSS-CAP SANITY (legacy-c8 vs legacy-c16) ══');
console.log(`  n=${crossCapLegacy.n}  flips=${crossCapLegacy.flips}  flipRate=${pct(crossCapLegacy.flipRatePct)}  (expected ≈0 if legacy enumeration rarely exceeds 8 candidates — reported, not asserted)`);

const PRE_REGISTRATION = {
  arms: ARMS.map((a) => ({ key: a.key, candidateGen: a.candidateGen, maxCandidates: a.maxCandidates, botPolicy: 'rollout', rollouts: 8, rolloutDepth: 3, rolloutSeedMode: 'actionKey' })),
  endpoint: 'primary: paired flip rate + per-faction marginal delta on same-cap pairs (legacy-c8 vs full-c8; legacy-c16 vs full-c16)',
  date: new Date().toISOString(),
  gitRev: gitRev(),
};

const output = {
  generatedFrom: 'balance-ab-candidates.mjs',
  pool: { path: String(POOL_PATH), sha256_16: POOL_SHA },
  focus: null,
  config: { AB_GPP, WORKERS },
  ruleset: BASE,
  arms: ARMS.map((a) => armResults[a.key]),
  flips: { legacyVsFullC8: pairC8, legacyVsFullC16: pairC16, crossCapLegacy },
  preRegistration: PRE_REGISTRATION,
  // Minimal pilots shim — appendRun/headlinePilot (balance-ledger.mjs) expects
  // pilots[].{label,spread,mirrorFp,decidedPct,games,runHash,marg}; the four
  // arms ARE the pilot rows here.
  pilots: ARMS.map((a) => {
    const r = armResults[a.key];
    return { label: r.label, spread: r.spread, mirrorFp: r.mirrorFp, decidedPct: r.decidedPct, games: r.games, runHash: r.runHash, marg: r.marg };
  }),
};

mkdirSync(path.dirname(AB_OUT), { recursive: true });
writeFileSync(AB_OUT, JSON.stringify(output, null, 2));
console.log(`\nWrote ${AB_OUT}`);

const entry = appendRun({ kind: 'ab-candidates', label: LABEL, resultPath: AB_OUT, env: { AB_GPP, WORKERS }, preset: null });
// appendRun archives by MOVING resultPath -> balance-runs/runs/<id>.json (see
// balance-deck-panel.mjs for the same convention). When AB_OUT was explicitly
// given, copy the archive back so the file stays at the path asked for.
if (EXPLICIT_OUT) copyFileSync(`${RUNS_DIR}${entry.id}.json`, AB_OUT);
console.log(`Ledger: ${entry.id}`);
for (const p of entry.pilots) {
  console.log(`  ${p.label.padEnd(16)} spread ${p.spread?.toFixed(1)}pp  mirrorFp ${p.mirrorFp?.toFixed(1)}%  decided ${p.decidedPct?.toFixed(1)}%  n=${p.games}`);
}
