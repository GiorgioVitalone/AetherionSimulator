import { describe, it, expect, beforeEach } from 'vitest';
import { executeEffect } from '../../src/effects/interpreter.js';
import { deployToZone } from '../../src/zones/zone-manager.js';
import type { Effect } from '../../src/types/effects.js';
import type { EffectContext } from '../../src/types/game-state.js';
import {
  mockCard,
  mockGameState,
  mockPlayerState,
  resetInstanceCounter,
  emptyZones,
} from '../helpers/card-factory.js';

function ctx(sourceId: string, controllerId: 0 | 1 = 0): EffectContext {
  return { sourceInstanceId: sourceId, controllerId, triggerDepth: 0 };
}

describe('Effect Interpreter', () => {
  beforeEach(() => {
    resetInstanceCounter();
  });

  describe('deal_damage', () => {
    it('should deal fixed damage to a character via self-target', () => {
      const target = mockCard({ currentHp: 5, owner: 1 });
      const source = mockCard({ owner: 0 });
      let p0Zones = deployToZone(emptyZones(), source, 'frontline');
      let p1Zones = deployToZone(emptyZones(), target, 'frontline');

      const state = mockGameState({
        players: [
          mockPlayerState(0, { zones: p0Zones }),
          mockPlayerState(1, { zones: p1Zones }),
        ],
      });

      const effect: Effect = {
        type: 'deal_damage',
        amount: { type: 'fixed', value: 3 },
        target: { type: 'self' },
      };

      // Self-targeting means the source takes the damage
      const result = executeEffect(state, effect, ctx(source.instanceId, 0));
      const damageEvents = result.events.filter(e => e.type === 'DAMAGE_DEALT');
      expect(damageEvents).toHaveLength(1);
    });

    it('should deal damage to enemy hero', () => {
      const source = mockCard({ owner: 0 });
      let p0Zones = deployToZone(emptyZones(), source, 'frontline');

      const state = mockGameState({
        players: [
          mockPlayerState(0, { zones: p0Zones }),
          mockPlayerState(1),
        ],
      });

      const effect: Effect = {
        type: 'deal_damage',
        amount: { type: 'fixed', value: 5 },
        target: { type: 'hero', side: 'enemy' },
      };

      const result = executeEffect(state, effect, ctx(source.instanceId, 0));
      expect(result.newState.players[1]!.hero.currentLp).toBe(20); // 25 - 5
      expect(result.events.some(e => e.type === 'HERO_DAMAGED')).toBe(true);
    });

    it('should set opponent as winner when self-damage kills own hero', () => {
      const state = mockGameState({
        players: [
          mockPlayerState(0, {
            hero: {
              ...mockGameState().players[0]!.hero,
              currentLp: 3,
              maxLp: 25,
            },
          }),
          mockPlayerState(1),
        ],
      });

      const effect: Effect = {
        type: 'deal_damage',
        amount: { type: 'fixed', value: 5 },
        target: { type: 'owner_hero' },
      };

      // Controller 0 damages their own hero
      const result = executeEffect(state, effect, ctx('src', 0));
      expect(result.newState.players[0]!.hero.currentLp).toBe(0);
      // Player 1 (opponent) should win, NOT player 0 (controller)
      expect(result.newState.winner).toBe(1);
    });

    it('should destroy character when HP reaches 0', () => {
      const target = mockCard({ currentHp: 2, owner: 1 });
      let p1Zones = deployToZone(emptyZones(), target, 'frontline');

      const state = mockGameState({
        players: [
          mockPlayerState(0),
          mockPlayerState(1, { zones: p1Zones }),
        ],
      });

      const effect: Effect = {
        type: 'deal_damage',
        amount: { type: 'fixed', value: 5 },
        target: { type: 'all_characters', side: 'enemy' },
      };

      const result = executeEffect(state, effect, ctx('src', 0));
      expect(result.events.some(e => e.type === 'CARD_DESTROYED')).toBe(true);
      expect(result.newState.players[1]!.zones.frontline[0]).toBeNull();
    });
  });

  describe('heal', () => {
    it('should heal a character up to base HP', () => {
      const card = mockCard({ currentHp: 1, baseHp: 5, owner: 0 });
      let zones = deployToZone(emptyZones(), card, 'frontline');

      const state = mockGameState({
        players: [
          mockPlayerState(0, { zones }),
          mockPlayerState(1),
        ],
      });

      const effect: Effect = {
        type: 'heal',
        amount: { type: 'fixed', value: 10 },
        target: { type: 'self' },
      };

      const result = executeEffect(state, effect, ctx(card.instanceId, 0));
      const healed = result.newState.players[0]!.zones.frontline[0]!;
      expect(healed.currentHp).toBe(5); // Capped at baseHp
    });

    it('should heal hero', () => {
      const state = mockGameState();
      const damaged = {
        ...state,
        players: [
          { ...state.players[0]!, hero: { ...state.players[0]!.hero, currentLp: 15, maxLp: 25 } },
          state.players[1]!,
        ] as const,
      };

      const effect: Effect = {
        type: 'heal',
        amount: { type: 'fixed', value: 5 },
        target: { type: 'owner_hero' },
      };

      const result = executeEffect(damaged, effect, ctx('src', 0));
      expect(result.newState.players[0]!.hero.currentLp).toBe(20);
    });
  });

  describe('modify_stats', () => {
    it('should buff ATK and HP', () => {
      const card = mockCard({ currentAtk: 2, currentHp: 3, owner: 0 });
      let zones = deployToZone(emptyZones(), card, 'frontline');

      const state = mockGameState({
        players: [
          mockPlayerState(0, { zones }),
          mockPlayerState(1),
        ],
      });

      const effect: Effect = {
        type: 'modify_stats',
        modifier: { atk: 1, hp: 2 },
        target: { type: 'self' },
        duration: { type: 'permanent' },
      };

      const result = executeEffect(state, effect, ctx(card.instanceId, 0));
      const buffed = result.newState.players[0]!.zones.frontline[0]!;
      expect(buffed.currentAtk).toBe(3);
      expect(buffed.currentHp).toBe(5);
    });
  });

  describe('draw_cards', () => {
    it('should draw cards from main deck to hand', () => {
      const deckCards = [
        mockCard({ name: 'Deck1' }),
        mockCard({ name: 'Deck2' }),
        mockCard({ name: 'Deck3' }),
      ];

      const state = mockGameState({
        players: [
          mockPlayerState(0, { mainDeck: deckCards, hand: [] }),
          mockPlayerState(1),
        ],
      });

      const effect: Effect = {
        type: 'draw_cards',
        count: { type: 'fixed', value: 2 },
        player: 'allied',
      };

      const result = executeEffect(state, effect, ctx('src', 0));
      expect(result.newState.players[0]!.hand).toHaveLength(2);
      expect(result.newState.players[0]!.mainDeck).toHaveLength(1);
    });
  });

  describe('deploy_token', () => {
    it('should deploy a token to frontline', () => {
      const state = mockGameState();

      const effect: Effect = {
        type: 'deploy_token',
        token: { name: 'Sapling', atk: 1, hp: 1 },
        count: 2,
        zone: 'frontline',
      };

      const result = executeEffect(state, effect, ctx('src', 0));
      const frontline = result.newState.players[0]!.zones.frontline;
      expect(frontline.filter(s => s !== null)).toHaveLength(2);
      expect(frontline[0]!.isToken).toBe(true);
      expect(frontline[0]!.name).toBe('Sapling');
    });
  });

  describe('destroy', () => {
    it('should destroy target and move to discard', () => {
      const card = mockCard({ owner: 1, isToken: false });
      let zones = deployToZone(emptyZones(), card, 'frontline');

      const state = mockGameState({
        players: [
          mockPlayerState(0),
          mockPlayerState(1, { zones }),
        ],
      });

      const effect: Effect = {
        type: 'destroy',
        target: { type: 'all_characters', side: 'enemy' },
      };

      const result = executeEffect(state, effect, ctx('src', 0));
      expect(result.newState.players[1]!.zones.frontline[0]).toBeNull();
      expect(result.newState.players[1]!.discardPile).toHaveLength(1);
    });
  });

  describe('bounce', () => {
    it('should return non-token to hand with reset stats', () => {
      const card = mockCard({
        owner: 1,
        isToken: false,
        currentHp: 1,
        baseHp: 5,
        currentAtk: 10,
        baseAtk: 2,
      });
      let zones = deployToZone(emptyZones(), card, 'frontline');

      const state = mockGameState({
        players: [
          mockPlayerState(0),
          mockPlayerState(1, { zones }),
        ],
      });

      const effect: Effect = {
        type: 'bounce',
        target: { type: 'all_characters', side: 'enemy' },
      };

      const result = executeEffect(state, effect, ctx('src', 0));
      expect(result.newState.players[1]!.zones.frontline[0]).toBeNull();
      expect(result.newState.players[1]!.hand).toHaveLength(1);
      expect(result.newState.players[1]!.hand[0]!.currentHp).toBe(5); // Reset
      expect(result.newState.players[1]!.hand[0]!.currentAtk).toBe(2); // Reset
    });

    it('should not duplicate card in discard pile', () => {
      const card = mockCard({ owner: 1, isToken: false });
      let zones = deployToZone(emptyZones(), card, 'frontline');

      const state = mockGameState({
        players: [
          mockPlayerState(0),
          mockPlayerState(1, { zones }),
        ],
      });

      const effect: Effect = {
        type: 'bounce',
        target: { type: 'all_characters', side: 'enemy' },
      };

      const result = executeEffect(state, effect, ctx('src', 0));
      // Card should be in hand but NOT in discard
      expect(result.newState.players[1]!.hand).toHaveLength(1);
      expect(result.newState.players[1]!.discardPile).toHaveLength(0);
    });

    it('should send equipment to discard when bouncing equipped card', () => {
      const equipment = mockCard({ name: 'Sword', cardType: 'E' as any, owner: 1, isToken: false });
      const card = mockCard({
        owner: 1,
        isToken: false,
        equipment,
      });
      let zones = deployToZone(emptyZones(), card, 'frontline');

      const state = mockGameState({
        players: [
          mockPlayerState(0),
          mockPlayerState(1, { zones }),
        ],
      });

      const effect: Effect = {
        type: 'bounce',
        target: { type: 'all_characters', side: 'enemy' },
      };

      const result = executeEffect(state, effect, ctx('src', 0));
      // Card should be in hand with equipment nulled (reset)
      expect(result.newState.players[1]!.hand).toHaveLength(1);
      expect(result.newState.players[1]!.hand[0]!.equipment).toBeNull();
      // Equipment should be in discard pile
      expect(result.newState.players[1]!.discardPile).toHaveLength(1);
      expect(result.newState.players[1]!.discardPile[0]!.instanceId).toBe(equipment.instanceId);
      // Should emit CARD_DESTROYED for the equipment
      expect(result.events.some(
        e => e.type === 'CARD_DESTROYED' && e.cardInstanceId === equipment.instanceId
      )).toBe(true);
    });

    it('should remove tokens from game (not to hand)', () => {
      const token = mockCard({ owner: 1, isToken: true });
      let zones = deployToZone(emptyZones(), token, 'frontline');

      const state = mockGameState({
        players: [
          mockPlayerState(0),
          mockPlayerState(1, { zones }),
        ],
      });

      const effect: Effect = {
        type: 'bounce',
        target: { type: 'all_characters', side: 'enemy' },
      };

      const result = executeEffect(state, effect, ctx('src', 0));
      expect(result.newState.players[1]!.hand).toHaveLength(0); // Token vanishes
    });
  });

  describe('composite', () => {
    it('should execute effects sequentially', () => {
      const card = mockCard({ currentAtk: 2, currentHp: 3, owner: 0 });
      let zones = deployToZone(emptyZones(), card, 'frontline');

      const state = mockGameState({
        players: [
          mockPlayerState(0, { zones }),
          mockPlayerState(1),
        ],
      });

      const effect: Effect = {
        type: 'composite',
        effects: [
          {
            type: 'modify_stats',
            modifier: { atk: 1 },
            target: { type: 'self' },
            duration: { type: 'permanent' },
          },
          {
            type: 'modify_stats',
            modifier: { hp: 2 },
            target: { type: 'self' },
            duration: { type: 'permanent' },
          },
        ],
      };

      const result = executeEffect(state, effect, ctx(card.instanceId, 0));
      const updated = result.newState.players[0]!.zones.frontline[0]!;
      expect(updated.currentAtk).toBe(3);
      expect(updated.currentHp).toBe(5);
    });
  });

  describe('move (effect)', () => {
    it('should move a character to a new zone', () => {
      const card = mockCard({ owner: 0 });
      let zones = deployToZone(emptyZones(), card, 'frontline');

      const state = mockGameState({
        players: [
          mockPlayerState(0, { zones }),
          mockPlayerState(1),
        ],
      });

      const effect: Effect = {
        type: 'move',
        target: { type: 'self' },
        destination: 'reserve',
      };

      const result = executeEffect(state, effect, ctx(card.instanceId, 0));
      // Card should be in reserve now
      expect(result.newState.players[0]!.zones.reserve.some(s => s !== null)).toBe(true);
      // Card should be gone from frontline
      expect(result.newState.players[0]!.zones.frontline[0]).toBeNull();
      expect(result.events.some(e => e.type === 'CARD_MOVED')).toBe(true);
    });
  });

  describe('gain_resource', () => {
    it('should add permanent resource cards to bank', () => {
      const state = mockGameState();

      const effect: Effect = {
        type: 'gain_resource',
        resourceType: 'mana',
        amount: 2,
      };

      const result = executeEffect(state, effect, ctx('src', 0));
      expect(result.newState.players[0]!.resourceBank).toHaveLength(2);
      expect(result.newState.players[0]!.resourceBank[0]!.resourceType).toBe('mana');
      expect(result.newState.players[0]!.resourceBank[0]!.exhausted).toBe(false);
    });

    it('should advance rng.counter to avoid duplicate resource IDs', () => {
      const state = mockGameState();

      const effect: Effect = {
        type: 'gain_resource',
        resourceType: 'mana',
        amount: 3,
      };

      const result = executeEffect(state, effect, ctx('src', 0));
      expect(result.newState.rng.counter).toBe(state.rng.counter + 3);
      // All resource IDs should be unique
      const ids = result.newState.players[0]!.resourceBank.map(r => r.instanceId);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('should add temporary resources when temporary flag is set', () => {
      const state = mockGameState();

      const effect: Effect = {
        type: 'gain_resource',
        resourceType: 'energy',
        amount: 1,
        temporary: true,
      };

      const result = executeEffect(state, effect, ctx('src', 0));
      expect(result.newState.players[0]!.temporaryResources).toHaveLength(1);
      expect(result.newState.players[0]!.temporaryResources[0]!.resourceType).toBe('energy');
    });
  });

  describe('deploy_token (unique IDs)', () => {
    it('should generate unique token IDs across multiple deployments', () => {
      const state = mockGameState();

      const effect: Effect = {
        type: 'deploy_token',
        token: { name: 'Sapling', atk: 1, hp: 1 },
        count: 2,
        zone: 'frontline',
      };

      const result = executeEffect(state, effect, ctx('src', 0));
      const tokens = result.newState.players[0]!.zones.frontline.filter(s => s !== null);
      expect(tokens).toHaveLength(2);
      expect(tokens[0]!.instanceId).not.toBe(tokens[1]!.instanceId);
    });
  });

  describe('heal (overheal)', () => {
    it('should emit CHARACTER_OVERHEALED when healing exceeds max HP', () => {
      const card = mockCard({ currentHp: 4, baseHp: 5, owner: 0 });
      let zones = deployToZone(emptyZones(), card, 'frontline');

      const state = mockGameState({
        players: [
          mockPlayerState(0, { zones }),
          mockPlayerState(1),
        ],
      });

      const effect: Effect = {
        type: 'heal',
        amount: { type: 'fixed', value: 5 },
        target: { type: 'self' },
      };

      const result = executeEffect(state, effect, ctx(card.instanceId, 0));
      expect(result.events.some(e => e.type === 'CHARACTER_HEALED')).toBe(true);
      expect(result.events.some(e => e.type === 'CHARACTER_OVERHEALED')).toBe(true);
      const overhealEvent = result.events.find(e => e.type === 'CHARACTER_OVERHEALED');
      expect(overhealEvent).toBeDefined();
      if (overhealEvent?.type === 'CHARACTER_OVERHEALED') {
        expect(overhealEvent.excess).toBe(4); // 5 heal - 1 missing HP = 4 excess
      }
    });
  });

  describe('discard (target resolution)', () => {
    it('should target enemy player when target side is enemy', () => {
      const state = mockGameState({
        players: [
          mockPlayerState(0),
          mockPlayerState(1, { hand: [mockCard({ owner: 1 })] }),
        ],
      });

      const effect: Effect = {
        type: 'discard',
        count: 1,
        target: { type: 'player', side: 'enemy' },
      };

      const result = executeEffect(state, effect, ctx('src', 0));
      expect(result.pendingChoice).toBeDefined();
      expect(result.pendingChoice?.playerId).toBe(1); // Enemy player
    });
  });

  describe('choose_one', () => {
    it('should return PendingChoice', () => {
      const state = mockGameState();

      const effect: Effect = {
        type: 'choose_one',
        options: [
          { label: 'Deal damage', effects: [] },
          { label: 'Draw card', effects: [] },
        ],
      };

      const result = executeEffect(state, effect, ctx('src', 0));
      expect(result.pendingChoice).toBeDefined();
      expect(result.pendingChoice?.type).toBe('choose_one');
      expect(result.pendingChoice?.options).toHaveLength(2);
    });
  });
});
