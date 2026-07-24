// make-deck-set.mjs — freeze a constructed 20-deck set (5 archetypes x 4
// factions) sampled from the ratified card pool, for repeatable balance runs.
//
// Writes a VERSIONED, TRACKED artifact (sim-data/deck-sets/constructed-v1.json)
// and refuses to overwrite an existing one — bump the version instead.
//
// Usage: node make-deck-set.mjs  (run from packages/engine)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const POOL_PATH = './generated-pools/aetherion-CURRENT-plus-ht2b2-payload.json';
const OUT_PATH = './sim-data/deck-sets/constructed-v1.json';
const SEED = 20260713;
const FACTIONS = ['Onyx', 'Radiant', 'Sapphire', 'Verdant'];
const DECKS_PER_FACTION = 5;

if (existsSync(OUT_PATH)) {
  console.error(
    `FATAL: ${OUT_PATH} already exists — deck sets are versioned artifacts and never overwritten. ` +
      `Bump the version (e.g. constructed-v2.json) instead.`,
  );
  process.exit(1);
}

// Ratify the pool the sampler reads from before importing it (deck-sampler.mjs
// reads AETHERION_CARDS synchronously at import time).
process.env.AETHERION_CARDS = POOL_PATH;
const { sampleFactionDecks } = await import('./deck-sampler.mjs');

const sha = (obj) => createHash('sha256').update(JSON.stringify(obj)).digest('hex').slice(0, 16);
const poolRaw = readFileSync(new URL(POOL_PATH, import.meta.url), 'utf8');
const poolSha = sha(JSON.parse(poolRaw));

const decks = FACTIONS.flatMap((faction) =>
  sampleFactionDecks(faction, DECKS_PER_FACTION, { seed: SEED }).map((deck) => ({
    ...deck,
    deckId: deck.deckKey,
  })),
);

const deckSet = {
  version: 'constructed-v1',
  seed: SEED,
  poolPath: POOL_PATH,
  poolSha,
  createdFrom: 'deck-sampler.mjs',
  decks,
};

mkdirSync(new URL('./sim-data/deck-sets/', import.meta.url), { recursive: true });
writeFileSync(new URL(OUT_PATH, import.meta.url), JSON.stringify(deckSet, null, 2) + '\n');
console.log(`Wrote ${OUT_PATH} (${decks.length} decks, pool ${POOL_PATH} sha256:${poolSha})`);

// ── Card-inclusion report ──────────────────────────────────────────────────
const pool = JSON.parse(poolRaw);
const factionOf = (c) => (Array.isArray(c.alignment) ? c.alignment[0] : c.alignment);
const mainPoolCards = pool.filter((c) => c.cardType === 'C' || c.cardType === 'S' || c.cardType === 'E');

const inclusionCount = new Map();
for (const c of mainPoolCards) inclusionCount.set(c.id, 0);
for (const deck of decks) {
  const includedIds = new Set(deck.mainDeckDefIds);
  for (const id of includedIds) {
    if (inclusionCount.has(id)) inclusionCount.set(id, inclusionCount.get(id) + 1);
  }
}

console.log('\nCARD-INCLUSION REPORT (of 20 decks each card appears in ≥1 copy of):');
let includedTotal = 0;
for (const faction of FACTIONS) {
  const cards = mainPoolCards
    .filter((c) => factionOf(c) === faction)
    .map((c) => ({ ...c, count: inclusionCount.get(c.id) }))
    .sort((a, b) => a.count - b.count);
  console.log(`\n${faction}:`);
  for (const c of cards) {
    if (c.count > 0) includedTotal++;
    const flag = c.count === 0 ? '  NO HOME' : '';
    console.log(`  ${String(c.count).padStart(2)}/20  ${c.cardType}  ${c.name}${flag}`);
  }
}
console.log(`\n${includedTotal} of ${mainPoolCards.length} cards appear in ≥1 deck.`);
