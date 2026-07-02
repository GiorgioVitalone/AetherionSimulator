// balance-probe-denergy.mjs — measure the discard_for_energy rule's contribution
// to faction balance (§12 bucket B: rules-design causes).
//
// The rule is nominally universal (any player may pitch a hand card for +1
// temporary Energy once per turn), but Energy only pays Energy costs and Verdant
// is the pool's only Energy faction — so in practice it is a Verdant-only
// conversion valve. This runs the standard heuristic panel twice, identical in
// every way except config.disableDiscardForEnergy, and prints the per-faction
// delta. The delta IS the rule's measured balance contribution at heuristic level.
//
// Usage: AETHERION_CARDS=./generated-pools/aetherion-CURRENT.json \
//        [GPP=1500] [WORKERS=cores] node balance-probe-denergy.mjs
import { availableParallelism } from 'node:os';
import { runSimParallel } from './sim-parallel.mjs';

const GPP = +(process.env.GPP || 1500);
const WORKERS = +(process.env.WORKERS || availableParallelism());
const FACTIONS = ['Onyx', 'Radiant', 'Sapphire', 'Verdant'];

if (!process.env.AETHERION_CARDS) {
  console.error('AETHERION_CARDS required (no silent default) — e.g. AETHERION_CARDS=./generated-pools/aetherion-CURRENT.json');
  process.exit(1);
}

// The standard heuristic pilot + standard rules, exactly as balance-verify.mjs's
// BASE + heuristic pilot config. The ONLY variable is disableDiscardForEnergy.
const BASE = {
  firstPlayer: 'alternating',
  fixHandSizeStall: true,
  termination: 'tiebreak',
  abilitiesOn: true,
  turnCap: 80,
  seedBase: 12345,
  armFirstInstanceOnly: true,
  terminationMode: 'resource_deck_empty_transform',
  botPolicy: 'heuristic',
  exileDiscardForEnergy: true,
  reachDiscard: true,
  valuePilot: true,
  decks: Object.fromEntries(FACTIONS.map((f) => [f, f])),
  matchups: 'all-pairs',
  gamesPerPairing: GPP,
};

const marg = (r) => Object.fromEntries(FACTIONS.map((f) => {
  const c = r.factionCounts[f] || { w: 0, n: 0 };
  return [f, c.n ? +(100 * c.w / c.n).toFixed(2) : 0];
}));

console.log(`discard_for_energy ablation probe — heuristic standard, GPP=${GPP} (${GPP * 10} games/arm), workers=${WORKERS}`);
console.log(`cards: ${process.env.AETHERION_CARDS}\n`);

const withRule = await runSimParallel(BASE, WORKERS);
console.log(`A (rule ON,  standard): runHash ${withRule.runHash}  ${JSON.stringify(marg(withRule))}`);
const withoutRule = await runSimParallel({ ...BASE, disableDiscardForEnergy: true }, WORKERS);
console.log(`B (rule OFF, ablated) : runHash ${withoutRule.runHash}  ${JSON.stringify(marg(withoutRule))}`);

const a = marg(withRule), b = marg(withoutRule);
console.log('\nDelta (OFF − ON) — the rule\'s contribution, positive = rule was HELPING that faction:');
for (const f of FACTIONS) console.log(`  ${f.padEnd(9)} ${(a[f] - b[f]) >= 0 ? '+' : ''}${(a[f] - b[f]).toFixed(2)} pp  (${a[f]} → ${b[f]})`);
const spread = (m) => Math.max(...FACTIONS.map((f) => m[f])) - Math.min(...FACTIONS.map((f) => m[f]));
console.log(`  spread: ${spread(a).toFixed(2)} → ${spread(b).toFixed(2)} pp`);
