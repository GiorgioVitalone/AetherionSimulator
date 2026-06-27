// balance-matrix2.mjs — stack rules levers ON TOP of our card rebalance + LP30.
// The baseline card set (all-23 edits + LP→30) is supplied via AETHERION_CARDS,
// so every row here adds only a config-knob lever on top of the patched cards.
// Reports spread, Δspread vs the patched baseline, and avg turns (pacing).
// Heuristic + fairPilot, real decks, all-pairs. Env: GPP, AETHERION_CARDS.
import { writeFileSync } from 'node:fs';
import { runSim } from './sim-runner.mjs';

const FACTIONS = ['Onyx', 'Radiant', 'Sapphire', 'Verdant'];
const realDecks = Object.fromEntries(FACTIONS.map((f) => [f, f]));
const GPP = +(process.env.GPP || 300);
const OUT = process.env.OUT || '/tmp/balance-matrix2-result.json';
const BASE = {
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

const ROWS = [
  ['baseline (patch: rebalance + LP30)', {}],
  // ── 7 levers, each solo on the patch ──────────────────────────────────────
  ['+ first-player compensation', L.fpComp],
  ['+ transform-gate widen', L.transform],
  ['+ ARM buffs take max', L.armMax],
  ['+ Defender only High Ground', L.defHG],
  ['+ High Ground size +1 (3 slots)', L.hg1],
  ['+ Frontline size +1 (4 slots)', L.fl1],
  ['+ ARM once per battle', L.armOnce],
  // ── combinations ──────────────────────────────────────────────────────────
  ['+ HG+1 & FL+1', { ...L.hg1, ...L.fl1 }],
  ['+ HG+1 & Defender-HG-only', { ...L.hg1, ...L.defHG }],
  ['+ ARM once & ARM max', { ...L.armOnce, ...L.armMax }],
  ['+ transform & FP-comp', { ...L.transform, ...L.fpComp }],
  ['+ FL+1 & HG+1 & Defender-HG', { ...L.fl1, ...L.hg1, ...L.defHG }],
  ['+ ARM once & FL+1 & HG+1', { ...L.armOnce, ...L.fl1, ...L.hg1 }],
  ['+ FP-comp & transform & ARM-once', { ...L.fpComp, ...L.transform, ...L.armOnce }],
  ['+ ALL 7 stacked', { ...L.fpComp, ...L.transform, ...L.armMax, ...L.defHG, ...L.hg1, ...L.fl1, ...L.armOnce }],
];

const pct = (x) => x.toFixed(1);
console.log(`Lever stack ON TOP of patch — heuristic + fairPilot, real decks, GPP=${GPP}, cards=${process.env.AETHERION_CARDS ? 'patched' : 'DEFAULT(!)'} `);
console.log(`  ${'config'.padEnd(38)}${FACTIONS.map((f) => f.slice(0, 4).padStart(6)).join('')}   spread Δspr  turns dec%`);
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
  console.log(`  ${label.padEnd(38)}${wp.map((v) => pct(v).padStart(6)).join('')}   ${pct(r.paritySpread).padStart(5)}${dcol}  ${r.gameLength.avg.toFixed(0).padStart(4)} ${pct(r.decidedPct ?? 0).padStart(4)}`);
  if (label.startsWith('baseline')) base = r;
  results.push({ label, faction: { ...r.factionWinPct }, spread: r.paritySpread, dSpread: dS, avgTurns: r.gameLength.avg, decidedPct: r.decidedPct });
}
writeFileSync(OUT, JSON.stringify({ GPP, results }, null, 1));
console.log(`\nWrote ${OUT}  (Δspread vs the patched baseline)`);
