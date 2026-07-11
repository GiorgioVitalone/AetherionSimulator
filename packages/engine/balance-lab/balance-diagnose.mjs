// balance-diagnose.mjs — causal decomposition of the parity spread via ablation.
//
// Runs the real starter decks (heuristic pilot, all-pairs incl. mirrors, alternating
// first player, deterministic) under a BASELINE and a battery of single-lever
// ablations from GameConfig. Each lever neutralizes one rule / mechanic / hero
// advantage; the change in each faction's win% and in the parity spread vs baseline
// is that lever's causal contribution. The point is to RANK drivers, not to fix one.
//
// Heuristic is used for breadth (fast, tight CIs); the biggest drivers should be
// re-checked under the rollout pilot separately. Env: GPP (games/cell, default 400).
import { writeFileSync } from 'node:fs';
import { runSim } from '../sim-runner.mjs';

const FACTIONS = ['Onyx', 'Radiant', 'Sapphire', 'Verdant'];
const realDecks = Object.fromEntries(FACTIONS.map(f => [f, f]));
const GPP = +(process.env.GPP || 400);
const OUT = process.env.OUT || '/tmp/balance-diagnose-result.json';
const BASE = { decks: realDecks, matchups: 'all-pairs', firstPlayer: 'alternating', fixHandSizeStall: true,
  termination: 'tiebreak', abilitiesOn: true, turnCap: 80, seedBase: 12345, botPolicy: 'heuristic', gamesPerPairing: GPP };

// Each entry: [label, configDelta]. Grouped by the layer it probes.
const ABLATIONS = [
  ['baseline', {}],
  // ── Game rules / structure ────────────────────────────────────────────────
  ['rule: defenders only from High Ground', { defenderHighGroundOnly: true }],
  ['rule: ARM only first hit/turn (no gang-wall)', { armFirstInstanceOnly: true }],
  ['rule: ARM buffs combine by max not sum', { armBuffsTakeMax: true }],
  ['rule: any char deploys to High Ground', { directHighGroundDeploy: true }],
  // ── Hero asymmetry ────────────────────────────────────────────────────────
  ['hero: equalize ALL hero LP to 30', { equalizeHeroLp: 30 }],
  ['hero: Radiant hero LP -> 30', { heroLpOverride: { faction: 'Radiant', lp: 30 } }],
  ['hero: disable ALL hero healing', { disableHeroHealing: true }],
  ['hero: Radiant cannot damage enemy hero', { disableFactionHeroReach: { faction: 'Radiant' } }],
  // ── Mechanics / keywords ──────────────────────────────────────────────────
  ['mech: ablate -1 "would take damage" shield', { ablateShield: true }],
  ['mech: ablate Seraphina Bulwark +1 ARM', { ablateBulwark: true }],
  ['mech: ablate Defender forcing', { ablateDefenderForcing: true }],
  ['mech: ablate Flying evasion', { ablateFlying: true }],
  // ── Raw card / stat strength (per faction) ────────────────────────────────
  ['stat: Radiant char stats x0.85', { factionStatScale: { faction: 'Radiant', scale: 0.85 } }],
  ['stat: Sapphire char stats x1.20', { factionStatScale: { faction: 'Sapphire', scale: 1.20 } }],
  ['stat: Onyx char stats x1.20', { factionStatScale: { faction: 'Onyx', scale: 1.20 } }],
  // ── Combined: strip Radiant's defensive package + LP head start ────────────
  ['combo: shield+bulwark+armMax+equalLP30', { ablateShield: true, ablateBulwark: true, armBuffsTakeMax: true, equalizeHeroLp: 30 }],
];

const pct = x => x.toFixed(1);
function row(label, r, base) {
  const wp = FACTIONS.map(f => r.factionWinPct[f] ?? 0);
  const spread = r.paritySpread;
  const dR = base ? (r.factionWinPct.Radiant - base.factionWinPct.Radiant) : 0;
  const dS = base ? (spread - base.paritySpread) : 0;
  const cols = wp.map(v => pct(v).padStart(6)).join('');
  const dcol = base ? `   ΔRad ${(dR >= 0 ? '+' : '') + pct(dR)}  Δspread ${(dS >= 0 ? '+' : '') + pct(dS)}` : '';
  console.log(`  ${label.padEnd(46)}${cols}   spread ${pct(spread).padStart(5)}${dcol}`);
  return { label, faction: { ...r.factionWinPct }, spread, decidedPct: r.decidedPct, avgTurns: r.gameLength.avg, dRadiant: dR, dSpread: dS };
}

console.log(`Ablation sweep — heuristic pilot, real decks, GPP=${GPP} (${GPP * 10} games/config)`);
console.log(`  ${'config'.padEnd(46)}${FACTIONS.map(f => f.slice(0, 4).padStart(6)).join('')}   spread`);
const results = [];
let base = null;
for (const [label, delta] of ABLATIONS) {
  let r;
  try { r = runSim({ ...BASE, ...delta }); }
  catch (e) { console.log(`  ${label.padEnd(46)} ERROR ${e.message}`); continue; }
  const rec = row(label, r, base);
  if (label === 'baseline') base = r;
  results.push(rec);
}
writeFileSync(OUT, JSON.stringify({ GPP, results }, null, 1));
console.log(`\nWrote ${OUT}`);
