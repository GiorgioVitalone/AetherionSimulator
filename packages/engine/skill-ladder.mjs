// skill-ladder.mjs (P1) — win rate as a CURVE over pilot skill.
// Runs the 4-deck round-robin under each rung (symmetric piloting) and prints a
// deck x rung win% table + per-rung ordering, so we can see each deck's skill-response
// curve (flat-low=weak, rising=skill-intensive, non-monotone=fragile) and which rung's
// ordering stabilizes. Rungs vary playout count R AND depth (our rollout truncates at a
// turn horizon — depth matters as much as R).
//
// Usage: node skill-ladder.mjs <value-net.json> <rung1,rung2,...> [gpp=250] [pool.json]
//   rungs: heuristic | valueGreedy | r8d3 | r8d3v | r16d6 | r16d12 | r32d3  (extend RUNGS)
import { pathToFileURL } from 'node:url';
const ENGINE = new URL('.', import.meta.url).pathname;
const modelPath = process.argv[2];
const rungList = (process.argv[3] || 'heuristic,valueGreedy,r8d3').split(',').map((s) => s.trim());
const gpp = +(process.argv[4] || 250);
process.env.AETHERION_CARDS = process.argv[5] || (ENGINE + 'generated-pools/aetherion-CURRENT.json');
const { runSimParallel } = await import(pathToFileURL(ENGINE + 'sim-parallel.mjs').href);

const FACTIONS = ['Radiant', 'Verdant', 'Onyx', 'Sapphire'];
const decks = Object.fromEntries(FACTIONS.map((f) => [f, f]));
const RULES = {
  rulesProfile: 'current',
  reachDiscard: true, termination: 'tiebreak',
  firstPlayer: 'alternating', seatAlternation: true,
  turnCap: 80,
};
const ROLL = { botPolicy: 'rollout', maxCandidates: 8, candidateGen: 'full', playoutBackend: 'snapshot', rolloutPlayout: 'heuristic' };
// Rung definitions (name -> sim config fragment). R = rollouts, d = rolloutDepth (turn horizon).
const RUNGS = {
  heuristic: { botPolicy: 'heuristic', valuePilot: true },
  valueGreedy: { botPolicy: 'valueGreedy', valueModelPath: modelPath },
  r8d3: { ...ROLL, rollouts: 8, rolloutDepth: 3 },
  r8d3v: { ...ROLL, rollouts: 8, rolloutDepth: 3, valueLeafModelPath: modelPath }, // Stage E
  r32d3: { ...ROLL, rollouts: 32, rolloutDepth: 3 },
  r16d6: { ...ROLL, rollouts: 16, rolloutDepth: 6 },   // deeper — likely >1h, Giorgio's terminal
  r16d12: { ...ROLL, rollouts: 16, rolloutDepth: 12 }, // deepest reference — Giorgio's terminal
};
function wilson(w, n) {
  if (!n) return [0, 0];
  const z = 1.96, p = w / n, d = 1 + (z * z) / n, c = p + (z * z) / (2 * n);
  const m = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [(c - m) / d, (c + m) / d];
}

console.log(`Skill ladder — pool ${process.env.AETHERION_CARDS.split('/').pop()}, gpp ${gpp}, rungs: ${rungList.join(' ')}`);
const table = {};
for (const rung of rungList) {
  const cfg = RUNGS[rung];
  if (!cfg) { console.error(`unknown rung "${rung}" (have: ${Object.keys(RUNGS).join(', ')})`); process.exit(1); }
  const t0 = Date.now();
  const res = await runSimParallel({ decks, ...RULES, ...cfg, gamesPerPairing: gpp }, 8);
  const secs = ((Date.now() - t0) / 1000).toFixed(0);
  const fc = res.factionCounts || {};
  const rows = FACTIONS.map((f) => { const c = fc[f] || { w: 0, n: 0 }; const wl = wilson(c.w, c.n); return { f, p: c.n ? c.w / c.n : 0, lo: wl[0], hi: wl[1], n: c.n }; });
  const ordered = [...rows].sort((a, b) => b.p - a.p);
  table[rung] = rows;
  console.log(`\n== ${rung}  (${secs}s, runHash ${res.runHash}) ==`);
  for (const r of [...rows].sort((a, b) => b.p - a.p)) console.log(`  ${r.f.padEnd(9)} ${(r.p * 100).toFixed(1)}%  [${(r.lo * 100).toFixed(1)},${(r.hi * 100).toFixed(1)}]`);
  console.log(`  ORDER: ${ordered.map((r) => r.f).join(' > ')}`);
}
// Curve summary: each deck's win% across rungs.
console.log(`\n== skill-response curves (deck win% by rung) ==`);
console.log(`  ${'deck'.padEnd(9)} ${rungList.map((r) => r.padStart(7)).join('')}`);
for (const f of FACTIONS) {
  const cells = rungList.map((r) => (table[r].find((x) => x.f === f).p * 100).toFixed(1).padStart(7));
  console.log(`  ${f.padEnd(9)} ${cells.join('')}`);
}
console.log('\n=== SKILL LADDER DONE ===');
