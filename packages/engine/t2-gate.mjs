// T2 confirmation gate — is the rollout verdict real and stable?
// Confirms the T1 flip (one-ply says Radiant best/Onyx worst; rollout says the opposite)
// with tighter CIs, convergence (r8 -> r12), and optional 2nd seed block.
//
// Run in Giorgio's terminal (multi-hour; workers <= 8, jetsam-safe):
//   node t2-gate.mjs [gpp=128] [seedBlocks=1|2]
// Writes a summary table to stdout AND a JSON to scratchpad for ledgering.
import { pathToFileURL } from 'node:url';
import { writeFileSync } from 'node:fs';

const ENGINE = new URL('.', import.meta.url).pathname;
process.env.AETHERION_CARDS = process.env.AETHERION_CARDS || ENGINE + 'generated-pools/aetherion-CURRENT.json';
const { runSimParallel } = await import(pathToFileURL(ENGINE + 'sim-parallel.mjs').href);

const GPP = +(process.argv[2] || 128);       // rollout games/pairing
const SEED_BLOCKS = +(process.argv[3] || 2); // 1 or 2
const SEEDS = SEED_BLOCKS === 2 ? [12345, 67890] : [12345];

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
const RUNGS = [
  { label: 'r8', rollouts: 8, rolloutDepth: 3, maxCandidates: 8 },
  { label: 'r12', rollouts: 12, rolloutDepth: 3, maxCandidates: 8 },
];
function summarize(res) {
  const fc = res.factionCounts || {};
  const rows = FACTIONS.map((f) => { const c = fc[f] || { w: 0, n: 0 }; const wl = wilson(c.w, c.n); return { f, p: c.n ? c.w / c.n : 0, lo: wl[0], hi: wl[1], n: c.n }; });
  rows.sort((x, y) => y.p - x.p);
  return { rows, order: rows.map((r) => r.f), runHash: res.runHash };
}
function printArm(name, gpp, secs, s) {
  console.log(`\n== ${name}  (gpp ${gpp}, ${secs}s, runHash ${s.runHash}) ==`);
  for (const r of s.rows) console.log(`  ${r.f.padEnd(9)} ${(r.p * 100).toFixed(1)}%  [${(r.lo * 100).toFixed(1)},${(r.hi * 100).toFixed(1)}]  n=${r.n}`);
  console.log(`  ORDER: ${s.order.join(' > ')}`);
}
const out = [];
async function arm(name, seedBase, cfg, gpp) {
  const t0 = Date.now();
  const res = await runSimParallel({ decks, ...RULES, seedBase, ...cfg, gamesPerPairing: gpp }, 8);
  const secs = ((Date.now() - t0) / 1000).toFixed(0);
  const s = summarize(res);
  printArm(name, gpp, secs, s);
  out.push({ name, seedBase, gpp, order: s.order, rows: s.rows, runHash: s.runHash, secs: +secs });
}

for (const seed of SEEDS) {
  console.log(`\n############## SEED BLOCK ${seed} ##############`);
  await arm(`valuePilot(1-ply) s${seed}`, seed, { botPolicy: 'heuristic', valuePilot: true }, 1000);
  for (const rp of ['random', 'heuristic']) {
    for (const rung of RUNGS) {
      const { label, ...knobs } = rung;
      await arm(`rollout-${rp}(${label}) s${seed}`, seed, { botPolicy: 'rollout', ...knobs, candidateGen: 'full', playoutBackend: 'snapshot', rolloutPlayout: rp }, GPP);
    }
  }
}
const dest = '/private/tmp/claude-501/-Users-gvitalone-Projects-personal-AetherionSimulator/1eeef765-c2cf-438b-afc8-bfc2c1393233/scratchpad/t2-result.json';
try { writeFileSync(dest, JSON.stringify(out, null, 1)); console.log(`\nwrote ${dest}`); } catch (e) { console.log(`(could not write summary json: ${e.message})`); }
console.log('\n=== T2 DONE ===');
