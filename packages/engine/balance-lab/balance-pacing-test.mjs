// balance-pacing-test.mjs — adjudicate "rules/design vs card" for the spread.
//
// Hypothesis: the rules over-reward proactive BOARD TEMPO and give reactive/value
// decks (Sapphire/Onyx) no competitive win condition — a DESIGN issue, not a card one.
// Test it by moving the tempo clock under the trustworthy fair rollout pilot:
//   - lpScale 2          → games last longer (more time for value/control to matter)
//   - damageScale 1.6    → games end faster (even less time for value)
//   - resource_deck_empty_transform → a go-long PAYOFF for whoever survives the clock
// Prediction if it IS a rules/pacing issue: the FLOOR (Sapphire+Onyx) rises with a
// slower clock / a go-long payoff and falls with a faster clock; the TOP-vs-FLOOR gap
// shrinks. If the floor barely moves, the rules-pacing story is weak. Env: GPP.
import { writeFileSync } from 'node:fs';
import { runSim } from '../sim-runner.mjs';

const FACTIONS = ['Onyx', 'Radiant', 'Sapphire', 'Verdant'];
const realDecks = Object.fromEntries(FACTIONS.map((f) => [f, f]));
const GPP = +(process.env.GPP || 12);
const OUT = process.env.OUT || '/tmp/balance-pacing-result.json';
const BASE = {
  rulesProfile: 'custom-diagnostic',
  decks: realDecks, matchups: 'all-pairs', firstPlayer: 'alternating', fixHandSizeStall: true,
  termination: 'tiebreak', abilitiesOn: true, turnCap: 80, seedBase: 12345,
  botPolicy: 'rollout', rollouts: 4, maxCandidates: 5, rolloutDepth: 3, fairPilot: true, gamesPerPairing: GPP,
};
const PROACTIVE = ['Radiant', 'Verdant']; // board/tempo decks
const REACTIVE = ['Onyx', 'Sapphire']; // value/control decks

const CONFIGS = [
  ['baseline', {}],
  ['SLOWER clock: lpScale 2 (longer games)', { lpScale: 2 }],
  ['FASTER clock: damageScale 1.6 (shorter games)', { damageScale: 1.6 }],
  ['GO-LONG payoff: resource-deck-empty transform', { terminationMode: 'resource_deck_empty_transform' }],
];

const pct = (x) => x.toFixed(1);
const avg = (wp, fs) => fs.reduce((s, f) => s + (wp[f] ?? 0), 0) / fs.length;
const results = [];
console.log(`Pacing/payoff test — fair rollout (depth-3), real decks, all-pairs, GPP=${GPP}`);
console.log(`  ${'config'.padEnd(46)}${FACTIONS.map((f) => f.slice(0, 4).padStart(7)).join('')}  topAvg floorAvg gap avgTurns`);
for (const [label, delta] of CONFIGS) {
  const s = Date.now();
  const r = runSim({ ...BASE, ...delta });
  const wp = Object.fromEntries(FACTIONS.map((f) => [f, r.factionWinPct[f] ?? 0]));
  const top = avg(wp, PROACTIVE), floor = avg(wp, REACTIVE);
  console.log(
    `  ${label.padEnd(46)}${FACTIONS.map((f) => pct(wp[f]).padStart(7)).join('')}  ` +
      `${pct(top).padStart(5)} ${pct(floor).padStart(6)} ${pct(top - floor).padStart(5)} ${r.gameLength.avg.toFixed(0).padStart(4)}  (${((Date.now() - s) / 1000).toFixed(0)}s)`,
  );
  results.push({ label, faction: wp, topAvg: top, floorAvg: floor, gap: top - floor, avgTurns: r.gameLength.avg });
}
writeFileSync(OUT, JSON.stringify({ GPP, results }, null, 1));
console.log(`\n(topAvg = Radiant+Verdant; floorAvg = Onyx+Sapphire. If the floor rises with a slower clock /`);
console.log(` go-long payoff and falls with a faster clock, the spread is a rules/pacing issue, not card tuning.)`);
console.log(`Wrote ${OUT}`);
