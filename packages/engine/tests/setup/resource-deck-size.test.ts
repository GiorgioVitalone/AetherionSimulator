/**
 * §13o rules variant — resourceDeckSize: each player's Resource Deck is
 * truncated to N cards AFTER the setup shuffle (deck-construction change,
 * 15 → N). Absent ⇒ full deck, byte-identical.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createGame, resetSetupInstanceCounter } from '../../src/setup/game-setup.js';
import type {
  CardDefinition,
  HeroDefinition,
  CardDefinitionRegistry,
} from '../../src/setup/game-setup.js';

function createTestRegistry(): CardDefinitionRegistry {
  const cards = new Map<number, CardDefinition>();
  const heroes = new Map<number, HeroDefinition>();
  for (let i = 1; i <= 40; i++) {
    cards.set(i, {
      id: i,
      name: `Card ${String(i)}`,
      cardType: 'C',
      cost: { mana: 1, energy: 0, flexible: 0 },
      stats: { hp: 3, atk: 2 },
      traits: [],
      tags: [],
      alignment: ['Onyx'],
    });
  }
  for (let i = 101; i <= 115; i++) {
    cards.set(i, {
      id: i,
      name: i <= 110 ? `Mana Crystal ${String(i)}` : `Energy Cell ${String(i)}`,
      cardType: 'R',
      cost: { mana: 0, energy: 0, flexible: 0 },
    });
  }
  heroes.set(200, { id: 200, name: 'Hero 200', lp: 25, alignment: ['Onyx'] });
  heroes.set(201, { id: 201, name: 'Hero 201', lp: 25, alignment: ['Onyx'] });
  return { getCard: (id: number) => cards.get(id), getHero: (id: number) => heroes.get(id) };
}

const mainDeckIds = Array.from({ length: 40 }, (_, i) => i + 1);
const resourceDeckIds = Array.from({ length: 15 }, (_, i) => i + 101);
const deck = { heroDefId: 200, mainDeckDefIds: mainDeckIds, resourceDeckDefIds: resourceDeckIds };
const deck2 = { ...deck, heroDefId: 201 };

describe('§13o — resourceDeckSize', () => {
  beforeEach(() => resetSetupInstanceCounter());

  it('defaults to the full 15-card Resource Deck', () => {
    const gs = createGame(deck, deck2, createTestRegistry(), 42);
    expect(gs.players[0].resourceDeck).toHaveLength(15);
    expect(gs.players[1].resourceDeck).toHaveLength(15);
  });

  it('truncates both players to the configured size after the shuffle', () => {
    const gs = createGame(deck, deck2, createTestRegistry(), 42, { resourceDeckSize: 12 });
    expect(gs.players[0].resourceDeck).toHaveLength(12);
    expect(gs.players[1].resourceDeck).toHaveLength(12);
  });

  it('same seed with no/empty options reproduces the pre-change decks exactly', () => {
    resetSetupInstanceCounter();
    const a = createGame(deck, deck2, createTestRegistry(), 7);
    resetSetupInstanceCounter();
    const b = createGame(deck, deck2, createTestRegistry(), 7, {});
    expect(a.players[0].resourceDeck).toEqual(b.players[0].resourceDeck);
    expect(a.players[1].resourceDeck).toEqual(b.players[1].resourceDeck);
  });

  it('the truncated deck is a prefix of the shuffled full deck (same seed)', () => {
    resetSetupInstanceCounter();
    const full = createGame(deck, deck2, createTestRegistry(), 9);
    resetSetupInstanceCounter();
    const cut = createGame(deck, deck2, createTestRegistry(), 9, { resourceDeckSize: 12 });
    expect(cut.players[0].resourceDeck).toEqual(full.players[0].resourceDeck.slice(0, 12));
  });
});
