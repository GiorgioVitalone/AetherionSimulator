// balance-apply-edits.mjs — apply the budget-model suggestions (+ optional hero-LP
// flatten) to a raw aetherion-cards array, so the sim/dashboard can use the
// rebalanced set. Exports a pure applyEdits(); the CLI writes a JSON for
// AETHERION_CARDS. MODE=all|nerfs|buffs|none, FLATTEN_LP=1 ⇒ 30.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { computeSuggestions } from './balance-suggestions.mjs';

/** Apply the suggestions (+ optional hero-LP flatten) to a COPY of `rawInput`.
 * mode: all|nerfs|buffs|none. Returns { raw, changes, lpCount }. Never mutates input. */
export function applyEdits(rawInput, { mode = 'all', flattenLp = 0 } = {}) {
  const raw = JSON.parse(JSON.stringify(rawInput));
  const sug = computeSuggestions(rawInput); // fit the INPUT pool (so passes iterate)
  const list =
    mode === 'nerfs' ? sug.over : mode === 'buffs' ? sug.under : mode === 'none' ? [] : [...sug.over, ...sug.under];
  const byId = new Map(raw.map((c) => [c.id, c]));
  const changes = [];
  for (const c of list) {
    const card = byId.get(c.id);
    if (!card) continue;
    const a = c.after.static;
    if (a.stats) card.stats = { hp: a.stats.hp, atk: a.stats.atk, arm: a.stats.arm };
    card.cost = { mana: a.cost.mana, energy: a.cost.energy, flexible: a.cost.flexible };
    changes.push(`${card.name}: ${c.after.lever}`);
  }
  let lpCount = 0;
  if (flattenLp) {
    for (const card of raw) {
      if (card.cardType === 'H' && card.stats) {
        card.stats = { ...card.stats, hp: flattenLp };
        lpCount++;
      }
    }
  }
  return { raw, changes, lpCount };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const MODE = process.env.MODE || 'all';
  const OUT = process.env.OUT || '/tmp/aetherion-cards-after.json';
  const FLATTEN_LP = process.env.FLATTEN_LP ? (Number(process.env.FLATTEN_LP) > 1 ? Number(process.env.FLATTEN_LP) : 30) : 0;
  const base = JSON.parse(readFileSync(new URL('./sim-data/aetherion-cards.json', import.meta.url)));
  const { raw, changes, lpCount } = applyEdits(base, { mode: MODE, flattenLp: FLATTEN_LP });
  writeFileSync(OUT, JSON.stringify(raw));
  console.log(
    `Wrote ${OUT} — ${MODE} (${changes.length} edits)${FLATTEN_LP ? ` + LP→${FLATTEN_LP} (${lpCount} heroes)` : ''}:`,
  );
  for (const ch of changes) console.log(`  · ${ch}`);
}
