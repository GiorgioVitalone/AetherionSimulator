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
const RX_GPP = +(process.env.RX_GPP || 0); // >0 adds a 3rd rollout rung (r12 d3 c8)
const SKIP_ROLLOUT = process.env.SKIP_ROLLOUT === '1';
const OUT = process.env.GAUGE_OUT || '/tmp/balance-verify-result.json';
// Parallel is byte-identical to serial (proven via runHash — see sim-parallel.mjs),
// so this is a pure speedup and every number/verdict below is unchanged. WORKERS=1
// forces the old serial path. This harness is the slow one (rollout pilots), so the
// win is large — an hour-plus run becomes minutes on a many-core machine.
const WORKERS = +(process.env.WORKERS || availableParallelism());
const run = (cfg) => (WORKERS > 1 ? runSimParallel(cfg, WORKERS) : Promise.resolve(runSim(cfg)));

// armFirstInstanceOnly + terminationMode=resource_deck_empty_transform: two rules
// changes adopted into the standard baseline (both pre-existing, fully wired
// engine features, gated off by default until now). See balance-standard-sim.mjs
// for the measured isolated effect on the raw baseline before adopting them here.
const BASE = {
  firstPlayer: 'alternating',
  fixHandSizeStall: true,
  termination: 'tiebreak',
  abilitiesOn: true,
  turnCap: 80,
  seedBase: 12345,
  armFirstInstanceOnly: true,
  terminationMode: 'resource_deck_empty_transform',
  costFloor: true,
};

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
    });
    for (const k of Object.keys(t)) t[k] += d[k] || 0;
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
  const r = await run({ ...BASE, ...pilotCfg, decks: realDecks, matchups: 'all-pairs', gamesPerPairing: gpp });
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
  }
  return lines.join('\n');
}

// ── Run the panel ────────────────────────────────────────────────────────────
console.log(`Config: GPP_MATRIX=${GPP_MATRIX}  RL_GPP=${RL_GPP}  RH_GPP=${RH_GPP}  RX_GPP=${RX_GPP}  heurRamp=${process.env.HEUR_RAMP === '1'}  skipRollout=${SKIP_ROLLOUT}`);
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
// HEUR_RAMP=1 adds a second heuristic with the rampPilot deploy bonus (the in-game
// analogue of computeDeckValue's acceleration term). Same seeds as 'heuristic', so
// the per-faction delta between the two IS the measured ramp-blindness component of
// pilot error — the instrument for the §12 causal decomposition.
if (process.env.HEUR_RAMP === '1') {
  console.log('\nRunning heuristic+ramp (pilot A/B)…');
  await add(await runMatrixPilot('heuristic+ramp', { botPolicy: 'heuristic', ...RULE, reachDiscard: true, valuePilot: true, rampPilot: true }));
}
if (!SKIP_ROLLOUT) {
  console.log('\nRunning rollout-low (r4 d2 c5)…');
  await add(await runAggPilot('rollout-low (r4 d2 c5)', { botPolicy: 'rollout', ...RULE, rollouts: 4, rolloutDepth: 2, maxCandidates: 5 }, RL_GPP));
  console.log('\nRunning rollout-high (r8 d3 c8) — convergence probe…');
  await add(await runAggPilot('rollout-high (r8 d3 c8)', { botPolicy: 'rollout', ...RULE, rollouts: 8, rolloutDepth: 3, maxCandidates: 8 }, RH_GPP));
  // RX_GPP>0 adds a third, stronger rung (r12 d3 c8) — the convergence probe's probe:
  // if a faction's win% is still moving low→high→max, its true number is undetermined
  // and needs an even stronger pilot, per docs/balance-targets.md §4's gate.
  if (RX_GPP > 0) {
    console.log('\nRunning rollout-max (r12 d3 c8) — convergence ladder rung 3…');
    await add(await runAggPilot('rollout-max (r12 d3 c8)', { botPolicy: 'rollout', ...RULE, rollouts: 12, rolloutDepth: 3, maxCandidates: 8 }, RX_GPP));
  }
}

// ── Cross-pilot agreement (the validity gate) ────────────────────────────────
const top = p => FACTIONS.map(f => [f, p.marg[f].wilson[1]]).sort((a, b) => b[1] - a[1])[0];
console.log('\n══ CROSS-PILOT AGREEMENT (validity gate) ══');
for (const p of pilots) { const [tf, tw] = top(p); console.log(`  ${p.label.padEnd(24)} top=${tf} ${pct(tw)}  spread ${pct(p.spread)}`); }
const tops = new Set(pilots.map(p => top(p)[0]));
console.log(`  → pilots agree on #1 faction: ${tops.size === 1 ? 'YES (' + [...tops][0] + ')' : 'NO — ' + [...tops].join('/') + ' (measurement-limited where they disagree)'}`);

writeFileSync(OUT, JSON.stringify({ generatedFrom: 'balance-verify.mjs', config: { GPP_MATRIX, RL_GPP, RH_GPP, RX_GPP, heurRamp: process.env.HEUR_RAMP === '1' }, pilots }, null, 1));
console.log(`\nWrote ${OUT}`);
