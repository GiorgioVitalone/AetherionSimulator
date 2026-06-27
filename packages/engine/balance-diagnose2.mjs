// balance-diagnose2.mjs — round 2: the user's past levers + realistic COMBINED stacks.
// Same harness as balance-diagnose.mjs (heuristic, real decks, all-pairs, alternating
// FP, deterministic). Tests the previously-tried levers that map onto engine knobs,
// plus two stacked configs to see whether combining the real ones closes the gap.
import { writeFileSync } from 'node:fs';
import { runSim } from './sim-runner.mjs';

const FACTIONS = ['Onyx', 'Radiant', 'Sapphire', 'Verdant'];
const realDecks = Object.fromEntries(FACTIONS.map(f => [f, f]));
const GPP = +(process.env.GPP || 400);
const OUT = process.env.OUT || '/tmp/balance-diagnose2-result.json';
const BASE = { decks: realDecks, matchups: 'all-pairs', firstPlayer: 'alternating', fixHandSizeStall: true,
  termination: 'tiebreak', abilitiesOn: true, turnCap: 80, seedBase: 12345, botPolicy: 'heuristic', gamesPerPairing: GPP };

// Radiant characters costing >=2 (for the "cost-2+ bodies -1 HP" lever).
const RAD2 = [45, 46, 47, 48, 49, 51, 53, 54];
const radMinus1Hp = Object.fromEntries(RAD2.map(id => [id, { hp: -1 }]));

const ABLATIONS = [
  ['baseline', {}],
  // ── User's past levers that map onto engine knobs ──────────────────────────
  ['user: -1 shield first-instance/turn only', { shieldFirstInstanceOnly: true }],
  ['user: first-player compensation (card+res)', { firstPlayerCompensation: 'both' }],
  ['user: transform-gate widen (res-deck-empty)', { terminationMode: 'resource_deck_empty_transform' }],
  ['user: Radiant cost>=2 bodies -1 HP', { cardStatOverride: radMinus1Hp }],
  ['user: Onyx hero LP 25 -> 30', { heroLpOverride: { faction: 'Onyx', lp: 30 } }],
  ['user: Onyx hero LP 25 -> 33', { heroLpOverride: { faction: 'Onyx', lp: 33 } }],
  ['user: Verdant char stats x0.85', { factionStatScale: { faction: 'Verdant', scale: 0.85 } }],
  // ── Surgical Defender-forcing nerf (vs the on/off ablate) ──────────────────
  ['Defender force cap = 2', { defenderForceCap: 2 }],
  ['Defender force cap = 1', { defenderForceCap: 1 }],
  // ── Context: how much does the LP-tiebreak policy itself shape results? ─────
  ['ctx: termination=none (no LP tiebreak)', { termination: 'none' }],
  // ── COMBINED stacks ────────────────────────────────────────────────────────
  // A: Radiant-targeted realistic nerf (no floor changes) — how low does the TOP go?
  ['combo-A: Rad -1HP + LP30 + forceCap2 + shieldFirst',
    { cardStatOverride: radMinus1Hp, heroLpOverride: { faction: 'Radiant', lp: 30 }, defenderForceCap: 2, shieldFirstInstanceOnly: true }],
  // B: full normalize — top nerf + LP equalize (raises Onyx) + Sapphire stat floor-raise.
  ['combo-B: A-set + equalizeLP31 + Sapphire x1.15',
    { cardStatOverride: radMinus1Hp, equalizeHeroLp: 31, defenderForceCap: 2, shieldFirstInstanceOnly: true, factionStatScale: { faction: 'Sapphire', scale: 1.15 } }],
];

const pct = x => x.toFixed(1);
function row(label, r, base) {
  const wp = FACTIONS.map(f => r.factionWinPct[f] ?? 0);
  const dR = base ? (r.factionWinPct.Radiant - base.factionWinPct.Radiant) : 0;
  const dS = base ? (r.paritySpread - base.paritySpread) : 0;
  const cols = wp.map(v => pct(v).padStart(6)).join('');
  const dcol = base ? `   ΔRad ${(dR >= 0 ? '+' : '') + pct(dR)}  Δspread ${(dS >= 0 ? '+' : '') + pct(dS)}` : '';
  console.log(`  ${label.padEnd(48)}${cols}   spread ${pct(r.paritySpread).padStart(5)}${dcol}`);
  return { label, faction: { ...r.factionWinPct }, spread: r.paritySpread, decidedPct: r.decidedPct, avgTurns: r.gameLength.avg, dRadiant: dR, dSpread: dS };
}

console.log(`Ablation sweep 2 — heuristic, real decks, GPP=${GPP}`);
console.log(`  ${'config'.padEnd(48)}${FACTIONS.map(f => f.slice(0, 4).padStart(6)).join('')}   spread`);
const results = []; let base = null;
for (const [label, delta] of ABLATIONS) {
  let r; try { r = runSim({ ...BASE, ...delta }); } catch (e) { console.log(`  ${label}: ERROR ${e.message}`); continue; }
  const rec = row(label, r, base); if (label === 'baseline') base = r; results.push(rec);
}
writeFileSync(OUT, JSON.stringify({ GPP, results }, null, 1));
console.log(`\nWrote ${OUT}`);
