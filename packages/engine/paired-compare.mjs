// paired-compare.mjs — PAIRED card-edit comparison harness.
//
// WHY THIS WORKS: each game's seed is a pure function of (seedBase, pairing p,
// game g) — seed = (seedBase + p*100003 + g*7919) >>> 0 (sim-runner.mjs:1659).
// Two runs sharing the SAME seedBase, gamesPerPairing, matchups and rung config
// therefore play the IDENTICAL seeded games per matchup, differing only by the
// card pool (AETHERION_CARDS). That means the per-game outcome pairs up across
// the "baseline" and "edited" arms, so the per-deck WIN-RATE DIFFERENCE is a
// paired statistic — its variance is far smaller than the variance of two
// independent absolute win rates, so a card edit's real effect on each deck
// shows up with far fewer games than a from-scratch battery would need.
//
// Each arm is run in its own child process (see paired-arm-runner.mjs) because
// sim-runner.mjs caches AETHERION_CARDS in a module-level constant at first
// import — a second import in the same process would silently reuse the first
// arm's card pool (see that file's header for the full explanation).
//
// Usage: node paired-compare.mjs <baselinePool.json> <editedPool.json> [gpp=150] [rung=r8d3] [--model=path]
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const ENGINE = fileURLToPath(new URL('.', import.meta.url));
const ARM_RUNNER = ENGINE + 'paired-arm-runner.mjs';

// ── CLI args ─────────────────────────────────────────────────────────────────
const rawArgs = process.argv.slice(2);
const modelArg = rawArgs.find(a => a.startsWith('--model='));
const modelPath = modelArg ? modelArg.slice('--model='.length) : process.env.AETHERION_VALUE_MODEL;
const positional = rawArgs.filter(a => !a.startsWith('--'));
const [baselinePool, editedPool, gppArg, rungArg] = positional;
if (!baselinePool || !editedPool) {
  console.error('usage: node paired-compare.mjs <baselinePool.json> <editedPool.json> [gpp=150] [rung=r8d3] [--model=path]');
  process.exit(1);
}
const gpp = +(gppArg || 150);
const rungName = rungArg || 'r8d3';

// ── Rung config (bot-policy knobs) ──────────────────────────────────────────
const R8D3 = { botPolicy: 'rollout', rollouts: 8, rolloutDepth: 3, maxCandidates: 8, candidateGen: 'full', playoutBackend: 'snapshot', rolloutPlayout: 'heuristic' };
const RUNGS = {
  r8d3: R8D3,
  heuristic: { botPolicy: 'heuristic' },
  valueGreedy: { botPolicy: 'valueGreedy', valueModelPath: modelPath },
  r8d3v: { ...R8D3, valueLeafModelPath: modelPath },
};
if (!(rungName in RUNGS)) {
  console.error(`unknown rung "${rungName}" — one of: ${Object.keys(RUNGS).join(', ')}`);
  process.exit(1);
}
const rung = RUNGS[rungName];
if ((rungName === 'valueGreedy' || rungName === 'r8d3v') && !modelPath) {
  console.error(`rung "${rungName}" needs a value-net model — pass --model=path or set AETHERION_VALUE_MODEL`);
  process.exit(1);
}

// ── Shared harness config (identical across both arms except AETHERION_CARDS) ─
const FACTIONS = ['Radiant', 'Verdant', 'Onyx', 'Sapphire'];
const decks = Object.fromEntries(FACTIONS.map(f => [f, f]));
const RULES = {
  reachDiscard: true, exileDiscardForEnergy: true, termination: 'tiebreak',
  firstPlayer: 'alternating', seatAlternation: true, fixHandSizeStall: true,
  armFirstInstanceOnly: true, terminationMode: 'resource_deck_empty_transform',
  costFloor: true, reserveTapChoice: true, reserveTapStrain: true, turnCap: 80,
};
const SEED_BASE = 12345; // FIXED and identical for both arms — this is what makes the games pair up.
const config = { decks, ...RULES, seedBase: SEED_BASE, ...rung, gamesPerPairing: gpp };

function wilson(w, n) {
  if (!n) return [0, 0];
  const z = 1.96, p = w / n, d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const m = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [(c - m) / d, (c + m) / d];
}

async function runArm(poolPath) {
  const { stdout } = await execFileAsync(
    process.execPath,
    [ARM_RUNNER, poolPath, JSON.stringify(config)],
    { maxBuffer: 64 * 1024 * 1024, cwd: ENGINE },
  );
  return JSON.parse(stdout);
}

// ── Run both arms (separate processes; safe to run concurrently) ────────────
console.log(`paired-compare: rung=${rungName} gpp=${gpp} seedBase=${SEED_BASE}`);
console.log(`  baseline pool: ${baselinePool}`);
console.log(`  edited   pool: ${editedPool}`);
const t0 = Date.now();
const [base, edit] = await Promise.all([runArm(baselinePool), runArm(editedPool)]);
const secs = ((Date.now() - t0) / 1000).toFixed(0);
console.log(`  done in ${secs}s\n`);

// ── Per-matchup PAIRED deltas (same seeds ⇒ cell win-count diff IS the sum of
// per-game paired outcome differences for that cell) ─────────────────────────
const pairedWinsByFaction = {}; // faction -> { deltaWins, n }
for (const key of new Set([...Object.keys(base.matchupDetail), ...Object.keys(edit.matchupDetail)])) {
  const cb = base.matchupDetail[key];
  const ce = edit.matchupDetail[key];
  if (!cb || !ce) continue;
  if (cb.fA === cb.fB) continue; // exclude mirrors, same convention as factionWinPct
  if (cb.n !== ce.n) throw new Error(`matchup ${key}: game count differs between arms (${cb.n} vs ${ce.n}) — arms are not paired`);
  const pf = (f) => (pairedWinsByFaction[f] ??= { deltaWins: 0, n: 0 });
  const a = pf(cb.fA); a.deltaWins += ce.wA - cb.wA; a.n += cb.n;
  const b = pf(cb.fB); b.deltaWins += ce.wB - cb.wB; b.n += cb.n;
}

// ── Report ───────────────────────────────────────────────────────────────────
const rows = FACTIONS.map((f) => {
  const cb = base.factionCounts[f] || { w: 0, n: 0 };
  const ce = edit.factionCounts[f] || { w: 0, n: 0 };
  const wb = wilson(cb.w, cb.n), we = wilson(ce.w, ce.n);
  const paired = pairedWinsByFaction[f] || { deltaWins: 0, n: 0 };
  const pairedDeltaPct = paired.n ? (100 * paired.deltaWins) / paired.n : 0;
  return {
    f,
    baseline: cb.n ? (100 * cb.w) / cb.n : 0, baseLo: wb[0] * 100, baseHi: wb[1] * 100, baseN: cb.n,
    edited: ce.n ? (100 * ce.w) / ce.n : 0, editLo: we[0] * 100, editHi: we[1] * 100, editN: ce.n,
    pairedDeltaPct,
  };
});
rows.sort((a, b) => b.pairedDeltaPct - a.pairedDeltaPct);

console.log('== per-faction win rate: baseline vs edited (paired Δ is the headline) ==');
for (const r of rows) {
  const sign = r.pairedDeltaPct >= 0 ? '+' : '';
  console.log(
    `  ${r.f.padEnd(9)} baseline ${r.baseline.toFixed(1)}% [${r.baseLo.toFixed(1)},${r.baseHi.toFixed(1)}] n=${r.baseN}` +
    `   edited ${r.edited.toFixed(1)}% [${r.editLo.toFixed(1)},${r.editHi.toFixed(1)}] n=${r.editN}` +
    `   Δ(paired) ${sign}${r.pairedDeltaPct.toFixed(2)} pp`,
  );
}
console.log(
  '\n  Note: because both arms play the SAME seeded games per matchup (shared seedBase), the\n' +
  '  Δ(paired) column is meaningful even when the baseline/edited absolute CIs overlap — it is\n' +
  '  computed from the per-cell win-count difference (edited − baseline) over the identical set\n' +
  '  of games, i.e. the sum of per-game paired outcome differences, not two independent samples.',
);

console.log(`\n  spread before (baseline): ${base.paritySpread}`);
console.log(`  spread after  (edited):   ${edit.paritySpread}`);

console.log(`\n  baseline runHash: ${base.runHash}`);
console.log(`  edited   runHash: ${edit.runHash}`);
if (baselinePool === editedPool) {
  console.log(`  (same pool both arms) runHash match: ${base.runHash === edit.runHash ? 'IDENTICAL (expected)' : 'DIFFERS — unexpected, investigate'}`);
} else {
  console.log(`  (different pools) runHash match: ${base.runHash === edit.runHash ? 'IDENTICAL — unexpected, pools should differ' : 'DIFFERS (expected)'}`);
}
