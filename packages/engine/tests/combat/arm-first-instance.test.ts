/**
 * EC-002 — `armFirstInstanceOnly` rule-variant semantics.
 *
 * When the toggle is ON, a body's ARM reduces only the FIRST combat-damage
 * instance it receives in a given turn; subsequent instances that turn are
 * unreduced (ARM = 0 against them). The per-body charge is tracked on
 * `CardInstance.armMitigatedThisTurn` (and `HeroState.armMitigatedThisTurn`) and
 * recharges at the turn boundary (`passTurn`). Each body consumes its OWN charge
 * (a defender and an attacker spend independently within one exchange).
 *
 * Default OFF = per-instance (every instance reduced; unchanged from the
 * Rulebook's "Armor reduces damage per instance").
 *
 * ARM is consulted ONLY in the combat path, so non-combat `deal_damage` (which
 * ignores ARM entirely) is irrelevant to this rule and is not exercised here.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { resolveCombat } from '../../src/combat/combat-resolver.js';
import { passTurn } from '../../src/state-machine/actions.js';
import { deployToZone } from '../../src/zones/zone-manager.js';
import {
  mockCard,
  mockGameState,
  mockPlayerState,
  mockHero,
  resetInstanceCounter,
  emptyZones,
} from '../helpers/card-factory.js';
import type { GameConfig } from '../../src/types/game-state.js';

const ON: GameConfig = { terminationMode: 'turn_cap', armFirstInstanceOnly: true };
const OFF: GameConfig = { terminationMode: 'turn_cap' };

/** Two p0 attackers in the Frontline, one p1 defender with ARM in the Frontline.
 * Attackers do 0 ATK so combat never destroys anything and we can hit the defender
 * twice in the same turn (the gang case). The defender's ATK is 0 so it deals no
 * counter-damage (isolates the DEFENDER's first-instance ARM). */
function gangState(config: GameConfig, defenderArm: number) {
  let p0 = emptyZones();
  const a1 = mockCard({ owner: 0, name: 'A1', currentAtk: 3, currentHp: 9, currentArm: 0 });
  const a2 = mockCard({ owner: 0, name: 'A2', currentAtk: 3, currentHp: 9, currentArm: 0 });
  p0 = deployToZone(p0, a1, 'frontline');
  p0 = deployToZone(p0, a2, 'frontline');
  let p1 = emptyZones();
  const def = mockCard({ owner: 1, name: 'Wall', currentAtk: 0, currentHp: 20, currentArm: defenderArm });
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

describe('EC-002 armFirstInstanceOnly — ON (toggle on)', () => {
  beforeEach(() => {
    resetInstanceCounter();
  });

  it('first hit on a body IS reduced by ARM', () => {
    // 3 ATK − 2 ARM = 1 damage to the defender on the first instance.
    const { state, a1, def } = gangState(ON, 2);
    const after = resolveCombat(state, a1, def).newState;
    expect(defHp(after)).toBe(19); // 20 − 1
    // First-instance charge now spent on the defender.
    expect(after.players[1]!.zones.frontline[0]!.armMitigatedThisTurn).toBe(true);
  });

  it('second hit on the SAME body the SAME turn is NOT reduced (gang case)', () => {
    const { state, a1, a2, def } = gangState(ON, 2);
    // Attack 1: 3 − 2 = 1 → 19 HP, charge spent.
    const s1 = resolveCombat(state, a1, def).newState;
    // Attack 2 (same turn, fresh attacker): ARM withheld ⇒ full 3 → 16 HP.
    const s2 = resolveCombat(s1, a2, def).newState;
    expect(defHp(s2)).toBe(16); // 19 − 3 (no ARM the second time)
  });

  it("the body's charge RESETS at the turn boundary (recharges next turn)", () => {
    const { state, a1, a2, def } = gangState(ON, 2);
    const s1 = resolveCombat(state, a1, def).newState; // first hit reduced → 19
    // Turn passes: passTurn recharges every body's first-instance ARM (and flips the
    // active player). The recharge is what this test asserts.
    const passed = passTurn(s1);
    expect(passed.players[1]!.zones.frontline[0]!.armMitigatedThisTurn).toBe(false);
    // Restore p0 as active and re-ready the consumed attacker so it can attack again
    // on the fresh turn (resolveCombat looks up the attacker in the active player).
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
    // New turn: attack again ⇒ ARM applies again on the first instance ⇒ 19 − 1 = 18.
    const s3 = resolveCombat(s2, a2, def).newState;
    expect(defHp(s3)).toBe(18); // 19 − 1 (ARM recharged)
  });

  it("an attacker's OWN ARM is spent independently on the counter-damage instance", () => {
    // One attacker (ARM 2) vs one defender (ATK 3). The defender's counter-damage
    // hits the attacker — the attacker's first-instance ARM blunts it. Then a second
    // defender hits the same attacker the same turn with ARM withheld.
    let p0 = emptyZones();
    const atk = mockCard({ owner: 0, name: 'Knight', currentAtk: 0, currentHp: 20, currentArm: 2 });
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
    // Knight attacks D1: Knight takes 3 − 2 = 1 counter ⇒ 19 HP, charge spent.
    const s1 = resolveCombat(state, atk.instanceId, d1.instanceId).newState;
    expect(s1.players[0]!.zones.frontline[0]!.currentHp).toBe(19);
    // Re-ready the Knight (it exhausted) and attack D2 same turn: ARM withheld ⇒ 3.
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
    expect(s2.players[0]!.zones.frontline[0]!.currentHp).toBe(16); // 19 − 3 (no ARM)
  });

  it('a granted-ARM hero blunts only its first combat instance per turn', () => {
    let p0 = emptyZones();
    const hg1 = mockCard({ owner: 0, name: 'HG1', currentAtk: 4, currentHp: 9 });
    const hg2 = mockCard({ owner: 0, name: 'HG2', currentAtk: 4, currentHp: 9 });
    p0 = deployToZone(p0, hg1, 'high_ground');
    p0 = deployToZone(p0, hg2, 'high_ground');
    const state = mockGameState({
      players: [
        mockPlayerState(0, { zones: p0 }),
        mockPlayerState(1, { zones: emptyZones(), hero: mockHero({ currentArm: 2, currentLp: 30, maxLp: 30 }) }),
      ],
      config: ON,
    });
    // First hit: 4 − 2 ARM = 2 ⇒ 28 LP; hero charge spent.
    const s1 = resolveCombat(state, hg1.instanceId, 'hero').newState;
    expect(s1.players[1]!.hero.currentLp).toBe(28);
    expect(s1.players[1]!.hero.armMitigatedThisTurn).toBe(true);
    // Second hit same turn: ARM withheld ⇒ full 4 ⇒ 24 LP.
    const s2 = resolveCombat(s1, hg2.instanceId, 'hero').newState;
    expect(s2.players[1]!.hero.currentLp).toBe(24);
  });
});

describe('EC-002 armFirstInstanceOnly — OFF (default, per-instance unchanged)', () => {
  beforeEach(() => {
    resetInstanceCounter();
  });

  it('every instance is reduced when the toggle is absent (per-instance ARM)', () => {
    const { state, a1, a2, def } = gangState(OFF, 2);
    const s1 = resolveCombat(state, a1, def).newState; // 3 − 2 = 1 → 19
    const s2 = resolveCombat(s1, a2, def).newState; // 3 − 2 = 1 → 18 (still reduced)
    expect(defHp(s2)).toBe(18);
    // The default path never touches the flag (byte-identical no-op).
    expect(s2.players[1]!.zones.frontline[0]!.armMitigatedThisTurn).toBeUndefined();
  });

  it('passTurn leaves bodies untouched when the toggle is OFF', () => {
    const { state, a1, def } = gangState(OFF, 2);
    const s1 = resolveCombat(state, a1, def).newState;
    const before = s1.players[1]!.zones.frontline[0]!;
    const after = passTurn(s1).players[1]!.zones.frontline[0]!;
    // Same object reference — passTurn allocated nothing for this body.
    expect(after).toBe(before);
  });
});
