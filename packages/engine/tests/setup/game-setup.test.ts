import { describe, it, expect, beforeEach } from 'vitest';
import {
  createGame,
  applyMulligan,
  resetSetupInstanceCounter,
} from '../../src/setup/game-setup.js';
import type {
  CardDefinition,
  HeroDefinition,
  CardDefinitionRegistry,
} from '../../src/setup/game-setup.js';
import { INITIAL_HAND_SIZE, MULLIGAN_HAND_SIZE } from '../../src/types/game-state.js';

// ── Test Registry ─────────────────────────────────────────────────────────────

function makeCardDef(id: number, name?: string): CardDefinition {
  return {
    id,
    name: name ?? `Card ${String(id)}`,
    cardType: 'C',
    cost: { mana: 1, energy: 0, flexible: 0 },
    stats: { hp: 3, atk: 2 },
    traits: [],
    tags: [],
    alignment: ['Onyx'],
  };
}

function makeHeroDef(id: number): HeroDefinition {
  return {
    id,
    name: `Hero ${String(id)}`,
    lp: 25,
    alignment: ['Onyx'],
  };
}

function makeResourceDef(id: number, name: string): CardDefinition {
  return {
    id,
    name,
    cardType: 'R',
    cost: { mana: 0, energy: 0, flexible: 0 },
  };
}

function createTestRegistry(): CardDefinitionRegistry {
  const cards = new Map<number, CardDefinition>();
  const heroes = new Map<number, HeroDefinition>();

  // 40 main deck cards
  for (let i = 1; i <= 40; i++) {
    cards.set(i, makeCardDef(i));
  }
  // 15 resource cards
  for (let i = 101; i <= 115; i++) {
    const name = i <= 110 ? `Mana Crystal ${String(i)}` : `Energy Cell ${String(i)}`;
    cards.set(i, makeResourceDef(i, name));
  }
  // Heroes
  heroes.set(200, makeHeroDef(200));
  heroes.set(201, makeHeroDef(201));

  return {
    getCard: (id: number) => cards.get(id),
    getHero: (id: number) => heroes.get(id),
  };
}

const mainDeckIds = Array.from({ length: 40 }, (_, i) => i + 1);
const resourceDeckIds = Array.from({ length: 15 }, (_, i) => i + 101);

describe('Game Setup', () => {
  beforeEach(() => {
    resetSetupInstanceCounter();
  });

  describe('createGame', () => {
    it('should create a valid game state', () => {
      const registry = createTestRegistry();
      const state = createGame(
        { heroDefId: 200, mainDeckDefIds: mainDeckIds, resourceDeckDefIds: resourceDeckIds },
        { heroDefId: 201, mainDeckDefIds: mainDeckIds, resourceDeckDefIds: resourceDeckIds },
        registry,
        42,
      );

      expect(state.players).toHaveLength(2);
      expect(state.phase).toBe('mulligan');
      expect(state.turnNumber).toBe(1);
      expect(state.winner).toBeNull();
    });

    it('should draw initial hand of 5 cards', () => {
      const registry = createTestRegistry();
      const state = createGame(
        { heroDefId: 200, mainDeckDefIds: mainDeckIds, resourceDeckDefIds: resourceDeckIds },
        { heroDefId: 201, mainDeckDefIds: mainDeckIds, resourceDeckDefIds: resourceDeckIds },
        registry,
        42,
      );

      expect(state.players[0]!.hand).toHaveLength(INITIAL_HAND_SIZE);
      expect(state.players[1]!.hand).toHaveLength(INITIAL_HAND_SIZE);
    });

    it('should have correct deck sizes after draw', () => {
      const registry = createTestRegistry();
      const state = createGame(
        { heroDefId: 200, mainDeckDefIds: mainDeckIds, resourceDeckDefIds: resourceDeckIds },
        { heroDefId: 201, mainDeckDefIds: mainDeckIds, resourceDeckDefIds: resourceDeckIds },
        registry,
        42,
      );

      expect(state.players[0]!.mainDeck).toHaveLength(40 - INITIAL_HAND_SIZE);
      expect(state.players[1]!.mainDeck).toHaveLength(40 - INITIAL_HAND_SIZE);
    });

    it('should initialize heroes with correct LP', () => {
      const registry = createTestRegistry();
      const state = createGame(
        { heroDefId: 200, mainDeckDefIds: mainDeckIds, resourceDeckDefIds: resourceDeckIds },
        { heroDefId: 201, mainDeckDefIds: mainDeckIds, resourceDeckDefIds: resourceDeckIds },
        registry,
        42,
      );

      expect(state.players[0]!.hero.currentLp).toBe(25);
      expect(state.players[1]!.hero.currentLp).toBe(25);
    });

    it('should shuffle resource decks', () => {
      const registry = createTestRegistry();
      const state = createGame(
        { heroDefId: 200, mainDeckDefIds: mainDeckIds, resourceDeckDefIds: resourceDeckIds },
        { heroDefId: 201, mainDeckDefIds: mainDeckIds, resourceDeckDefIds: resourceDeckIds },
        registry,
        42,
      );

      expect(state.players[0]!.resourceDeck).toHaveLength(15);
    });

    it('should produce deterministic state from same seed', () => {
      const registry = createTestRegistry();
      const s1 = createGame(
        { heroDefId: 200, mainDeckDefIds: mainDeckIds, resourceDeckDefIds: resourceDeckIds },
        { heroDefId: 201, mainDeckDefIds: mainDeckIds, resourceDeckDefIds: resourceDeckIds },
        registry,
        42,
      );

      resetSetupInstanceCounter();
      const s2 = createGame(
        { heroDefId: 200, mainDeckDefIds: mainDeckIds, resourceDeckDefIds: resourceDeckIds },
        { heroDefId: 201, mainDeckDefIds: mainDeckIds, resourceDeckDefIds: resourceDeckIds },
        registry,
        42,
      );

      // Same hands from same seed
      expect(s1.players[0]!.hand.map(c => c.name)).toEqual(
        s2.players[0]!.hand.map(c => c.name),
      );
      expect(s1.activePlayerIndex).toBe(s2.activePlayerIndex);
    });

    it('should assign unique instance IDs to all cards', () => {
      const registry = createTestRegistry();
      const state = createGame(
        { heroDefId: 200, mainDeckDefIds: mainDeckIds, resourceDeckDefIds: resourceDeckIds },
        { heroDefId: 201, mainDeckDefIds: mainDeckIds, resourceDeckDefIds: resourceDeckIds },
        registry,
        42,
      );

      const allIds = new Set<string>();
      for (const player of state.players) {
        for (const card of player.hand) allIds.add(card.instanceId);
        for (const card of player.mainDeck) allIds.add(card.instanceId);
        for (const rc of player.resourceDeck) allIds.add(rc.instanceId);
      }

      // 2 * (40 main + 15 resource) = 110 unique IDs
      expect(allIds.size).toBe(110);
    });

    it('should start with mulligan pending choice for player 0', () => {
      const registry = createTestRegistry();
      const state = createGame(
        { heroDefId: 200, mainDeckDefIds: mainDeckIds, resourceDeckDefIds: resourceDeckIds },
        { heroDefId: 201, mainDeckDefIds: mainDeckIds, resourceDeckDefIds: resourceDeckIds },
        registry,
        42,
      );

      expect(state.pendingChoice).not.toBeNull();
      expect(state.pendingChoice!.type).toBe('mulligan');
      expect(state.pendingChoice!.playerId).toBe(0);
    });

    it('should throw for unknown hero definition', () => {
      const registry = createTestRegistry();
      expect(() =>
        createGame(
          { heroDefId: 999, mainDeckDefIds: mainDeckIds, resourceDeckDefIds: resourceDeckIds },
          { heroDefId: 201, mainDeckDefIds: mainDeckIds, resourceDeckDefIds: resourceDeckIds },
          registry,
          42,
        ),
      ).toThrow('Hero definition not found');
    });

    it('should initialize empty zones for both players', () => {
      const registry = createTestRegistry();
      const state = createGame(
        { heroDefId: 200, mainDeckDefIds: mainDeckIds, resourceDeckDefIds: resourceDeckIds },
        { heroDefId: 201, mainDeckDefIds: mainDeckIds, resourceDeckDefIds: resourceDeckIds },
        registry,
        42,
      );

      for (const player of state.players) {
        expect(player.zones.reserve.every(s => s === null)).toBe(true);
        expect(player.zones.frontline.every(s => s === null)).toBe(true);
        expect(player.zones.highGround.every(s => s === null)).toBe(true);
      }
    });
  });

  describe('applyMulligan', () => {
    it('should keep hand when player chooses keep', () => {
      const registry = createTestRegistry();
      const state = createGame(
        { heroDefId: 200, mainDeckDefIds: mainDeckIds, resourceDeckDefIds: resourceDeckIds },
        { heroDefId: 201, mainDeckDefIds: mainDeckIds, resourceDeckDefIds: resourceDeckIds },
        registry,
        42,
      );

      const originalHand = state.players[0]!.hand.map(c => c.name);
      const after = applyMulligan(state, 0, true);

      // Hand unchanged
      expect(after.players[0]!.hand.map(c => c.name)).toEqual(originalHand);
      // Pending choice moves to player 1
      expect(after.pendingChoice!.playerId).toBe(1);
    });

    it('should redraw 4 cards on mulligan', () => {
      const registry = createTestRegistry();
      const state = createGame(
        { heroDefId: 200, mainDeckDefIds: mainDeckIds, resourceDeckDefIds: resourceDeckIds },
        { heroDefId: 201, mainDeckDefIds: mainDeckIds, resourceDeckDefIds: resourceDeckIds },
        registry,
        42,
      );

      const after = applyMulligan(state, 0, false);

      expect(after.players[0]!.hand).toHaveLength(MULLIGAN_HAND_SIZE);
      // Total cards (hand + deck) should still be 40
      expect(
        after.players[0]!.hand.length + after.players[0]!.mainDeck.length,
      ).toBe(40);
    });

    it('should transition to first-player choice after both players mulligan', () => {
      const registry = createTestRegistry();
      let state = createGame(
        { heroDefId: 200, mainDeckDefIds: mainDeckIds, resourceDeckDefIds: resourceDeckIds },
        { heroDefId: 201, mainDeckDefIds: mainDeckIds, resourceDeckDefIds: resourceDeckIds },
        registry,
        42,
      );

      state = applyMulligan(state, 0, true);
      expect(state.phase).toBe('mulligan');

      state = applyMulligan(state, 1, true);
      expect(state.phase).toBe('setup');
      expect(state.firstPlayerId).toBeNull();
      expect(state.pendingChoice?.type).toBe('choose_first_player');
      expect(state.pendingChoice?.playerId).toBe(state.firstPlayerChooserId);
    });
  });
});
