// tie-audit.mjs — how often does the rollout pilot's argmax face an exact tie?
//
// pilot-rollout.mjs:473 keeps the first candidate unless a later one beats it by
// >1e-12, so any tie at the top is decided by enumeration order, not by evaluation.
// This measures how much of the pilot's play is actually decided that way.
//
// Usage: node tie-audit.mjs [FA] [FB] [games] [rollouts] [depth] [seed]
import { pathToFileURL } from 'node:url';

const ENGINE = new URL('.', import.meta.url).pathname;
const [, , FA = 'Onyx', FB = 'Sapphire', gamesArg, rArg, dArg, seedArg] = process.argv;
const GAMES = +(gamesArg || 6);
const R = +(rArg || 8);
const D = +(dArg || 3);
const SEED = +(seedArg || 12345);

process.env.AETHERION_CARDS =
  process.env.AETHERION_CARDS || ENGINE + 'sim-data/pools/aetherion-BALANCED-v2-frozen.json';
const { runSim } = await import(pathToFileURL(ENGINE + 'sim-runner.mjs').href);
const { readFileSync } = await import('node:fs');

const manifest = JSON.parse(readFileSync(ENGINE + 'sim-data/ruleset-v3.json', 'utf8'));
const RULES = {
  rulesProfile: 'legacy-v3',
  reachDiscard: true, termination: 'tiebreak', firstPlayer: 'alternating',
  seatAlternation: false, fixHandSizeStall: true, turnCap: 80, ...manifest.rules,
};

const res = runSim({
  decks: { [FA]: FA, [FB]: FB },
  matchups: { factions: [FA, FB], includeMirrors: false },
  ...RULES,
  botPolicy: 'rollout', rollouts: R, rolloutDepth: D, maxCandidates: 8,
  candidateGen: 'full', playoutBackend: 'snapshot', rolloutPlayout: 'heuristic',
  gamesPerPairing: GAMES, seedBase: SEED, collectDecisionLog: true,
});

const EPS = 1e-12;
const kind = (c) => c.action?.type ?? 'pass';

const per = new Map();
const bump = (f) => {
  if (!per.has(f)) per.set(f, {
    n: 0, tied: 0, allTied: 0, tieSizes: [], mixedKind: 0,
    deployVsSpell: 0, deployOnTable: 0, spellOverDeploy: 0, spellOverDeployTied: 0,
  });
  return per.get(f);
};

for (const row of res.decisionLog ?? []) {
  const cands = (row.candidates ?? []).filter((c) => c.value != null);
  if (cands.length < 2) continue;
  const s = bump(row.faction);
  s.n++;

  const max = Math.max(...cands.map((c) => c.value));
  const top = cands.filter((c) => c.value >= max - EPS);
  s.tieSizes.push(top.length);
  if (top.length > 1) s.tied++;
  if (top.length === cands.length) s.allTied++;

  const topKinds = new Set(top.map(kind));
  if (topKinds.size > 1) s.mixedKind++;
  if (topKinds.has('deploy') && topKinds.has('cast_spell')) s.deployVsSpell++;

  // Did a deploy exist at all, and did the pilot take a spell over it?
  const hasDeploy = cands.some((c) => kind(c) === 'deploy');
  if (!hasDeploy) continue;
  s.deployOnTable++;
  const chosen = row.candidates[row.chosenIdx];
  if (kind(chosen) !== 'cast_spell') continue;
  s.spellOverDeploy++;
  const bestDeploy = Math.max(...cands.filter((c) => kind(c) === 'deploy').map((c) => c.value));
  if (Math.abs(bestDeploy - chosen.value) <= EPS) s.spellOverDeployTied++;
}

const pct = (a, b) => (b ? ((100 * a) / b).toFixed(1).padStart(5) : '  n/a');
console.log(`=== ${FA} vs ${FB} | ${GAMES} games | rollouts=${R} depth=${D} seed=${SEED} ===\n`);
for (const [f, s] of per) {
  const mean = s.tieSizes.reduce((a, b) => a + b, 0) / s.tieSizes.length;
  console.log(`${f.padEnd(9)} decisions=${String(s.n).padStart(4)}`);
  console.log(`   top-value tie (>=2 candidates equal) : ${pct(s.tied, s.n)}%`);
  console.log(`   EVERY candidate equal                : ${pct(s.allTied, s.n)}%`);
  console.log(`   tie spans >1 action kind             : ${pct(s.mixedKind, s.n)}%`);
  console.log(`   tie contains both deploy & spell     : ${pct(s.deployVsSpell, s.n)}%`);
  console.log(`   mean tie-set size                    : ${mean.toFixed(2)}`);
  console.log(`   deploy available                     : ${String(s.deployOnTable).padStart(4)}`);
  console.log(`     -> chose spell instead             : ${pct(s.spellOverDeploy, s.deployOnTable)}%`);
  console.log(`     -> ...of which exact ties          : ${pct(s.spellOverDeployTied, s.spellOverDeploy)}%\n`);
}
