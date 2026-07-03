// make-pools.mjs — materialize the card pools this investigation evaluates.
//
// TWO KINDS of pool, deliberately separated after the §13 formula repair:
//
//   FROZEN references (CURRENT + its Sapphire-redesign variant): committed
//   fixtures under sim-data/pools/ — the EXACT bytes every §7–§13 measurement
//   ran against. They were originally derived, but the pricing formula now
//   evolves, so re-deriving would silently change the baseline. This script
//   COPIES them and HASH-VERIFIES the bytes at generation time; any mismatch
//   is a hard failure, never a silent drift.
//
//   DERIVED candidates: generated live from the committed tooling + the
//   CURRENT formula. These CHANGE when the formula improves — that is the
//   point — and their notes say so. Never call a derived pool "the baseline".
//
// Usage: node make-pools.mjs [outDir=./generated-pools]  (run from packages/engine)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { applyEdits } from './balance-apply-edits.mjs';
import { applyHeroTune, applyHeroTuneV2, applyGrovekeeperFix } from './make-hero-tune.mjs';
import { applyBatteryTrim } from './make-battery-trim.mjs';

const outDir = `${(process.argv[2] || './generated-pools').replace(/\/$/, '')}/`;
mkdirSync(outDir, { recursive: true });

const sha = (obj) => createHash('sha256').update(JSON.stringify(obj)).digest('hex').slice(0, 16);
const loadFrozen = (name, expected) => {
  const pool = JSON.parse(readFileSync(new URL(`./sim-data/pools/${name}`, import.meta.url)));
  const h = sha(pool);
  if (h !== expected) {
    console.error(`FATAL: frozen fixture ${name} hashes ${h}, expected ${expected} — the baseline bytes changed. STOP.`);
    process.exit(1);
  }
  return pool;
};

const rawUnpatched = JSON.parse(readFileSync(new URL('./sim-data/aetherion-cards.json', import.meta.url)));
const frozenCurrent = loadFrozen('aetherion-CURRENT-frozen.json', '6928b4ab3b7ef915');
const frozenSapphire = loadFrozen('aetherion-CURRENT-plus-sapphire-redesign-frozen.json', '396fd91fac214ef3');

// Live derivations (current formula — §13-repaired weights, §13a loop guards).
const derivedPatch = applyEdits(rawUnpatched, { mode: 'all', flattenLp: 30 });
const derivedNerfs = applyEdits(rawUnpatched, { mode: 'nerfs', flattenLp: 30 });

// name -> { pool, note }. "CURRENT" is the one name to point at as "the baseline".
const pools = {
  'raw-unpatched': { pool: rawUnpatched, note: 'raw committed cards, never edited (NOT "the baseline")' },
  CURRENT: {
    pool: frozenCurrent,
    note: 'THE frozen baseline (committed fixture, hash-verified) — all §7–§13 measurements',
  },
  'CURRENT-plus-sapphire-redesign': {
    pool: frozenSapphire,
    note: 'frozen §8 variant: CURRENT + the Sapphire redesign patch table',
  },
  'CURRENT-plus-hero-tune': {
    pool: applyHeroTune(applyGrovekeeperFix(frozenCurrent).raw).raw,
    note: '§13e candidate (measured §13f): frozen CURRENT + Grovekeeper X-cost fix + hero three-window knob tune',
  },
  'CURRENT-plus-hero-tune2': {
    pool: applyHeroTuneV2(applyHeroTune(applyGrovekeeperFix(frozenCurrent).raw).raw).raw,
    note: '§13g candidate (measured §13h): hero-tune + W1-fixed-window Verdant re-split (Harvest token 0/1, Overgrowth cd 2, Synthetic 2E)',
  },
  'CURRENT-plus-hero-tune2-battery': {
    pool: applyBatteryTrim(applyHeroTuneV2(applyHeroTune(applyGrovekeeperFix(frozenCurrent).raw).raw).raw).raw,
    note: '§13i candidate: hero-tune2 + tap-loop feeder trim (Bio-Seedling 0E→1E, Sprout 2E→3E)',
  },
  'derived-nerfs-lp30': {
    pool: derivedNerfs.raw,
    note: `LIVE candidate: corrected-formula nerf arm only + LP→30 (${derivedNerfs.changes.length} edits, ${derivedNerfs.vetoed.length} vetoed) — changes as the formula improves`,
  },
  'derived-patch-lp30': {
    pool: derivedPatch.raw,
    note: `LIVE diagnostic: corrected-formula both arms + LP→30 (${derivedPatch.changes.length} edits, ${derivedPatch.vetoed.length} vetoed) — buff arm is review-only policy; exists to inspect what it WOULD do`,
  },
};

console.log(`Wrote pools to ${outDir}\n(CURRENT is a hash-verified frozen fixture; derived-* pools track the live formula)\n`);
for (const [name, { pool, note }] of Object.entries(pools)) {
  writeFileSync(`${outDir}aetherion-${name}.json`, JSON.stringify(pool));
  console.log(`  ${name.padEnd(34)} sha256 ${sha(pool)}  — ${note}`);
}
const vetoNotes = [...new Set([...derivedNerfs.vetoed, ...derivedPatch.vetoed])];
if (vetoNotes.length) {
  console.log('\nLoop-guard vetoes in live derivations:');
  for (const v of vetoNotes) console.log(`  ✗ ${v}`);
}
console.log(`\nThen e.g.:  node balance-standard-sim.mjs ${outDir}aetherion-CURRENT.json 400`);
