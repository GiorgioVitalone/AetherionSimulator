/**
 * Hero transformation — verifies declare_transform flips the active Hero to its
 * transformed side: swaps name/abilities, shifts maxLp by the delta while keeping
 * current LP (damage), marks transformedThisTurn, and registers
 * the transformed side's triggered abilities so they become live.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { executePlayerAction } from '../../src/state-machine/actions.js';
import { computeAvailableActions } from '../../src/actions/available-actions.js';
import {
  mockHero,
  mockGameState,
  mockPlayerState,
  resetInstanceCounter,
} from '../helpers/card-factory.js';
import type { AbilityDSL } from '../../src/types/ability.js';
import type { HeroTransformData } from '../../src/types/game-state.js';
import type { DeclareTransformAction } from '../../src/state-machine/types.js';

const ultimate: AbilityDSL = {
  type: 'triggered',
  trigger: { type: 'activated', cost: { mana: 0, energy: 0, flexible: 0 }, cooldown: 0 },
  effects: [{ type: 'heal', amount: { type: 'fixed', value: 5 }, target: { type: 'owner_hero' } }],
};

function transformData(): HeroTransformData {
  return { cardDefId: 999, name: 'Transformed Form', lpDelta: 0, abilities: [ultimate] };
}

const DO_TRANSFORM: DeclareTransformAction = { type: 'declare_transform' };

describe('declare_transform', () => {
  beforeEach(() => resetInstanceCounter());

  it('flips the hero, swaps abilities, keeps LP, registers triggers', () => {
    const hero = mockHero({
      currentLp: 8,
      maxLp: 25,
      transformData: transformData(),
    });
    const state = mockGameState({
      phase: 'strategy',
      players: [mockPlayerState(0, { hero }), mockPlayerState(1)],
    });

    const result = executePlayerAction(state, DO_TRANSFORM);
    const h = result.state.players[0].hero;

    expect(h.transformed).toBe(true);
    expect(h.transformedThisTurn).toBe(true);
    expect(h.name).toBe('Transformed Form');
    expect(h.currentLp).toBe(8); // damage preserved
    expect(h.maxLp).toBe(25); // lpDelta 0
    expect(h.abilities).toHaveLength(1);
    expect(h.registeredTriggers).toHaveLength(1); // ultimate registered
    expect(h.registeredTriggers[0]!.ownerPlayerId).toBe(0);
  });

  it('applies lpDelta to maxLp while leaving current damage intact', () => {
    const hero = mockHero({
      currentLp: 6,
      maxLp: 25,
      transformData: { cardDefId: 5, name: 'Bigger', lpDelta: 5, abilities: [] },
    });
    const state = mockGameState({
      phase: 'strategy',
      players: [mockPlayerState(0, { hero }), mockPlayerState(1)],
    });
    const result = executePlayerAction(state, DO_TRANSFORM);
    expect(result.state.players[0].hero.maxLp).toBe(30);
    expect(result.state.players[0].hero.currentLp).toBe(6);
  });

  it('is a no-op once already transformed or with no transform data', () => {
    const noData = mockHero({ currentLp: 5 });
    const s1 = mockGameState({
      phase: 'strategy',
      players: [mockPlayerState(0, { hero: noData }), mockPlayerState(1)],
    });
    expect(executePlayerAction(s1, DO_TRANSFORM).state.players[0].hero.transformed).toBe(false);

    const already = mockHero({ currentLp: 5, transformed: true, transformData: transformData() });
    const s2 = mockGameState({
      phase: 'strategy',
      players: [mockPlayerState(0, { hero: already }), mockPlayerState(1)],
    });
    const r2 = executePlayerAction(s2, DO_TRANSFORM);
    expect(r2.state.players[0].hero.name).toBe(already.name); // unchanged
  });
});

describe('transform eligibility (computeAvailableActions.canTransform)', () => {
  beforeEach(() => resetInstanceCounter());

  it('is allowed when LP <= 10', () => {
    const state = mockGameState({
      phase: 'strategy',
      players: [mockPlayerState(0, { hero: mockHero({ currentLp: 10 }) }), mockPlayerState(1)],
    });
    expect(computeAvailableActions(state).canTransform).toBe(true);
  });

  it('is allowed on a 5+ resource deficit with no characters in play', () => {
    const me = mockPlayerState(0, {
      hero: mockHero({ currentLp: 25 }),
      resourceBank: [],
    });
    const opp = mockPlayerState(1, {
      resourceBank: Array.from({ length: 6 }, (_, i) => ({
        instanceId: `r${String(i)}`,
        resourceType: 'mana' as const,
        exhausted: false,
      })),
    });
    const state = mockGameState({ phase: 'strategy', players: [me, opp] });
    expect(computeAvailableActions(state).canTransform).toBe(true);
  });

  it('is disallowed at full LP with parity in resources', () => {
    const state = mockGameState({
      phase: 'strategy',
      players: [mockPlayerState(0, { hero: mockHero({ currentLp: 25 }) }), mockPlayerState(1)],
    });
    expect(computeAvailableActions(state).canTransform).toBe(false);
  });
});

describe('hero activated abilities are usable in the Strategy Phase', () => {
  beforeEach(() => resetInstanceCounter());

  it('lists and executes a Hero activated ability (e.g. after transform)', () => {
    const hero = mockHero({
      cardDefId: 42,
      currentLp: 18,
      maxLp: 25,
      abilities: [ultimate], // activated heal-5
    });
    const state = mockGameState({
      phase: 'strategy',
      players: [mockPlayerState(0, { hero }), mockPlayerState(1)],
    });

    const opts = computeAvailableActions(state).canActivateAbility;
    const heroOpt = opts.find(o => o.cardInstanceId === 'hero_42');
    expect(heroOpt).toBeDefined();

    const result = executePlayerAction(state, {
      type: 'activate_ability',
      cardInstanceId: 'hero_42',
      abilityIndex: 0,
    });
    // Heal 5: 18 -> 23 (under maxLp 25, no cap).
    expect(result.state.players[0].hero.currentLp).toBe(23);
  });
});
