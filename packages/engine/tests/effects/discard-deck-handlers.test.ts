import { describe, it, expect, beforeEach } from 'vitest';
import { executeEffect } from '../../src/effects/interpreter.js';
import type { Effect } from '../../src/types/effects.js';
import type { EffectContext, GameState } from '../../src/types/game-state.js';
import {
  mockCard,
  mockGameState,
  mockPlayerState,
  resetInstanceCounter,
} from '../helpers/card-factory.js';

function ctx(
  controllerId: 0 | 1 = 0,
  selectedTargets?: readonly string[],
): EffectContext {
  return { sourceInstanceId: 'src', controllerId, triggerDepth: 0, selectedTargets };
}

describe('Discard / Deck effect handlers', () => {
  beforeEach(() => {
    resetInstanceCounter();
  });

  describe('return_from_discard', () => {
    it('returns a selected discard card to hand', () => {
      const disc = mockCard({ owner: 0, name: 'Buried', isToken: false });
      const state = mockGameState({
        players: [mockPlayerState(0, { discardPile: [disc] }), mockPlayerState(1)],
      });
      const effect: Effect = {
        type: 'return_from_discard',
        target: { type: 'target_card_in_discard', side: 'allied' },
        destination: 'hand',
      };
      const result = executeEffect(state, effect, ctx(0, [disc.instanceId]));
      expect(result.newState.players[0]!.discardPile).toHaveLength(0);
      expect(result.newState.players[0]!.hand.map(c => c.instanceId)).toContain(disc.instanceId);
    });

    it('returns a discard card to the battlefield, reset', () => {
      const disc = mockCard({ owner: 0, name: 'Risen', currentHp: 0, baseHp: 4, isToken: false });
      const state = mockGameState({
        players: [mockPlayerState(0, { discardPile: [disc] }), mockPlayerState(1)],
      });
      const effect: Effect = {
        type: 'return_from_discard',
        target: { type: 'target_card_in_discard', side: 'allied' },
        destination: 'battlefield',
      };
      const result = executeEffect(state, effect, ctx(0, [disc.instanceId]));
      expect(result.newState.players[0]!.discardPile).toHaveLength(0);
      const deployed = result.newState.players[0]!.zones.frontline[0]!;
      expect(deployed.instanceId).toBe(disc.instanceId);
      expect(deployed.currentHp).toBe(4);
      expect(result.events.some(e => e.type === 'CARD_DEPLOYED')).toBe(true);
    });
  });

  describe('search_deck', () => {
    it('moves a matching card from deck to hand and shuffles the rest', () => {
      const target = mockCard({ name: 'Wanted', cost: { mana: 1, energy: 0, flexible: 0 } });
      const filler1 = mockCard({ name: 'Big', cost: { mana: 9, energy: 0, flexible: 0 } });
      const filler2 = mockCard({ name: 'Big2', cost: { mana: 9, energy: 0, flexible: 0 } });
      const state = mockGameState({
        players: [
          mockPlayerState(0, { mainDeck: [filler1, target, filler2], hand: [] }),
          mockPlayerState(1),
        ],
      });
      const effect: Effect = {
        type: 'search_deck',
        filter: { maxCost: 2 },
        destination: 'hand',
      };
      const result = executeEffect(state, effect, ctx(0));
      expect(result.newState.players[0]!.hand.map(c => c.instanceId)).toContain(target.instanceId);
      expect(result.newState.players[0]!.mainDeck).toHaveLength(2);
      expect(result.newState.players[0]!.mainDeck.some(c => c.instanceId === target.instanceId)).toBe(false);
    });

    it('is deterministic — same seed produces same deck order', () => {
      const build = (): GameState =>
        mockGameState({
          players: [
            mockPlayerState(0, {
              mainDeck: [
                mockCard({ name: 'A' }),
                mockCard({ name: 'B' }),
                mockCard({ name: 'C' }),
                mockCard({ name: 'D' }),
              ],
            }),
            mockPlayerState(1),
          ],
        });
      const effect: Effect = { type: 'search_deck', filter: { maxCost: 1 }, destination: 'hand' };
      resetInstanceCounter();
      const r1 = executeEffect(build(), effect, ctx(0));
      resetInstanceCounter();
      const r2 = executeEffect(build(), effect, ctx(0));
      expect(r1.newState.players[0]!.mainDeck.map(c => c.name)).toEqual(
        r2.newState.players[0]!.mainDeck.map(c => c.name),
      );
    });

    it('castFreeIfCost: casts the found spell for free when at or under the threshold', () => {
      // Master Archivist CORE1-C-S-074: search for an Arcane spell; if it costs 1
      // or less, cast it for free. The free-cast resolves the spell's on-cast
      // effects and moves it to discard (spells discard after they resolve).
      const bolt = mockCard({
        name: 'Free Bolt',
        cardType: 'S',
        cost: { mana: 1, energy: 0, flexible: 0 },
        tags: ['Arcane'],
        abilities: [{
          type: 'triggered',
          trigger: { type: 'on_cast' },
          effects: [{ type: 'deal_damage', target: { type: 'hero', side: 'enemy' }, amount: { type: 'fixed', value: 3 } }],
        }],
      });
      const state = mockGameState({
        players: [mockPlayerState(0, { mainDeck: [bolt], hand: [] }), mockPlayerState(1)],
      });
      const effect: Effect = {
        type: 'search_deck',
        filter: { tag: 'Arcane', cardType: 'S' },
        destination: 'hand',
        castFreeIfCost: 1,
      };
      const before = state.players[1]!.hero.currentLp;
      const result = executeEffect(state, effect, ctx(0));
      // Free-cast fired: enemy hero took 3 damage.
      expect(result.newState.players[1]!.hero.currentLp).toBe(before - 3);
      // The spell resolved and went to discard, not lingering in hand.
      expect(result.newState.players[0]!.hand.some(c => c.instanceId === bolt.instanceId)).toBe(false);
      expect(result.newState.players[0]!.discardPile.some(c => c.instanceId === bolt.instanceId)).toBe(true);
      expect(result.events.some(e => e.type === 'SPELL_CAST')).toBe(true);
    });

    it('castFreeIfCost: leaves the found spell in hand uncast when above the threshold', () => {
      const pricey = mockCard({
        name: 'Pricey Bolt',
        cardType: 'S',
        cost: { mana: 3, energy: 0, flexible: 0 },
        tags: ['Arcane'],
        abilities: [{
          type: 'triggered',
          trigger: { type: 'on_cast' },
          effects: [{ type: 'deal_damage', target: { type: 'hero', side: 'enemy' }, amount: { type: 'fixed', value: 3 } }],
        }],
      });
      const state = mockGameState({
        players: [mockPlayerState(0, { mainDeck: [pricey], hand: [] }), mockPlayerState(1)],
      });
      const effect: Effect = {
        type: 'search_deck',
        filter: { tag: 'Arcane', cardType: 'S' },
        destination: 'hand',
        castFreeIfCost: 1,
      };
      const before = state.players[1]!.hero.currentLp;
      const result = executeEffect(state, effect, ctx(0));
      expect(result.newState.players[1]!.hero.currentLp).toBe(before);
      expect(result.newState.players[0]!.hand.some(c => c.instanceId === pricey.instanceId)).toBe(true);
    });
  });

  describe('shuffle_into_deck', () => {
    it('moves discard pile into the deck and empties discard', () => {
      const d1 = mockCard({ owner: 0, name: 'D1' });
      const d2 = mockCard({ owner: 0, name: 'D2' });
      const state = mockGameState({
        players: [
          mockPlayerState(0, { discardPile: [d1, d2], mainDeck: [mockCard({ name: 'Deck' })] }),
          mockPlayerState(1),
        ],
      });
      const effect: Effect = { type: 'shuffle_into_deck', source: 'discard' };
      const result = executeEffect(state, effect, ctx(0));
      expect(result.newState.players[0]!.discardPile).toHaveLength(0);
      expect(result.newState.players[0]!.mainDeck).toHaveLength(3);
      expect(result.newState.rng.counter).toBeGreaterThan(state.rng.counter);
    });
  });

  describe('cleanse', () => {
    it('removes status effects and negative modifiers from the target', () => {
      const card = mockCard({
        owner: 0,
        statusEffects: [{ statusType: 'stunned', value: 1, remainingTurns: 2 }],
        modifiers: [
          { id: 'm1', sourceInstanceId: 's', modifier: { atk: -2 }, duration: { type: 'permanent' } },
          { id: 'm2', sourceInstanceId: 's', modifier: { atk: 3 }, duration: { type: 'permanent' } },
        ],
      });
      const state = mockGameState({
        players: [
          mockPlayerState(0, { zones: { reserve: [null, null], frontline: [card, null, null], highGround: [null, null] } }),
          mockPlayerState(1),
        ],
      });
      const effect: Effect = { type: 'cleanse', target: { type: 'self' } };
      const result = executeEffect(state, effect, { sourceInstanceId: card.instanceId, controllerId: 0, triggerDepth: 0 });
      const cleaned = result.newState.players[0]!.zones.frontline[0]!;
      expect(cleaned.statusEffects).toHaveLength(0);
      expect(cleaned.modifiers).toHaveLength(1);
      expect(cleaned.modifiers[0]!.modifier.atk).toBe(3);
    });
  });

  describe('deploy_from_deck', () => {
    it('deploys a matching character from deck to a legal slot', () => {
      const char = mockCard({ name: 'Recruit', cardType: 'C', cost: { mana: 1, energy: 0, flexible: 0 } });
      const spell = mockCard({ name: 'Spell', cardType: 'S' });
      const state = mockGameState({
        players: [mockPlayerState(0, { mainDeck: [spell, char] }), mockPlayerState(1)],
      });
      const effect: Effect = { type: 'deploy_from_deck', filter: { maxCost: 2 } };
      const result = executeEffect(state, effect, ctx(0));
      const front = result.newState.players[0]!.zones.frontline.filter(s => s !== null);
      expect(front).toHaveLength(1);
      expect(front[0]!.instanceId).toBe(char.instanceId);
      expect(result.newState.players[0]!.mainDeck.some(c => c.instanceId === char.instanceId)).toBe(false);
    });

    it('does nothing when no character matches', () => {
      const spell = mockCard({ name: 'Spell', cardType: 'S' });
      const state = mockGameState({
        players: [mockPlayerState(0, { mainDeck: [spell] }), mockPlayerState(1)],
      });
      const effect: Effect = { type: 'deploy_from_deck', filter: {} };
      const result = executeEffect(state, effect, ctx(0));
      expect(result.newState).toBe(state);
    });

    it('honors costRelativeTo:destroyed_card — caps deploy cost at destroyedCost + offset', () => {
      // Rampant Evolution CORE1-S-V-117: destroy an allied character, then deploy
      // a character whose cost <= destroyed cost + 1. The just-destroyed card is
      // the most-recent entry in the controller's discard pile (cost 2).
      const destroyed = mockCard({ owner: 0, name: 'Sacrificed', cardType: 'C', cost: { mana: 2, energy: 0, flexible: 0 }, isToken: false });
      const cheap = mockCard({ name: 'Cheap', cardType: 'C', cost: { mana: 3, energy: 0, flexible: 0 } });
      const tooBig = mockCard({ name: 'TooBig', cardType: 'C', cost: { mana: 4, energy: 0, flexible: 0 } });
      const state = mockGameState({
        players: [
          mockPlayerState(0, { discardPile: [destroyed], mainDeck: [tooBig, cheap] }),
          mockPlayerState(1),
        ],
      });
      const effect: Effect = {
        type: 'deploy_from_deck',
        filter: { cardType: 'C', costRelativeTo: { reference: 'destroyed_card', offset: 1 } },
      };
      const result = executeEffect(state, effect, ctx(0));
      const front = result.newState.players[0]!.zones.frontline.filter(s => s !== null);
      expect(front).toHaveLength(1);
      // cost 3 <= 2 + 1 deploys; cost 4 is excluded even though it comes first.
      expect(front[0]!.instanceId).toBe(cheap.instanceId);
    });

    it('costRelativeTo: deploys nothing when every candidate exceeds the cap', () => {
      const destroyed = mockCard({ owner: 0, name: 'Sacrificed', cardType: 'C', cost: { mana: 1, energy: 0, flexible: 0 }, isToken: false });
      const tooBig = mockCard({ name: 'TooBig', cardType: 'C', cost: { mana: 5, energy: 0, flexible: 0 } });
      const state = mockGameState({
        players: [
          mockPlayerState(0, { discardPile: [destroyed], mainDeck: [tooBig] }),
          mockPlayerState(1),
        ],
      });
      const effect: Effect = {
        type: 'deploy_from_deck',
        filter: { cardType: 'C', costRelativeTo: { reference: 'destroyed_card', offset: 1 } },
      };
      const result = executeEffect(state, effect, ctx(0));
      expect(result.newState).toBe(state);
    });

    it('costRelativeTo:cast_spell is an intentional no-op (YAGNI) — constraint does not apply', () => {
      // The 'cast_spell' reference exists in the type union (targets.ts) but no
      // card in the data set uses it on a deploy_from_deck filter — only
      // 'destroyed_card' is wired. resolveReferenceCost returns undefined for
      // 'cast_spell', so applyFilter treats the cost constraint as absent: any
      // matching character deploys regardless of cost. This test documents that
      // the no-op is deliberate, not a latent bug. Wire real semantics only once
      // a card actually needs them.
      const expensive = mockCard({ name: 'Expensive', cardType: 'C', cost: { mana: 9, energy: 0, flexible: 0 } });
      const state = mockGameState({
        players: [mockPlayerState(0, { mainDeck: [expensive] }), mockPlayerState(1)],
      });
      const effect: Effect = {
        type: 'deploy_from_deck',
        filter: { cardType: 'C', costRelativeTo: { reference: 'cast_spell', offset: 0 } },
      };
      const result = executeEffect(state, effect, ctx(0));
      const front = result.newState.players[0]!.zones.frontline.filter(s => s !== null);
      expect(front).toHaveLength(1);
      expect(front[0]!.instanceId).toBe(expensive.instanceId);
    });
  });

  describe('copy_card', () => {
    it('creates a token copy in hand with a fresh id', () => {
      const disc = mockCard({ owner: 0, name: 'Original', isToken: false });
      const state = mockGameState({
        players: [mockPlayerState(0, { discardPile: [disc] }), mockPlayerState(1)],
      });
      const effect: Effect = { type: 'copy_card', source: 'discard', destination: 'hand' };
      const result = executeEffect(state, effect, ctx(0));
      const hand = result.newState.players[0]!.hand;
      expect(hand).toHaveLength(1);
      expect(hand[0]!.isToken).toBe(true);
      expect(hand[0]!.instanceId).not.toBe(disc.instanceId);
      expect(hand[0]!.name).toBe('Original');
      // Original remains in discard
      expect(result.newState.players[0]!.discardPile).toHaveLength(1);
    });
  });

  describe('scry', () => {
    it('pick_and_remainder: picks to hand, sends remainder to bottom', () => {
      const top = mockCard({ name: 'Top' });
      const mid = mockCard({ name: 'Mid' });
      const bottom = mockCard({ name: 'Bottom' });
      const state = mockGameState({
        players: [mockPlayerState(0, { mainDeck: [top, mid, bottom] }), mockPlayerState(1)],
      });
      const effect: Effect = {
        type: 'scry',
        lookCount: 2,
        action: { type: 'pick_and_remainder', pickCount: 1, pickTo: 'hand', remainder: 'bottom' },
      };
      const result = executeEffect(state, effect, ctx(0));
      expect(result.newState.players[0]!.hand.map(c => c.name)).toEqual(['Top']);
      // remainder (Mid) goes to bottom after Bottom
      expect(result.newState.players[0]!.mainDeck.map(c => c.name)).toEqual(['Bottom', 'Mid']);
    });

    it('pick_and_remainder remainder:"shuffle" — shuffles remainder back via rng (deterministic)', () => {
      const build = (): GameState =>
        mockGameState({
          players: [
            mockPlayerState(0, {
              mainDeck: [
                mockCard({ name: 'T1' }),
                mockCard({ name: 'T2' }),
                mockCard({ name: 'R1' }),
                mockCard({ name: 'R2' }),
                mockCard({ name: 'R3' }),
              ],
            }),
            mockPlayerState(1),
          ],
        });
      const effect: Effect = {
        type: 'scry',
        lookCount: 2,
        action: { type: 'pick_and_remainder', pickCount: 1, pickTo: 'hand', remainder: 'shuffle' },
      };
      resetInstanceCounter();
      const base = build();
      const r1 = executeEffect(base, effect, ctx(0));
      resetInstanceCounter();
      const r2 = executeEffect(build(), effect, ctx(0));
      // Faithful shuffle advances rng (not a no-op) and stays deterministic.
      expect(r1.newState.rng.counter).toBeGreaterThan(base.rng.counter);
      expect(r1.newState.players[0]!.mainDeck.map(c => c.name))
        .toEqual(r2.newState.players[0]!.mainDeck.map(c => c.name));
      // The unpicked looked card (T2) is shuffled back into the deck, not lost.
      const deckNames = r1.newState.players[0]!.mainDeck.map(c => c.name);
      expect(deckNames).toContain('T2');
      expect(r1.newState.players[0]!.mainDeck).toHaveLength(4);
    });

    it('distribute: routes looked cards per destinations', () => {
      const a = mockCard({ name: 'A' });
      const b = mockCard({ name: 'B' });
      const c = mockCard({ name: 'C' });
      const state = mockGameState({
        players: [mockPlayerState(0, { mainDeck: [a, b, c] }), mockPlayerState(1)],
      });
      const effect: Effect = {
        type: 'scry',
        lookCount: 2,
        action: { type: 'distribute', destinations: ['hand', 'discard'] },
      };
      const result = executeEffect(state, effect, ctx(0));
      expect(result.newState.players[0]!.hand.map(c => c.name)).toEqual(['A']);
      expect(result.newState.players[0]!.discardPile.map(c => c.name)).toEqual(['B']);
      expect(result.newState.players[0]!.mainDeck.map(c => c.name)).toEqual(['C']);
    });
  });
});
