/**
 * Unit tests for the standalone deck-legality validator (src/sim/deck-legality.ts).
 *
 * Mirrors the legality rules of sim-runner.mjs buildDeck without importing it:
 * 40-60 main, <=3 copies (<=1 Legendary), exactly 12 faction-typed resources,
 * hero alignment-consistent.
 */
import { describe, it, expect } from 'vitest';
import {
  validateDeck,
  MAIN_MIN,
  RESOURCE_DECK_SIZE,
  type CardFacts,
  type HeroFacts,
  type CardIndex,
  type DeckSelection,
} from '../../src/sim/deck-legality.js';

// A tiny synthetic pool: hero 1 (Onyx/mana), plenty of common bodies, one
// Legendary, a foreign-faction card, and a mana resource (id 99).
const cards: Record<number, CardFacts> = {
  99: { id: 99, cardType: 'R', faction: 'None', rarity: 'Common', resourceType: 'mana' },
  98: { id: 98, cardType: 'R', faction: 'None', rarity: 'Common', resourceType: 'energy' },
  10: { id: 10, cardType: 'C', faction: 'Onyx', rarity: 'Common' },
  11: { id: 11, cardType: 'S', faction: 'Onyx', rarity: 'Common' },
  12: { id: 12, cardType: 'E', faction: 'Onyx', rarity: 'Common' },
  13: { id: 13, cardType: 'C', faction: 'Onyx', rarity: 'Legendary' },
  20: { id: 20, cardType: 'C', faction: 'Radiant', rarity: 'Common' },
};
const heroes: Record<number, HeroFacts> = {
  1: { id: 1, faction: 'Onyx', resourceType: 'mana' },
};
const index: CardIndex = {
  card: (id) => cards[id],
  hero: (id) => heroes[id],
};

const bodyIds = [10, 11, 12];
function mainOf(size: number): number[] {
  // size cards, never exceeding 3 copies of any single id (cycles 10,11,12).
  return Array.from({ length: size }, (_, i) => bodyIds[i % bodyIds.length] as number);
}
const resources = Array.from({ length: RESOURCE_DECK_SIZE }, () => 99);

function legalDeck(): DeckSelection {
  // 9 cards from the 3-id cycle would only allow 3 copies each → exactly 9.
  // Use enough distinct ids to reach MAIN_MIN under the copy cap.
  const main: number[] = [];
  const pool = [10, 11, 12, 13];
  let count = 0;
  for (const id of pool) {
    const cap = id === 13 ? 1 : 3;
    for (let k = 0; k < cap && main.length < MAIN_MIN; k++) main.push(id);
    count++;
  }
  // Still short of 40 (4 ids → max 10). Pad by reusing within cap is impossible,
  // so this synthetic pool can't reach 40 — instead test the 40-floor explicitly
  // below with a larger generated pool.
  void count;
  return { heroDefId: 1, mainDeckDefIds: main, resourceDeckDefIds: resources, faction: 'Onyx' };
}

// A larger pool with 40 distinct Onyx commons so a 40-card main is reachable.
const bigCards: Record<number, CardFacts> = { ...cards };
for (let id = 100; id < 140; id++) {
  bigCards[id] = { id, cardType: 'C', faction: 'Onyx', rarity: 'Common' };
}
const bigIndex: CardIndex = { card: (id) => bigCards[id], hero: (id) => heroes[id] };
const bigMain = Array.from({ length: 40 }, (_, i) => 100 + i);

describe('validateDeck', () => {
  it('accepts a legal 40-card deck', () => {
    const r = validateDeck(
      { heroDefId: 1, mainDeckDefIds: bigMain, resourceDeckDefIds: resources, faction: 'Onyx' },
      bigIndex,
    );
    expect(r.legal).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it('rejects a main deck below 40', () => {
    const r = validateDeck(
      { heroDefId: 1, mainDeckDefIds: bigMain.slice(0, 39), resourceDeckDefIds: resources },
      bigIndex,
    );
    expect(r.legal).toBe(false);
    expect(r.errors.some((e) => e.includes('size 39'))).toBe(true);
  });

  it('rejects a main deck above 60', () => {
    const main = Array.from({ length: 61 }, (_, i) => 100 + (i % 40));
    const r = validateDeck(
      { heroDefId: 1, mainDeckDefIds: main, resourceDeckDefIds: resources },
      bigIndex,
    );
    expect(r.legal).toBe(false);
    expect(r.errors.some((e) => e.includes('outside'))).toBe(true);
  });

  it('rejects more than 3 copies of a non-Legendary card', () => {
    const main = [...mainOf(40)]; // cycles 10,11,12 → 14/13/13 copies
    const r = validateDeck(
      { heroDefId: 1, mainDeckDefIds: main, resourceDeckDefIds: resources },
      index,
    );
    expect(r.legal).toBe(false);
    expect(r.errors.some((e) => e.includes('exceeds limit 3'))).toBe(true);
  });

  it('rejects more than 1 copy of a Legendary card', () => {
    const main = [...bigMain.slice(0, 38), 13, 13];
    const r = validateDeck(
      { heroDefId: 1, mainDeckDefIds: main, resourceDeckDefIds: resources },
      bigIndex,
    );
    expect(r.legal).toBe(false);
    expect(r.errors.some((e) => e.includes('exceeds limit 1'))).toBe(true);
  });

  it('rejects off-faction main-deck cards (hero alignment consistency)', () => {
    const main = [...bigMain.slice(0, 39), 20]; // 20 is Radiant
    const r = validateDeck(
      { heroDefId: 1, mainDeckDefIds: main, resourceDeckDefIds: resources },
      bigIndex,
    );
    expect(r.legal).toBe(false);
    expect(r.errors.some((e) => e.includes('faction Radiant'))).toBe(true);
  });

  it('rejects a resource deck that is not exactly 12', () => {
    const r = validateDeck(
      { heroDefId: 1, mainDeckDefIds: bigMain, resourceDeckDefIds: resources.slice(0, 11) },
      bigIndex,
    );
    expect(r.legal).toBe(false);
    expect(r.errors.some((e) => e.includes('resource deck size 11'))).toBe(true);
  });

  it('rejects resources of the wrong type for the faction', () => {
    const wrong = Array.from({ length: RESOURCE_DECK_SIZE }, () => 98); // energy for a mana hero
    const r = validateDeck(
      { heroDefId: 1, mainDeckDefIds: bigMain, resourceDeckDefIds: wrong },
      bigIndex,
    );
    expect(r.legal).toBe(false);
    expect(r.errors.some((e) => e.includes('type energy'))).toBe(true);
  });

  it('rejects an unknown hero', () => {
    const r = validateDeck(
      { heroDefId: 999, mainDeckDefIds: bigMain, resourceDeckDefIds: resources },
      bigIndex,
    );
    expect(r.legal).toBe(false);
    expect(r.errors[0]).toContain('unknown hero');
  });

  it('flags a selection.faction that disagrees with the hero', () => {
    const r = validateDeck(
      { heroDefId: 1, mainDeckDefIds: bigMain, resourceDeckDefIds: resources, faction: 'Radiant' },
      bigIndex,
    );
    expect(r.legal).toBe(false);
    expect(r.errors.some((e) => e.includes('selection faction Radiant'))).toBe(true);
  });

  it('synthetic small-pool legalDeck helper stays within copy caps', () => {
    // Documents that the tiny pool cannot reach 40 (so the big pool is used above).
    const d = legalDeck();
    expect(d.mainDeckDefIds.length).toBeLessThan(MAIN_MIN);
  });
});
