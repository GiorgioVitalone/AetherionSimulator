// balance-faction-tune.mjs — apply per-faction flat CHARACTER stat deltas on top of
// the patched + LP30 baseline, realizing a faction-archetype power correction as
// concrete card edits. The per-card budget patch fixes individual outliers; this
// closes the faction win-rate gap the standard pilot (reach+exile+value) exposed.
// Additive (not multiplicative) so it actually moves low-stat bodies under integer
// rounding. Env: SRC, OUT, FDELTAS='{"Onyx":{"hp":1,"atk":1},"Verdant":{"hp":-1}}'.
import { readFileSync, writeFileSync } from 'node:fs';

const SRC = process.env.SRC || '/tmp/aetherion-cards-baseline.json';
const OUT = process.env.OUT || '/tmp/aetherion-cards-tuned.json';
const FDELTAS = JSON.parse(process.env.FDELTAS || '{}'); // { Faction: { hp?, atk?, arm? } }

const cards = JSON.parse(readFileSync(SRC));
const tally = {};
for (const c of cards) {
  if (c.cardType !== 'C' || !c.stats) continue;
  for (const [faction, d] of Object.entries(FDELTAS)) {
    if (!(c.alignment || []).includes(faction)) continue;
    if (d.hp) c.stats.hp = Math.max(1, c.stats.hp + d.hp);
    if (d.atk) c.stats.atk = Math.max(0, c.stats.atk + d.atk);
    if (d.arm) c.stats.arm = Math.max(0, c.stats.arm + d.arm);
    tally[faction] = (tally[faction] || 0) + 1;
  }
}

writeFileSync(OUT, JSON.stringify(cards));
const summary = Object.entries(FDELTAS)
  .map(([f, d]) => `${f} ${JSON.stringify(d)} ×${tally[f] || 0}`)
  .join('  ·  ');
console.log(`Wrote ${OUT} — faction char-stat deltas: ${summary || '(none)'}`);
