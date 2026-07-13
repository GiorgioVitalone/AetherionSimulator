// balance-verify.mjs — verify the 4 starter decks against docs/balance-targets.md.
//
// Runs the real official starter decks (deck-loader, committed fixture) under a
// PANEL of pilots of increasing strength (random floor → heuristic → outcome-driven
// rollout), full all-pairs incl. mirrors, with first player ALTERNATING (the
// confound neutralized) and the hand-size stall fixed. For each pilot it reports the
// 4x4 matchup matrix, marginal faction win% with Wilson 95% CIs, parity spread,
// worst-matchup polarization, mirror first-player advantage, and decided%. It then
// grades every metric PASS/FLAG/FAIL against the target spec and checks whether the
// pilots AGREE (the validity gate — a verdict that flips with the pilot is not real).
//
// Sizes are env-tunable for a fast smoke run:
//   GPP_MATRIX (random/heuristic per-cell games), RL_GPP / RH_GPP (rollout low/high
//   all-pairs games), SKIP_ROLLOUT=1. Deterministic (seeded); writes JSON to GAUGE_OUT.
// T4 rollout-pilot A/B knobs (threaded into every rollout rung; unset ⇒
//   byte-identical to today): CAND_GEN ('legacy'|'full') -> candidateGen,
//   SEED_MODE ('index'|'actionKey') -> rolloutSeedMode, ROLLOUT_MAXC (int) ->
//   overrides maxCandidates on every rung. T7: PLAYOUT_BACKEND ('actor'|
//   'snapshot') -> playoutBackend, hash-exempt diagnostic (see sim-runner's
//   computeRunHash).
import { readFileSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { createHash } from 'node:crypto';
import { runSim } from './sim-runner.mjs';
import { runSimParallel } from './sim-parallel.mjs';

// Pool provenance, embedded in header + output JSON so every run self-certifies
// which card bytes it ran on (same digest as make-pools.mjs: sha256/16 of the
// re-serialized parsed pool, robust to file formatting). Verification of an
// external run is then a read, not a re-simulation — full bit-for-bit rung
// reproduction (§7/§8-era check) is reserved for runs whose internals look
// inconsistent. Metadata only: runHash is computed inside sim-runner from the
// sim config and is unaffected.
const POOL_PATH = process.env.AETHERION_CARDS || new URL('./sim-data/aetherion-cards.json', import.meta.url);
const POOL_SHA = createHash('sha256')
  .update(JSON.stringify(JSON.parse(readFileSync(POOL_PATH, 'utf8'))))
  .digest('hex')
  .slice(0, 16);

// Canonical thresholds — docs/balance-targets.md §2 mirrors this file; on conflict
// this JSON wins (see the file's own $comment).
const TARGETS_PATH = new URL('./sim-data/balance-targets.json', import.meta.url);
const T = JSON.parse(readFileSync(TARGETS_PATH, 'utf8')).thresholds;

// Locked ruleset manifest (sim-data/ruleset-v1.json) — the CONSUMED source of
// truth for the 9 locked rule flags (docs/balance-framework.md §1: v1 never
// mutates). This BASE no longer hardcodes those flags; it loads them from the
// manifest. Missing manifest means a pre-lock checkout — fall back to the
// pre-lock hardcoded defaults (RD/COMP absent, i.e. engine defaults) so old
// worktrees keep working, with a loud warning.
const MANIFEST_PATH = new URL('./sim-data/ruleset-v1.json', import.meta.url);
const PRE_LOCK_FALLBACK_RULES = {
  armFirstInstanceOnly: true,
  terminationMode: 'resource_deck_empty_transform',
  costFloor: true,
  reserveTapChoice: true,
  reserveTapStrain: true,
  exileDiscardForEnergy: true,
  apnapAnyOrderFix: true,
};
let manifest = null;
let manifestRules = PRE_LOCK_FALLBACK_RULES;
try {
  manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
  manifestRules = manifest.rules;
} catch {
  console.warn(`WARNING: manifest not found at ${MANIFEST_PATH} — using pre-lock hardcoded BASE (this checkout predates the ruleset-v1 lock).`);
}

const FACTIONS = ['Onyx', 'Radiant', 'Sapphire', 'Verdant'];
const realDecks = Object.fromEntries(FACTIONS.map(f => [f, f])); // faction name -> real official deck

const GPP_MATRIX = +(process.env.GPP_MATRIX || 1000);
const RL_GPP = +(process.env.RL_GPP || 16);
const RH_GPP = +(process.env.RH_GPP || 8);
const RX_GPP = +(process.env.RX_GPP || 0); // >0 adds a 3rd rollout rung (r12 d3 c8)
const SKIP_ROLLOUT = process.env.SKIP_ROLLOUT === '1';
// FOCUS=<faction>: run ONLY that faction's pairings (3 cross + mirror). For a
// candidate pool that edits a single faction's cards, the other six pairings are
// byte-identical replays of the reference panel (game seeds are a pure function
// of (seedBase, pairing, game) and those games never instantiate the edited
// cards — proven empirically in §13g), so this buys the SAME n on every
// informative cell at ~40% of the compute. Non-focus marginals then contain
// vs-FOCUS games only — reconstruct full marginals by combining with the
// reference panel's unchanged pack-internal counts. Cross-pilot gate is skipped.
const FOCUS = process.env.FOCUS || '';
if (FOCUS && !FACTIONS.includes(FOCUS)) {
  console.error(`FOCUS must be one of: ${FACTIONS.join(', ')}`);
  process.exit(1);
}
// CAND_GEN / SEED_MODE / ROLLOUT_MAXC (T4): thread the T2/T3 rollout-pilot
// knobs (candidateGen, rolloutSeedMode, maxCandidates) into every rollout rung
// (runAggPilot below), so the A/B panel is env-driven instead of hand-edited
// per run. Unset ⇒ the key is simply omitted from the rung's config, so it's
// byte-identical to every prior panel (matches runSim's unset-is-omitted
// contract — see rollout-pin.test.ts).
const CAND_GEN = process.env.CAND_GEN;
if (CAND_GEN !== undefined && CAND_GEN !== 'legacy' && CAND_GEN !== 'full') {
  console.error(`CAND_GEN must be 'legacy' or 'full' (got "${CAND_GEN}")`);
  process.exit(1);
}
const SEED_MODE = process.env.SEED_MODE;
if (SEED_MODE !== undefined && SEED_MODE !== 'index' && SEED_MODE !== 'actionKey') {
  console.error(`SEED_MODE must be 'index' or 'actionKey' (got "${SEED_MODE}")`);
  process.exit(1);
}
const ROLLOUT_MAXC = process.env.ROLLOUT_MAXC !== undefined ? +process.env.ROLLOUT_MAXC : undefined;
if (ROLLOUT_MAXC !== undefined && (!Number.isInteger(ROLLOUT_MAXC) || ROLLOUT_MAXC <= 0)) {
  console.error(`ROLLOUT_MAXC must be a positive integer (got "${process.env.ROLLOUT_MAXC}")`);
  process.exit(1);
}
// PLAYOUT_BACKEND (T7): 'actor' (default) | 'snapshot' — the playout stepping
// machinery A/B. Hash-exempt (see sim-runner's computeRunHash) — this is a
// harness dimension like WORKERS, not a rules dimension; both backends must
// produce IDENTICAL runHashes (pinned in rollout-pin.test.ts).
const PLAYOUT_BACKEND = process.env.PLAYOUT_BACKEND;
if (PLAYOUT_BACKEND !== undefined && PLAYOUT_BACKEND !== 'actor' && PLAYOUT_BACKEND !== 'snapshot') {
  console.error(`PLAYOUT_BACKEND must be 'actor' or 'snapshot' (got "${PLAYOUT_BACKEND}")`);
  process.exit(1);
}
const OUT = process.env.GAUGE_OUT || '/tmp/balance-verify-result.json';
// Parallel is byte-identical to serial (proven via runHash — see sim-parallel.mjs),
// so this is a pure speedup and every number/verdict below is unchanged. WORKERS=1
// forces the old serial path. This harness is the slow one (rollout pilots), so the
// win is large — an hour-plus run becomes minutes on a many-core machine.
// Default capped at 8 (~1 GB/worker under sim-parallel's heap cap keeps a 64 GB
// desktop responsive); WORKERS env overrides for beefier machines.
const WORKERS = +(process.env.WORKERS || Math.min(availableParallelism(), 8));
const run = (cfg) => (WORKERS > 1 ? runSimParallel(cfg, WORKERS) : Promise.resolve(runSim(cfg)));

// Measurement fields (not rule flags — not in the manifest) stay local; the 9
// locked rule flags come from manifestRules above.
const BASE = {
  firstPlayer: 'alternating',
  fixHandSizeStall: true,
  termination: 'tiebreak',
  abilitiesOn: true,
  turnCap: 80,
  seedBase: 12345,
  ...manifestRules,
  // §13q seat-asymmetry fix (2026-07-10): side:'any' target resolution now returns
  // APNAP order (active player first) instead of seat order, and the harness
  // alternates seats per pairing so a matchup's win rate no longer depends on
  // which deck happens to sit in seat 0 (~5pp drift measured before this fix).
  seatAlternation: true,
};

// Env overrides (RESOURCE_DECK, COMP, RULE_OFF) are EXPERIMENT deviations from
// the locked manifest, not the locked ruleset itself — loudly banner + record
// any override that actually changes an effective rule value away from the
// manifest's.
const ruleOverrides = [];
function override(key, effectiveValue) {
  const manifestValue = manifestRules[key] ?? null;
  if (manifestValue !== effectiveValue) {
    console.log(`RULE OVERRIDE (experiment): ${key} ${JSON.stringify(manifestValue)} -> ${JSON.stringify(effectiveValue)} — not the locked ruleset`);
    ruleOverrides.push({ rule: key, manifestValue, effectiveValue });
  }
  BASE[key] = effectiveValue;
}
// §13o rules probe (RESOURCE_DECK=<n>): truncate each Resource Deck to n cards
// post-shuffle (deck-construction change). Locked at 12 (manifest); env deviates.
if (process.env.RESOURCE_DECK) override('resourceDeckSize', Number(process.env.RESOURCE_DECK));
// Rule-lock Step 2 (COMP=card|resource|both): firstPlayerCompensation. Locked at
// 'card' (manifest); env deviates.
if (process.env.COMP) override('firstPlayerCompensation', process.env.COMP);

// One-flag-off ablation knob (rule-lock protocol): RULE_OFF=<flag> re-runs the
// panel with that single locked rule removed from BASE (engine default takes
// over), so each rule's retention case is one command. The removal is visible in
// the output via the resolved config echoed by every runSim result.
const RULE_OFF_ALLOWED = ['armFirstInstanceOnly', 'terminationMode', 'costFloor', 'reserveTapChoice', 'reserveTapStrain', 'exileDiscardForEnergy', 'apnapAnyOrderFix'];
const RULE_OFF = process.env.RULE_OFF || '';
if (RULE_OFF) {
  if (!RULE_OFF_ALLOWED.includes(RULE_OFF)) {
    console.error(`RULE_OFF=${RULE_OFF} is not an adopted rule flag (allowed: ${RULE_OFF_ALLOWED.join(', ')})`);
    process.exit(1);
  }
  if (RULE_OFF in BASE) {
    const manifestValue = manifestRules[RULE_OFF] ?? null;
    delete BASE[RULE_OFF];
    console.log(`RULE OVERRIDE (experiment): ${RULE_OFF} ${JSON.stringify(manifestValue)} -> off (removed) — not the locked ruleset`);
    ruleOverrides.push({ rule: RULE_OFF, manifestValue, effectiveValue: null });
  }
}

// Wilson 95% score interval -> [lowPct, pPct, highPct].
function wilson(w, n, z = 1.96) {
  if (n <= 0) return [0, 0, 0];
  const p = w / n, d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const h = (z / d) * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [100 * (c - h), 100 * p, 100 * (c + h)];
}
const pct = x => `${x.toFixed(1)}%`;
const ci = (w, n) => { const [lo, p, hi] = wilson(w, n); return `${pct(p)} [${pct(lo)}–${pct(hi)}]`; };

// ── Matrix pilots (random, heuristic): per-cell runs give the matrix + marginals ──
// Merge per-run factionDetail raw sums so the pilot-level mechanism evidence pools
// across all 10 cell runs (the `raw` block exists exactly for this).
function mergeFactionDetail(into, fd) {
  if (!fd) return;
  for (const [f, det] of Object.entries(fd)) {
    const d = det.raw;
    const t = (into[f] ??= {
      games: 0, transforms: 0, transformTurnSum: 0, transformTurnN: 0,
      winsT: 0, decT: 0, winsN: 0, decN: 0,
      res5: 0, res10: 0, res15: 0, deploys: 0, deploysEarly: 0, spellsEarly: 0, discards: 0,
      flipLpSum: 0, flipLpN: 0, flipSurvSum: 0, flipSurvN: 0, heroPre: 0, heroPost: 0,
      heroPostIdx: {},
    });
    for (const k of Object.keys(t)) {
      if (k === 'heroPostIdx') continue; // object-valued: merged below
      t[k] += d[k] || 0;
    }
    for (const [idx, n] of Object.entries(d.heroPostIdx || {})) {
      t.heroPostIdx[idx] = (t.heroPostIdx[idx] || 0) + n;
    }
  }
}
function finishFactionDetail(sums) {
  const pct1 = (w, n) => +(100 * w / Math.max(n, 1)).toFixed(1);
  const out = {};
  for (const [f, d] of Object.entries(sums)) {
    out[f] = {
      games: d.games,
      transformPct: pct1(d.transforms, d.games),
      transformAvgTurn: d.transformTurnN ? +(d.transformTurnSum / d.transformTurnN).toFixed(1) : null,
      winPctWhenTransformed: d.decT ? pct1(d.winsT, d.decT) : null,
      winPctWhenNot: d.decN ? pct1(d.winsN, d.decN) : null,
      avgLpAtFlip: d.flipLpN ? +(d.flipLpSum / d.flipLpN).toFixed(1) : null,
      avgTurnsAfterFlip: d.flipSurvN ? +(d.flipSurvSum / d.flipSurvN).toFixed(1) : null,
      heroAbilityUsesPerGame: {
        preFlip: +(d.heroPre / Math.max(d.games, 1)).toFixed(2),
        postFlip: d.transforms ? +(d.heroPost / d.transforms).toFixed(2) : null,
      },
      postFlipUsesByIndex: d.heroPostIdx,
      resourcesByTurn: {
        t5: +(d.res5 / Math.max(d.games, 1)).toFixed(2),
        t10: +(d.res10 / Math.max(d.games, 1)).toFixed(2),
        t15: +(d.res15 / Math.max(d.games, 1)).toFixed(2),
      },
      deploysPerGame: +(d.deploys / Math.max(d.games, 1)).toFixed(2),
      earlyDeploysPerGame: +(d.deploysEarly / Math.max(d.games, 1)).toFixed(2),
      earlySpellsPerGame: +(d.spellsEarly / Math.max(d.games, 1)).toFixed(2),
      discardsPerGame: +(d.discards / Math.max(d.games, 1)).toFixed(2),
    };
  }
  return out;
}

async function runMatrixPilot(label, pilotCfg) {
  const counts = Object.fromEntries(FACTIONS.map(f => [f, { w: 0, n: 0 }])); // marginal non-mirror
  const matrix = {}; // matrix[A][B] = {w,n}  (A beats B)
  for (const f of FACTIONS) matrix[f] = {};
  let mirrorFpWon = 0, mirrorDecided = 0;
  let decided = 0, games = 0, timeouts = 0, turnsSum = 0;
  const matchupDetail = {};
  const fdSums = {};

  for (let i = 0; i < FACTIONS.length; i++) {
    for (let j = i; j < FACTIONS.length; j++) {
      const A = FACTIONS[i], B = FACTIONS[j];
      if (FOCUS && A !== FOCUS && B !== FOCUS) continue;
      const r = await run({ ...BASE, ...pilotCfg, matchups: [{ p0Deck: A, p1Deck: B }], gamesPerPairing: GPP_MATRIX });
      games += r.games; decided += Math.round((r.decidedPct / 100) * r.games);
      timeouts += Math.round((r.timeoutPct / 100) * r.games); turnsSum += r.gameLength.avg * r.games;
      Object.assign(matchupDetail, r.matchupDetail); // one cell per run; keys never collide
      mergeFactionDetail(fdSums, r.factionDetail);
      if (i === j) { // mirror: first-player control
        mirrorDecided += Math.round((r.decidedPct / 100) * r.games);
        mirrorFpWon += Math.round((r.mirrorFirstPlayerPct / 100) * Math.round((r.decidedPct / 100) * r.games));
      } else {
        const fc = r.factionCounts; // {A:{w,n}, B:{w,n}} over non-mirror decided games
        if (fc[A]) { matrix[A][B] = { ...fc[A] }; counts[A].w += fc[A].w; counts[A].n += fc[A].n; }
        if (fc[B]) { matrix[B][A] = { ...fc[B] }; counts[B].w += fc[B].w; counts[B].n += fc[B].n; }
      }
    }
  }
  // Marginal win% + Wilson per faction.
  const marg = {};
  for (const f of FACTIONS) { const { w, n } = counts[f]; marg[f] = { w, n, wilson: wilson(w, n) }; }
  const wps = FACTIONS.map(f => marg[f].wilson[1]);
  const spread = Math.max(...wps) - Math.min(...wps);
  // Worst matchup polarization (max deviation of any off-diagonal cell from 50%).
  let worst = { dev: 0 };
  for (const A of FACTIONS) for (const B of FACTIONS) {
    if (A === B || !matrix[A][B]) continue;
    const { w, n } = matrix[A][B]; if (n < 30) continue;
    const wp = 100 * w / n, dev = Math.abs(wp - 50);
    if (dev > worst.dev) worst = { dev, A, B, wp, n };
  }
  const mirrorFp = mirrorDecided ? 100 * mirrorFpWon / mirrorDecided : 0;
  return { label, kind: 'matrix', marg, spread, matrix, worst, mirrorFp, mirrorDecided,
    decidedPct: 100 * decided / games, timeoutPct: 100 * timeouts / games, avgTurns: turnsSum / games, games,
    matchupDetail, factionDetail: finishFactionDetail(fdSums) };
}

// ── Aggregate pilots (rollout): single all-pairs run. Marginals PLUS the full
// per-cell + per-faction mechanism diagnostics (matchupDetail/factionDetail from
// summarize) — cells are only "too thin" at smoke sizes; at real GPP they carry
// the evidence (win split w/ CI, fp split, length percentiles, win method,
// comeback rate, victory margin, transform/resource/tempo curves). ──
async function runAggPilot(label, pilotCfg, gpp) {
  // FOCUS: explicit pairing list instead of all-pairs. Pairing indices differ
  // from an all-pairs run, so focus cells are statistically (not byte-)
  // comparable with previous full panels — same sizes, different seeds.
  const matchups = FOCUS ? FACTIONS.map((f) => ({ p0Deck: FOCUS, p1Deck: f })) : 'all-pairs';
  const r = await run({
    ...BASE, ...pilotCfg,
    ...(CAND_GEN !== undefined ? { candidateGen: CAND_GEN } : {}),
    ...(SEED_MODE !== undefined ? { rolloutSeedMode: SEED_MODE } : {}),
    ...(ROLLOUT_MAXC !== undefined ? { maxCandidates: ROLLOUT_MAXC } : {}),
    ...(PLAYOUT_BACKEND !== undefined ? { playoutBackend: PLAYOUT_BACKEND } : {}),
    decks: realDecks, matchups, gamesPerPairing: gpp,
  });
  const marg = {};
  for (const f of FACTIONS) { const c = r.factionCounts[f] || { w: 0, n: 0 }; marg[f] = { ...c, wilson: wilson(c.w, c.n) }; }
  const wps = FACTIONS.map(f => marg[f].wilson[1]);
  return { label, kind: 'agg', marg, spread: Math.max(...wps) - Math.min(...wps), mirrorFp: r.mirrorFirstPlayerPct,
    decidedPct: r.decidedPct, timeoutPct: r.timeoutPct, avgTurns: r.gameLength.avg, games: r.games, runHash: r.runHash,
    matchupDetail: r.matchupDetail, factionDetail: r.factionDetail };
}

// ── Verdict vs docs/balance-targets.md ───────────────────────────────────────
function grade(v, healthy, flag, fail) { return fail(v) ? 'FAIL' : flag(v) ? 'FLAG' : 'PASS'; }
function factionVerdict(p) {
  const out = {};
  for (const f of FACTIONS) { const wp = p.marg[f].wilson[1];
    out[f] = grade(wp, null, x => x < T.factionWinPct.flagBelow || x > T.factionWinPct.flagAbove, x => x < T.factionWinPct.failBelow || x > T.factionWinPct.failAbove); }
  return out;
}
const spreadVerdict = s => grade(s, null, x => x > T.spreadPp.flagAbove, x => x > T.spreadPp.failAbove);
const polVerdict = w => !w.A ? 'n/a' : grade(w.wp, null, x => Math.abs(x - 50) > T.worstCellDevPp.flagAbove, x => Math.abs(x - 50) > T.worstCellDevPp.failAbove);
const fpVerdict = fp => grade(Math.abs(fp - 50), null, x => x > T.mirrorFpEdgePp.flagAbove, x => x > T.mirrorFpEdgePp.failAbove);
const decidedVerdict = d => grade(d, null, x => x < T.decidedPct.flagBelow, x => x < T.decidedPct.failBelow);

// ── Pacing/comeback watch metrics (§13s-era, external vector audit) ─────────
// WATCH-grade only: these are NOT part of the locked ruleset-v1 acceptance
// criteria (docs/balance-targets.md §2 / sim-data/balance-targets.json
// thresholds.pacing carries the provenance + measured baseline). They exist to
// catch a blind spot decidedPct can't see: decidedPct counts turn-cap
// tiebreaks as "decided", so a degenerate tiebreak-heavy meta could pass that
// gate — natural-kill share is the missing guard. Computed from the same
// matchupDetail cells the report already prints (agg pilots only — the
// per-cell winMethod/turnsP/comeback fields the matrix pilots also carry are
// not pooled here since the pacing bands were measured against agg/rollout
// pilots specifically). Never FAILs; never touches an exit code.
function pacingMetrics(p) {
  if (!p.matchupDetail) return null;
  let games = 0, kill = 0, tiebreak = 0;
  let cbN = 0, cbOver = 0;
  const turnsP50 = [];
  for (const d of Object.values(p.matchupDetail)) {
    games += d.n; kill += d.winMethod.kill; tiebreak += d.winMethod.tiebreak;
    cbN += d.comeback.n; cbOver += d.comeback.overturned;
    turnsP50.push({ p50: d.turnsP.p50, n: d.n });
  }
  turnsP50.sort((a, b) => a.p50 - b.p50);
  const total = turnsP50.reduce((s, x) => s + x.n, 0);
  let acc = 0, medianP50 = null;
  for (const x of turnsP50) { acc += x.n; if (acc >= total / 2) { medianP50 = x.p50; break; } }
  return {
    naturalKillPct: +(100 * kill / Math.max(games, 1)).toFixed(1),
    tiebreakPct: +(100 * tiebreak / Math.max(games, 1)).toFixed(1),
    turnsP50: medianP50,
    // The cell-level comeback field IS the turn-10-leader-overturned rate
    // (sim-runner.mjs: leaderAt10WinPct = 100 - comebackPct, same snapped-game
    // denominator), so leaderAt10 conversion is its games-weighted complement.
    leaderAt10WinPct: +(100 * (cbN - cbOver) / Math.max(cbN, 1)).toFixed(1),
    comebackPct: +(100 * cbOver / Math.max(cbN, 1)).toFixed(1),
  };
}
// Each metric tagged independently (OK/WATCH) — no combined verdict, no exit
// code, no interaction with the locked ratification gate above.
function pacingVerdicts(m) {
  const P = T.pacing;
  return {
    naturalKillPct: m.naturalKillPct < P.naturalKillPct.watchBelow ? 'WATCH' : 'OK',
    tiebreakPct: m.tiebreakPct > P.tiebreakPct.watchAbove ? 'WATCH' : 'OK',
    turnsP50: (m.turnsP50 < P.turnsP50.watchBelow || m.turnsP50 > P.turnsP50.watchAbove) ? 'WATCH' : 'OK',
    leaderAt10WinPct: m.leaderAt10WinPct > P.leaderAt10WinPct.watchAbove ? 'WATCH' : 'OK',
    comebackPct: m.comebackPct < P.comebackPct.watchBelow ? 'WATCH' : 'OK',
  };
}

function report(p) {
  const lines = [];
  lines.push(`\n══ PILOT: ${p.label} ══  (${p.games} games, decided ${pct(p.decidedPct)}, avgTurns ${p.avgTurns.toFixed(1)})`);
  const fv = factionVerdict(p);
  lines.push('  Faction win% (non-mirror, Wilson 95% CI):');
  for (const f of FACTIONS) lines.push(`    ${f.padEnd(9)} ${ci(p.marg[f].w, p.marg[f].n).padEnd(26)} ${fv[f]}`);
  lines.push(`  Parity spread (max−min): ${pct(p.spread)}  → ${spreadVerdict(p.spread)}  [target ≤${T.spreadPp.flagAbove}pp]`);
  lines.push(`  Mirror first-player edge: ${pct(p.mirrorFp - 50)} over 50%  → ${fpVerdict(p.mirrorFp)}  [target ≤+${T.mirrorFpEdgePp.flagAbove}pp]`);
  lines.push(`  Decided%: ${pct(p.decidedPct)}  → ${decidedVerdict(p.decidedPct)}  [target ≥${T.decidedPct.flagBelow}%]`);
  // Pacing/comeback watch metrics (agg/rollout pilots only — the bands were
  // measured against agg-pilot matchupDetail; WATCH-grade, never affects the
  // verdict or exit code — see thresholds.pacing provenance).
  if (p.kind === 'agg') {
    const pm = p.pacing ? p.pacing.metrics : pacingMetrics(p);
    const pv = p.pacing ? p.pacing.verdicts : pacingVerdicts(pm);
    lines.push(
      `  Pacing (watch): natural-kill ${pct(pm.naturalKillPct)} [${pv.naturalKillPct}]  tiebreak ${pct(pm.tiebreakPct)} [${pv.tiebreakPct}]  ` +
      `turns p50 ${pm.turnsP50} [${pv.turnsP50}]  leader@10 conv ${pct(pm.leaderAt10WinPct)} [${pv.leaderAt10WinPct}]  comeback ${pct(pm.comebackPct)} [${pv.comebackPct}]`,
    );
  }
  if (p.kind === 'matrix') {
    if (p.worst.A) lines.push(`  Worst matchup: ${p.worst.A} beats ${p.worst.B} ${pct(p.worst.wp)} (n=${p.worst.n})  → ${polVerdict(p.worst)}  [target within ${100 - (50 + T.worstCellDevPp.flagAbove)}/${50 + T.worstCellDevPp.flagAbove}]`);
    lines.push('  Matchup matrix (row beats col, %):');
    lines.push('           ' + FACTIONS.map(f => f.slice(0, 4).padStart(6)).join(''));
    for (const A of FACTIONS) {
      const row = FACTIONS.map(B => { if (A === B) return '   —  '; const c = p.matrix[A][B]; return c && c.n ? (100 * c.w / c.n).toFixed(0).padStart(6) : '   ? '; }).join('');
      lines.push(`    ${A.padEnd(9)}${row}`);
    }
  }
  // Mechanism evidence (per-cell): every pairing judged on data, not marginals.
  if (p.matchupDetail) {
    lines.push('  Cells (A vs B): A-win% [nAB], fp-win%, turns p50 (p25–p90), end kill/tb/undec, comeback%, winner-LP med:');
    for (const d of Object.values(p.matchupDetail)) {
      const mirror = d.fA === d.fB ? ' (mirror)' : '';
      lines.push(
        `    ${d.fA.slice(0, 4)} v ${d.fB.slice(0, 4).padEnd(4)} ${String(d.aWinPct).padStart(5)}% [${d.wA}/${d.wA + d.wB}]  fp ${String(d.firstPlayerWinPct).padStart(5)}%  t ${String(d.turnsP.p50).padStart(3)} (${d.turnsP.p25}–${d.turnsP.p90})  ` +
        `end ${d.winMethod.kill}/${d.winMethod.tiebreak}/${d.winMethod.undecided}  cb ${String(d.comeback.pct).padStart(5)}%  lp ${d.winnerLpMedian}${mirror}`,
      );
    }
  }
  if (p.factionDetail) {
    lines.push('  Faction mechanisms: transform% @avg-turn (win% T vs N) | res t5/t10/t15 | deploys (early) | early spells | discards:');
    for (const f of FACTIONS) {
      const d = p.factionDetail[f];
      if (!d) continue;
      lines.push(
        `    ${f.padEnd(9)} ${String(d.transformPct).padStart(5)}% @${d.transformAvgTurn ?? '—'} (${d.winPctWhenTransformed ?? '—'} vs ${d.winPctWhenNot ?? '—'}) | ` +
        `${d.resourcesByTurn.t5}/${d.resourcesByTurn.t10}/${d.resourcesByTurn.t15} | ${d.deploysPerGame} (${d.earlyDeploysPerGame}) | ${d.earlySpellsPerGame} | ${d.discardsPerGame}`,
      );
    }
    lines.push('  Transform autopsy (§13b): LP at flip | turns lived after | hero-ability uses/game pre → post flip (post by index):');
    for (const f of FACTIONS) {
      const d = p.factionDetail[f];
      if (!d || d.avgLpAtFlip == null) continue;
      const idx = Object.entries(d.postFlipUsesByIndex || {}).map(([i, n]) => `#${i}:${n}`).join(' ') || 'none';
      lines.push(
        `    ${f.padEnd(9)} lp ${String(d.avgLpAtFlip).padStart(5)} | +${d.avgTurnsAfterFlip}t | ${d.heroAbilityUsesPerGame.preFlip} → ${d.heroAbilityUsesPerGame.postFlip ?? '—'} (${idx})`,
      );
    }
  }
  return lines.join('\n');
}

// ── Run the panel ────────────────────────────────────────────────────────────
console.log(`Config: GPP_MATRIX=${GPP_MATRIX}  RL_GPP=${RL_GPP}  RH_GPP=${RH_GPP}  RX_GPP=${RX_GPP}  heurRamp=${process.env.HEUR_RAMP === '1'}  skipRollout=${SKIP_ROLLOUT}${FOCUS ? `  FOCUS=${FOCUS}` : ''}${CAND_GEN !== undefined ? `  CAND_GEN=${CAND_GEN}` : ''}${SEED_MODE !== undefined ? `  SEED_MODE=${SEED_MODE}` : ''}${ROLLOUT_MAXC !== undefined ? `  ROLLOUT_MAXC=${ROLLOUT_MAXC}` : ''}`);
console.log(`Pool: ${POOL_PATH}  sha256/16 ${POOL_SHA}`);
console.log(`Ruleset: ${manifest ? `manifest v${manifest.version} (locked)` : 'pre-lock hardcoded fallback'}${ruleOverrides.length ? ` — ${ruleOverrides.length} override(s) in effect` : ''}`);
if (FOCUS) console.log(`FOCUS mode: only ${FOCUS}-involving pairings run — non-${FOCUS} marginals/grades are vs-${FOCUS} cells only; combine with the reference panel's pack-internal counts for full marginals.`);
// exileDiscardForEnergy (discard_for_energy exiles instead of binning) applies
// to every pilot via BASE. reachDiscard/valuePilot are HEURISTIC bot policies
// (read only by that policy — see sim-runner.mjs), so only the 'heuristic'
// pilot gets them. Without these, 'heuristic' reproduces the blind,
// self-handicapping discard bot §11a-c found (~76% of its discards wasted, which
// specifically subsidized Onyx's graveyard) — invalidating any verdict built on
// it. See docs/balance-diagnosis.md §11 for why this pilot was adopted as standard.
console.log(`Workers: ${WORKERS} (parallel — byte-identical to serial)`);
const pilots = [];
const add = async (p) => {
  // Attach watch-grade pacing metrics before push so they land in both the
  // console report and the output JSON (see pacingMetrics/pacingVerdicts).
  if (p.kind === 'agg') { const metrics = pacingMetrics(p); p.pacing = { metrics, verdicts: pacingVerdicts(metrics) }; }
  pilots.push(p);
  console.log(report(p));
};
console.log('Running random (floor)…'); await add(await runMatrixPilot('random', { botPolicy: 'random' }));
console.log('\nRunning heuristic…'); await add(await runMatrixPilot('heuristic', { botPolicy: 'heuristic', reachDiscard: true, valuePilot: true }));
// HEUR_RAMP=1 adds a second heuristic with the rampPilot deploy bonus (the in-game
// analogue of computeDeckValue's acceleration term). Same seeds as 'heuristic', so
// the per-faction delta between the two IS the measured ramp-blindness component of
// pilot error — the instrument for the §12 causal decomposition.
if (process.env.HEUR_RAMP === '1') {
  console.log('\nRunning heuristic+ramp (pilot A/B)…');
  await add(await runMatrixPilot('heuristic+ramp', { botPolicy: 'heuristic', reachDiscard: true, valuePilot: true, rampPilot: true }));
}
if (!SKIP_ROLLOUT) {
  console.log('\nRunning rollout-low (r4 d2 c5)…');
  await add(await runAggPilot('rollout-low (r4 d2 c5)', { botPolicy: 'rollout', rollouts: 4, rolloutDepth: 2, maxCandidates: 5 }, RL_GPP));
  console.log('\nRunning rollout-high (r8 d3 c8) — convergence probe…');
  await add(await runAggPilot('rollout-high (r8 d3 c8)', { botPolicy: 'rollout', rollouts: 8, rolloutDepth: 3, maxCandidates: 8 }, RH_GPP));
  // RX_GPP>0 adds a third, stronger rung (r12 d3 c8) — the convergence probe's probe:
  // if a faction's win% is still moving low→high→max, its true number is undetermined
  // and needs an even stronger pilot, per docs/balance-targets.md §4's gate.
  if (RX_GPP > 0) {
    console.log('\nRunning rollout-max (r12 d3 c8) — convergence ladder rung 3…');
    await add(await runAggPilot('rollout-max (r12 d3 c8)', { botPolicy: 'rollout', rollouts: 12, rolloutDepth: 3, maxCandidates: 8 }, RX_GPP));
  }
}

// ── Cross-pilot agreement (the validity gate) ────────────────────────────────
if (FOCUS) {
  console.log(`\n(cross-pilot agreement gate skipped in FOCUS mode — non-${FOCUS} marginals are partial)`);
} else {
  const top = p => FACTIONS.map(f => [f, p.marg[f].wilson[1]]).sort((a, b) => b[1] - a[1])[0];
  console.log('\n══ CROSS-PILOT AGREEMENT (validity gate) ══');
  for (const p of pilots) { const [tf, tw] = top(p); console.log(`  ${p.label.padEnd(24)} top=${tf} ${pct(tw)}  spread ${pct(p.spread)}`); }
  const tops = new Set(pilots.map(p => top(p)[0]));
  console.log(`  → pilots agree on #1 faction: ${tops.size === 1 ? 'YES (' + [...tops][0] + ')' : 'NO — ' + [...tops].join('/') + ' (measurement-limited where they disagree)'}`);
}

writeFileSync(OUT, JSON.stringify({ generatedFrom: 'balance-verify.mjs', pool: { path: String(POOL_PATH), sha256_16: POOL_SHA }, focus: FOCUS || null, config: {
  GPP_MATRIX, RL_GPP, RH_GPP, RX_GPP, heurRamp: process.env.HEUR_RAMP === '1',
  ...(CAND_GEN !== undefined ? { CAND_GEN } : {}),
  ...(SEED_MODE !== undefined ? { SEED_MODE } : {}),
  ...(ROLLOUT_MAXC !== undefined ? { ROLLOUT_MAXC } : {}),
}, ruleset: BASE, ruleOff: RULE_OFF || null, ruleOverrides, pilots }, null, 1));
console.log(`\nWrote ${OUT}`);
