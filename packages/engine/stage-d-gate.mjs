// stage-d-gate.mjs — Stage D qualification for the neural valueGreedy pilot.
//
// THE PAYOFF TEST: does the cheap one-ply value net reproduce the ROLLOUT verdict
// (Onyx top, Radiant bottom) at ~valuePilot speed? Runs the 4-starter round-robin under
// valueGreedy and prints per-faction win% + Wilson CI + ordering + throughput, next to the
// established references (valuePilot inverts the meta; rollout says Onyx>...>Radiant).
//
// Usage: node stage-d-gate.mjs <path/to/value-net.json> [gamesPerPairing=500]
import { pathToFileURL } from 'node:url';
const ENGINE = new URL('.', import.meta.url).pathname;
process.env.AETHERION_CARDS = process.env.AETHERION_CARDS || ENGINE + 'generated-pools/aetherion-CURRENT.json';
const { runSimParallel } = await import(pathToFileURL(ENGINE + 'sim-parallel.mjs').href);

const modelPath = process.argv[2];
if (!modelPath) {
  console.error('usage: node stage-d-gate.mjs <value-net.json> [gamesPerPairing=500]');
  process.exit(1);
}
const gpp = +(process.argv[3] || 500);

const FACTIONS = ['Radiant', 'Verdant', 'Onyx', 'Sapphire'];
const decks = Object.fromEntries(FACTIONS.map((f) => [f, f]));
const RULES = {
  rulesProfile: 'current',
  reachDiscard: true, termination: 'tiebreak',
  firstPlayer: 'alternating', seatAlternation: true, turnCap: 80,
};
function wilson(w, n) {
  if (!n) return [0, 0];
  const z = 1.96, p = w / n, d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const m = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [(c - m) / d, (c + m) / d];
}

console.log(`Stage D — valueGreedy qualification\n  model: ${modelPath}\n  gpp: ${gpp}`);
console.log('  reference (established): rollout verdict = Onyx > (Verdant/Sapphire) > Radiant;');
console.log('              valuePilot INVERTS it = Radiant top / Onyx bottom.\n');

const t0 = Date.now();
const res = await runSimParallel(
  { decks, ...RULES, botPolicy: 'valueGreedy', valueModelPath: modelPath, gamesPerPairing: gpp },
  8,
);
const secs = (Date.now() - t0) / 1000;
const fc = res.factionCounts || {};
const rows = FACTIONS.map((f) => { const c = fc[f] || { w: 0, n: 0 }; const wl = wilson(c.w, c.n); return { f, p: c.n ? c.w / c.n : 0, lo: wl[0], hi: wl[1], n: c.n }; });
rows.sort((a, b) => b.p - a.p);
const totalGames = rows.reduce((s, r) => s + r.n, 0) / 2; // each game counts for 2 factions

console.log(`== valueGreedy (gpp ${gpp}, ${secs.toFixed(0)}s, ~${(totalGames / secs).toFixed(1)} games/s, runHash ${res.runHash}) ==`);
for (const r of rows) console.log(`  ${r.f.padEnd(9)} ${(r.p * 100).toFixed(1)}%  [${(r.lo * 100).toFixed(1)},${(r.hi * 100).toFixed(1)}]  n=${r.n}`);
console.log(`  ORDER: ${rows.map((r) => r.f).join(' > ')}`);

// Verdict heuristic (indicative — final call is mine on the numbers):
const top = rows[0].f, bottom = rows[rows.length - 1].f;
const reproduces = top === 'Onyx' && bottom === 'Radiant';
console.log(`\n  top=${top}, bottom=${bottom} -> ${reproduces ? 'REPRODUCES rollout extremes (Onyx top / Radiant bottom)' : 'does NOT match rollout extremes'}`);
console.log('=== STAGE D DONE ===');
