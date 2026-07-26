// stage-e-gate.mjs — Stage E qualification: truncated rollout + value-net leaf.
//
// Same 4-starter round-robin as stage-d, but the bot is the rollout pilot with a SHALLOW
// depth whose truncated leaves are scored by the value net (valueLeafModelPath). A few plies
// of real lookahead + the net's eval — the fix for value-greedy's one-ply blindness on slow
// decks. Does it now match the rollout truth (Onyx top, Radiant bottom, Sapphire mid)?
//
// Usage: node stage-e-gate.mjs <value-net.json> [gpp=500] [depth=2] [rollouts=3]
import { pathToFileURL } from 'node:url';
const ENGINE = new URL('.', import.meta.url).pathname;
process.env.AETHERION_CARDS = process.env.AETHERION_CARDS || ENGINE + 'generated-pools/aetherion-CURRENT.json';
const { runSimParallel } = await import(pathToFileURL(ENGINE + 'sim-parallel.mjs').href);

const modelPath = process.argv[2];
if (!modelPath) { console.error('usage: node stage-e-gate.mjs <value-net.json> [gpp=500] [depth=2] [rollouts=3]'); process.exit(1); }
const gpp = +(process.argv[3] || 500);
const depth = +(process.argv[4] || 2);
const rollouts = +(process.argv[5] || 3);

const FACTIONS = ['Radiant', 'Verdant', 'Onyx', 'Sapphire'];
const decks = Object.fromEntries(FACTIONS.map((f) => [f, f]));
const RULES = {
  rulesProfile: 'current',
  reachDiscard: true, termination: 'tiebreak',
  firstPlayer: 'alternating', seatAlternation: true,
  turnCap: 80,
};
function wilson(w, n) {
  if (!n) return [0, 0];
  const z = 1.96, p = w / n, d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const m = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [(c - m) / d, (c + m) / d];
}

console.log(`Stage E — truncated rollout + value leaf\n  model: ${modelPath}\n  gpp ${gpp}, depth ${depth}, rollouts ${rollouts}`);
console.log('  reference: rollout truth = Onyx top / Radiant bottom / Sapphire mid;');
console.log('             valueGreedy (Stage D) = Onyx#1 ✓ but Sapphire#4/Radiant#3 (swapped bottom).\n');

const t0 = Date.now();
const res = await runSimParallel(
  {
    decks, ...RULES,
    botPolicy: 'rollout', valueLeafModelPath: modelPath,
    rollouts, rolloutDepth: depth, maxCandidates: 8,
    candidateGen: 'full', playoutBackend: 'snapshot', rolloutPlayout: 'heuristic',
    gamesPerPairing: gpp,
  },
  8,
);
const secs = (Date.now() - t0) / 1000;
const fc = res.factionCounts || {};
const rows = FACTIONS.map((f) => { const c = fc[f] || { w: 0, n: 0 }; const wl = wilson(c.w, c.n); return { f, p: c.n ? c.w / c.n : 0, lo: wl[0], hi: wl[1], n: c.n }; });
rows.sort((a, b) => b.p - a.p);
const totalGames = rows.reduce((s, r) => s + r.n, 0) / 2;

console.log(`== rollout+valueLeaf (gpp ${gpp} d${depth} r${rollouts}, ${secs.toFixed(0)}s, ~${(totalGames / secs).toFixed(1)} games/s, runHash ${res.runHash}) ==`);
for (const r of rows) console.log(`  ${r.f.padEnd(9)} ${(r.p * 100).toFixed(1)}%  [${(r.lo * 100).toFixed(1)},${(r.hi * 100).toFixed(1)}]  n=${r.n}`);
console.log(`  ORDER: ${rows.map((r) => r.f).join(' > ')}`);
const top = rows[0].f, bottom = rows[rows.length - 1].f;
console.log(`\n  top=${top}, bottom=${bottom} -> ${top === 'Onyx' && bottom === 'Radiant' ? 'MATCHES rollout extremes (Onyx top / Radiant bottom)' : 'does NOT match rollout extremes'}`);
console.log('=== STAGE E DONE ===');
