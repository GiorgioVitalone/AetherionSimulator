import { describe, it, expect, beforeEach } from 'vitest';
import { resolveCombat } from '../../src/combat/combat-resolver.js';
import { executePlayerAction } from '../../src/state-machine/actions.js';
import { findCard, deployToZone } from '../../src/zones/zone-manager.js';
import type { TriggeredAbilityDSL } from '../../src/types/ability.js';
import {
  mockCard,
  mockGameState,
  mockPlayerState,
  resetInstanceCounter,
  emptyZones,
  zonesWithCards,
} from '../helpers/card-factory.js';

describe('Stealth — acting lifts untargetability (hasActed)', () => {
  beforeEach(() => {
    resetInstanceCounter();
  });

  it('attacking sets hasActed on the Stealth attacker', () => {
    const stealth = mockCard({
      owner: 0,
      traits: ['stealth'],
      currentAtk: 2,
      currentHp: 3,
    });
    const target = mockCard({ owner: 1, currentAtk: 0, currentHp: 5 });
    let p0 = emptyZones();
    p0 = deployToZone(p0, stealth, 'frontline');
    let p1 = emptyZones();
    p1 = deployToZone(p1, target, 'frontline');
    const state = mockGameState({
      players: [mockPlayerState(0, { zones: p0 }), mockPlayerState(1, { zones: p1 })],
    });

    const result = resolveCombat(state, stealth.instanceId, target.instanceId);
    const after = findCard(result.newState.players[0]!.zones, stealth.instanceId)!.card;
    expect(after.hasActed).toBe(true);
  });

  it('using an activated ability sets hasActed on the Stealth character', () => {
    const activated: TriggeredAbilityDSL = {
      type: 'triggered',
      trigger: { type: 'activated', cost: { mana: 0, energy: 0, flexible: 0 } },
      effects: [{ type: 'draw_cards', target: { type: 'owner_hero' }, count: { type: 'fixed', value: 1 } }],
    };
    const stealth = mockCard({
      owner: 0,
      traits: ['stealth'],
      summoningSick: false,
      abilities: [activated],
    });
    const state = mockGameState({
      phase: 'strategy',
      players: [
        mockPlayerState(0, {
          zones: zonesWithCards({ frontline: [stealth, null, null] }),
          mainDeck: [mockCard({ owner: 0 })],
        }),
        mockPlayerState(1),
      ],
    });

    const { state: next } = executePlayerAction(state, {
      type: 'activate_ability',
      cardInstanceId: stealth.instanceId,
      abilityIndex: 0,
    });
    const after = findCard(next.players[0]!.zones, stealth.instanceId)!.card;
    expect(after.hasActed).toBe(true);
  });
});
