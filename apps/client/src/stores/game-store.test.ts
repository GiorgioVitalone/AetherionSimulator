/**
 * Game Store Integration Test
 *
 * Tests the full pipeline: mock card data → registry → engine → controller
 * → store → actions → state. Bypasses deck-loader's static JSON import by
 * building decks and registry directly from mock data.
 */
import { describe, it, expect, afterEach } from 'vitest';
import type { DeckSelection } from '@aetherion-sim/engine';
import type { SimCard } from '@aetherion-sim/cards';
import { createRegistry, RARITY_COPY_LIMITS } from '@/features/game-setup';
import { GameFlowController } from '@/machines/game-flow';
import { MOCK_CARDS } from './__fixtures__/mock-cards';

function buildTestDeck(faction: string): DeckSelection {
  const hero = MOCK_CARDS.find(
    c => c.cardType === 'H' && c.alignment.includes(faction as 'Onyx' | 'Radiant'),
  );
  if (!hero) throw new Error(`No hero for ${faction}`);

  const factionCards = MOCK_CARDS.filter(
    c => c.alignment.includes(faction as 'Onyx' | 'Radiant') &&
      c.cardType !== 'H' && c.cardType !== 'T' && c.cardType !== 'R',
  );

  const mainDeckDefIds: number[] = [];
  const copyCounts = new Map<number, number>();

  for (const card of factionCards) {
    const maxCopies = RARITY_COPY_LIMITS[card.rarity] ?? 3;
    const currentCopies = copyCounts.get(card.id) ?? 0;
    const copiesToAdd = Math.min(maxCopies - currentCopies, 40 - mainDeckDefIds.length);
    for (let i = 0; i < copiesToAdd; i++) {
      mainDeckDefIds.push(card.id);
    }
    copyCounts.set(card.id, currentCopies + copiesToAdd);
    if (mainDeckDefIds.length >= 40) break;
  }

  const resourceCard = MOCK_CARDS.find(
    c => c.cardType === 'R' && c.alignment.includes(faction as 'Onyx' | 'Radiant'),
  );
  const resourceDeckDefIds: number[] = [];
  if (resourceCard) {
    for (let i = 0; i < 15; i++) {
      resourceDeckDefIds.push(resourceCard.id);
    }
  }

  return { heroDefId: hero.id, mainDeckDefIds, resourceDeckDefIds };
}

// ── Test Suite ──────────────────────────────────────────────────────────────

describe('Game Flow Integration', () => {
  let controller: GameFlowController | null = null;
  const registryWithAbilities = createRegistry(MOCK_CARDS);
  const SEED = 42;

  afterEach(() => {
    controller?.stop();
    controller = null;
  });

  function startGame(): { states: import('@aetherion-sim/engine').GameState[] } {
    const states: import('@aetherion-sim/engine').GameState[] = [];
    const onyxDeck = buildTestDeck('Onyx');
    const radiantDeck = buildTestDeck('Radiant');

    controller = new GameFlowController({
      player1Deck: onyxDeck,
      player2Deck: radiantDeck,
      registryWithAbilities,
      seed: SEED,
      onStateChange: (state) => {
        states.push(state);
      },
    });

    controller.start();
    return { states };
  }

  it('initializes a game in mulligan phase with two players', () => {
    const { states } = startGame();

    expect(states.length).toBeGreaterThanOrEqual(1);
    const initial = states[0]!;

    expect(initial.phase).toBe('mulligan');
    expect(initial.players).toHaveLength(2);
    expect(initial.players[0].hand.length).toBe(5);
    expect(initial.players[1].hand.length).toBe(5);
    expect(initial.pendingChoice).not.toBeNull();
    expect(initial.pendingChoice?.type).toBe('mulligan');
  });

  it('hydrates hero abilities from DSL', () => {
    const { states } = startGame();
    const initial = states[0]!;

    // At least one hero should have abilities from the mock data
    const heroWithAbilities = initial.players.find(
      p => p.hero.abilities.length > 0,
    );
    expect(heroWithAbilities).toBeDefined();
  });

  it('processes mulligan decisions and transitions to playing', () => {
    const { states } = startGame();

    // Player 0 keeps
    controller!.dispatch({
      type: 'mulligan_decision',
      playerId: 0,
      keep: true,
    });

    // Player 1 keeps
    controller!.dispatch({
      type: 'mulligan_decision',
      playerId: 1,
      keep: true,
    });

    const afterMulligans = states[states.length - 1]!;
    expect(afterMulligans.phase).toBe('setup');
    expect(afterMulligans.pendingChoice?.type).toBe('choose_first_player');

    controller!.dispatch({
      type: 'player_response',
      response: { selectedOptionIds: ['player_0'] },
    });

    const latest = states[states.length - 1]!;

    expect(['upkeep', 'strategy']).toContain(latest.phase);
    expect(latest.turnNumber).toBe(1);
  });

  it('transitions through phases with end_phase', () => {
    const { states } = startGame();

    // Both players keep
    controller!.dispatch({ type: 'mulligan_decision', playerId: 0, keep: true });
    controller!.dispatch({ type: 'mulligan_decision', playerId: 1, keep: true });
    controller!.dispatch({
      type: 'player_response',
      response: { selectedOptionIds: ['player_0'] },
    });

    // End strategy phase → should go to action phase
    controller!.dispatch({ type: 'end_phase' });

    const afterStrategy = states[states.length - 1]!;
    expect(afterStrategy.phase).toBe('action');

    // End action phase → should go to end phase → pass turn
    controller!.dispatch({ type: 'end_phase' });

    const afterAction = states[states.length - 1]!;
    // After end phase, the turn passes, which triggers the next player's upkeep→strategy
    expect(['upkeep', 'strategy']).toContain(afterAction.phase);
  });

  it('handles concede correctly', () => {
    const { states } = startGame();

    // Both players keep
    controller!.dispatch({ type: 'mulligan_decision', playerId: 0, keep: true });
    controller!.dispatch({ type: 'mulligan_decision', playerId: 1, keep: true });

    // Player 0 concedes
    controller!.dispatch({ type: 'concede', playerId: 0 });

    const final = states[states.length - 1]!;
    expect(final.winner).toBe(1);
  });

  it('dispatch is a no-op after controller is stopped', () => {
    const { states } = startGame();
    const stateCountBeforeStop = states.length;

    controller!.stop();

    // Dispatch after stop should not push new states
    controller!.dispatch({ type: 'end_phase' });
    expect(states.length).toBe(stateCountBeforeStop);
  });
});

describe('Registry Adapter', () => {
  it('separates heroes and cards into correct maps', () => {
    const { registry } = createRegistry(MOCK_CARDS);

    // Heroes should be in hero map
    const onyxHero = registry.getHero(1);
    expect(onyxHero).toBeDefined();
    expect(onyxHero?.name).toBe('Malachar the Undying');
    expect(onyxHero?.lp).toBe(28);

    // Cards should be in card map
    const graveWarden = registry.getCard(100);
    expect(graveWarden).toBeDefined();
    expect(graveWarden?.name).toBe('Grave Warden');
    expect(graveWarden?.cost).toEqual({ mana: 2, energy: 0, flexible: 0 });
  });

  it('extracts DSL abilities from card data', () => {
    const { getHeroAbilities } = createRegistry(MOCK_CARDS);

    // Onyx hero (id=1) has one DSL ability
    const abilities = getHeroAbilities(1);
    expect(abilities).toHaveLength(1);
    expect(abilities[0]).toHaveProperty('type', 'triggered');
  });

  it('strips xMana/xEnergy from cost', () => {
    const { registry } = createRegistry(MOCK_CARDS);
    const card = registry.getCard(100);
    expect(card?.cost).not.toHaveProperty('xMana');
    expect(card?.cost).not.toHaveProperty('xEnergy');
  });

  it('infers faction resource types for zero-cost heroes and cards', () => {
    const cards: SimCard[] = [
      {
        id: 1,
        name: 'Prototype Seedmind',
        cardType: 'H',
        rarity: 'Legendary',
        alignment: ['Verdant'],
        cost: { mana: 0, energy: 0, flexible: 0, xMana: false, xEnergy: false },
        stats: { hp: 25, atk: 0, arm: 0 },
        abilities: [],
        traits: [],
        artUrl: null,
        flavorText: null,
        setCode: 'TEST',
        transformsInto: null,
      },
      {
        id: 2,
        name: 'Bio-Seedling',
        cardType: 'C',
        rarity: 'Common',
        alignment: ['Verdant'],
        cost: { mana: 0, energy: 0, flexible: 0, xMana: false, xEnergy: false },
        stats: { hp: 1, atk: 1, arm: 0 },
        abilities: [],
        traits: [],
        artUrl: null,
        flavorText: null,
        setCode: 'TEST',
        transformsInto: null,
      },
      {
        id: 3,
        name: 'Growth Pulse',
        cardType: 'S',
        rarity: 'Common',
        alignment: ['Verdant'],
        cost: { mana: 0, energy: 1, flexible: 0, xMana: false, xEnergy: false },
        stats: null,
        abilities: [],
        traits: [],
        artUrl: null,
        flavorText: null,
        setCode: 'TEST',
        transformsInto: null,
      },
    ];

    const { registry } = createRegistry(cards);

    expect(registry.getHero(1)?.resourceTypes).toEqual(['energy']);
    expect(registry.getCard(2)?.resourceTypes).toEqual(['energy']);
  });
});
