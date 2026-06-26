/**
 * `disableHeroReachBySeat` — diagnostic "reach" isolation (default OFF ⇒ no-op).
 *
 * When `config.disableHeroReachBySeat[seat]` is true, that seat can never reduce
 * the ENEMY Hero's LP:
 *   (a) attack targeting never offers the enemy Hero (Flying / High-Ground /
 *       Empty-Board / Sniper hero attacks all lose the hero target), and the
 *       combat hero branch is unreachable as a result;
 *   (b) a direct `deal_damage` effect that seat sources against the enemy Hero
 *       deals 0 LP and fires no HERO_DAMAGED.
 * The seat can still kill enemy CHARACTERS, and its OWN hero is unaffected.
 *
 * Default (absent / both false) = byte-identical to the v10 baseline.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { getValidAttackTargets } from '../../src/zones/targeting.js';
import { executeEffect } from '../../src/effects/interpreter.js';
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
import type { Effect } from '../../src/types/effects.js';
import type { EffectContext } from '../../src/types/game-state.js';

// Seat 0 (the attacker/source) has its hero-reach disabled; seat 1 unaffected.
const REACH_OFF_SEAT0: GameConfig = {
  terminationMode: 'turn_cap',
  disableHeroReachBySeat: [true, false],
};
const OFF: GameConfig = { terminationMode: 'turn_cap' };

const ctx = (controllerId: 0 | 1): EffectContext => ({
  sourceInstanceId: `hero_${String(controllerId)}`,
  controllerId,
  triggerDepth: 0,
});

const damageEnemyHero: Effect = {
  type: 'deal_damage',
  target: { type: 'hero', side: 'enemy' },
  amount: { type: 'fixed', value: 5 },
} as Effect;

describe('disableHeroReachBySeat — ON for seat 0', () => {
  beforeEach(() => {
    resetInstanceCounter();
  });

  it('strips the enemy Hero from a High-Ground attacker on the disabled seat', () => {
    // Defender side (p1) has a body so the board is not empty; a High-Ground
    // attacker would normally see both the body and the hero.
    let p1 = emptyZones();
    p1 = deployToZone(p1, mockCard({ owner: 1, currentAtk: 0, currentHp: 5 }), 'frontline');
    const targets = getValidAttackTargets('high_ground', [], p1, REACH_OFF_SEAT0, 0);
    expect(targets.some(t => t.type === 'hero')).toBe(false);
    expect(targets.some(t => t.type === 'character')).toBe(true);
  });

  it('strips the Hero even under the Empty Board Rule for the disabled seat', () => {
    const targets = getValidAttackTargets('frontline', [], emptyZones(), REACH_OFF_SEAT0, 0);
    expect(targets).toHaveLength(0);
  });

  it('a Flying attacker on the disabled seat still cannot reach the enemy Hero', () => {
    let p1 = emptyZones();
    p1 = deployToZone(p1, mockCard({ owner: 1, currentAtk: 0, currentHp: 5 }), 'frontline');
    const targets = getValidAttackTargets('high_ground', ['flying'], p1, REACH_OFF_SEAT0, 0);
    expect(targets.some(t => t.type === 'hero')).toBe(false);
  });

  it('a direct deal_damage effect from the disabled seat deals 0 LP to the enemy hero', () => {
    const state = mockGameState({
      players: [
        mockPlayerState(0),
        mockPlayerState(1, { hero: mockHero({ currentLp: 25, maxLp: 25 }) }),
      ],
      config: REACH_OFF_SEAT0,
    });
    const result = executeEffect(state, damageEnemyHero, ctx(0));
    expect(result.newState.players[1]!.hero.currentLp).toBe(25);
    expect(result.events.some(e => e.type === 'HERO_DAMAGED')).toBe(false);
    expect(result.newState.winner).toBeNull();
  });

  it('the disabled seat can still kill enemy CHARACTERS', () => {
    let p1 = emptyZones();
    const victim = mockCard({ owner: 1, currentAtk: 0, currentHp: 4, currentArm: 0 });
    p1 = deployToZone(p1, victim, 'frontline');
    const state = mockGameState({
      players: [mockPlayerState(0), mockPlayerState(1, { zones: p1 })],
      config: REACH_OFF_SEAT0,
    });
    const dmgCharacter: Effect = {
      type: 'deal_damage',
      target: { type: 'all_characters', side: 'enemy' },
      amount: { type: 'fixed', value: 4 },
    } as Effect;
    const result = executeEffect(state, dmgCharacter, ctx(0));
    // The body is destroyed (removed from its zone).
    expect(result.newState.players[1]!.zones.frontline.every(c => c === null)).toBe(true);
  });

  it('the disabled seat can still damage its OWN hero (self-targeted, unaffected)', () => {
    const state = mockGameState({
      players: [
        mockPlayerState(0, { hero: mockHero({ currentLp: 25, maxLp: 25 }) }),
        mockPlayerState(1),
      ],
      config: REACH_OFF_SEAT0,
    });
    const selfDmg: Effect = {
      type: 'deal_damage',
      target: { type: 'hero', side: 'allied' },
      amount: { type: 'fixed', value: 5 },
    } as Effect;
    const result = executeEffect(state, selfDmg, ctx(0));
    expect(result.newState.players[0]!.hero.currentLp).toBe(20);
  });
});

describe('disableHeroReachBySeat — the OTHER seat is unaffected', () => {
  beforeEach(() => {
    resetInstanceCounter();
  });

  it('seat 1 (not disabled) can still target and damage the enemy hero', () => {
    // Targeting: a High-Ground attacker on seat 1 sees the hero normally.
    let p0 = emptyZones();
    p0 = deployToZone(p0, mockCard({ owner: 0, currentAtk: 0, currentHp: 5 }), 'frontline');
    const targets = getValidAttackTargets('high_ground', [], p0, REACH_OFF_SEAT0, 1);
    expect(targets.some(t => t.type === 'hero')).toBe(true);
    // Direct damage: seat 1 reduces seat 0's hero LP.
    const state = mockGameState({
      players: [
        mockPlayerState(0, { hero: mockHero({ currentLp: 25, maxLp: 25 }) }),
        mockPlayerState(1),
      ],
      config: REACH_OFF_SEAT0,
    });
    const result = executeEffect(state, damageEnemyHero, ctx(1));
    expect(result.newState.players[0]!.hero.currentLp).toBe(20);
    expect(result.events.some(e => e.type === 'HERO_DAMAGED')).toBe(true);
  });
});

describe('disableHeroReachBySeat — OFF (default, byte-identical)', () => {
  beforeEach(() => {
    resetInstanceCounter();
  });

  it('a High-Ground attacker reaches the enemy hero normally when the toggle is OFF', () => {
    let p1 = emptyZones();
    p1 = deployToZone(p1, mockCard({ owner: 1, currentAtk: 0, currentHp: 5 }), 'frontline');
    const targets = getValidAttackTargets('high_ground', [], p1, OFF, 0);
    expect(targets.some(t => t.type === 'hero')).toBe(true);
  });

  it('the Empty Board Rule still grants a hero target when the toggle is OFF', () => {
    const targets = getValidAttackTargets('frontline', [], emptyZones(), OFF, 0);
    expect(targets).toEqual([{ type: 'hero', instanceId: null }]);
  });

  it('a direct deal_damage effect reduces the enemy hero LP normally when OFF', () => {
    const state = mockGameState({
      players: [
        mockPlayerState(0),
        mockPlayerState(1, { hero: mockHero({ currentLp: 25, maxLp: 25 }) }),
      ],
      config: OFF,
    });
    const result = executeEffect(state, damageEnemyHero, ctx(0));
    expect(result.newState.players[1]!.hero.currentLp).toBe(20);
    expect(result.events.some(e => e.type === 'HERO_DAMAGED')).toBe(true);
  });
});
