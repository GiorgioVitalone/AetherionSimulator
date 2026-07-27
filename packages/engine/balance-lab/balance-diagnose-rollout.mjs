// balance-diagnose-rollout.mjs — validity cross-check: does the focused Radiant
// nerf (combo-A) close the REAL gap, or only the heuristic's? Re-runs baseline and
// combo-A under the archetype-neutral rollout pilot (which the heuristic's Sapphire/
// Onyx under-piloting does not bias). Small n (rollout is ~1.8s/game) ⇒ wide CIs;
// we only need the direction + rough magnitude.
import { writeFileSync } from 'node:fs';
import { runSim } from '../sim-runner.mjs';

const FACTIONS = ['Onyx', 'Radiant', 'Sapphire', 'Verdant'];
const realDecks = Object.fromEntries(FACTIONS.map(f => [f, f]));
const GPP = +(process.env.GPP || 20);
const OUT = process.env.OUT || '/tmp/balance-diagnose-rollout-result.json';
const BASE = { rulesProfile: 'custom-diagnostic', decks: realDecks, matchups: 'all-pairs', firstPlayer: 'alternating', fixHandSizeStall: true,
  termination: 'tiebreak', abilitiesOn: true, turnCap: 80, seedBase: 12345,
  botPolicy: 'rollout', rollouts: 4, rolloutDepth: 2, maxCandidates: 5, gamesPerPairing: GPP };

const RAD2 = [45, 46, 47, 48, 49, 51, 53, 54];
const comboA = {
  cardStatOverride: Object.fromEntries(RAD2.map(id => [id, { hp: -1 }])),
  heroLpOverride: { faction: 'Radiant', lp: 30 }, defenderForceCap: 2, shieldFirstInstanceOnly: true,
};

const CONFIGS = [['baseline', {}], ['combo-A (focused Radiant nerf)', comboA]];
const pct = x => x.toFixed(1);
const results = [];
console.log(`Rollout cross-check — r4/d2, real decks, GPP=${GPP} (${GPP * 10} games/config)`);
console.log(`  ${'config'.padEnd(34)}${FACTIONS.map(f => f.slice(0, 4).padStart(6)).join('')}   spread`);
for (const [label, delta] of CONFIGS) {
  const r = runSim({ ...BASE, ...delta });
  const wp = FACTIONS.map(f => r.factionWinPct[f] ?? 0);
  console.log(`  ${label.padEnd(34)}${wp.map(v => pct(v).padStart(6)).join('')}   spread ${pct(r.paritySpread).padStart(5)}  (decided ${pct(r.decidedPct)})`);
  results.push({ label, faction: { ...r.factionWinPct }, spread: r.paritySpread, decidedPct: r.decidedPct });
}
writeFileSync(OUT, JSON.stringify({ GPP, results }, null, 1));
console.log(`\nWrote ${OUT}`);
