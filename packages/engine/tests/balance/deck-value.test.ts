import { describe, expect, it } from 'vitest';
import { computeDeckValue, type DeckInput } from '../../src/balance/deck-value.js';
import type { CardIndex, HeroInput, StaticCard } from '../../src/balance/types.js';
import { aura, body, card } from './factory.js';

function index(cards: readonly StaticCard[]): CardIndex {
  return new Map(cards.map((c) => [c.id, c]));
}

const HERO: HeroInput = { id: 100, name: 'H', lp: 30, abilities: [], alignment: ['Verdant'] };

function tribalLord(id: number, name: string, tag: string): StaticCard {
  return card({
    id,
    name,
    cardType: 'C',
    stats: { atk: 2, hp: 2, arm: 0 },
    alignment: ['Verdant'],
    abilities: [
      aura([
        {
          type: 'modify_stats',
          modifier: { atk: 1 },
          target: { type: 'all_characters', side: 'allied', filter: { tag } },
          duration: { type: 'permanent' },
        },
      ]),
    ],
  });
}

describe('computeDeckValue', () => {
  it('produces finite, positive, deterministic results with all terms', () => {
    const idx = index([
      body(1, 'A', 3, 3, 0, { alignment: ['Verdant'] }),
      body(2, 'B', 2, 4, 0, { alignment: ['Verdant'] }),
    ]);
    const deck: DeckInput = { faction: 'Verdant', mainDeckDefIds: [1, 1, 1, 2, 2, 2] };
    const a = computeDeckValue(deck, HERO, idx);
    expect(computeDeckValue(deck, HERO, idx)).toEqual(a);
    expect(a.cardPowerSum).toBeGreaterThan(0);
    expect(Number.isFinite(a.value)).toBe(true);
    expect(a.perCard.length).toBe(2);
  });

  it('acceleration needs BOTH cheap enablers and a finisher (the min gate)', () => {
    const free = { cost: { mana: 0, energy: 0, flexible: 0 }, alignment: ['Verdant'] };
    const mid = { cost: { mana: 3, energy: 0, flexible: 0 }, alignment: ['Verdant'] };
    const top = { cost: { mana: 5, energy: 0, flexible: 0 }, alignment: ['Verdant'] };
    const enabler = body(1, 'Seedling', 0, 2, 0, free);
    const finisher = body(2, 'Titan', 5, 5, 0, top);
    const midA = body(1, 'MidA', 0, 2, 0, mid);
    const midB = body(2, 'MidB', 5, 5, 0, mid);
    const ids = [1, 1, 1, 2, 2];
    const snowball = computeDeckValue(
      { faction: 'Verdant', mainDeckDefIds: ids },
      HERO,
      index([enabler, finisher]),
    );
    const flat = computeDeckValue(
      { faction: 'Verdant', mainDeckDefIds: ids },
      HERO,
      index([midA, midB]),
    );
    const onlyCheap = computeDeckValue(
      { faction: 'Verdant', mainDeckDefIds: ids },
      HERO,
      index([enabler, midB]), // cheap enabler, no finisher (midB is cost 3)
    );
    expect(snowball.acceleration).toBeGreaterThan(0);
    expect(flat.acceleration).toBe(0); // no cheap, no finisher
    expect(onlyCheap.acceleration).toBe(0); // tempo present but nothing to deploy
  });

  it('rewards matching tribal tags over mismatched ones (inter-card synergy)', () => {
    const deck: DeckInput = { faction: 'Verdant', mainDeckDefIds: [1, 1, 1, 2, 2, 2, 3, 3, 3] };
    const matched = index([
      tribalLord(1, 'Lord', 'Bio'),
      body(2, 'B1', 2, 2, 0, { tags: ['Bio'], alignment: ['Verdant'] }),
      body(3, 'B2', 2, 2, 0, { tags: ['Bio'], alignment: ['Verdant'] }),
    ]);
    const mismatched = index([
      tribalLord(1, 'Lord', 'Bio'),
      body(2, 'B1', 2, 2, 0, { tags: ['Other'], alignment: ['Verdant'] }),
      body(3, 'B2', 2, 2, 0, { tags: ['Other'], alignment: ['Verdant'] }),
    ]);
    const m = computeDeckValue(deck, HERO, matched);
    const n = computeDeckValue(deck, HERO, mismatched);
    expect(m.interSynergy.capped).toBeGreaterThan(n.interSynergy.capped);
  });
});
