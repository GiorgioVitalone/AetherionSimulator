// balance-faction-tune.mjs — apply CHARACTER stat deltas to the top-N marquee bodies
// of a faction on top of the patched + LP30 baseline, realizing a faction-archetype
// power correction as a few concrete card edits. The per-card budget patch fixes
// individual outliers; this closes the faction win-rate gap the standard pilot
// (reach+exile+value) exposed. Additive (not multiplicative) so it moves low-stat
// bodies under integer rounding. Round 1 showed the lever is extreme (a flat ±1 on a
// whole faction swings 25–50 pp), so target the top-N highest-stat bodies per faction.
// Env: SRC, OUT, FDELTAS='{"Radiant":{"hp":-1}}', FCOUNT='{"Radiant":4}' (default: all).
import { readFileSync, writeFileSync } from 'node:fs';

const SRC = process.env.SRC || '/tmp/aetherion-cards-baseline.json';
const OUT = process.env.OUT || '/tmp/aetherion-cards-tuned.json';
const FDELTAS = JSON.parse(process.env.FDELTAS || '{}'); // { Faction: { hp?, atk?, arm? } }
const FCOUNT = JSON.parse(process.env.FCOUNT || '{}'); // { Faction: N } — top-N bodies (default all)

const cards = JSON.parse(readFileSync(SRC));
const statSum = (c) => (c.stats?.hp ?? 0) + (c.stats?.atk ?? 0);
const applied = {};
for (const [faction, d] of Object.entries(FDELTAS)) {
  const chars = cards
    .filter((c) => c.cardType === 'C' && c.stats && (c.alignment || []).includes(faction))
    .sort((a, b) => statSum(b) - statSum(a) || a.id - b.id);
  const targets = FCOUNT[faction] !== undefined ? chars.slice(0, FCOUNT[faction]) : chars;
  for (const c of targets) {
    if (d.hp) c.stats.hp = Math.max(1, c.stats.hp + d.hp);
    if (d.atk) c.stats.atk = Math.max(0, c.stats.atk + d.atk);
    if (d.arm) c.stats.arm = Math.max(0, c.stats.arm + d.arm);
  }
  applied[faction] = targets.map((c) => c.name);
}

writeFileSync(OUT, JSON.stringify(cards));
console.log(`Wrote ${OUT} — faction char-stat deltas:`);
for (const [f, d] of Object.entries(FDELTAS)) {
  console.log(`  ${f} ${JSON.stringify(d)} → ${applied[f].length}: ${applied[f].join(', ')}`);
}
