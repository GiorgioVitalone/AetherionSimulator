// balance-matrix2.mjs — stack rules levers ON TOP of our card rebalance + LP30.
// The baseline card set (all-23 edits + LP→30) is supplied via AETHERION_CARDS,
// so every row here adds only a config-knob lever on top of the patched cards.
// Reports spread, Δspread vs the patched baseline, and avg turns (pacing).
// Heuristic + fairPilot, real decks, all-pairs. Env: GPP, AETHERION_CARDS.
import { writeFileSync } from 'node:fs';
import { runSim } from '../sim-runner.mjs';

const FACTIONS = ['Onyx', 'Radiant', 'Sapphire', 'Verdant'];
const realDecks = Object.fromEntries(FACTIONS.map((f) => [f, f]));
const GPP = +(process.env.GPP || 300);
const OUT = process.env.OUT || '/tmp/balance-matrix2-result.json';
const BASE = {
  rulesProfile: 'custom-diagnostic',
  decks: realDecks, matchups: 'all-pairs', firstPlayer: 'alternating', fixHandSizeStall: true,
  termination: 'tiebreak', terminationMode: 'turn_cap', abilitiesOn: true, turnCap: 80,
  seedBase: 12345, botPolicy: 'heuristic', fairPilot: true, gamesPerPairing: GPP,
};

const L = {
  fpComp: { firstPlayerCompensation: 'both' },
  transform: { terminationMode: 'resource_deck_empty_transform' },
  armMax: { armBuffsTakeMax: true },
  defHG: { defenderHighGroundOnly: true },
  hg1: { highGroundSlots: 3 }, // default 2
  fl1: { frontlineSlots: 4 }, // default 3
  armOnce: { armOneTimeAbsolute: true }, // ARM consumed once per battle (not refreshed per turn)
};

// group: 'both' (always), 'fast' (no board change — cheap), 'board' (larger board
// blows up the heuristic's action/combat search → run at a tiny GPP). GROUP env
// selects which to run; default 'all'.
const GROUP = process.env.GROUP || 'all';
const ROWS = [
  ['baseline (patch: rebalance + LP30)', {}, 'both'],
  // ── fast levers (no board-size change) ────────────────────────────────────
  ['+ first-player compensation', L.fpComp, 'fast'],
  ['+ transform-gate widen', L.transform, 'fast'],
  ['+ ARM buffs take max', L.armMax, 'fast'],
  ['+ Defender only High Ground', L.defHG, 'fast'],
  ['+ ARM once per battle', L.armOnce, 'fast'],
  ['+ ARM once & ARM max', { ...L.armOnce, ...L.armMax }, 'fast'],
  ['+ transform & FP-comp', { ...L.transform, ...L.fpComp }, 'fast'],
  ['+ FP-comp & transform & ARM-once', { ...L.fpComp, ...L.transform, ...L.armOnce }, 'fast'],
  ['+ Defender-HG & ARM-once & FP-comp', { ...L.defHG, ...L.armOnce, ...L.fpComp }, 'fast'],
  // ── board-size levers (SLOW — larger board explodes the action search) ────
  ['+ High Ground size +1 (3 slots)', L.hg1, 'board'],
  ['+ Frontline size +1 (4 slots)', L.fl1, 'board'],
  ['+ HG+1 & FL+1', { ...L.hg1, ...L.fl1 }, 'board'],
  ['+ HG+1 & Defender-HG-only', { ...L.hg1, ...L.defHG }, 'board'],
  ['+ ALL 7 stacked', { ...L.fpComp, ...L.transform, ...L.armMax, ...L.defHG, ...L.hg1, ...L.fl1, ...L.armOnce }, 'board'],
].filter(([, , g]) => GROUP === 'all' || g === 'both' || g === GROUP);

const pct = (x) => x.toFixed(1);
console.log(`Lever stack ON TOP of patch — heuristic + fairPilot, real decks, GPP=${GPP}, cards=${process.env.AETHERION_CARDS ? 'patched' : 'DEFAULT(!)'} `);
console.log(`  ${'config'.padEnd(38)}${FACTIONS.map((f) => f.slice(0, 4).padStart(6)).join('')}   spread Δspr  avgT medT dec%`);
const results = [];
let base = null;
for (const [label, delta] of ROWS) {
  let r;
  try {
    r = runSim({ ...BASE, ...delta });
  } catch (e) {
    console.log(`  ${label}: ERROR ${e.message}`);
    continue;
  }
  const wp = FACTIONS.map((f) => r.factionWinPct[f] ?? 0);
  const dS = base ? r.paritySpread - base.paritySpread : 0;
  const dcol = base ? ` ${(dS >= 0 ? '+' : '') + pct(dS)}`.padStart(6) : '      ';
  console.log(`  ${label.padEnd(38)}${wp.map((v) => pct(v).padStart(6)).join('')}   ${pct(r.paritySpread).padStart(5)}${dcol}  ${r.gameLength.avg.toFixed(1).padStart(4)} ${String(r.gameLength.median).padStart(4)} ${pct(r.decidedPct ?? 0).padStart(4)}`);
  if (label.startsWith('baseline')) base = r;
  results.push({ label, faction: { ...r.factionWinPct }, spread: r.paritySpread, dSpread: dS, avgTurns: r.gameLength.avg, medTurns: r.gameLength.median, decidedPct: r.decidedPct });
}
writeFileSync(OUT, JSON.stringify({ GPP, results }, null, 1));
console.log(`\nWrote ${OUT}  (Δspread vs the patched baseline)`);
