/**
 * Seeded faction-deck sampler for the balance simulator (WS-C).
 *
 * Produces DIVERSE, LEGAL, DETERMINISTIC decks for a faction: one per archetype
 * template, each a legal 40-card main deck + 12 resource cards. Same seed ⇒
 * byte-identical output; distinct seeds ⇒ distinct samples. Pure data + a seeded
 * RNG; no Math.random, no Date.

 * Card data is read from the committed fixture `sim-data/aetherion-cards.json`
 * (override with AETHERION_CARDS). The exported `cardIndex` matches the `CardIndex`
 * the compiled `dist/sim/deck-legality.js` validator expects, so callers can do
 * `validateDeck(deck, cardIndex)`.
 */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const CARDS_PATH = process.env.AETHERION_CARDS
  ? process.env.AETHERION_CARDS
  : new URL('./sim-data/aetherion-cards.json', import.meta.url);

const raw = JSON.parse(readFileSync(CARDS_PATH, 'utf8'));

const FACTIONS = ['Onyx', 'Radiant', 'Sapphire', 'Verdant'];
const ENERGY_FACTIONS = new Set(['Verdant']);
const DECK_SIZE = 40;
// sim-data/ruleset-v1.json rules.resourceDeckSize (frozen at 12, not the 15-card
// physical starter deck size).
export const RESOURCE_DECK_SIZE = 12;

const factionOf = (c) => (Array.isArray(c.alignment) ? c.alignment[0] : c.alignment);
const copyLimit = (c) => {
  if (c.rarity === 'Legendary') return 1;
  if (c.rarity === 'Ethereal' || c.rarity === 'Mythic') return 2;
  return 3;
};
const resourceTypeFor = (faction) => (ENERGY_FACTIONS.has(faction) ? 'energy' : 'mana');

// Resource cards (alignment-neutral): pick by name, mirroring sim-runner.mjs.
const rCards = raw.filter((c) => c.cardType === 'R');
const manaR = rCards.find((c) => /mana/i.test(c.name)) ?? rCards[0];
const energyR = rCards.find((c) => /energy/i.test(c.name)) ?? rCards[rCards.length - 1];
const resourceIdFor = (faction) => (ENERGY_FACTIONS.has(faction) ? energyR.id : manaR.id);

const heroByFaction = {};
for (const c of raw) if (c.cardType === 'H') heroByFaction[factionOf(c)] = c;

const poolByFaction = {};
for (const f of FACTIONS) {
  poolByFaction[f] = raw.filter(
    (c) => (c.cardType === 'C' || c.cardType === 'S' || c.cardType === 'E') && factionOf(c) === f,
  );
}

// ── cardIndex (the CardIndex shape dist/sim/deck-legality.js validates against) ──
const cardFactsById = new Map();
const heroFactsById = new Map();
for (const c of raw) {
  if (c.cardType === 'C' || c.cardType === 'S' || c.cardType === 'E') {
    cardFactsById.set(c.id, { id: c.id, cardType: c.cardType, faction: factionOf(c), rarity: c.rarity });
  } else if (c.cardType === 'R') {
    cardFactsById.set(c.id, {
      id: c.id,
      cardType: 'R',
      faction: factionOf(c),
      rarity: c.rarity,
      resourceType: /energy/i.test(c.name) ? 'energy' : 'mana',
    });
  } else if (c.cardType === 'H') {
    heroFactsById.set(c.id, { id: c.id, faction: factionOf(c), resourceType: resourceTypeFor(factionOf(c)) });
  }
}

export const cardIndex = {
  card: (id) => cardFactsById.get(id),
  hero: (id) => heroFactsById.get(id),
};

// ── Archetype templates — distinct C/S/E quotas (each sums to 40, clamped to the
// faction pool and backfilled, so every deck reaches exactly 40 legal cards). ──
export const ARCHETYPE_NAMES = ['Aggro', 'Midrange', 'Control', 'Tempo', 'Ramp'];
const ARCHETYPE_QUOTA = {
  Aggro: { C: 30, S: 6, E: 4 },
  Midrange: { C: 24, S: 10, E: 6 },
  Control: { C: 16, S: 18, E: 6 },
  Tempo: { C: 26, S: 6, E: 8 },
  Ramp: { C: 22, S: 14, E: 4 },
};

// ── Seeded RNG (mulberry32) + a small FNV-1a string mixer for the per-deck seed ──
function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function mixSeed(...parts) {
  let h = 2166136261 >>> 0;
  const s = parts.join(':');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

function shuffled(arr, rng) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Round-robin copies of `cards` into `main` up to `quota` (and the 40 cap), never
// exceeding each card's copy limit.
function fillType(main, cards, quota, used) {
  let added = 0;
  let progress = true;
  while (added < quota && main.length < DECK_SIZE && progress) {
    progress = false;
    for (const c of cards) {
      if (added >= quota || main.length >= DECK_SIZE) break;
      const u = used.get(c.id) ?? 0;
      if (u < copyLimit(c)) {
        main.push(c.id);
        used.set(c.id, u + 1);
        added++;
        progress = true;
      }
    }
  }
}

/** Order-independent hash of a card-id multiset. */
export function multisetHash(ids) {
  const sorted = [...ids].sort((a, b) => a - b);
  return createHash('sha1').update(sorted.join(',')).digest('hex');
}

function buildMain(faction, archetype, seed, nonce) {
  const rng = mulberry32(mixSeed(seed, faction, archetype, nonce));
  const pool = poolByFaction[faction];
  const byType = { C: [], S: [], E: [] };
  for (const c of shuffled(pool, rng)) byType[c.cardType].push(c);
  const quota = ARCHETYPE_QUOTA[archetype];
  const main = [];
  const used = new Map();
  for (const t of ['C', 'S', 'E']) fillType(main, byType[t], quota[t], used);
  if (main.length < DECK_SIZE) fillType(main, shuffled(pool, rng), DECK_SIZE, used);
  return main.slice(0, DECK_SIZE);
}

/**
 * Sample `count` decks for a faction. The first 5 cover the 5 archetypes (then
 * cycle); collisions within a sample are perturbed deterministically so deckKeys
 * stay distinct.
 * @returns {{heroDefId:number, mainDeckDefIds:number[], resourceDeckDefIds:number[], faction:string, archetype:string, deckKey:string}[]}
 */
export function sampleFactionDecks(faction, count, opts) {
  const { seed } = opts;
  const hero = heroByFaction[faction];
  const rid = resourceIdFor(faction);
  const out = [];
  const seenKeys = new Set();
  for (let i = 0; i < count; i++) {
    const archetype = ARCHETYPE_NAMES[i % ARCHETYPE_NAMES.length];
    let nonce = 0;
    let main = buildMain(faction, archetype, seed, nonce);
    let key = `${faction}:${archetype}:${multisetHash(main)}`;
    while (seenKeys.has(key) && nonce < 64) {
      nonce++;
      main = buildMain(faction, archetype, seed, nonce);
      key = `${faction}:${archetype}:${multisetHash(main)}`;
    }
    seenKeys.add(key);
    out.push({
      heroDefId: hero.id,
      mainDeckDefIds: main,
      resourceDeckDefIds: Array.from({ length: RESOURCE_DECK_SIZE }, () => rid),
      faction,
      archetype,
      deckKey: key,
    });
  }
  return out;
}
