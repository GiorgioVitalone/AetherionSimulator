import { describe, it, expect, beforeEach } from 'vitest';
import { resolveCombat } from '../../src/combat/combat-resolver.js';
import { dispatchTriggers } from '../../src/runtime/dispatch.js';
import {
  registerCardTriggers,
  getAllRegisteredTriggers,
  resetRegistrationCounter,
} from '../../src/events/trigger-registry.js';
import {
  mockCard,
  mockGameState,
  mockPlayerState,
  zonesWithCards,
  resetInstanceCounter,
} from '../helpers/card-factory.js';
import type { AbilityDSL } from '../../src/types/ability.js';

// Wave 6 A15 + A5: combat emits CHARACTER_BLOCKED, on_block matches it, and the
// Sunlit Guardian oncePerTurn block-heal fires once per turn.
const blockHeal: AbilityDSL = {
  type: 'triggered',
  trigger: { type: 'on_block' },
  effects: [{ type: 'heal', amount: { type: 'fixed', value: 1 }, target: { type: 'self' } }],
  oncePerTurn: true,
};

describe('on_block (Sunlit Guardian)', () => {
  beforeEach(() => {
    resetInstanceCounter();
    resetRegistrationCounter();
  });

  it('emits CHARACTER_BLOCKED and heals the blocker once per turn', () => {
    // Attacker 2 ATK; blocker has on_block heal, takes 1 damage (down to 4) then
    // the block-heal restores 1 (back to 5). High HP so it survives.
    const attacker = mockCard({ owner: 0, name: 'Attacker', currentAtk: 1, currentHp: 5, baseHp: 5 });
    const blocker = mockCard({
      owner: 1, name: 'Sunlit Guardian', currentAtk: 0, currentHp: 5, baseHp: 5, abilities: [blockHeal],
    });
    const base = mockGameState({
      players: [
        mockPlayerState(0, { zones: zonesWithCards({ frontline: [attacker, null, null] }) }),
        mockPlayerState(1, { zones: zonesWithCards({ frontline: [blocker, null, null] }) }),
      ],
      log: [{ type: 'TURN_START', playerId: 0, turnNumber: 1 }],
    });
    const registered = registerCardTriggers(base, blocker.instanceId);
    const pool = getAllRegisteredTriggers(registered);

    const combat = resolveCombat(registered, attacker.instanceId, blocker.instanceId);
    expect(combat.events.some(e => e.type === 'CHARACTER_BLOCKED')).toBe(true);

    const dispatched = dispatchTriggers(combat.newState, combat.events, 0, pool);
    const healed = dispatched.newState.players[1]!.zones.frontline[0]!;
    // 5 HP - 1 combat damage + 1 block-heal = 5.
    expect(healed.currentHp).toBe(5);
    expect(dispatched.events.some(e => e.type === 'CHARACTER_HEALED')).toBe(true);
  });

  it('does NOT emit CHARACTER_BLOCKED when attacking the hero', () => {
    const attacker = mockCard({ owner: 0, name: 'Attacker', currentAtk: 1 });
    const base = mockGameState({
      players: [
        mockPlayerState(0, { zones: zonesWithCards({ frontline: [attacker, null, null] }) }),
        mockPlayerState(1),
      ],
    });
    const combat = resolveCombat(base, attacker.instanceId, 'hero');
    expect(combat.events.some(e => e.type === 'CHARACTER_BLOCKED')).toBe(false);
  });
});
