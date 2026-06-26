/**
 * Design-sweep config knobs (default-OFF diagnostics):
 *  - damageScale: multiply COMBAT damage (character + hero face), Math.round.
 *  - frontlineSlots / highGroundSlots: per-player zone-capacity overrides.
 *
 * Engine-level behavior is asserted via the damage calculator + combat resolver
 * + zone manager; the byte-identical-no-op + determinism guarantees are asserted
 * through runSim (default-OFF and explicit-default both reproduce the baseline).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  calculateCombatDamage,
  calculateHeroDamage,
} from '../../src/combat/damage-calculator.js';
import { resolveCombat } from '../../src/combat/combat-resolver.js';
import { deployToZone } from '../../src/zones/zone-manager.js';
import {
  mockCard,
  mockGameState,
  mockPlayerState,
  resetInstanceCounter,
  emptyZones,
} from '../helpers/card-factory.js';
import type { ZoneState } from '../../src/types/game-state.js';

const runnerPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../sim-runner.mjs');

describe('damageScale knob', () => {
  beforeEach(() => {
    resetInstanceCounter();
  });

  it('default (1) leaves combat damage unchanged; 2 doubles it (calculator)', () => {
    const base = calculateCombatDamage(3, 0, 5, 2, 0, 5, [], []);
    expect(base.damageToDefender).toBe(3);
    expect(base.damageToAttacker).toBe(2);

    const scaled = calculateCombatDamage(3, 0, 5, 2, 0, 5, [], [], r => r, r => r, 2);
    expect(scaled.damageToDefender).toBe(6); // 3 * 2
    expect(scaled.damageToAttacker).toBe(4); // 2 * 2
  });

  it('scales AFTER ARM, and drives lethality from the scaled magnitude', () => {
    // raw 3, ARM 1 => 2 post-ARM; *2 => 4 dealt, which is lethal vs 4 HP.
    const scaled = calculateCombatDamage(3, 0, 5, 0, 1, 4, [], [], r => r, r => r, 2);
    expect(scaled.damageToDefender).toBe(4); // (3 - 1) * 2
    expect(scaled.defenderDestroyed).toBe(true);
  });

  it('scales hero face damage with Math.round rounding', () => {
    expect(calculateHeroDamage(5, 0)).toBe(5);
    expect(calculateHeroDamage(5, 0, 2)).toBe(10);
    expect(calculateHeroDamage(3, 0, 1.5)).toBe(5); // round(4.5) = 5 (Math.round, half up)
  });

  it('damageScale 2 doubles a real combat hit through the resolver', () => {
    const make = (damageScale: number) => {
      resetInstanceCounter();
      let p0 = emptyZones();
      const atk = mockCard({ owner: 0, currentAtk: 3, currentHp: 10, currentArm: 0 });
      p0 = deployToZone(p0, atk, 'frontline');
      let p1 = emptyZones();
      const def = mockCard({ owner: 1, currentAtk: 0, currentHp: 20, currentArm: 0 });
      p1 = deployToZone(p1, def, 'frontline');
      const state = mockGameState({
        players: [mockPlayerState(0, { zones: p0 }), mockPlayerState(1, { zones: p1 })],
        config: { terminationMode: 'turn_cap', damageScale },
      });
      const r = resolveCombat(state, atk.instanceId, def.instanceId);
      const hit = r.events.find(e => e.type === 'DAMAGE_DEALT' && e.targetId === def.instanceId);
      return hit && hit.type === 'DAMAGE_DEALT' ? hit.amount : 0;
    };
    expect(make(1)).toBe(3);
    expect(make(2)).toBe(6);
  });
});

describe('zone-capacity knobs', () => {
  beforeEach(() => {
    resetInstanceCounter();
  });

  // Capacity is carried by the physical zone-array length; the sim-runner resizes
  // the arrays to match the config. These build the post-resize zones directly.
  const fourFrontline = (): ZoneState => ({ reserve: [null, null], frontline: [null, null, null, null], highGround: [null, null] });
  const threeHighGround = (): ZoneState => ({ reserve: [null, null], frontline: [null, null, null], highGround: [null, null, null] });

  it('frontlineSlots 4 allows a 4th Frontline deploy; default 3 caps at 3', () => {
    // Default 3-slot board: a 4th deploy throws (no open slot).
    let def = emptyZones();
    for (let i = 0; i < 3; i++) def = deployToZone(def, mockCard({ owner: 0 }), 'frontline');
    expect(() => deployToZone(def, mockCard({ owner: 0 }), 'frontline')).toThrow('No open slot in frontline');

    // 4-slot board: the 4th deploy succeeds and lands in slot index 3.
    let wide = fourFrontline();
    for (let i = 0; i < 4; i++) wide = deployToZone(wide, mockCard({ owner: 0 }), 'frontline');
    expect(wide.frontline.filter(s => s !== null)).toHaveLength(4);
    expect(wide.frontline[3]).not.toBeNull();
    // Explicit 4th slot index is in range under the wider board.
    const explicit = deployToZone(fourFrontline(), mockCard({ owner: 0 }), 'frontline', 3);
    expect(explicit.frontline[3]).not.toBeNull();
  });

  it('highGroundSlots 3 allows a 3rd High Ground deploy; default 2 caps at 2', () => {
    let def = emptyZones();
    for (let i = 0; i < 2; i++) def = deployToZone(def, mockCard({ owner: 0 }), 'high_ground');
    expect(() => deployToZone(def, mockCard({ owner: 0 }), 'high_ground')).toThrow('No open slot in high_ground');

    let wide = threeHighGround();
    for (let i = 0; i < 3; i++) wide = deployToZone(wide, mockCard({ owner: 0 }), 'high_ground');
    expect(wide.highGround.filter(s => s !== null)).toHaveLength(3);
    expect(wide.highGround[2]).not.toBeNull();
  });
});

describe('design-sweep knobs: byte-identical no-op + determinism (runSim)', () => {
  it('default-OFF, explicit-default damageScale 1, and explicit-default 3/2 all reproduce the baseline runHash; real knobs diverge deterministically', async () => {
    const { runSim } = (await import(runnerPath)) as {
      runSim: (c: unknown) => { runHash: string };
    };
    const base = { matchups: 'all-pairs', gamesPerPairing: 6, seedBase: 999 };
    const off = runSim(base);

    // Explicit defaults collapse to the no-op baseline (not emitted into the hash).
    expect(runSim({ ...base, damageScale: 1 }).runHash).toBe(off.runHash);
    expect(runSim({ ...base, frontlineSlots: 3, highGroundSlots: 2 }).runHash).toBe(off.runHash);

    // Real knob values diverge, and are deterministic across two calls.
    const dmg = runSim({ ...base, damageScale: 2 });
    expect(dmg.runHash).not.toBe(off.runHash);
    expect(runSim({ ...base, damageScale: 2 }).runHash).toBe(dmg.runHash);

    const fl4 = runSim({ ...base, frontlineSlots: 4 });
    expect(fl4.runHash).not.toBe(off.runHash);
    expect(runSim({ ...base, frontlineSlots: 4 }).runHash).toBe(fl4.runHash);

    const hg3 = runSim({ ...base, highGroundSlots: 3 });
    expect(hg3.runHash).not.toBe(off.runHash);
    expect(hg3.runHash).not.toBe(fl4.runHash);
  }, 30000);
});
