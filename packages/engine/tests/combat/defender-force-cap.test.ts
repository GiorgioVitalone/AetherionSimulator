/**
 * EC-004 — `defenderForceCap` rule-variant semantics (combat-resolution level).
 *
 * When a positive cap N is set, a Frontline Defender forces at most N attackers onto
 * itself per turn. Once N attacks have been FORCED onto it this turn, it stops
 * forcing and additional attackers may attack freely (flow AROUND the wall). The
 * per-Defender counter is tracked on `CardInstance.forcedAttacksThisTurn`, incremented
 * in combat resolution when an attack lands on a body that was forcing, and reset at
 * the turn boundary (`passTurn`).
 *
 * Default (cap unset / <= 0) = the Defender forces ALL enemy attacks (current
 * behavior), byte-identical no-op.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { resolveCombat } from '../../src/combat/combat-resolver.js';
import { passTurn } from '../../src/state-machine/actions.js';
import { getValidAttackTargets } from '../../src/zones/targeting.js';
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

const CAP1: GameConfig = { terminationMode: 'turn_cap', defenderForceCap: 1 };
const OFF: GameConfig = { terminationMode: 'turn_cap' };

/** p0 has 4 attackers (2 High Ground so they can reach the hero once the wall is
 * down, 2 Frontline); p1 has a single high-HP Defender in the Frontline plus a hero.
 * Attackers deal 0 ATK so nothing is ever destroyed and the wall survives every
 * forced hit — letting us observe the cap flipping forcing off mid-turn. */
function buildState(config: GameConfig) {
  let p0 = emptyZones();
  const a0 = mockCard({ owner: 0, name: 'A0', currentAtk: 0, currentHp: 9, traits: [] });
  const a1 = mockCard({ owner: 0, name: 'A1', currentAtk: 0, currentHp: 9, traits: [] });
  const a2 = mockCard({ owner: 0, name: 'A2', currentAtk: 0, currentHp: 9, traits: [] });
  const a3 = mockCard({ owner: 0, name: 'A3', currentAtk: 0, currentHp: 9, traits: [] });
  p0 = deployToZone(p0, a0, 'high_ground');
  p0 = deployToZone(p0, a1, 'high_ground');
  p0 = deployToZone(p0, a2, 'frontline');
  p0 = deployToZone(p0, a3, 'frontline');
  let p1 = emptyZones();
  const def = mockCard({ owner: 1, name: 'Wall', currentAtk: 0, currentHp: 50, currentArm: 0, traits: ['defender'] });
  p1 = deployToZone(p1, def, 'frontline');
  const state = mockGameState({
    players: [
      mockPlayerState(0, { zones: p0 }),
      mockPlayerState(1, { zones: p1, hero: mockHero({ currentLp: 30, maxLp: 30, currentArm: 0 }) }),
    ],
    config,
  });
  return { state, ids: { a0: a0.instanceId, a1: a1.instanceId, a2: a2.instanceId, a3: a3.instanceId, def: def.instanceId } };
}

function readyAll(state: ReturnType<typeof mockGameState>) {
  return {
    ...state,
    players: state.players.map((p, i) =>
      i === 0
        ? {
            ...p,
            zones: {
              reserve: p.zones.reserve.map(c => (c ? { ...c, exhausted: false } : c)),
              frontline: p.zones.frontline.map(c => (c ? { ...c, exhausted: false } : c)),
              highGround: p.zones.highGround.map(c => (c ? { ...c, exhausted: false } : c)),
            },
          }
        : p,
    ) as typeof state.players,
  };
}

describe('EC-004 defenderForceCap — ON (cap = 1)', () => {
  beforeEach(() => {
    resetInstanceCounter();
  });

  it('the first attacker is FORCED onto the Defender (cap not yet reached)', () => {
    const { state, ids } = buildState(CAP1);
    // A high-ground attacker: while the Defender is under cap, only the Defender is a
    // valid target (no hero option).
    const targets = getValidAttackTargets('high_ground', [], state.players[1]!.zones, CAP1);
    expect(targets).toHaveLength(1);
    expect(targets[0]?.instanceId).toBe(ids.def);
    // Resolve the forced attack ⇒ the Defender's counter ticks to 1.
    const after = resolveCombat(state, ids.a0, ids.def).newState;
    expect(after.players[1]!.zones.frontline[0]!.forcedAttacksThisTurn).toBe(1);
  });

  it('a 4th attacker bypasses a cap-1 Defender (flows around the wall to the hero)', () => {
    const { state, ids } = buildState(CAP1);
    // Attack 1 (forced onto the wall) ⇒ counter = 1 = cap.
    const s1 = resolveCombat(state, ids.a0, ids.def).newState;
    expect(s1.players[1]!.zones.frontline[0]!.forcedAttacksThisTurn).toBe(1);
    // Now the wall is capped out: subsequent high-ground attackers see the hero as a
    // legal target (the wall no longer forces). (Frontline attackers still cannot
    // reach the hero — the zone matrix is unchanged; only high-ground reaches face.)
    const targets = getValidAttackTargets('high_ground', [], s1.players[1]!.zones, CAP1);
    expect(targets.some(t => t.type === 'hero')).toBe(true);
    // A fresh HIGH-GROUND attacker (a1) attacks the HERO directly through the open
    // wall — the bypass that a cap-1 wall now permits. Give it real ATK so the bypass
    // shows on the hero LP.
    const heroBefore = s1.players[1]!.hero.currentLp;
    const s1b = {
      ...s1,
      players: s1.players.map((p, i) =>
        i === 0
          ? {
              ...p,
              zones: {
                ...p.zones,
                highGround: p.zones.highGround.map(c =>
                  c?.instanceId === ids.a1 ? { ...c, currentAtk: 5 } : c,
                ),
              },
            }
          : p,
      ) as typeof s1.players,
    };
    const s2 = resolveCombat(s1b, ids.a1, 'hero').newState;
    expect(s2.players[1]!.hero.currentLp).toBe(heroBefore - 5);
    // The wall's forced counter did NOT increment (the hero hit was a bypass).
    expect(s2.players[1]!.zones.frontline[0]!.forcedAttacksThisTurn).toBe(1);
  });

  it('the Defender remains a LEGAL (freely-chosen) target after capping out', () => {
    const { state, ids } = buildState(CAP1);
    const s1 = resolveCombat(state, ids.a0, ids.def).newState;
    const targets = getValidAttackTargets('frontline', [], s1.players[1]!.zones, CAP1);
    // The capped Defender is still in the target list (just no longer mandatory).
    expect(targets.some(t => t.instanceId === ids.def)).toBe(true);
  });

  it("the Defender's forced counter RESETS at the turn boundary (forces again next turn)", () => {
    const { state, ids } = buildState(CAP1);
    const s1 = resolveCombat(state, ids.a0, ids.def).newState;
    expect(s1.players[1]!.zones.frontline[0]!.forcedAttacksThisTurn).toBe(1);
    // Pass two turns to return to p0 as the active attacker, then re-ready bodies.
    const back = readyAll({
      ...passTurn(passTurn(s1)),
      activePlayerIndex: 0 as const,
    });
    // The counter recharged to 0 ⇒ the wall forces again on the fresh turn.
    expect(back.players[1]!.zones.frontline[0]!.forcedAttacksThisTurn).toBe(0);
    const targets = getValidAttackTargets('high_ground', [], back.players[1]!.zones, CAP1);
    expect(targets).toHaveLength(1);
    expect(targets[0]?.instanceId).toBe(ids.def); // forced again — no hero option
  });
});

describe('EC-004 defenderForceCap — OFF (default, forcing unchanged)', () => {
  beforeEach(() => {
    resetInstanceCounter();
  });

  it('an uncapped Defender forces every attacker (no flow-around) and never tracks the counter', () => {
    const { state, ids } = buildState(OFF);
    const s1 = resolveCombat(state, ids.a0, ids.def).newState;
    // Default path never reads/writes the counter (byte-identical no-op).
    expect(s1.players[1]!.zones.frontline[0]!.forcedAttacksThisTurn).toBeUndefined();
    // Even after many forced hits, high-ground attackers still cannot reach the hero.
    const targets = getValidAttackTargets('high_ground', [], s1.players[1]!.zones, OFF);
    expect(targets.some(t => t.type === 'hero')).toBe(false);
    expect(targets).toHaveLength(1);
    expect(targets[0]?.instanceId).toBe(ids.def);
  });

  it('passTurn leaves the Defender untouched when the cap is OFF', () => {
    const { state, ids } = buildState(OFF);
    const s1 = resolveCombat(state, ids.a0, ids.def).newState;
    const before = s1.players[1]!.zones.frontline[0]!;
    const after = passTurn(s1).players[1]!.zones.frontline[0]!;
    expect(after).toBe(before); // same reference — passTurn allocated nothing for this body
  });
});
