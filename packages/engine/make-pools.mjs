// make-pools.mjs — regenerate the exact card pools this investigation evaluated,
// deterministically, from the COMMITTED tooling (budget model + function-preserving
// levers + LP flatten). Same commit ⇒ BIT-IDENTICAL pools: the printed sha256 lets
// you confirm your machine generated the same bytes as mine, so a sim you run
// locally reproduces one here exactly (the sim runHash will match too).
//
// Pools use only committed constants (RMSE_MULT, RARITY_BONUS, the type-segmented
// budget model). No top-N faction re-tune is baked in — those were hand-tuned
// "crutch" layers; the budget-only pools below are the reproducible baseline.
//
// Usage: node make-pools.mjs [outDir=/tmp/aetherion-pools]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { applyEdits } from './balance-apply-edits.mjs';

const outDir = process.argv[2] || '/tmp/aetherion-pools';
mkdirSync(outDir, { recursive: true });

const baseline = JSON.parse(readFileSync(new URL('./sim-data/aetherion-cards.json', import.meta.url)));

// name -> { pool, note }
const pools = {
  baseline: { pool: baseline, note: 'raw committed cards (the reference all others derive from)' },
  'narrow-patch-lp30': {
    pool: applyEdits(baseline, { mode: 'all', flattenLp: 30 }).raw,
    note: 'narrow (0.6) budget patch, all edits, + hero LP→30, NO faction re-tune',
  },
  'narrow-nerfs-lp30': {
    pool: applyEdits(baseline, { mode: 'nerfs', flattenLp: 30 }).raw,
    note: 'same but nerfs only (§10: the over-budget nerfs do nearly all the work)',
  },
};

const sha = (obj) => createHash('sha256').update(JSON.stringify(obj)).digest('hex').slice(0, 16);
console.log(`Wrote pools to ${outDir}\n(verify the sha256 matches the reference to confirm your bytes == mine)\n`);
for (const [name, { pool, note }] of Object.entries(pools)) {
  const path = `${outDir}/aetherion-${name}.json`;
  writeFileSync(path, JSON.stringify(pool));
  console.log(`  ${name.padEnd(20)} sha256 ${sha(pool)}  — ${note}`);
}
console.log(`\nThen e.g.:  node balance-standard-sim.mjs ${outDir}/aetherion-narrow-patch-lp30.json 400`);
