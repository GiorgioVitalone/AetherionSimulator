// make-pools.mjs — regenerate the exact card pools this investigation evaluated,
// deterministically, from the COMMITTED tooling (budget model + function-preserving
// levers + LP flatten). Same commit ⇒ BIT-IDENTICAL pools: the printed sha256 lets
// you confirm your machine generated the same bytes as mine, so a sim you run
// locally reproduces one here exactly (the sim runHash will match too).
//
// Pools use only committed constants (RMSE_MULT, RARITY_BONUS, the type-segmented
// budget model). No top-N faction re-tune is baked in — those were hand-tuned
// "crutch" layers; the budget-patch pool below is the reproducible baseline.
//
// Naming note: the raw, never-edited committed cards are called "raw-unpatched"
// here, NOT "baseline" — a prior version of this file called it "baseline" and
// that ambiguity (raw vs. "the current working reference") directly caused a
// real wrong-dataset mistake mid-investigation. "CURRENT" below is the one
// unambiguous working reference; everything else is explicitly labeled.
//
// Usage: node make-pools.mjs [outDir=./generated-pools]  (relative to this file,
// so the same command produces the same relative layout on any machine)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { applyEdits } from './balance-apply-edits.mjs';
import { applySapphireRedesign } from './make-sapphire-redesign.mjs';

// Relative to CWD (this repo's convention: run from packages/engine/), not to
// this script's own location — so the printed path is relative and portable,
// not an absolute path baked to one machine.
const outDir = `${(process.argv[2] || './generated-pools').replace(/\/$/, '')}/`;
mkdirSync(outDir, { recursive: true });

const rawUnpatched = JSON.parse(readFileSync(new URL('./sim-data/aetherion-cards.json', import.meta.url)));
const narrowPatchLp30 = applyEdits(rawUnpatched, { mode: 'all', flattenLp: 30 }).raw;

// name -> { pool, note }. "CURRENT" is the one file to point at as "the baseline"
// going forward — everything else is a labeled variant for a specific comparison.
const pools = {
  'raw-unpatched': { pool: rawUnpatched, note: 'raw committed cards, never edited (NOT "the baseline")' },
  'narrow-patch-lp30': {
    pool: narrowPatchLp30,
    note: '0.6 budget patch, all edits, + hero LP→30, NO faction re-tune',
  },
  'narrow-nerfs-lp30': {
    pool: applyEdits(rawUnpatched, { mode: 'nerfs', flattenLp: 30 }).raw,
    note: 'same but nerfs only (§10: the over-budget nerfs do nearly all the work)',
  },
  CURRENT: {
    pool: narrowPatchLp30,
    note: 'THE working reference — identical bytes to narrow-patch-lp30, this is the name to remember',
  },
  'CURRENT-plus-sapphire-redesign': {
    pool: applySapphireRedesign(narrowPatchLp30).raw,
    note: 'CURRENT + docs/sapphire-redesign-proposal.md (9 redesigns + 2 tweaks) applied',
  },
};

const sha = (obj) => createHash('sha256').update(JSON.stringify(obj)).digest('hex').slice(0, 16);
console.log(`Wrote pools to ${outDir}\n(verify the sha256 matches the reference to confirm your bytes == mine)\n`);
for (const [name, { pool, note }] of Object.entries(pools)) {
  const path = `${outDir}aetherion-${name}.json`;
  writeFileSync(path, JSON.stringify(pool));
  console.log(`  ${name.padEnd(30)} sha256 ${sha(pool)}  — ${note}`);
}
console.log(`\nThen e.g.:  node balance-standard-sim.mjs ${outDir}aetherion-CURRENT.json 400`);
