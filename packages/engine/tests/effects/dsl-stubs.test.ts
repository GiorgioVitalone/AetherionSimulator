/**
 * Wave 7 — DSL stub resolution tests.
 * Covers the nodes that previously zeroed-out / mis-resolved real cards:
 *  - `dice` AmountExpr (seeded roll; Arcane Barrage 1d4)
 *  - `random` TargetExpr (seeded selection; Ruinous Imp random discard)
 *  - `event_value` AmountExpr (Pendant of Mercy heal-equal-to-damage)
 *  - `event_context` Condition (RIA-09 temp-resource flags)
 *  - `triggering_card_cost` Condition (Lyria Arcane Convergence)
 *  - `discard` + `each_player` (Soulflay: BOTH players discard)
 *  - latent nodes: target_equipment / adjacent_to_self / copy_of, move any/adjacent
 *
 * Determinism is asserted explicitly for the RNG-backed nodes.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { executeEffect } from '../../src/effects/interpreter.js';
import { resolveTargets } from '../../src/effects/target-resolver.js';
import { evaluateCondition } from '../../src/effects/condition-evaluator.js';
import { dispatchTriggers } from '../../src/runtime/dispatch.js';
import {
  registerCardTriggers,
  getAllRegisteredTriggers,
  resetRegistrationCounter,
} from '../../src/events/trigger-registry.js';
import { deployToZone } from '../../src/zones/zone-manager.js';
import type { Effect } from '../../src/types/effects.js';
import type { Condition } from '../../src/types/conditions.js';
import type { AbilityDSL } from '../../src/types/ability.js';
import type { EffectContext, GameState, GameEvent } from '../../src/types/game-state.js';
import {
  mockCard,
  mockGameState,
  mockPlayerState,
  resetInstanceCounter,
  emptyZones,
} from '../helpers/card-factory.js';

function ctx(sourceId: string, controllerId: 0 | 1 = 0, extra?: Partial<EffectContext>): EffectContext {
  return { sourceInstanceId: sourceId, controllerId, triggerDepth: 0, ...extra };
}

describe('Wave 7 — DSL stub resolution', () => {
  beforeEach(() => {
    resetInstanceCounter();
    resetRegistrationCounter();
  });

  describe('dice AmountExpr (seeded)', () => {
    function diceState(seed: number): { state: GameState; targets: string[]; src: string } {
      const src = mockCard({ owner: 0 });
      const t1 = mockCard({ owner: 1, currentHp: 9 });
      const t2 = mockCard({ owner: 1, currentHp: 9 });
      const t3 = mockCard({ owner: 1, currentHp: 9 });
      const t4 = mockCard({ owner: 1, currentHp: 9 });
      const p0 = deployToZone(emptyZones(), src, 'frontline');
      let p1 = deployToZone(emptyZones(), t1, 'frontline');
      p1 = deployToZone(p1, t2, 'frontline');
      p1 = deployToZone(p1, t3, 'reserve');
      p1 = deployToZone(p1, t4, 'reserve');
      const state = mockGameState({
        rng: { seed, counter: 0 },
        players: [mockPlayerState(0, { zones: p0 }), mockPlayerState(1, { zones: p1 })],
      });
      return { state, targets: [t1, t2, t3, t4].map(c => c.instanceId), src: src.instanceId };
    }

    const barrage: Effect = {
      type: 'deal_damage',
      amount: { type: 'fixed', value: 2 },
      target: { side: 'enemy', type: 'up_to', count: { type: 'dice', count: 1, sides: 4 } },
    };

    it('rolls 1d4 into the up_to max (between 1 and 4 targets hit)', () => {
      const { state, src } = diceState(7);
      const ctxWithTargets = ctx(src, 0);
      // The auto-resolver path is exercised via dispatch; here drive the pendingChoice
      // directly: the maxSelections reflects the roll.
      const res = executeEffect(state, barrage, ctxWithTargets);
      // up_to with a dice count returns a pendingChoice whose maxSelections == roll.
      expect(res.pendingChoice).toBeDefined();
      const max = res.pendingChoice!.maxSelections;
      expect(max).toBeGreaterThanOrEqual(1);
      expect(max).toBeLessThanOrEqual(4);
    });

    it('is deterministic — same seed yields the same roll', () => {
      const a = executeEffect(diceState(123).state, barrage, ctx('x', 0));
      const b = executeEffect(diceState(123).state, barrage, ctx('x', 0));
      expect(a.pendingChoice!.maxSelections).toBe(b.pendingChoice!.maxSelections);
    });

    it('advances the RNG counter (roll consumes the seeded stream)', () => {
      const { state, src } = diceState(55);
      const res = executeEffect(state, barrage, ctx(src, 0));
      expect(res.newState.rng.counter).toBeGreaterThan(state.rng.counter);
    });
  });

  describe('event_value AmountExpr', () => {
    it('heals the amount carried by the triggering event', () => {
      const self = mockCard({ owner: 0, currentHp: 1, baseHp: 5 });
      const p0 = deployToZone(emptyZones(), self, 'frontline');
      const state = mockGameState({ players: [mockPlayerState(0, { zones: p0 }), mockPlayerState(1)] });
      const heal: Effect = { type: 'heal', amount: { type: 'event_value', event: 'damage_taken' }, target: { type: 'self' } };
      const res = executeEffect(state, heal, ctx(self.instanceId, 0, { eventValue: 3 }));
      const healed = res.newState.players[0]!.zones.frontline.find(c => c?.instanceId === self.instanceId);
      expect(healed!.currentHp).toBe(4);
    });

    it('heals 0 when no event value is present (backwards-safe)', () => {
      const self = mockCard({ owner: 0, currentHp: 1, baseHp: 5 });
      const p0 = deployToZone(emptyZones(), self, 'frontline');
      const state = mockGameState({ players: [mockPlayerState(0, { zones: p0 }), mockPlayerState(1)] });
      const heal: Effect = { type: 'heal', amount: { type: 'event_value', event: 'damage_taken' }, target: { type: 'self' } };
      const res = executeEffect(state, heal, ctx(self.instanceId, 0));
      const c = res.newState.players[0]!.zones.frontline.find(x => x?.instanceId === self.instanceId);
      expect(c!.currentHp).toBe(1);
    });
  });

  describe('event_context Condition', () => {
    it('used_temporary_resource reads the per-event context flag', () => {
      const src = mockCard({ owner: 0 });
      const p0 = deployToZone(emptyZones(), src, 'frontline');
      const state = mockGameState({ players: [mockPlayerState(0, { zones: p0 }), mockPlayerState(1)] });
      const cond: Condition = { type: 'event_context', check: 'used_temporary_resource' };
      expect(evaluateCondition(state, cond, ctx(src.instanceId, 0, { usedTemporaryResource: true }))).toBe(true);
      expect(evaluateCondition(state, cond, ctx(src.instanceId, 0))).toBe(false);
    });

    it('gained_temporary_resource_this_turn reads the per-player turnState flag', () => {
      const cond: Condition = { type: 'event_context', check: 'gained_temporary_resource_this_turn' };
      const yes = mockGameState({
        turnState: { discardedForEnergy: false, firstPlayerFirstTurn: false, gainedTemporaryResource: [true, false] },
      });
      const no = mockGameState();
      expect(evaluateCondition(yes, cond, ctx('x', 0))).toBe(true);
      expect(evaluateCondition(yes, cond, ctx('x', 1))).toBe(false);
      expect(evaluateCondition(no, cond, ctx('x', 0))).toBe(false);
    });

    it('gain_resource (temporary) sets gainedTemporaryResource for the controller', () => {
      const src = mockCard({ owner: 0 });
      const p0 = deployToZone(emptyZones(), src, 'frontline');
      const state = mockGameState({ players: [mockPlayerState(0, { zones: p0 }), mockPlayerState(1)] });
      const gain: Effect = { type: 'gain_resource', resourceType: 'energy', amount: 1, temporary: true };
      const res = executeEffect(state, gain, ctx(src.instanceId, 0));
      expect(res.newState.turnState.gainedTemporaryResource?.[0]).toBe(true);
      expect(res.newState.turnState.gainedTemporaryResource?.[1]).toBe(false);
    });
  });

  describe('triggering_card_cost Condition', () => {
    it('is true when a triggering card cost is threaded', () => {
      const cond: Condition = { type: 'triggering_card_cost', comparison: 'less_equal', value: 3 };
      expect(evaluateCondition(mockGameState(), cond, ctx('x', 0, { triggeringCardCost: 3 }))).toBe(true);
    });
    it('is false when no triggering card is known', () => {
      const cond: Condition = { type: 'triggering_card_cost', comparison: 'less_equal', value: 3 };
      expect(evaluateCondition(mockGameState(), cond, ctx('x', 0))).toBe(false);
    });
  });

  describe('random TargetExpr (seeded discard)', () => {
    function imp(seed: number): GameState {
      const h1 = mockCard({ owner: 1, name: 'A' });
      const h2 = mockCard({ owner: 1, name: 'B' });
      const h3 = mockCard({ owner: 1, name: 'C' });
      return mockGameState({
        rng: { seed, counter: 0 },
        players: [mockPlayerState(0), mockPlayerState(1, { hand: [h1, h2, h3] })],
      });
    }
    const discard: Effect = { type: 'discard', count: 1, target: { type: 'random', side: 'enemy', zone: 'hand' } };

    it('discards exactly one random card from the enemy hand (no choice)', () => {
      const res = executeEffect(imp(9), discard, ctx('src', 0));
      expect(res.pendingChoice).toBeUndefined();
      expect(res.newState.players[1]!.hand).toHaveLength(2);
      expect(res.newState.players[1]!.discardPile).toHaveLength(1);
      expect(res.events.filter(e => e.type === 'CARD_DISCARDED')).toHaveLength(1);
    });

    it('is deterministic — same seed discards the same card (by position)', () => {
      // Rebuild with a reset counter so both states have identical card identities;
      // the seeded RNG must then pick the same card.
      resetInstanceCounter();
      const a = executeEffect(imp(9), discard, ctx('src', 0));
      resetInstanceCounter();
      const b = executeEffect(imp(9), discard, ctx('src', 0));
      expect(a.newState.players[1]!.discardPile[0]!.name)
        .toBe(b.newState.players[1]!.discardPile[0]!.name);
    });
  });

  describe('discard + each_player', () => {
    it('makes BOTH players discard', () => {
      const a = mockCard({ owner: 0, name: 'p0a' });
      const b = mockCard({ owner: 1, name: 'p1a' });
      const state = mockGameState({
        players: [mockPlayerState(0, { hand: [a] }), mockPlayerState(1, { hand: [b] })],
      });
      const eff: Effect = { type: 'discard', count: 1, target: { type: 'each_player' } };
      // First pass discards the opponent and opens the controller's choice.
      const first = executeEffect(state, eff, ctx('src', 0));
      expect(first.newState.players[1]!.hand).toHaveLength(0);
      expect(first.pendingChoice).toBeDefined();
      expect(first.pendingChoice!.playerId).toBe(0);
      // Resolve the controller's choice.
      const second = executeEffect(first.newState, eff, ctx('src', 0, { selectedTargets: [a.instanceId] }));
      expect(second.newState.players[0]!.hand).toHaveLength(0);
    });
  });

  describe('latent TargetExpr nodes', () => {
    it('target_equipment surfaces a holder\'s equipment', () => {
      const equip = mockCard({ owner: 0, cardType: 'E', name: 'Sword' });
      const holder = mockCard({ owner: 0, equipment: equip });
      const p0 = deployToZone(emptyZones(), holder, 'frontline');
      const state = mockGameState({ players: [mockPlayerState(0, { zones: p0 }), mockPlayerState(1)] });
      const res = resolveTargets(state, { type: 'target_equipment', side: 'allied' }, ctx(holder.instanceId, 0));
      expect(res.resolved).toBe(false);
      if (!res.resolved) expect(res.pendingChoice.options[0]!.id).toBe(equip.instanceId);
    });

    it('adjacent_to_self resolves cards in zones adjacent to the source', () => {
      const self = mockCard({ owner: 0 });
      const ally = mockCard({ owner: 0 });
      let p0 = deployToZone(emptyZones(), self, 'frontline');
      p0 = deployToZone(p0, ally, 'reserve');
      const state = mockGameState({ players: [mockPlayerState(0, { zones: p0 }), mockPlayerState(1)] });
      const res = resolveTargets(state, { type: 'adjacent_to_self' }, ctx(self.instanceId, 0));
      expect(res.resolved).toBe(true);
      if (res.resolved) expect(res.targetIds).toContain(ally.instanceId);
    });

    it('copy_of resolves its base target', () => {
      const self = mockCard({ owner: 0 });
      const p0 = deployToZone(emptyZones(), self, 'frontline');
      const state = mockGameState({ players: [mockPlayerState(0, { zones: p0 }), mockPlayerState(1)] });
      const res = resolveTargets(state, { type: 'copy_of', base: { type: 'self' } }, ctx(self.instanceId, 0));
      expect(res.resolved).toBe(true);
      if (res.resolved) expect(res.targetIds).toEqual([self.instanceId]);
    });
  });

  describe('dispatch threads the triggering event into context', () => {
    it('event_value: an on_take_damage heal reads the DAMAGE_DEALT amount (Pendant of Mercy)', () => {
      const healOnDamage: AbilityDSL = {
        type: 'triggered',
        trigger: { type: 'on_take_damage' },
        effects: [{ type: 'heal', amount: { type: 'event_value', event: 'damage_taken' }, target: { type: 'self' } }],
      };
      const wearer = mockCard({ owner: 0, currentHp: 2, baseHp: 5, abilities: [healOnDamage] });
      const p0 = deployToZone(emptyZones(), wearer, 'frontline');
      const base = mockGameState({ players: [mockPlayerState(0, { zones: p0 }), mockPlayerState(1)] });
      const registered = registerCardTriggers(base, wearer.instanceId);
      const pool = getAllRegisteredTriggers(registered);
      const dmg: GameEvent = { type: 'DAMAGE_DEALT', sourceId: 'enemy', targetId: wearer.instanceId, amount: 3 };
      const res = dispatchTriggers(registered, [dmg], 0, pool);
      const healed = res.newState.players[0]!.zones.frontline.find(c => c?.instanceId === wearer.instanceId);
      expect(healed!.currentHp).toBe(5); // 2 + 3 healed (capped at baseHp 5)
    });

    it('triggering_card_cost: an on_spell_cast ability gated by the cast spell fires (Lyria)', () => {
      const drawOnSpell: AbilityDSL = {
        type: 'triggered',
        trigger: { type: 'on_spell_cast', side: 'allied' },
        effects: [{ type: 'draw_cards', count: { type: 'fixed', value: 1 }, player: 'allied' }],
        condition: { type: 'triggering_card_cost', comparison: 'less_equal', value: 3 },
      };
      const lyria = mockCard({ owner: 0, name: 'Lyria', abilities: [drawOnSpell] });
      const spell = mockCard({ owner: 0, cardType: 'S', cost: { mana: 3, energy: 0, flexible: 0 } });
      const p0 = deployToZone(emptyZones(), lyria, 'frontline');
      const base = mockGameState({
        players: [
          mockPlayerState(0, { zones: p0, discardPile: [spell], mainDeck: [mockCard({ owner: 0 })] }),
          mockPlayerState(1),
        ],
      });
      const registered = registerCardTriggers(base, lyria.instanceId);
      const pool = getAllRegisteredTriggers(registered);
      const cast: GameEvent = { type: 'SPELL_CAST', cardInstanceId: spell.instanceId, playerId: 0 };
      const res = dispatchTriggers(registered, [cast], 0, pool);
      expect(res.newState.players[0]!.hand).toHaveLength(1);
    });
  });

  describe('latent move destinations', () => {
    it('move "any" relocates to a zone with an open slot', () => {
      const c = mockCard({ owner: 0 });
      const p0 = deployToZone(emptyZones(), c, 'reserve');
      const state = mockGameState({ players: [mockPlayerState(0, { zones: p0 }), mockPlayerState(1)] });
      const eff: Effect = { type: 'move', target: { type: 'self' }, destination: 'any' };
      const res = executeEffect(state, eff, ctx(c.instanceId, 0));
      const moved = res.events.find(e => e.type === 'CARD_MOVED');
      expect(moved).toBeDefined();
    });

    it('move "adjacent_to_current" relocates to an adjacent zone', () => {
      const c = mockCard({ owner: 0 });
      const p0 = deployToZone(emptyZones(), c, 'reserve');
      const state = mockGameState({ players: [mockPlayerState(0, { zones: p0 }), mockPlayerState(1)] });
      const eff: Effect = { type: 'move', target: { type: 'self' }, destination: 'adjacent_to_current' };
      const res = executeEffect(state, eff, ctx(c.instanceId, 0));
      const moved = res.events.find(e => e.type === 'CARD_MOVED');
      expect(moved && moved.type === 'CARD_MOVED' && moved.toZone).toBe('frontline');
    });
  });
});
