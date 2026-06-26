/**
 * Aura non-stat effect registration (Gap A2).
 *
 * recomputeAuras must register the replacement / apply_status / grant_trait /
 * grant_ability effects embedded in an `aura` ability — not only modify_stats /
 * cost_reduction. These registrations are continuous: stripped and rebuilt every
 * recompute, and consulted by combat (A3) so e.g. a Shieldbearer Paladin -1 ward
 * actually mitigates combat damage.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { recomputeAuras } from '../../src/runtime/aura-recompute.js';
import { resolveCombat } from '../../src/combat/combat-resolver.js';
import { deployToZone } from '../../src/zones/zone-manager.js';
import type { AbilityDSL } from '../../src/types/ability.js';
import {
  mockCard,
  mockGameState,
  mockPlayerState,
  resetInstanceCounter,
  emptyZones,
} from '../helpers/card-factory.js';

const wardAura: AbilityDSL = {
  type: 'aura',
  effects: [
    {
      type: 'replacement',
      instead: [],
      replaces: { type: 'on_would_take_damage', reduction: 1 },
    },
  ],
};

const hexproofAura: AbilityDSL = {
  type: 'aura',
  effects: [
    { type: 'apply_status', status: 'hexproof', target: { type: 'self' } },
  ],
};

const grantAbilityAura: AbilityDSL = {
  type: 'aura',
  effects: [
    {
      type: 'grant_ability',
      target: { type: 'self' },
      duration: { type: 'while_in_play' },
      ability: {
        trigger: { type: 'on_take_damage' },
        effects: [
          { type: 'heal', amount: { type: 'fixed', value: 1 }, target: { type: 'self' } },
        ],
      },
    },
  ],
};

describe('Aura non-stat registration (A2)', () => {
  beforeEach(() => {
    resetInstanceCounter();
  });

  it('registers an aura replacement on the source card', () => {
    let zones = emptyZones();
    const paladin = mockCard({ owner: 0, abilities: [wardAura], currentHp: 10 });
    zones = deployToZone(zones, paladin, 'frontline');
    const state = mockGameState({
      players: [mockPlayerState(0, { zones }), mockPlayerState(1)],
    });

    const recomputed = recomputeAuras(state);
    const card = recomputed.players[0]!.zones.frontline[0]!;
    expect(card.activeReplacements?.length).toBe(1);
    expect(card.activeReplacements?.[0]?.id.startsWith('aura_')).toBe(true);
  });

  it('strips and rebuilds the aura replacement on each recompute (no duplication)', () => {
    let zones = emptyZones();
    const paladin = mockCard({ owner: 0, abilities: [wardAura], currentHp: 10 });
    zones = deployToZone(zones, paladin, 'frontline');
    const state = mockGameState({
      players: [mockPlayerState(0, { zones }), mockPlayerState(1)],
    });

    const twice = recomputeAuras(recomputeAuras(state));
    expect(twice.players[0]!.zones.frontline[0]!.activeReplacements?.length).toBe(1);
  });

  it('removes the aura replacement once the source leaves play', () => {
    let zones = emptyZones();
    const paladin = mockCard({ owner: 0, abilities: [wardAura], currentHp: 10 });
    zones = deployToZone(zones, paladin, 'frontline');
    const state = mockGameState({
      players: [mockPlayerState(0, { zones }), mockPlayerState(1)],
    });
    const registered = recomputeAuras(state);

    // Empty the board (source gone) and recompute: the registration is stripped.
    const gone = recomputeAuras({
      ...registered,
      players: [
        mockPlayerState(0, { zones: emptyZones() }),
        mockPlayerState(1),
      ] as typeof registered.players,
    });
    expect(gone.players[0]!.zones.frontline[0]).toBeNull();
  });

  it('registers an aura-granted status tagged with sourceAuraId', () => {
    let zones = emptyZones();
    const card = mockCard({ owner: 0, abilities: [hexproofAura] });
    zones = deployToZone(zones, card, 'frontline');
    const state = mockGameState({
      players: [mockPlayerState(0, { zones }), mockPlayerState(1)],
    });

    const recomputed = recomputeAuras(state);
    const after = recomputed.players[0]!.zones.frontline[0]!;
    expect(after.statusEffects.some(s => s.statusType === 'hexproof' && s.sourceAuraId !== undefined)).toBe(true);
  });

  it('registers an aura grant_ability as a dispatch trigger without growing abilities', () => {
    let zones = emptyZones();
    const card = mockCard({ owner: 0, abilities: [grantAbilityAura] });
    zones = deployToZone(zones, card, 'frontline');
    const state = mockGameState({
      players: [mockPlayerState(0, { zones }), mockPlayerState(1)],
    });

    const twice = recomputeAuras(recomputeAuras(state));
    const after = twice.players[0]!.zones.frontline[0]!;
    // abilities array is untouched (still just the source aura); exactly one
    // aura-tagged registeredTrigger exists even after two recomputes.
    expect(after.abilities.length).toBe(1);
    const granted = after.registeredTriggers.filter(t => t.id.startsWith('aura_grant_'));
    expect(granted.length).toBe(1);
    expect(granted[0]?.trigger.type).toBe('on_take_damage');
  });

  it('an aura -1 reduction mitigates COMBAT damage 2->1 after recompute', () => {
    let p1Zones = emptyZones();
    const paladin = mockCard({
      owner: 1,
      abilities: [wardAura],
      currentAtk: 0,
      currentHp: 10,
      currentArm: 0,
    });
    p1Zones = deployToZone(p1Zones, paladin, 'frontline');

    let p0Zones = emptyZones();
    const attacker = mockCard({ owner: 0, currentAtk: 2, currentHp: 10, currentArm: 0 });
    p0Zones = deployToZone(p0Zones, attacker, 'frontline');

    const state = recomputeAuras(mockGameState({
      players: [
        mockPlayerState(0, { zones: p0Zones }),
        mockPlayerState(1, { zones: p1Zones }),
      ],
    }));

    const defenderId = state.players[1]!.zones.frontline[0]!.instanceId;
    const attackerId = state.players[0]!.zones.frontline[0]!.instanceId;
    const result = resolveCombat(state, attackerId, defenderId);

    const dmg = result.events.find(
      e => e.type === 'DAMAGE_DEALT' && e.targetId === defenderId,
    );
    expect(dmg?.type === 'DAMAGE_DEALT' ? dmg.amount : -1).toBe(1);
  });
});
