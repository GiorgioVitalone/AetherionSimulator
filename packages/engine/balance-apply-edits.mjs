// balance-apply-edits.mjs — write a modified aetherion-cards.json with the suggested
// balance edits applied (the same primary edits the before/after compare uses), so
// the sim can be re-run against them via AETHERION_CARDS. MODE=all|nerfs|buffs.
import { readFileSync, writeFileSync } from 'node:fs';
import { computeSuggestions } from './balance-suggestions.mjs';

const MODE = process.env.MODE || 'all'; // all | nerfs | buffs | none
const OUT = process.env.OUT || '/tmp/aetherion-cards-after.json';
// FLATTEN_LP: set every hero's starting LP to this value (FLATTEN_LP=1 ⇒ 30).
const FLATTEN_LP = process.env.FLATTEN_LP ? (Number(process.env.FLATTEN_LP) > 1 ? Number(process.env.FLATTEN_LP) : 30) : 0;

const sug = computeSuggestions();
const list = MODE === 'nerfs' ? sug.over : MODE === 'buffs' ? sug.under : MODE === 'none' ? [] : [...sug.over, ...sug.under];

const raw = JSON.parse(readFileSync(new URL('./sim-data/aetherion-cards.json', import.meta.url)));
const byId = new Map(raw.map((c) => [c.id, c]));

let n = 0;
const changes = [];
for (const c of list) {
  const card = byId.get(c.id);
  if (!card) continue;
  const a = c.after.static;
  const before = { stats: card.stats ? { ...card.stats } : null, cost: { ...card.cost } };
  if (a.stats) card.stats = { hp: a.stats.hp, atk: a.stats.atk, arm: a.stats.arm };
  card.cost = { mana: a.cost.mana, energy: a.cost.energy, flexible: a.cost.flexible };
  n++;
  changes.push(`${card.name}: ${c.after.lever}`);
}

let lpCount = 0;
if (FLATTEN_LP) {
  for (const card of raw) {
    if (card.cardType === 'H' && card.stats) {
      card.stats = { ...card.stats, hp: FLATTEN_LP };
      lpCount++;
    }
  }
}

writeFileSync(OUT, JSON.stringify(raw));
console.log(`Wrote ${OUT} — ${MODE} (${n} edits)${FLATTEN_LP ? ` + LP→${FLATTEN_LP} (${lpCount} heroes)` : ''}:`);
for (const ch of changes) console.log(`  · ${ch}`);
