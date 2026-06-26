import { describe, it, expect, beforeEach } from 'vitest';
import { resolveCombat } from '../../src/combat/combat-resolver.js';
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

describe('Volatile — exiled (not discarded) on destruction (Rulebook 16)', () => {
  beforeEach(() => {
    resetInstanceCounter();
  });

  it('combat: a destroyed Volatile defender is exiled, not added to the discard pile', () => {
    const attacker = mockCard({ owner: 0, currentAtk: 5, currentHp: 5 });
    const volatileDefender = mockCard({
      owner: 1,
      currentAtk: 0,
      currentHp: 2,
      traits: ['volatile'],
    });
    let p0 = emptyZones();
    p0 = deployToZone(p0, attacker, 'frontline');
    let p1 = emptyZones();
    p1 = deployToZone(p1, volatileDefender, 'frontline');
    const state = mockGameState({
      players: [
        mockPlayerState(0, { zones: p0 }),
        mockPlayerState(1, { zones: p1 }),
      ],
    });

    const result = resolveCombat(state, attacker.instanceId, volatileDefender.instanceId);

    expect(result.events.some(e => e.type === 'CARD_DESTROYED')).toBe(true);
    expect(
      result.events.some(
        e => e.type === 'CARD_EXILED' && e.cardInstanceId === volatileDefender.instanceId,
      ),
    ).toBe(true);
    // Body removed from the game — NOT in the owner's discard pile.
    expect(result.newState.players[1]!.discardPile).toHaveLength(0);
  });

  it('combat: a destroyed NON-Volatile defender goes to the discard pile (no exile event)', () => {
    const attacker = mockCard({ owner: 0, currentAtk: 5, currentHp: 5 });
    const plainDefender = mockCard({ owner: 1, currentAtk: 0, currentHp: 2 });
    let p0 = emptyZones();
    p0 = deployToZone(p0, attacker, 'frontline');
    let p1 = emptyZones();
    p1 = deployToZone(p1, plainDefender, 'frontline');
    const state = mockGameState({
      players: [
        mockPlayerState(0, { zones: p0 }),
        mockPlayerState(1, { zones: p1 }),
      ],
    });

    const result = resolveCombat(state, attacker.instanceId, plainDefender.instanceId);

    expect(result.events.some(e => e.type === 'CARD_EXILED')).toBe(false);
    expect(result.newState.players[1]!.discardPile).toHaveLength(1);
  });

  it('effect destroy: a Volatile character is destroyed AND exiled (Last Breath scope intact)', () => {
    const volatile = mockCard({ owner: 0, traits: ['volatile'], currentHp: 3 });
    let p0 = emptyZones();
    p0 = deployToZone(p0, volatile, 'frontline');
    const state = mockGameState({
      players: [mockPlayerState(0, { zones: p0 }), mockPlayerState(1)],
    });
    const effect: Effect = {
      type: 'destroy',
      target: { type: 'self' },
    };
    const ctx: EffectContext = {
      sourceInstanceId: volatile.instanceId,
      controllerId: 0,
      triggerDepth: 0,
    };

    const result = executeEffect(state, effect, ctx);

    expect(result.events.some(e => e.type === 'CARD_DESTROYED')).toBe(true);
    expect(result.events.some(e => e.type === 'CARD_EXILED')).toBe(true);
    expect(result.newState.players[0]!.discardPile).toHaveLength(0);
  });
});
