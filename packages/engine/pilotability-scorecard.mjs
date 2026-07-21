// pilotability-scorecard.mjs (P2A) — is a deck genuinely weak, or can't-the-bot-pilot-it?
//
// Pure replay over a decision-log NDJSON (decision-datagen.mjs output). For each rollout
// decision we have every candidate's rollout VALUE, the rollout's chosen index (argmax =
// the "skilled" pick), the heuristic bot's chosen index, and the pass index. Per deck:
//   - value-loss(heuristic) = rollout_best_value - value[heuristicIdx]   (how much the cheap
//       bot leaves on the table). High = the deck is hard to pilot (heuristic mis-plays it).
//   - value-loss(pass)      = rollout_best_value - value[passIdx]        (cost of doing nothing)
//   - decision-importance   = rollout_best_value - mean_candidate_value  (how much piloting
//       matters AT ALL at this deck's decisions). High = skill-intensive.
//   - blunder rate          = fraction of decisions where value-loss(heuristic) > threshold.
// A deck that scores LOW on a naive bot only because of high value-loss is bot-fragile, not
// weak — do NOT buff it. A deck with low value-loss that still loses is genuinely weak.
//
// Values are on the rollout outcome scale (~[-1,1]); a loss of ~2 ≈ flipping a win to a loss.
//
// Usage: node pilotability-scorecard.mjs <decision-log.ndjson> [blunderThreshold=0.5]
import { readFileSync } from 'node:fs';

const path = process.argv[2];
if (!path) { console.error('usage: node pilotability-scorecard.mjs <decision-log.ndjson> [blunderThreshold]'); process.exit(1); }
const BLUNDER = +(process.argv[3] || 0.5);

const lines = readFileSync(path, 'utf8').trim().split('\n');
const header = JSON.parse(lines[0]);
const rows = lines.slice(1).map((l) => JSON.parse(l));

// value of candidate i (null when it got no playouts — treat as the worst observed, since the
// rollout deprioritized it; but for heuristic/pass lookups we use the actual logged value).
const val = (cands, i) => (i != null && i >= 0 && i < cands.length && cands[i].value != null ? cands[i].value : null);
const bestValue = (cands) => { let b = -Infinity; for (const c of cands) if (c.value != null && c.value > b) b = c.value; return b === -Infinity ? null : b; };
const meanValue = (cands) => { let s = 0, n = 0; for (const c of cands) if (c.value != null) { s += c.value; n++; } return n ? s / n : null; };

const per = {}; // faction -> accumulators
function acc(f) { return (per[f] ??= { n: 0, vlHeur: 0, vlHeurN: 0, vlPass: 0, vlPassN: 0, imp: 0, impN: 0, blunder: 0, heurMissing: 0, trivial: 0 }); }

for (const r of rows) {
  const a = acc(r.faction);
  a.n++;
  const cands = r.candidates;
  const best = bestValue(cands);
  const mean = meanValue(cands);
  if (best == null) continue;
  // decision importance
  if (mean != null) { a.imp += best - mean; a.impN++; if (best - mean < 1e-6) a.trivial++; }
  // heuristic value-loss
  if (r.heuristicIdx === -1) { a.heurMissing++; }
  else { const hv = val(cands, r.heuristicIdx); if (hv != null) { const loss = best - hv; a.vlHeur += loss; a.vlHeurN++; if (loss > BLUNDER) a.blunder++; } }
  // pass value-loss
  const pv = val(cands, r.passIdx); if (pv != null) { a.vlPass += best - pv; a.vlPassN++; }
}

console.log(`Pilotability scorecard — ${path.split('/').pop()} (schema v${header.schemaVersion}, ${rows.length} decisions), blunder>${BLUNDER}`);
console.log(`\n  ${'deck'.padEnd(9)} ${'decisions'.padStart(10)} ${'vLoss(heur)'.padStart(12)} ${'blunder%'.padStart(9)} ${'importance'.padStart(11)} ${'vLoss(pass)'.padStart(12)} ${'heurOff-list%'.padStart(14)} ${'trivial%'.padStart(9)}`);
const order = Object.keys(per).sort((x, y) => (per[y].vlHeurN ? per[y].vlHeur / per[y].vlHeurN : 0) - (per[x].vlHeurN ? per[x].vlHeur / per[x].vlHeurN : 0));
for (const f of order) {
  const a = per[f];
  const vlH = a.vlHeurN ? a.vlHeur / a.vlHeurN : 0;
  const bl = a.vlHeurN ? (100 * a.blunder) / a.vlHeurN : 0;
  const imp = a.impN ? a.imp / a.impN : 0;
  const vlP = a.vlPassN ? a.vlPass / a.vlPassN : 0;
  const miss = a.n ? (100 * a.heurMissing) / a.n : 0;
  const triv = a.impN ? (100 * a.trivial) / a.impN : 0;
  console.log(`  ${f.padEnd(9)} ${String(a.n).padStart(10)} ${vlH.toFixed(3).padStart(12)} ${bl.toFixed(1).padStart(9)} ${imp.toFixed(3).padStart(11)} ${vlP.toFixed(3).padStart(12)} ${miss.toFixed(1).padStart(14)} ${triv.toFixed(1).padStart(9)}`);
}
console.log(`\n  READING: high vLoss(heur) + high importance => deck is HARD TO PILOT (bot-fragile), not weak.`);
console.log(`           low vLoss + still-losing => genuinely weak. heurOff-list% = heuristic picked a move`);
console.log(`           the rollout didn't enumerate (also a piloting-divergence signal).`);
console.log('\n=== SCORECARD DONE ===');
