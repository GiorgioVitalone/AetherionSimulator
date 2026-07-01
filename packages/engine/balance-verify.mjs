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
import { writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { runSim } from './sim-runner.mjs';
import { runSimParallel } from './sim-parallel.mjs';

const FACTIONS = ['Onyx', 'Radiant', 'Sapphire', 'Verdant'];
const realDecks = Object.fromEntries(FACTIONS.map(f => [f, f])); // faction name -> real official deck

const GPP_MATRIX = +(process.env.GPP_MATRIX || 1000);
const RL_GPP = +(process.env.RL_GPP || 16);
const RH_GPP = +(process.env.RH_GPP || 8);
const SKIP_ROLLOUT = process.env.SKIP_ROLLOUT === '1';
const OUT = process.env.GAUGE_OUT || '/tmp/balance-verify-result.json';
// Parallel is byte-identical to serial (proven via runHash — see sim-parallel.mjs),
// so this is a pure speedup and every number/verdict below is unchanged. WORKERS=1
// forces the old serial path. This harness is the slow one (rollout pilots), so the
// win is large — an hour-plus run becomes minutes on a many-core machine.
const WORKERS = +(process.env.WORKERS || availableParallelism());
const run = (cfg) => (WORKERS > 1 ? runSimParallel(cfg, WORKERS) : Promise.resolve(runSim(cfg)));

const BASE = { firstPlayer: 'alternating', fixHandSizeStall: true, termination: 'tiebreak', abilitiesOn: true, turnCap: 80, seedBase: 12345 };

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
async function runMatrixPilot(label, pilotCfg) {
  const counts = Object.fromEntries(FACTIONS.map(f => [f, { w: 0, n: 0 }])); // marginal non-mirror
  const matrix = {}; // matrix[A][B] = {w,n}  (A beats B)
  for (const f of FACTIONS) matrix[f] = {};
  let mirrorFpWon = 0, mirrorDecided = 0;
  let decided = 0, games = 0, timeouts = 0, turnsSum = 0;

  for (let i = 0; i < FACTIONS.length; i++) {
    for (let j = i; j < FACTIONS.length; j++) {
      const A = FACTIONS[i], B = FACTIONS[j];
      const r = await run({ ...BASE, ...pilotCfg, matchups: [{ p0Deck: A, p1Deck: B }], gamesPerPairing: GPP_MATRIX });
      games += r.games; decided += Math.round((r.decidedPct / 100) * r.games);
      timeouts += Math.round((r.timeoutPct / 100) * r.games); turnsSum += r.gameLength.avg * r.games;
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
    decidedPct: 100 * decided / games, timeoutPct: 100 * timeouts / games, avgTurns: turnsSum / games, games };
}

// ── Aggregate pilots (rollout): single all-pairs run, marginal-only (cells too thin) ──
async function runAggPilot(label, pilotCfg, gpp) {
  const r = await run({ ...BASE, ...pilotCfg, decks: realDecks, matchups: 'all-pairs', gamesPerPairing: gpp });
  const marg = {};
  for (const f of FACTIONS) { const c = r.factionCounts[f] || { w: 0, n: 0 }; marg[f] = { ...c, wilson: wilson(c.w, c.n) }; }
  const wps = FACTIONS.map(f => marg[f].wilson[1]);
  return { label, kind: 'agg', marg, spread: Math.max(...wps) - Math.min(...wps), mirrorFp: r.mirrorFirstPlayerPct,
    decidedPct: r.decidedPct, timeoutPct: r.timeoutPct, avgTurns: r.gameLength.avg, games: r.games, runHash: r.runHash };
}

// ── Verdict vs docs/balance-targets.md ───────────────────────────────────────
function grade(v, healthy, flag, fail) { return fail(v) ? 'FAIL' : flag(v) ? 'FLAG' : 'PASS'; }
function factionVerdict(p) {
  const out = {};
  for (const f of FACTIONS) { const wp = p.marg[f].wilson[1];
    out[f] = grade(wp, null, x => x < 45 || x > 55, x => x < 43 || x > 57); }
  return out;
}
const spreadVerdict = s => grade(s, null, x => x > 6, x => x > 10);
const polVerdict = w => !w.A ? 'n/a' : grade(w.wp, null, x => Math.abs(x - 50) > 20, x => Math.abs(x - 50) > 30);
const fpVerdict = fp => grade(Math.abs(fp - 50), null, x => x > 3, x => x > 5);
const decidedVerdict = d => grade(d, null, x => x < 85, x => x < 70);

function report(p) {
  const lines = [];
  lines.push(`\n══ PILOT: ${p.label} ══  (${p.games} games, decided ${pct(p.decidedPct)}, avgTurns ${p.avgTurns.toFixed(1)})`);
  const fv = factionVerdict(p);
  lines.push('  Faction win% (non-mirror, Wilson 95% CI):');
  for (const f of FACTIONS) lines.push(`    ${f.padEnd(9)} ${ci(p.marg[f].w, p.marg[f].n).padEnd(26)} ${fv[f]}`);
  lines.push(`  Parity spread (max−min): ${pct(p.spread)}  → ${spreadVerdict(p.spread)}  [target ≤6pp]`);
  lines.push(`  Mirror first-player edge: ${pct(p.mirrorFp - 50)} over 50%  → ${fpVerdict(p.mirrorFp)}  [target ≤+3pp]`);
  lines.push(`  Decided%: ${pct(p.decidedPct)}  → ${decidedVerdict(p.decidedPct)}  [target ≥85%]`);
  if (p.kind === 'matrix') {
    if (p.worst.A) lines.push(`  Worst matchup: ${p.worst.A} beats ${p.worst.B} ${pct(p.worst.wp)} (n=${p.worst.n})  → ${polVerdict(p.worst)}  [target within 30/70]`);
    lines.push('  Matchup matrix (row beats col, %):');
    lines.push('           ' + FACTIONS.map(f => f.slice(0, 4).padStart(6)).join(''));
    for (const A of FACTIONS) {
      const row = FACTIONS.map(B => { if (A === B) return '   —  '; const c = p.matrix[A][B]; return c && c.n ? (100 * c.w / c.n).toFixed(0).padStart(6) : '   ? '; }).join('');
      lines.push(`    ${A.padEnd(9)}${row}`);
    }
  }
  return lines.join('\n');
}

// ── Run the panel ────────────────────────────────────────────────────────────
console.log(`Config: GPP_MATRIX=${GPP_MATRIX}  RL_GPP=${RL_GPP}  RH_GPP=${RH_GPP}  skipRollout=${SKIP_ROLLOUT}`);
// exileDiscardForEnergy is a RULE toggle (discard_for_energy exiles instead of
// binning) — applies to every pilot. reachDiscard/valuePilot are HEURISTIC bot
// policies (read only by that policy — see sim-runner.mjs), so only the
// 'heuristic' pilot gets them. Without these, 'heuristic' reproduces the blind,
// self-handicapping discard bot §11a-c found (~76% of its discards wasted, which
// specifically subsidized Onyx's graveyard) — invalidating any verdict built on
// it. See docs/balance-diagnosis.md §11 for why this pilot was adopted as standard.
const RULE = { exileDiscardForEnergy: true };
console.log(`Workers: ${WORKERS} (parallel — byte-identical to serial)`);
const pilots = [];
const add = async (p) => { pilots.push(p); console.log(report(p)); };
console.log('Running random (floor)…'); await add(await runMatrixPilot('random', { botPolicy: 'random', ...RULE }));
console.log('\nRunning heuristic…'); await add(await runMatrixPilot('heuristic', { botPolicy: 'heuristic', ...RULE, reachDiscard: true, valuePilot: true }));
if (!SKIP_ROLLOUT) {
  console.log('\nRunning rollout-low (r4 d2 c5)…');
  await add(await runAggPilot('rollout-low (r4 d2 c5)', { botPolicy: 'rollout', ...RULE, rollouts: 4, rolloutDepth: 2, maxCandidates: 5 }, RL_GPP));
  console.log('\nRunning rollout-high (r8 d3 c8) — convergence probe…');
  await add(await runAggPilot('rollout-high (r8 d3 c8)', { botPolicy: 'rollout', ...RULE, rollouts: 8, rolloutDepth: 3, maxCandidates: 8 }, RH_GPP));
}

// ── Cross-pilot agreement (the validity gate) ────────────────────────────────
const top = p => FACTIONS.map(f => [f, p.marg[f].wilson[1]]).sort((a, b) => b[1] - a[1])[0];
console.log('\n══ CROSS-PILOT AGREEMENT (validity gate) ══');
for (const p of pilots) { const [tf, tw] = top(p); console.log(`  ${p.label.padEnd(24)} top=${tf} ${pct(tw)}  spread ${pct(p.spread)}`); }
const tops = new Set(pilots.map(p => top(p)[0]));
console.log(`  → pilots agree on #1 faction: ${tops.size === 1 ? 'YES (' + [...tops][0] + ')' : 'NO — ' + [...tops].join('/') + ' (measurement-limited where they disagree)'}`);

writeFileSync(OUT, JSON.stringify({ generatedFrom: 'balance-verify.mjs', config: { GPP_MATRIX, RL_GPP, RH_GPP }, pilots }, null, 1));
console.log(`\nWrote ${OUT}`);
