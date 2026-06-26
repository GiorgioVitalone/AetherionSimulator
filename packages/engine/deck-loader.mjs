/**
 * Deck loader for the balance simulator.
 *
 * Serves the official premade STARTER decks (one per faction) that the balance
 * sim measures. The decks are committed as a generated fixture at
 * `sim-data/aetherion-decks.json` (produced from the card DB — see
 * `sim-data/README.md`), so `runSim` stays synchronous and CI needs no database.
 *
 * `getDeck(spec)` resolves a faction name, deck UUID, or deck name to a deck the
 * runner can hydrate; an unknown spec returns `null`, which makes the runner fall
 * back to an auto-built deck (see `resolveDeckSpec` in `sim-runner.mjs`).
 *
 * Override the fixture with the `AETHERION_DECKS` env var to sim against a freshly
 * exported deck set without editing the repo.
 */
import { readFileSync } from 'node:fs';

const DECKS_PATH = process.env.AETHERION_DECKS
  ? process.env.AETHERION_DECKS
  : new URL('./sim-data/aetherion-decks.json', import.meta.url);

/** @typedef {{ deckId: string, name: string, faction: string, heroDefId: number, mainDeckDefIds: number[], resourceDeckDefIds: number[] }} OfficialDeck */

/** @type {OfficialDeck[]} */
const decks = JSON.parse(readFileSync(DECKS_PATH, 'utf8'));

const byFaction = new Map();
const byDeckId = new Map();
const byName = new Map();
for (const d of decks) {
  if (d.faction && !byFaction.has(d.faction)) byFaction.set(d.faction, d);
  byDeckId.set(String(d.deckId), d);
  byName.set(d.name, d);
}

/**
 * Resolve a deck spec to an official premade deck, or `null` if none matches.
 * @param {string|number|null|undefined} spec - faction name ("Onyx"), deck UUID, or deck name.
 * @returns {OfficialDeck|null}
 */
export function getDeck(spec) {
  if (spec == null) return null;
  const key = String(spec);
  return byFaction.get(key) ?? byDeckId.get(key) ?? byName.get(key) ?? null;
}
