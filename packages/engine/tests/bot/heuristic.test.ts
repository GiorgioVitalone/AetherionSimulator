/**
 * Heuristic bot policy — unit tests for individual decisions: deploy strongest,
 * promote to High Ground, attack the Hero, lethal combat targeting, transform,
 * and sensible pendingChoice responses.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { chooseAction, chooseChoiceResponse } from '../../src/bot/heuristic.js';
import {
  mockCard,
  mockHero,
  mockGameState,
  mockPlayerState,
  zonesWithCards,
  resetInstanceCounter,
} from '../helpers/card-factory.js';
import type { ResourceCard, HeroTransformData, PendingChoice } from '../../src/types/game-state.js';

function manaBank(n: number): ResourceCard[] {
  return Array.from({ length: n }, (_, i) => ({
    instanceId: `res_${String(i)}`,
    resourceType: 'mana' as const,
    exhausted: false,
  }));
}

describe('heuristic bot — strategy decisions', () => {
  beforeEach(() => resetInstanceCounter());

  it('deploys the strongest affordable creature', () => {
    const weak = mockCard({ instanceId: 'WEAK', currentAtk: 1, currentHp: 1, baseAtk: 1, baseHp: 1, cost: { mana: 1, energy: 0, flexible: 0 } });
    const strong = mockCard({ instanceId: 'STRONG', currentAtk: 4, currentHp: 4, baseAtk: 4, baseHp: 4, cost: { mana: 2, energy: 0, flexible: 0 } });
    const p0 = mockPlayerState(0, { hand: [weak, strong], resourceBank: manaBank(4) });
    const state = mockGameState({ phase: 'strategy', players: [p0, mockPlayerState(1)] });

    const action = chooseAction(state);
    expect(action).not.toBeNull();
    expect(action!.type).toBe('deploy');
    expect((action as { cardInstanceId: string }).cardInstanceId).toBe('STRONG');
  });

  it('declares transform when eligible and beneficial', () => {
    const data: HeroTransformData = { cardDefId: 7, name: 'X', lpDelta: 0, abilities: [] };
    const p0 = mockPlayerState(0, { hero: mockHero({ currentLp: 8, transformData: data }) });
    const state = mockGameState({ phase: 'strategy', players: [p0, mockPlayerState(1)] });
    expect(chooseAction(state)!.type).toBe('declare_transform');
  });

  it('promotes a ready Frontline attacker to High Ground', () => {
    const attacker = mockCard({
      instanceId: 'ATK', currentAtk: 3, summoningSick: false, exhausted: false, movedThisTurn: false,
    });
    const p0 = mockPlayerState(0, {
      hero: mockHero({ currentLp: 25 }),
      zones: zonesWithCards({ frontline: [attacker, null, null] }),
    });
    const state = mockGameState({ phase: 'strategy', players: [p0, mockPlayerState(1)] });
    const action = chooseAction(state);
    expect(action).not.toBeNull();
    expect(action!.type).toBe('move');
    expect((action as { toZone: string }).toZone).toBe('high_ground');
  });
});

describe('heuristic bot — combat decisions', () => {
  beforeEach(() => resetInstanceCounter());

  it('attacks the enemy Hero from High Ground when the board is empty', () => {
    const attacker = mockCard({ instanceId: 'ATK', currentAtk: 3, summoningSick: false });
    const p0 = mockPlayerState(0, { zones: zonesWithCards({ highGround: [attacker, null] }) });
    const state = mockGameState({ phase: 'action', players: [p0, mockPlayerState(1)] });
    const action = chooseAction(state);
    expect(action).not.toBeNull();
    expect(action!.type).toBe('declare_attack');
    expect((action as { targetId: string }).targetId).toBe('hero');
  });

  it('takes a lethal trade on the highest-value enemy creature', () => {
    // Beefy attacker survives both kills, so it picks the higher-value lethal.
    const attacker = mockCard({ instanceId: 'ATK', currentAtk: 4, currentHp: 10, summoningSick: false });
    const smallEnemy = mockCard({ instanceId: 'SMALL', owner: 1, currentAtk: 1, currentHp: 2, currentArm: 0 });
    const bigEnemy = mockCard({ instanceId: 'BIG', owner: 1, currentAtk: 5, currentHp: 4, currentArm: 0 });
    const p0 = mockPlayerState(0, { zones: zonesWithCards({ frontline: [attacker, null, null] }) });
    const p1 = mockPlayerState(1, { zones: zonesWithCards({ frontline: [smallEnemy, bigEnemy, null] }) });
    const state = mockGameState({ phase: 'action', players: [p0, p1] });

    const action = chooseAction(state);
    expect(action!.type).toBe('declare_attack');
    // 4 dmg is lethal to BIG (hp 4); prefer the higher-value kill.
    expect((action as { targetId: string }).targetId).toBe('BIG');
  });
});

describe('heuristic bot — combat value gate (purposeful vs pointless)', () => {
  beforeEach(() => resetInstanceCounter());

  it('declines a LONE pointless swing into an armored wall (kills nothing, opens nothing)', () => {
    // A single 2/2 attacker into a 0/2 ARM-2 Defender wall: damage = max(0, 2-2) = 0.
    // One body cannot finish the wall, so the swing is pure waste with no follow-up —
    // still declined. (A GANG that CAN kill the wall is allowed — see below.)
    const attacker = mockCard({ instanceId: 'ATK', currentAtk: 2, currentHp: 2, summoningSick: false });
    const wall = mockCard({ instanceId: 'WALL', owner: 1, currentAtk: 0, currentHp: 2, currentArm: 2 });
    const p0 = mockPlayerState(0, { zones: zonesWithCards({ frontline: [attacker, null, null] }) });
    const p1 = mockPlayerState(1, {
      hero: mockHero({ currentLp: 25 }),
      zones: zonesWithCards({ frontline: [wall, null, null] }),
    });
    const state = mockGameState({ phase: 'action', players: [p0, p1] });
    // Frontline attacker cannot reach the hero (wall present), and the only swing is
    // a 0-damage waste that nothing else can finish — so the bot declines.
    expect(chooseAction(state)).toBeNull();
  });

  it('declines a LONE chump suicide that kills nothing and dies back', () => {
    // A single 2/1 attacker into a 5/5 (not a Defender, no gate): deals 2 (no kill),
    // takes 5 (dies). No second body to finish it, so this is pointless — declined.
    const attacker = mockCard({ instanceId: 'ATK', currentAtk: 2, currentHp: 1, summoningSick: false });
    const big = mockCard({ instanceId: 'BIG', owner: 1, currentAtk: 5, currentHp: 5, currentArm: 0 });
    const p0 = mockPlayerState(0, { zones: zonesWithCards({ frontline: [attacker, null, null] }) });
    const p1 = mockPlayerState(1, {
      hero: mockHero({ currentLp: 25 }),
      zones: zonesWithCards({ frontline: [big, null, null] }),
    });
    const state = mockGameState({ phase: 'action', players: [p0, p1] });
    expect(chooseAction(state)).toBeNull();
  });

  it('GANGS two bodies to kill a big board-gating Defender (purposeful sacrifice)', () => {
    // Two 2/2 attackers vs a 3/4 ARM-0 Defender wall (power 7). Neither alone kills
    // it (4 HP) and each swing DIES to the 3 ATK return for only 2 chip — so the
    // greedy value gate refuses both (net -2 each). But together they deal 2+2 = 4 =
    // lethal, breaking the wall that gates the path to the Hero. The removal is worth
    // the two bodies, so the plan must ATTACK the wall, not hold.
    const a1 = mockCard({ instanceId: 'A1', currentAtk: 2, currentHp: 2, summoningSick: false });
    const a2 = mockCard({ instanceId: 'A2', currentAtk: 2, currentHp: 2, summoningSick: false });
    const wall = mockCard({
      instanceId: 'WALL', owner: 1, currentAtk: 3, currentHp: 4, currentArm: 0,
      traits: ['defender'],
    });
    const p0 = mockPlayerState(0, { zones: zonesWithCards({ frontline: [a1, a2, null] }) });
    const p1 = mockPlayerState(1, {
      hero: mockHero({ currentLp: 25 }),
      zones: zonesWithCards({ frontline: [wall, null, null] }),
    });
    const state = mockGameState({ phase: 'action', players: [p0, p1] });
    const action = chooseAction(state);
    expect(action).not.toBeNull();
    expect(action!.type).toBe('declare_attack');
    expect((action as { targetId: string }).targetId).toBe('WALL');
  });

  it('declines to GANG a Defender the committed attackers still cannot kill', () => {
    // Two 2/2 attackers vs a 1/4 ARM-2 Defender: each swing deals max(0, 2-2) = 0,
    // so even ganged they cannot break it. Pointless — the bot holds, not a sacrifice.
    const a1 = mockCard({ instanceId: 'A1', currentAtk: 2, currentHp: 2, summoningSick: false });
    const a2 = mockCard({ instanceId: 'A2', currentAtk: 2, currentHp: 2, summoningSick: false });
    const wall = mockCard({
      instanceId: 'WALL', owner: 1, currentAtk: 1, currentHp: 4, currentArm: 2,
      traits: ['defender'],
    });
    const p0 = mockPlayerState(0, { zones: zonesWithCards({ frontline: [a1, a2, null] }) });
    const p1 = mockPlayerState(1, {
      hero: mockHero({ currentLp: 25 }),
      zones: zonesWithCards({ frontline: [wall, null, null] }),
    });
    const state = mockGameState({ phase: 'action', players: [p0, p1] });
    expect(chooseAction(state)).toBeNull();
  });

  it('is ARM/shield-aware: targets the body it can actually hurt', () => {
    // Attacker 3 ATK. SHIELDED has a -2 "would take damage" replacement plus ARM 1
    // (nets 0 through), SOFT has no mitigation. The bot must pick SOFT, not the
    // shielded body it cannot damage.
    const attacker = mockCard({ instanceId: 'ATK', currentAtk: 3, currentHp: 6, summoningSick: false });
    const shielded = mockCard({
      instanceId: 'SHIELDED', owner: 1, currentAtk: 1, currentHp: 4, currentArm: 1,
      activeReplacements: [{
        id: 'r1', sourceInstanceId: 'SHIELDED',
        replaces: { type: 'on_would_take_damage', reduction: 2 },
        instead: [], oncePerTurn: false, usedThisTurn: false,
      }],
    });
    const soft = mockCard({ instanceId: 'SOFT', owner: 1, currentAtk: 1, currentHp: 4, currentArm: 0 });
    const p0 = mockPlayerState(0, { zones: zonesWithCards({ frontline: [attacker, null, null] }) });
    const p1 = mockPlayerState(1, { zones: zonesWithCards({ frontline: [shielded, soft, null] }) });
    const state = mockGameState({ phase: 'action', players: [p0, p1] });
    const action = chooseAction(state);
    expect(action!.type).toBe('declare_attack');
    expect((action as { targetId: string }).targetId).toBe('SOFT');
  });

  it('does not attack the Hero when ARM fully absorbs the swing', () => {
    // 2 ATK into a hero with ARM 3 deals 0 — wasted face swing, so hold.
    const attacker = mockCard({ instanceId: 'ATK', currentAtk: 2, summoningSick: false });
    const p0 = mockPlayerState(0, { zones: zonesWithCards({ highGround: [attacker, null] }) });
    const p1 = mockPlayerState(1, { hero: mockHero({ currentArm: 3 }) });
    const state = mockGameState({ phase: 'action', players: [p0, p1] });
    expect(chooseAction(state)).toBeNull();
  });
});

describe('heuristic bot — pendingChoice', () => {
  beforeEach(() => resetInstanceCounter());

  it('discards the lowest-value cards to meet the hand limit', () => {
    const creature = mockCard({ instanceId: 'KEEP', cardType: 'C', currentAtk: 4, currentHp: 4 });
    const spell = mockCard({ instanceId: 'DROP', cardType: 'S', currentAtk: 0, currentHp: 0 });
    const p0 = mockPlayerState(0, { hand: [creature, spell] });
    const pc: PendingChoice = {
      type: 'discard_to_hand_limit',
      playerId: 0,
      options: [
        { id: 'KEEP', label: 'k', instanceId: 'KEEP' },
        { id: 'DROP', label: 'd', instanceId: 'DROP' },
      ],
      minSelections: 1,
      maxSelections: 1,
      context: '',
    };
    const state = mockGameState({ players: [p0, mockPlayerState(1)], pendingChoice: pc });
    expect(chooseChoiceResponse(state)).toEqual(['DROP']);
  });
});
