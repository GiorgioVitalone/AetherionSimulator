// balance-matrix.mjs — screen the user's 13 balance levers against the win-rate
// spread, individually and in a few stacks, all via engine config knobs (no
// card-file juggling). Our budget patch (the over-budget nerfs) is itself built
// as a cardStatOverride knob from computeSuggestions(), so it composes with the
// rules levers. Heuristic + fairPilot, real decks, all-pairs. Env: GPP.
import { writeFileSync } from 'node:fs';
import { runSim } from '../sim-runner.mjs';
import { computeSuggestions } from '../balance-suggestions.mjs';

const FACTIONS = ['Onyx', 'Radiant', 'Sapphire', 'Verdant'];
const realDecks = Object.fromEntries(FACTIONS.map((f) => [f, f]));
const GPP = +(process.env.GPP || 300);
const OUT = process.env.OUT || '/tmp/balance-matrix-result.json';
const BASE = {
  decks: realDecks, matchups: 'all-pairs', firstPlayer: 'alternating', fixHandSizeStall: true,
  termination: 'tiebreak', terminationMode: 'turn_cap', abilitiesOn: true, turnCap: 80,
  seedBase: 12345, botPolicy: 'heuristic', fairPilot: true, gamesPerPairing: GPP,
};

// Our budget patch's nerfs, as a cardStatOverride knob (from the suggestions).
const sug = computeSuggestions();
const statDelta = (c) => {
  const o = {};
  if (c.statEdit?.dh) o.hp = c.statEdit.dh;
  if (c.statEdit?.da) o.atk = c.statEdit.da;
  if (c.statEdit?.dr) o.arm = c.statEdit.dr;
  return Object.keys(o).length ? o : null;
};
const nerfsOverride = {};
const cheapTrim = {};
for (const c of sug.over) {
  const d = statDelta(c);
  if (!d) continue;
  nerfsOverride[c.id] = d;
  if (c.cost <= 3) cheapTrim[c.id] = d;
}
// Radiant characters costing >=2 (the "cost-2+ bodies -1 HP" lever).
const radMinus1Hp = Object.fromEntries([45, 46, 47, 48, 49, 51, 53, 54].map((id) => [id, { hp: -1 }]));
const PATCH = { cardStatOverride: nerfsOverride, equalizeHeroLp: 30 };

// label, delta, group ('single' | 'stack'). Two levers need new cards → stat-scale PROXY.
const ROWS = [
  ['baseline', {}, 'single'],
  // ── the 13 levers, each solo ──────────────────────────────────────────────
  ['L: ARM buffs take max', { armBuffsTakeMax: true }, 'single'],
  ['L: Defender only High Ground', { defenderHighGroundOnly: true }, 'single'],
  ['L: turn-cap LP tiebreak (off→none)', { termination: 'none' }, 'single'],
  ['L: first-player compensation (card+res)', { firstPlayerCompensation: 'both' }, 'single'],
  ['L: transform-gate widen (res-deck-empty)', { terminationMode: 'resource_deck_empty_transform' }, 'single'],
  ['L: Radiant cost>=2 bodies -1 HP', { cardStatOverride: radMinus1Hp }, 'single'],
  ['L: trim cheap over-budget bodies', { cardStatOverride: cheapTrim }, 'single'],
  ['L: disable hero healing', { disableHeroHealing: true }, 'single'],
  ['L: -1 shield first instance/turn', { shieldFirstInstanceOnly: true }, 'single'],
  ['L: Onyx starting LP 25->30', { heroLpOverride: { faction: 'Onyx', lp: 30 } }, 'single'],
  ['L: Verdant char stats x0.85', { factionStatScale: { faction: 'Verdant', scale: 0.85 } }, 'single'],
  ['L: Sapphire wincon (PROXY x1.15)', { factionStatScale: { faction: 'Sapphire', scale: 1.15 } }, 'single'],
  ['L: Onyx recursion payoff (PROXY x1.15)', { factionStatScale: { faction: 'Onyx', scale: 1.15 } }, 'single'],
  // ── our budget patch + a few stacks on top ────────────────────────────────
  ['PATCH: budget nerfs + LP->30', PATCH, 'stack'],
  ['PATCH + Verdant x0.85', { ...PATCH, factionStatScale: { faction: 'Verdant', scale: 0.85 } }, 'stack'],
  ['PATCH + transform widen', { ...PATCH, terminationMode: 'resource_deck_empty_transform' }, 'stack'],
  ['PATCH + Defender HG-only', { ...PATCH, defenderHighGroundOnly: true }, 'stack'],
  ['PATCH + -1 shield first', { ...PATCH, shieldFirstInstanceOnly: true }, 'stack'],
  ['PATCH + ARM buffs max', { ...PATCH, armBuffsTakeMax: true }, 'stack'],
];

const pct = (x) => x.toFixed(1);
console.log(`Balance-lever matrix — heuristic + fairPilot, real decks, all-pairs, GPP=${GPP}`);
console.log(`  ${'config'.padEnd(42)}${FACTIONS.map((f) => f.slice(0, 4).padStart(6)).join('')}   spread  Δspread`);
const results = [];
let base = null;
for (const [label, delta, group] of ROWS) {
  let r;
  try {
    r = runSim({ ...BASE, ...delta });
  } catch (e) {
    console.log(`  ${label}: ERROR ${e.message}`);
    continue;
  }
  const wp = FACTIONS.map((f) => r.factionWinPct[f] ?? 0);
  const dS = base ? r.paritySpread - base.paritySpread : 0;
  const dcol = base ? `  ${(dS >= 0 ? '+' : '') + pct(dS)}` : '';
  console.log(`  ${label.padEnd(42)}${wp.map((v) => pct(v).padStart(6)).join('')}   ${pct(r.paritySpread).padStart(5)}${dcol}`);
  if (label === 'baseline') base = r;
  results.push({ label, group, faction: { ...r.factionWinPct }, spread: r.paritySpread, dSpread: dS, avgTurns: r.gameLength.avg });
}
writeFileSync(OUT, JSON.stringify({ GPP, results }, null, 1));
console.log(`\nWrote ${OUT}  (Δspread vs baseline; PROXY = stat-scale stand-in for a new card)`);
