/**
 * Gang-planner rule-awareness (EC-003 + the bot-correctness fix).
 *
 * `planGangAttack` decides whether committing multiple ready attackers can KILL a
 * key enemy body (a board-gating Defender). Its kill-simulation must use the
 * engine's REAL combat damage model so the target's −1 "would take damage" shield is
 * consumed CORRECTLY across the gang sequence:
 *   - default (per-instance shield): the shield blunts EVERY swing, so a body that
 *     out-tanks the gang under per-instance shield is correctly left standing;
 *   - EC-003 (shieldFirstInstanceOnly): only the FIRST swing is blunted, so the same
 *     gang can now finish a shielded Defender — the planner must ELECT to gang it.
 *
 * The previous planner applied `applyDamageReplacements` fresh per swing (shield on
 * every swing, no per-turn charge), so it could never exploit EC-003. These tests
 * pin both the bite (EC-003 ⇒ elects to gang) and the discipline (still declines a
 * body it cannot clear, even under EC-003).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { planGangAttack } from '../../src/bot/combat-plan.js';
import { mockCard, mockPlayerState, resetInstanceCounter, emptyZones } from '../helpers/card-factory.js';
import { deployToZone } from '../../src/zones/zone-manager.js';
import type { GameConfig, CardInstance, PlayerState } from '../../src/types/game-state.js';
import type { AttackOption } from '../../src/actions/available-actions.js';

const PER_INSTANCE: GameConfig = { terminationMode: 'turn_cap' };
const EC003: GameConfig = { terminationMode: 'turn_cap', shieldFirstInstanceOnly: true };

function shieldRepl(id: string) {
  return {
    id,
    sourceInstanceId: id,
    replaces: { type: 'on_would_take_damage' as const, reduction: 1 },
    instead: [],
    oncePerTurn: false,
    usedThisTurn: false,
  };
}

/** A ready attacker that can target `targetId`. */
function ready(card: CardInstance, targetId: string): { card: CardInstance; option: AttackOption } {
  return {
    card,
    option: {
      attackerInstanceId: card.instanceId,
      validTargets: [{ type: 'character', instanceId: targetId }],
    },
  };
}

/** Opponent with a single shielded Defender (the gang target) in the Frontline. */
function opponentWithDefender(hp: number): { opponent: PlayerState; def: CardInstance } {
  let zones = emptyZones();
  const def = mockCard({
    owner: 1, name: 'ShieldWall', cardType: 'C',
    currentAtk: 2, currentHp: hp, currentArm: 0,
    traits: ['defender'],
    activeReplacements: [shieldRepl('shield_w')],
  });
  zones = deployToZone(zones, def, 'frontline');
  return { opponent: mockPlayerState(1, { zones }), def };
}

describe('gang-planner shield rule-awareness', () => {
  beforeEach(() => resetInstanceCounter());

  it('declines a shielded Defender it cannot clear under per-instance shield', () => {
    // Defender HP 3, shield −1. Two 2-ATK attackers. Per-instance: each swing
    // 2−1=1 ⇒ 1+1 = 2 < 3 ⇒ NOT killed ⇒ no gang (regen/key-body kill required).
    const { opponent, def } = opponentWithDefender(3);
    const a1 = mockCard({ owner: 0, name: 'A1', currentAtk: 2, currentHp: 9 });
    const a2 = mockCard({ owner: 0, name: 'A2', currentAtk: 2, currentHp: 9 });
    const attackers = [ready(a1, def.instanceId), ready(a2, def.instanceId)];

    const plan = planGangAttack(attackers, opponent, PER_INSTANCE);
    expect(plan).toBeNull(); // shield blunts every swing ⇒ wall stands
  });

  it('ELECTS to gang the same shielded Defender under EC-003 (first-instance shield)', () => {
    // Same board. EC-003: only the FIRST swing is blunted ⇒ 1 + 2 = 3 = lethal ⇒
    // the gang clears it, so the planner returns the next attack of the gang.
    const { opponent, def } = opponentWithDefender(3);
    const a1 = mockCard({ owner: 0, name: 'A1', currentAtk: 2, currentHp: 9 });
    const a2 = mockCard({ owner: 0, name: 'A2', currentAtk: 2, currentHp: 9 });
    const attackers = [ready(a1, def.instanceId), ready(a2, def.instanceId)];

    const plan = planGangAttack(attackers, opponent, EC003);
    expect(plan).not.toBeNull();
    expect(plan!.action.type).toBe('declare_attack');
    expect(plan!.action).toMatchObject({ targetId: def.instanceId });
    expect(plan!.value).toBeGreaterThan(0);
  });

  it('still DECLINES a shielded Defender it cannot clear even under EC-003', () => {
    // Defender HP 6, shield −1. Two 2-ATK attackers. EC-003: 1 + 2 = 3 < 6 ⇒ even
    // with the first-instance shield the gang cannot finish it ⇒ correctly declines.
    const { opponent, def } = opponentWithDefender(6);
    const a1 = mockCard({ owner: 0, name: 'A1', currentAtk: 2, currentHp: 9 });
    const a2 = mockCard({ owner: 0, name: 'A2', currentAtk: 2, currentHp: 9 });
    const attackers = [ready(a1, def.instanceId), ready(a2, def.instanceId)];

    const plan = planGangAttack(attackers, opponent, EC003);
    expect(plan).toBeNull();
  });
});
