/**
 * EC-003 — `shieldFirstInstanceOnly` rule-variant semantics.
 *
 * When the toggle is ON, a body's −1 "would take damage" shield (an
 * on_would_take_damage damage-reduction replacement in `activeReplacements` —
 * Shieldbearer Paladin id48, Radiant Shield id66) reduces only the FIRST
 * combat-damage instance it receives in a given turn; subsequent instances that
 * turn are unreduced (the shield does not fire). The per-body charge is tracked on
 * `CardInstance.shieldMitigatedThisTurn` (INDEPENDENT of the recompute-volatile
 * `ActiveReplacement.usedThisTurn`) and recharges at the turn boundary (`passTurn`).
 * Each body consumes its OWN charge.
 *
 * Default OFF = per-instance (every instance reduced; the shield is consulted on
 * every swing, unchanged from current engine behaviour).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { resolveCombat } from '../../src/combat/combat-resolver.js';
import { passTurn } from '../../src/state-machine/actions.js';
import { deployToZone } from '../../src/zones/zone-manager.js';
import {
  mockCard,
  mockGameState,
  mockPlayerState,
  resetInstanceCounter,
  emptyZones,
} from '../helpers/card-factory.js';
import type { GameConfig, ActiveReplacement } from '../../src/types/game-state.js';

const ON: GameConfig = { terminationMode: 'turn_cap', shieldFirstInstanceOnly: true };
const OFF: GameConfig = { terminationMode: 'turn_cap' };

/** A −1 "would take damage" shield replacement (the real shield's shape). */
function shield(id: string): ActiveReplacement {
  return {
    id,
    sourceInstanceId: id,
    replaces: { type: 'on_would_take_damage', reduction: 1 },
    instead: [],
    oncePerTurn: false,
    usedThisTurn: false,
  };
}

/** Two p0 attackers (3 ATK, 0 ARM) and one p1 shielded defender (0 ATK so no
 * counter-damage, big HP so it survives the gang). Lets us hit the shielded
 * defender twice in the same turn (the gang case) and isolate its shield. */
function gangState(config: GameConfig) {
  let p0 = emptyZones();
  const a1 = mockCard({ owner: 0, name: 'A1', currentAtk: 3, currentHp: 9, currentArm: 0 });
  const a2 = mockCard({ owner: 0, name: 'A2', currentAtk: 3, currentHp: 9, currentArm: 0 });
  p0 = deployToZone(p0, a1, 'frontline');
  p0 = deployToZone(p0, a2, 'frontline');
  let p1 = emptyZones();
  const def = mockCard({
    owner: 1, name: 'Paladin', currentAtk: 0, currentHp: 20, currentArm: 0,
    activeReplacements: [shield('shield_d')],
  });
  p1 = deployToZone(p1, def, 'frontline');
  return {
    state: mockGameState({
      players: [mockPlayerState(0, { zones: p0 }), mockPlayerState(1, { zones: p1 })],
      config,
    }),
    a1: a1.instanceId,
    a2: a2.instanceId,
    def: def.instanceId,
  };
}

function defHp(state: ReturnType<typeof mockGameState>): number {
  return state.players[1]!.zones.frontline[0]!.currentHp;
}

describe('EC-003 shieldFirstInstanceOnly — ON (toggle on)', () => {
  beforeEach(() => {
    resetInstanceCounter();
  });

  it('first hit on a shielded body IS reduced by the shield', () => {
    // 3 ATK − 1 shield = 2 damage on the first instance.
    const { state, a1, def } = gangState(ON);
    const after = resolveCombat(state, a1, def).newState;
    expect(defHp(after)).toBe(18); // 20 − 2
    // First-instance shield charge now spent on the defender.
    expect(after.players[1]!.zones.frontline[0]!.shieldMitigatedThisTurn).toBe(true);
  });

  it('second hit on the SAME body the SAME turn is NOT reduced (gang case)', () => {
    const { state, a1, a2, def } = gangState(ON);
    // Attack 1: 3 − 1 = 2 → 18 HP, shield charge spent.
    const s1 = resolveCombat(state, a1, def).newState;
    expect(defHp(s1)).toBe(18);
    // Attack 2 (same turn, fresh attacker): shield withheld ⇒ full 3 → 15 HP.
    const s2 = resolveCombat(s1, a2, def).newState;
    expect(defHp(s2)).toBe(15); // 18 − 3 (no shield the second time)
  });

  it("the body's shield charge RESETS at the turn boundary (recharges next turn)", () => {
    const { state, a1, a2, def } = gangState(ON);
    const s1 = resolveCombat(state, a1, def).newState; // first hit reduced → 18
    // Turn passes: passTurn recharges every body's first-instance shield charge.
    const passed = passTurn(s1);
    expect(passed.players[1]!.zones.frontline[0]!.shieldMitigatedThisTurn).toBe(false);
    // Restore p0 as active and re-ready the consumed attacker so it can attack again.
    const s2 = {
      ...passed,
      activePlayerIndex: 0 as const,
      players: passed.players.map((p, i) =>
        i === 0
          ? {
              ...p,
              zones: {
                ...p.zones,
                frontline: p.zones.frontline.map(c =>
                  c?.instanceId === a2 ? { ...c, exhausted: false } : c,
                ),
              },
            }
          : p,
      ) as typeof passed.players,
    };
    // New turn: attack again ⇒ shield applies again on the first instance ⇒ 18 − 2 = 16.
    const s3 = resolveCombat(s2, a2, def).newState;
    expect(defHp(s3)).toBe(16); // 18 − 2 (shield recharged)
  });

  it("an attacker's OWN shield is spent independently on the counter-damage instance", () => {
    // One shielded attacker (0 ATK so it never kills) vs two 3-ATK defenders. The
    // first defender's counter-damage is blunted by the attacker's shield; the
    // second defender's counter the same turn is NOT (shield withheld).
    let p0 = emptyZones();
    const atk = mockCard({
      owner: 0, name: 'Knight', currentAtk: 0, currentHp: 20, currentArm: 0,
      activeReplacements: [shield('shield_a')],
    });
    p0 = deployToZone(p0, atk, 'frontline');
    let p1 = emptyZones();
    const d1 = mockCard({ owner: 1, name: 'D1', currentAtk: 3, currentHp: 20, currentArm: 0 });
    const d2 = mockCard({ owner: 1, name: 'D2', currentAtk: 3, currentHp: 20, currentArm: 0 });
    p1 = deployToZone(p1, d1, 'frontline');
    p1 = deployToZone(p1, d2, 'frontline');
    const state = mockGameState({
      players: [mockPlayerState(0, { zones: p0 }), mockPlayerState(1, { zones: p1 })],
      config: ON,
    });
    // Knight attacks D1: takes 3 − 1 shield = 2 counter ⇒ 18 HP, shield spent.
    const s1 = resolveCombat(state, atk.instanceId, d1.instanceId).newState;
    expect(s1.players[0]!.zones.frontline[0]!.currentHp).toBe(18);
    // Re-ready the Knight and attack D2 same turn: shield withheld ⇒ 3 counter.
    const ready = {
      ...s1,
      players: s1.players.map((p, i) =>
        i === 0
          ? {
              ...p,
              zones: {
                ...p.zones,
                frontline: p.zones.frontline.map(c =>
                  c?.instanceId === atk.instanceId ? { ...c, exhausted: false } : c,
                ),
              },
            }
          : p,
      ) as typeof s1.players,
    };
    const s2 = resolveCombat(ready, atk.instanceId, d2.instanceId).newState;
    expect(s2.players[0]!.zones.frontline[0]!.currentHp).toBe(15); // 18 − 3 (no shield)
  });
});

describe('EC-003 shieldFirstInstanceOnly — OFF (default, per-instance unchanged)', () => {
  beforeEach(() => {
    resetInstanceCounter();
  });

  it('every instance is reduced when the toggle is absent (per-instance shield)', () => {
    const { state, a1, a2, def } = gangState(OFF);
    const s1 = resolveCombat(state, a1, def).newState; // 3 − 1 = 2 → 18
    const s2 = resolveCombat(s1, a2, def).newState; // 3 − 1 = 2 → 16 (still reduced)
    expect(defHp(s2)).toBe(16);
    // The default path never touches the EC-003 flag (byte-identical no-op).
    expect(s2.players[1]!.zones.frontline[0]!.shieldMitigatedThisTurn).toBeUndefined();
  });

  it('passTurn leaves bodies untouched when the toggle is OFF', () => {
    const { state, a1, def } = gangState(OFF);
    const s1 = resolveCombat(state, a1, def).newState;
    const before = s1.players[1]!.zones.frontline[0]!;
    const after = passTurn(s1).players[1]!.zones.frontline[0]!;
    // Same object reference — passTurn allocated nothing for this body.
    expect(after).toBe(before);
  });
});
