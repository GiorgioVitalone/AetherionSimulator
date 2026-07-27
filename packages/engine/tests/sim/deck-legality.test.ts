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
  14: { id: 14, cardType: 'C', faction: 'Onyx', rarity: 'Ethereal' },
  15: { id: 15, cardType: 'C', faction: 'Onyx', rarity: 'Mythic' },
  20: { id: 20, cardType: 'C', faction: 'Radiant', rarity: 'Common' },
  21: { id: 21, cardType: 'C', faction: 'Radiant', rarity: 'Mythic' },
  22: { id: 22, cardType: 'C', faction: 'Sapphire', rarity: 'Common' },
  23: {
    id: 23,
    cardType: 'C',
    faction: 'Radiant',
    rarity: 'Common',
    requiredResourceTypes: ['energy'],
  },
  24: {
    id: 24,
    cardType: 'C',
    faction: 'Onyx',
    rarity: 'Common',
    requiredResourceTypes: ['energy'],
  },
};
const heroes: Record<number, HeroFacts> = {
  1: { id: 1, faction: 'Onyx', resourceType: 'mana' },
  2: {
    id: 2,
    faction: 'Onyx',
    alignments: ['Onyx', 'Radiant'],
    resourceType: 'mana',
    resourceTypes: ['mana', 'energy'],
  },
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

  it('rejects more than 2 copies of an Ethereal card', () => {
    const main = [...bigMain.slice(0, 37), 14, 14, 14];
    const r = validateDeck(
      { heroDefId: 1, mainDeckDefIds: main, resourceDeckDefIds: resources },
      bigIndex,
    );
    expect(r.legal).toBe(false);
    expect(r.errors.some((e) => e.includes('exceeds limit 2'))).toBe(true);
  });

  it('accepts exactly 2 copies of an Ethereal card', () => {
    const main = [...bigMain.slice(0, 38), 14, 14];
    const r = validateDeck(
      { heroDefId: 1, mainDeckDefIds: main, resourceDeckDefIds: resources },
      bigIndex,
    );
    expect(r.legal).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it('rejects more than 2 copies of a Mythic card', () => {
    const main = [...bigMain.slice(0, 37), 15, 15, 15];
    const r = validateDeck(
      { heroDefId: 1, mainDeckDefIds: main, resourceDeckDefIds: resources },
      bigIndex,
    );
    expect(r.legal).toBe(false);
    expect(r.errors.some((e) => e.includes('exceeds limit 2'))).toBe(true);
  });

  it('accepts exactly 2 copies of a Mythic card', () => {
    const main = [...bigMain.slice(0, 38), 15, 15];
    const r = validateDeck(
      { heroDefId: 1, mainDeckDefIds: main, resourceDeckDefIds: resources },
      bigIndex,
    );
    expect(r.legal).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it('accepts exactly 3 copies of a Common card', () => {
    const main = [...bigMain.slice(0, 37), 10, 10, 10];
    const r = validateDeck(
      { heroDefId: 1, mainDeckDefIds: main, resourceDeckDefIds: resources },
      bigIndex,
    );
    expect(r.legal).toBe(true);
    expect(r.errors).toEqual([]);
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

  it('accepts Common secondary-alignment cards and either dual-Hero resource', () => {
    const main = [...bigMain.slice(0, 39), 20];
    const mixedResources = [
      ...resources.slice(0, RESOURCE_DECK_SIZE / 2),
      ...Array.from({ length: RESOURCE_DECK_SIZE / 2 }, () => 98),
    ];
    const r = validateDeck(
      {
        heroDefId: 2,
        mainDeckDefIds: main,
        resourceDeckDefIds: mixedResources,
        faction: 'Onyx',
      },
      bigIndex,
    );
    expect(r).toEqual({ legal: true, errors: [] });
  });

  it('rejects Mythic cards from a dual Hero secondary alignment', () => {
    const r = validateDeck(
      {
        heroDefId: 2,
        mainDeckDefIds: [...bigMain.slice(0, 39), 21],
        resourceDeckDefIds: resources,
        faction: 'Onyx',
      },
      bigIndex,
    );
    expect(r.legal).toBe(false);
    expect(r.errors.some((error) => error.includes('secondary alignment Radiant'))).toBe(true);
  });

  it('allows that same Mythic when its alignment is declared primary', () => {
    const r = validateDeck(
      {
        heroDefId: 2,
        mainDeckDefIds: [...bigMain.slice(0, 39), 21],
        resourceDeckDefIds: resources,
        faction: 'Radiant',
      },
      bigIndex,
    );
    expect(r).toEqual({ legal: true, errors: [] });
  });

  it('requires dual-alignment decks to declare their primary alignment', () => {
    const r = validateDeck(
      {
        heroDefId: 2,
        mainDeckDefIds: bigMain,
        resourceDeckDefIds: resources,
      },
      bigIndex,
    );
    expect(r.legal).toBe(false);
    expect(r.errors.some((error) => error.includes('must declare'))).toBe(true);
  });

  it('still rejects cards outside both Hero alignments', () => {
    const r = validateDeck(
      {
        heroDefId: 2,
        mainDeckDefIds: [...bigMain.slice(0, 39), 22],
        resourceDeckDefIds: resources,
        faction: 'Onyx',
      },
      bigIndex,
    );
    expect(r.legal).toBe(false);
    expect(r.errors.some((error) => error.includes('outside hero alignments'))).toBe(true);
  });

  it('allows either printed resource requirement for a dual-resource Hero', () => {
    const r = validateDeck(
      {
        heroDefId: 2,
        mainDeckDefIds: [...bigMain.slice(0, 39), 23],
        resourceDeckDefIds: resources,
        faction: 'Onyx',
      },
      bigIndex,
    );
    expect(r).toEqual({ legal: true, errors: [] });
  });

  it('rejects a resource requirement the Hero does not support', () => {
    const r = validateDeck(
      {
        heroDefId: 1,
        mainDeckDefIds: [...bigMain.slice(0, 39), 24],
        resourceDeckDefIds: resources,
        faction: 'Onyx',
      },
      bigIndex,
    );
    expect(r.legal).toBe(false);
    expect(r.errors.some((error) => error.includes('requires energy'))).toBe(true);
  });

  it('synthetic small-pool legalDeck helper stays within copy caps', () => {
    // Documents that the tiny pool cannot reach 40 (so the big pool is used above).
    const d = legalDeck();
    expect(d.mainDeckDefIds.length).toBeLessThan(MAIN_MIN);
  });
});
