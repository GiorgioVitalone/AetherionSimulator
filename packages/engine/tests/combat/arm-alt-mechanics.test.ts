/**
 * TEST A (`armOneTimeAbsolute`) and TEST B (`armChargeAbsorb`) — alternative ARM
 * mechanics, mutually exclusive, both default OFF.
 *
 * TEST A — ARM reduces only the FIRST damage instance the body EVER takes
 * (absolute, once per game), by its ARM value (raw − arm, min 0). After that first
 * instance, ARM gives NO reduction ever again. Never refreshes (not even across
 * turns). Tracked via `CardInstance.armConsumed` / `HeroState.armConsumed`.
 *
 * TEST B — ARM is a CHARGE counter. Each instance is FULLY negated (0 damage) and
 * ARM decrements by 1. When ARM reaches 0, damage flows normally. No recovery
 * unless a fresh ARM buff raises `currentArm`. Tracked via `CardInstance.armCharges`.
 *
 * Default OFF reproduces per-instance ARM (engine default, byte-identical no-op).
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

const TEST_A: GameConfig = { terminationMode: 'turn_cap', armOneTimeAbsolute: true };
const TEST_B: GameConfig = { terminationMode: 'turn_cap', armChargeAbsorb: true };
const OFF: GameConfig = { terminationMode: 'turn_cap' };

/** Two p0 attackers in the Frontline, one p1 defender (ARM, 0 ATK so no
 * counter-damage, big HP so it survives many hits). Lets us hit the defender
 * repeatedly in one turn. */
function gangState(config: GameConfig, defenderArm: number, atk = 3) {
  let p0 = emptyZones();
  const a1 = mockCard({ owner: 0, name: 'A1', currentAtk: atk, currentHp: 99, currentArm: 0 });
  const a2 = mockCard({ owner: 0, name: 'A2', currentAtk: atk, currentHp: 99, currentArm: 0 });
  const a3 = mockCard({ owner: 0, name: 'A3', currentAtk: atk, currentHp: 99, currentArm: 0 });
  p0 = deployToZone(p0, a1, 'frontline');
  p0 = deployToZone(p0, a2, 'frontline');
  p0 = deployToZone(p0, a3, 'frontline');
  let p1 = emptyZones();
  const def = mockCard({ owner: 1, name: 'Wall', currentAtk: 0, currentHp: 99, currentArm: defenderArm });
  p1 = deployToZone(p1, def, 'frontline');
  return {
    state: mockGameState({
      players: [mockPlayerState(0, { zones: p0 }), mockPlayerState(1, { zones: p1 })],
      config,
    }),
    a1: a1.instanceId,
    a2: a2.instanceId,
    a3: a3.instanceId,
    def: def.instanceId,
  };
}

function defHp(state: ReturnType<typeof mockGameState>): number {
  return state.players[1]!.zones.frontline[0]!.currentHp;
}

function defCard(state: ReturnType<typeof mockGameState>) {
  return state.players[1]!.zones.frontline[0]!;
}

describe('TEST A armOneTimeAbsolute — ON', () => {
  beforeEach(() => {
    resetInstanceCounter();
  });

  it('first hit IS reduced by ARM (raw − arm)', () => {
    const { state, a1 } = gangState(TEST_A, 2);
    const after = resolveCombat(state, a1, defCard(state).instanceId).newState;
    expect(defHp(after)).toBe(98); // 99 − (3 − 2)
    expect(defCard(after).armConsumed).toBe(true);
  });

  it('second hit is FULL damage (ARM gone forever)', () => {
    const { state, a1, a2 } = gangState(TEST_A, 2);
    const s1 = resolveCombat(state, a1, defCard(state).instanceId).newState; // 99 − 1 = 98
    const s2 = resolveCombat(s1, a2, defCard(s1).instanceId).newState; // 98 − 3 = 95 (no ARM)
    expect(defHp(s2)).toBe(95);
  });

  it('does NOT refresh across the turn boundary (one-time, absolute)', () => {
    const { state, a1, a2 } = gangState(TEST_A, 2);
    const s1 = resolveCombat(state, a1, defCard(state).instanceId).newState; // 98, consumed
    // passTurn must NOT clear armConsumed (unlike EC-002's per-turn recharge).
    const passed = passTurn(s1);
    expect(defCard(passed).armConsumed).toBe(true);
    // Re-ready an attacker on the fresh turn and hit again: still full damage.
    const ready = {
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
    const s3 = resolveCombat(ready, a2, defCard(ready).instanceId).newState;
    expect(defHp(s3)).toBe(95); // 98 − 3 (ARM still gone)
  });

  it('a body with 0 ARM is never marked consumed', () => {
    const { state, a1 } = gangState(TEST_A, 0);
    const after = resolveCombat(state, a1, defCard(state).instanceId).newState;
    expect(defHp(after)).toBe(96); // full 3
    expect(defCard(after).armConsumed).toBeUndefined();
  });

  it('a granted-ARM hero blunts only its first ever instance', () => {
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
      config: TEST_A,
    });
    const s1 = resolveCombat(state, hg1.instanceId, 'hero').newState; // 4 − 2 = 2 → 28
    expect(s1.players[1]!.hero.currentLp).toBe(28);
    expect(s1.players[1]!.hero.armConsumed).toBe(true);
    const s2 = resolveCombat(s1, hg2.instanceId, 'hero').newState; // full 4 → 24
    expect(s2.players[1]!.hero.currentLp).toBe(24);
  });
});

describe('TEST B armChargeAbsorb — ON', () => {
  beforeEach(() => {
    resetInstanceCounter();
  });

  it('2 ARM absorbs TWO full hits, then the third is normal', () => {
    const { state, a1, a2, a3 } = gangState(TEST_B, 2);
    const s1 = resolveCombat(state, a1, defCard(state).instanceId).newState; // absorbed → 99
    expect(defHp(s1)).toBe(99);
    expect(defCard(s1).armCharges).toBe(1);
    const s2 = resolveCombat(s1, a2, defCard(s1).instanceId).newState; // absorbed → 99
    expect(defHp(s2)).toBe(99);
    expect(defCard(s2).armCharges).toBe(0);
    const s3 = resolveCombat(s2, a3, defCard(s2).instanceId).newState; // normal → 96
    expect(defHp(s3)).toBe(96);
    expect(defCard(s3).armCharges).toBe(0);
  });

  it('charges do NOT recover across the turn boundary', () => {
    const { state, a1, a2 } = gangState(TEST_B, 1);
    const s1 = resolveCombat(state, a1, defCard(state).instanceId).newState; // absorbed → 99, charges 0
    expect(defCard(s1).armCharges).toBe(0);
    const passed = passTurn(s1);
    expect(defCard(passed).armCharges).toBe(0); // no recharge
    const ready = {
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
    const s2 = resolveCombat(ready, a2, defCard(ready).instanceId).newState; // normal → 96
    expect(defHp(s2)).toBe(96);
  });

  it('a fresh ARM buff (raising currentArm above remaining) tops up charges', () => {
    const { state, a1, a2 } = gangState(TEST_B, 1);
    const s1 = resolveCombat(state, a1, defCard(state).instanceId).newState; // absorbed, charges 0
    expect(defCard(s1).armCharges).toBe(0);
    // Simulate a fresh +2 ARM buff: currentArm now 3 (> remaining 0) ⇒ re-tops to 3.
    const buffed = {
      ...s1,
      players: s1.players.map((p, i) =>
        i === 1
          ? {
              ...p,
              zones: {
                ...p.zones,
                frontline: p.zones.frontline.map(c =>
                  c?.instanceId === defCard(s1).instanceId ? { ...c, currentArm: 3 } : c,
                ),
              },
            }
          : p,
      ) as typeof s1.players,
    };
    const s2 = resolveCombat(buffed, a2, defCard(buffed).instanceId).newState; // absorbed again
    expect(defHp(s2)).toBe(99);
    // Fresh buff added (3 − 1 already-synced) = 2 charges to the 0 remaining; this
    // hit absorbs one ⇒ 1 left.
    expect(defCard(s2).armCharges).toBe(1);
  });

  it('0 ARM takes full damage with no charge tracking', () => {
    const { state, a1 } = gangState(TEST_B, 0);
    const after = resolveCombat(state, a1, defCard(state).instanceId).newState;
    expect(defHp(after)).toBe(96); // full 3
    expect(defCard(after).armCharges).toBeUndefined();
  });
});

describe('ARM alt mechanics — OFF (default per-instance, byte-identical)', () => {
  beforeEach(() => {
    resetInstanceCounter();
  });

  it('every instance is reduced per-instance when both toggles are absent', () => {
    const { state, a1, a2 } = gangState(OFF, 2);
    const s1 = resolveCombat(state, a1, defCard(state).instanceId).newState; // 3 − 2 = 1 → 98
    const s2 = resolveCombat(s1, a2, defCard(s1).instanceId).newState; // 3 − 2 = 1 → 97
    expect(defHp(s2)).toBe(97);
    expect(defCard(s2).armConsumed).toBeUndefined();
    expect(defCard(s2).armCharges).toBeUndefined();
  });

  it('passTurn leaves bodies untouched when the toggles are OFF', () => {
    const { state, a1 } = gangState(OFF, 2);
    const s1 = resolveCombat(state, a1, defCard(state).instanceId).newState;
    const before = defCard(s1);
    const after = passTurn(s1).players[1]!.zones.frontline[0]!;
    expect(after).toBe(before);
  });
});
