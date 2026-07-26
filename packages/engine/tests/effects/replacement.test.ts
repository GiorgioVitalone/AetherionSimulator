/**
 * replacement tests — event-replacement hooks in the damage/destruction pipeline.
 *
 * A `replacement` effect registers an ActiveReplacement on its source card. The
 * damage/destruction path then consults it:
 *   - on_would_take_damage{reduction}: incoming damage is reduced before HP drops.
 *   - on_would_be_destroyed: the card runs `instead` effects instead of dying.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { executeEffect } from '../../src/effects/interpreter.js';
import { applyDamageReplacements } from '../../src/effects/replacement-handler.js';
import { deployToZone, findCard } from '../../src/zones/zone-manager.js';
import type { Effect } from '../../src/types/effects.js';
import type { EffectContext, CardInstance } from '../../src/types/game-state.js';
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

const registerReplacement = (over: Partial<Extract<Effect, { type: 'replacement' }>>): Effect => ({
  type: 'replacement',
  replaces: { type: 'on_would_take_damage', reduction: 1 },
  instead: [],
  ...over,
});

const dealSelf = (value: number): Effect => ({
  type: 'deal_damage',
  amount: { type: 'fixed', value },
  target: { type: 'self' },
});

function findById(state: ReturnType<typeof mockGameState>, id: string): CardInstance | null {
  for (const p of state.players) {
    const loc = findCard(p.zones, id);
    if (loc !== null) return loc.card;
  }
  return null;
}

describe('replacement effects', () => {
  beforeEach(() => {
    resetInstanceCounter();
  });

  it('registers an active replacement on the source card', () => {
    const card = mockCard({ owner: 0 });
    const zones = deployToZone(emptyZones(), card, 'frontline');
    const state = mockGameState({ players: [mockPlayerState(0, { zones }), mockPlayerState(1)] });

    const result = executeEffect(state, registerReplacement({}), ctx(card.instanceId));
    const updated = findById(result.newState, card.instanceId);
    expect(updated?.activeReplacements).toHaveLength(1);
    expect(updated?.activeReplacements?.[0]?.replaces.type).toBe('on_would_take_damage');
  });

  it('a damage-reduction replacement lowers incoming damage', () => {
    const card = mockCard({ owner: 0, currentHp: 5 });
    const zones = deployToZone(emptyZones(), card, 'frontline');
    let state = mockGameState({ players: [mockPlayerState(0, { zones }), mockPlayerState(1)] });

    state = executeEffect(state, registerReplacement({
      replaces: { type: 'on_would_take_damage', reduction: 2 },
    }), ctx(card.instanceId)).newState;

    const result = executeEffect(state, dealSelf(3), ctx(card.instanceId));
    // 3 incoming - 2 reduction = 1 damage; 5 -> 4
    expect(findById(result.newState, card.instanceId)?.currentHp).toBe(4);
    const dmg = result.events.find(e => e.type === 'DAMAGE_DEALT');
    expect(dmg && 'amount' in dmg ? dmg.amount : null).toBe(1);
  });

  it('a replacement with no reduction value prevents all damage', () => {
    const card = mockCard({ owner: 0, currentHp: 4 });
    const zones = deployToZone(emptyZones(), card, 'frontline');
    let state = mockGameState({ players: [mockPlayerState(0, { zones }), mockPlayerState(1)] });

    state = executeEffect(state, registerReplacement({
      replaces: { type: 'on_would_take_damage' },
    }), ctx(card.instanceId)).newState;

    const result = executeEffect(state, dealSelf(9), ctx(card.instanceId));
    expect(findById(result.newState, card.instanceId)?.currentHp).toBe(4);
  });

  it('a "would be destroyed" replacement fires instead of destruction (return to hand)', () => {
    const card = mockCard({ owner: 0, currentHp: 2, isToken: false });
    const zones = deployToZone(emptyZones(), card, 'frontline');
    let state = mockGameState({ players: [mockPlayerState(0, { zones }), mockPlayerState(1)] });

    // would be destroyed -> instead bounce self to hand
    state = executeEffect(state, registerReplacement({
      replaces: { type: 'on_would_be_destroyed' },
      instead: [{ type: 'bounce', target: { type: 'self' } }],
    }), ctx(card.instanceId)).newState;

    const result = executeEffect(state, dealSelf(5), ctx(card.instanceId));

    // Not in any zone, not in discard, IS in hand.
    expect(findById(result.newState, card.instanceId)).toBeNull();
    expect(result.newState.players[0].discardPile.some(c => c.instanceId === card.instanceId)).toBe(false);
    expect(result.newState.players[0].hand.some(c => c.instanceId === card.instanceId)).toBe(true);
    expect(result.events.some(e => e.type === 'CARD_DESTROYED' && e.cardInstanceId === card.instanceId)).toBe(false);
    expect(result.events.some(e => e.type === 'CARD_BOUNCED')).toBe(true);
  });

  it('destroy effect also consults the "would be destroyed" replacement', () => {
    const card = mockCard({ owner: 0, currentHp: 3 });
    const zones = deployToZone(emptyZones(), card, 'frontline');
    let state = mockGameState({ players: [mockPlayerState(0, { zones }), mockPlayerState(1)] });

    state = executeEffect(state, registerReplacement({
      replaces: { type: 'on_would_be_destroyed' },
      instead: [{ type: 'bounce', target: { type: 'self' } }],
    }), ctx(card.instanceId)).newState;

    const destroy: Effect = { type: 'destroy', target: { type: 'self' } };
    const result = executeEffect(state, destroy, ctx(card.instanceId));
    expect(result.newState.players[0].hand.some(c => c.instanceId === card.instanceId)).toBe(true);
    expect(result.events.some(e => e.type === 'CARD_DESTROYED')).toBe(false);
  });

  it('a destruction replacement can exile the card into the durable ledger', () => {
    const card = mockCard({ owner: 0, currentHp: 2, isToken: false });
    const zones = deployToZone(emptyZones(), card, 'frontline');
    let state = mockGameState({
      config: { terminationMode: 'turn_cap', stateBasedActions: true },
      players: [mockPlayerState(0, { zones }), mockPlayerState(1)],
    });
    state = executeEffect(
      state,
      registerReplacement({
        replaces: { type: 'on_would_be_destroyed' },
        instead: [{ type: 'exile', target: { type: 'self' } }],
      }),
      ctx(card.instanceId),
    ).newState;

    const result = executeEffect(state, dealSelf(5), ctx(card.instanceId));
    expect(findById(result.newState, card.instanceId)).toBeNull();
    expect(result.newState.players[0].discardPile).toHaveLength(0);
    expect(result.newState.players[0].exile).toMatchObject([
      {
        instanceId: card.instanceId,
        ownerPlayerId: 0,
        cause: 'effect',
      },
    ]);
    expect(result.events.some((event) => event.type === 'CARD_EXILED')).toBe(true);
  });

  it('oncePerTurn replacement only fires once', () => {
    const card = mockCard({ owner: 0, currentHp: 10 });
    const zones = deployToZone(emptyZones(), card, 'frontline');
    let state = mockGameState({ players: [mockPlayerState(0, { zones }), mockPlayerState(1)] });

    state = executeEffect(state, registerReplacement({
      replaces: { type: 'on_would_take_damage', reduction: 5 },
      oncePerTurn: true,
    }), ctx(card.instanceId)).newState;

    // First hit: 4 - 5 -> 0 damage; hp stays 10. Replacement consumed.
    state = executeEffect(state, dealSelf(4), ctx(card.instanceId)).newState;
    expect(findById(state, card.instanceId)?.currentHp).toBe(10);

    // Second hit: replacement already used -> full 4 damage; 10 -> 6.
    state = executeEffect(state, dealSelf(4), ctx(card.instanceId)).newState;
    expect(findById(state, card.instanceId)?.currentHp).toBe(6);
  });

  it('applyDamageReplacements is deterministic and pure', () => {
    const card = mockCard({
      owner: 0,
      activeReplacements: [{
        id: 'r1',
        sourceInstanceId: 'x',
        replaces: { type: 'on_would_take_damage', reduction: 3 },
        instead: [],
        oncePerTurn: false,
        usedThisTurn: false,
      }],
    });
    const a = applyDamageReplacements(card, 7);
    const b = applyDamageReplacements(card, 7);
    expect(a.amount).toBe(4);
    expect(a).toEqual(b);
    // input not mutated
    expect(card.activeReplacements?.[0]?.usedThisTurn).toBe(false);
  });
});
