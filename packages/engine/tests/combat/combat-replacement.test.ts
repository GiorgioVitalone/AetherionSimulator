/**
 * Combat damage replacements (Gap A3) + hero ARM (BUG-R3).
 *
 * Combat must consult a card's `on_would_take_damage` replacements (e.g. a
 * registered -1 reduction, or an aura-granted ward) before HP is reduced, and
 * must read the defending Hero's ARM instead of hardcoding 0.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { resolveCombat } from '../../src/combat/combat-resolver.js';
import { deployToZone } from '../../src/zones/zone-manager.js';
import type { ActiveReplacement } from '../../src/types/game-state.js';
import {
  mockCard,
  mockHero,
  mockGameState,
  mockPlayerState,
  resetInstanceCounter,
  emptyZones,
} from '../helpers/card-factory.js';

function reduction(id: string, amount: number, oncePerTurn = false): ActiveReplacement {
  return {
    id,
    sourceInstanceId: id,
    replaces: { type: 'on_would_take_damage', reduction: amount },
    instead: [],
    oncePerTurn,
    usedThisTurn: false,
  };
}

describe('Combat damage replacements (A3)', () => {
  beforeEach(() => {
    resetInstanceCounter();
  });

  it('reduces incoming COMBAT damage 2->1 via a registered reduction:1', () => {
    let p0Zones = emptyZones();
    const attacker = mockCard({ currentAtk: 2, currentHp: 10, currentArm: 0, owner: 0 });
    p0Zones = deployToZone(p0Zones, attacker, 'frontline');

    let p1Zones = emptyZones();
    const defender = mockCard({
      currentAtk: 0,
      currentHp: 10,
      currentArm: 0,
      owner: 1,
      activeReplacements: [reduction('repl_d', 1)],
    });
    p1Zones = deployToZone(p1Zones, defender, 'frontline');

    const state = mockGameState({
      players: [
        mockPlayerState(0, { zones: p0Zones }),
        mockPlayerState(1, { zones: p1Zones }),
      ],
    });

    const result = resolveCombat(state, attacker.instanceId, defender.instanceId);
    const damageEvent = result.events.find(
      e => e.type === 'DAMAGE_DEALT' && e.targetId === defender.instanceId,
    );
    expect(damageEvent?.type === 'DAMAGE_DEALT' ? damageEvent.amount : -1).toBe(1);
    // 2 raw - 1 reduction = 1 applied; defender ends at 9 HP.
    expect(result.newState.players[1]!.zones.frontline[0]!.currentHp).toBe(9);
  });

  it('prevents lethal when reduction keeps the defender alive', () => {
    let p0Zones = emptyZones();
    const attacker = mockCard({ currentAtk: 2, currentHp: 10, currentArm: 0, owner: 0 });
    p0Zones = deployToZone(p0Zones, attacker, 'frontline');

    let p1Zones = emptyZones();
    const defender = mockCard({
      currentAtk: 0,
      currentHp: 2,
      currentArm: 0,
      owner: 1,
      activeReplacements: [reduction('repl_d', 1)],
    });
    p1Zones = deployToZone(p1Zones, defender, 'frontline');

    const state = mockGameState({
      players: [
        mockPlayerState(0, { zones: p0Zones }),
        mockPlayerState(1, { zones: p1Zones }),
      ],
    });

    const result = resolveCombat(state, attacker.instanceId, defender.instanceId);
    // 2 - 1 = 1 < 2 HP, so the defender survives (no destruction).
    expect(
      result.events.some(e => e.type === 'CARD_DESTROYED'),
    ).toBe(false);
    expect(result.newState.players[1]!.zones.frontline[0]!.currentHp).toBe(1);
  });

  it('marks a oncePerTurn combat reduction as used', () => {
    let p0Zones = emptyZones();
    const attacker = mockCard({ currentAtk: 2, currentHp: 10, currentArm: 0, owner: 0 });
    p0Zones = deployToZone(p0Zones, attacker, 'frontline');

    let p1Zones = emptyZones();
    const defender = mockCard({
      currentAtk: 0,
      currentHp: 10,
      currentArm: 0,
      owner: 1,
      activeReplacements: [reduction('repl_once', 1, true)],
    });
    p1Zones = deployToZone(p1Zones, defender, 'frontline');

    const state = mockGameState({
      players: [
        mockPlayerState(0, { zones: p0Zones }),
        mockPlayerState(1, { zones: p1Zones }),
      ],
    });

    const result = resolveCombat(state, attacker.instanceId, defender.instanceId);
    const after = result.newState.players[1]!.zones.frontline[0]!;
    expect(after.activeReplacements?.[0]?.usedThisTurn).toBe(true);
  });
});

describe('Hero ARM in combat (BUG-R3)', () => {
  beforeEach(() => {
    resetInstanceCounter();
  });

  it('mitigates hero damage by the defending hero ARM', () => {
    let p0Zones = emptyZones();
    const attacker = mockCard({ currentAtk: 4, currentHp: 5, owner: 0 });
    p0Zones = deployToZone(p0Zones, attacker, 'high_ground');

    const state = mockGameState({
      players: [
        mockPlayerState(0, { zones: p0Zones }),
        mockPlayerState(1, { hero: mockHero({ currentArm: 2 }) }),
      ],
    });

    const result = resolveCombat(state, attacker.instanceId, 'hero');
    const dmg = result.events.find(e => e.type === 'HERO_DAMAGED');
    // 4 ATK - 2 hero ARM = 2 damage; 25 - 2 = 23.
    expect(dmg?.type === 'HERO_DAMAGED' ? dmg.amount : -1).toBe(2);
    expect(result.newState.players[1]!.hero.currentLp).toBe(23);
  });
});
