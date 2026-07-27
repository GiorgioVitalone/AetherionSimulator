// diag-sapphire.mjs — why is Sapphire the outlier?
// Runs the given pool under FULL rollout-heuristic (ground-truth bot) and dumps marginals +
// the per-opponent matchup matrix + how games end (win method / length), so we can tell
// whether Sapphire's low Stage-E rate is a real deck weakness or a depth-2 piloting artifact.
//
// Usage: node diag-sapphire.mjs <pool.json> [gpp=80]
import { pathToFileURL } from 'node:url';
const ENGINE = new URL('.', import.meta.url).pathname;
process.env.AETHERION_CARDS = process.argv[2] || (ENGINE + 'generated-pools/aetherion-CURRENT.json');
const { runSimParallel } = await import(pathToFileURL(ENGINE + 'sim-parallel.mjs').href);

const gpp = +(process.argv[3] || 80);
const FACTIONS = ['Radiant', 'Verdant', 'Onyx', 'Sapphire'];
const decks = Object.fromEntries(FACTIONS.map((f) => [f, f]));
const RULES = {
  rulesProfile: 'current',
  reachDiscard: true, termination: 'tiebreak',
  firstPlayer: 'alternating', seatAlternation: true, turnCap: 80,
};

console.log(`Sapphire diagnostic — pool ${process.env.AETHERION_CARDS.split('/').pop()}, GROUND-TRUTH bot (rollout r8 heuristic), gpp ${gpp}`);
const res = await runSimParallel(
  { decks, ...RULES, botPolicy: 'rollout', rollouts: 8, rolloutDepth: 3, maxCandidates: 8, candidateGen: 'full', playoutBackend: 'snapshot', rolloutPlayout: 'heuristic', gamesPerPairing: gpp },
  8,
);

console.log('\n== marginals (rollout ground truth) ==');
const fc = res.factionCounts || {};
for (const f of FACTIONS) { const c = fc[f] || { w: 0, n: 0 }; console.log(`  ${f.padEnd(9)} ${c.n ? ((c.w / c.n) * 100).toFixed(1) : '?'}%  n=${c.n}`); }

console.log('\n== result keys (to find matchup/length data) ==');
console.log('  ' + Object.keys(res).join(', '));
const md = res.matchupDetail || res.matchups || res.matrix;
if (md) {
  console.log('\n== matchupDetail (raw) ==');
  console.log(JSON.stringify(md, null, 1).slice(0, 2000));
}
// length / win-method if summarize exposed them
for (const k of ['lengthStats', 'winMethod', 'termination', 'turns', 'summary']) {
  if (res[k]) console.log(`\n== ${k} ==\n` + JSON.stringify(res[k], null, 1).slice(0, 1200));
}
console.log('\n=== DIAG DONE ===');
