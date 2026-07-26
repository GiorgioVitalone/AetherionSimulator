import { describe, expect, it } from 'vitest';
import { executeEffect } from '../../src/effects/interpreter.js';
import { exileCardFromState } from '../../src/effects/state-helpers.js';
import { resolveCombat } from '../../src/combat/combat-resolver.js';
import { refreshCards } from '../../src/state-machine/actions.js';
import { tickStatusEffects } from '../../src/runtime/status-tick.js';
import {
  mockCard,
  mockGameState,
  mockPlayerState,
  zonesWithCards,
} from '../helpers/card-factory.js';
import type { GameState } from '../../src/types/game-state.js';

const context = {
  sourceInstanceId: 'source',
  controllerId: 0 as const,
  triggerDepth: 0,
};

function cardIn(state: GameState, id: string) {
  for (const player of state.players) {
    for (const card of [
      ...player.zones.reserve,
      ...player.zones.frontline,
      ...player.zones.highGround,
    ]) {
      if (card?.instanceId === id) return card;
    }
  }
  throw new Error(`missing ${id}`);
}

describe('status replacement semantics', () => {
  for (const status of ['persistent', 'regeneration'] as const) {
    it(`${status}: lower/equal applications do not stack and higher replaces`, () => {
      const body = mockCard({
        instanceId: 'body',
        statusEffects: [{ statusType: status, value: 3, remainingTurns: null }],
      });
      let state = mockGameState({
        players: [
          mockPlayerState(0, {
            zones: zonesWithCards({ frontline: [body, null, null] }),
          }),
          mockPlayerState(1),
        ],
      });
      for (const value of [2, 3, 5]) {
        state = executeEffect(
          state,
          {
            type: 'apply_status',
            status,
            value,
            target: { type: 'self' },
          },
          { ...context, sourceInstanceId: 'body' },
        ).newState;
        const matching = cardIn(state, 'body').statusEffects.filter(
          (entry) => entry.statusType === status,
        );
        expect(matching).toHaveLength(1);
        expect(matching[0]!.value).toBe(value === 5 ? 5 : 3);
      }
    });
  }

  it('routes Persistent through ordinary damage replacements', () => {
    const body = mockCard({
      instanceId: 'body',
      currentHp: 5,
      statusEffects: [
        { statusType: 'persistent', value: 2, remainingTurns: null },
      ],
      activeReplacements: [
        {
          id: 'shield',
          sourceInstanceId: 'body',
          replaces: { type: 'on_would_take_damage', reduction: 1 },
          instead: [],
          oncePerTurn: true,
          usedThisTurn: false,
        },
      ],
    });
    const result = tickStatusEffects(
      mockGameState({
        players: [
          mockPlayerState(0, {
            zones: zonesWithCards({ frontline: [body, null, null] }),
          }),
          mockPlayerState(1),
        ],
      }),
      0,
    );
    expect(cardIn(result.state, 'body').currentHp).toBe(4);
    expect(
      cardIn(result.state, 'body').activeReplacements?.[0]?.usedThisTurn,
    ).toBe(true);
  });
});

describe('duration lifecycle', () => {
  it('consumes a two-upkeep Stun exactly once per owner upkeep', () => {
    const body = mockCard({
      instanceId: 'body',
      exhausted: true,
      statusEffects: [
        { statusType: 'stunned', value: 1, remainingTurns: 2 },
      ],
    });
    let state = mockGameState({
      players: [
        mockPlayerState(0, {
          zones: zonesWithCards({ frontline: [body, null, null] }),
        }),
        mockPlayerState(1),
      ],
    });
    state = refreshCards(state);
    expect(cardIn(state, 'body').exhausted).toBe(true);
    expect(cardIn(state, 'body').statusEffects[0]?.remainingTurns).toBe(1);
    state = refreshCards(state);
    expect(cardIn(state, 'body').exhausted).toBe(true);
    expect(cardIn(state, 'body').statusEffects).toHaveLength(0);
    state = refreshCards(state);
    expect(cardIn(state, 'body').exhausted).toBe(false);
  });

  it('expires for-combat modifiers and traits at combat end', () => {
    const attacker = mockCard({
      instanceId: 'attacker',
      currentAtk: 3,
      baseAtk: 3,
      summoningSick: false,
      exhausted: false,
    });
    let state = mockGameState({
      phase: 'action',
      players: [
        mockPlayerState(0, {
          zones: zonesWithCards({ frontline: [attacker, null, null] }),
        }),
        mockPlayerState(1),
      ],
    });
    state = executeEffect(
      state,
      {
        type: 'modify_stats',
        modifier: { atk: 2 },
        target: { type: 'self' },
        duration: { type: 'for_combat' },
      },
      { ...context, sourceInstanceId: 'attacker' },
    ).newState;
    state = executeEffect(
      state,
      {
        type: 'grant_trait',
        trait: 'flying',
        target: { type: 'self' },
        duration: { type: 'for_combat' },
      },
      { ...context, sourceInstanceId: 'attacker' },
    ).newState;
    expect(cardIn(state, 'attacker').currentAtk).toBe(5);
    const result = resolveCombat(state, 'attacker', 'hero');
    expect(result.newState.players[1].hero.currentLp).toBe(20);
    expect(cardIn(result.newState, 'attacker').currentAtk).toBe(3);
    expect(cardIn(result.newState, 'attacker').grantedTraits).toHaveLength(0);
  });

  it('does not persist instant stat or trait grants', () => {
    const body = mockCard({ instanceId: 'body', currentAtk: 3 });
    let state = mockGameState({
      players: [
        mockPlayerState(0, {
          zones: zonesWithCards({ frontline: [body, null, null] }),
        }),
        mockPlayerState(1),
      ],
    });
    state = executeEffect(
      state,
      {
        type: 'modify_stats',
        modifier: { atk: 9 },
        target: { type: 'self' },
        duration: { type: 'instant' },
      },
      { ...context, sourceInstanceId: 'body' },
    ).newState;
    state = executeEffect(
      state,
      {
        type: 'grant_trait',
        trait: 'flying',
        target: { type: 'self' },
        duration: { type: 'instant' },
      },
      { ...context, sourceInstanceId: 'body' },
    ).newState;
    expect(cardIn(state, 'body').currentAtk).toBe(3);
    expect(cardIn(state, 'body').grantedTraits).toHaveLength(0);
  });

  it('expires while-in-play modifiers when their source leaves', () => {
    const source = mockCard({ instanceId: 'source' });
    const target = mockCard({ instanceId: 'target', currentHp: 3 });
    let state = mockGameState({
      players: [
        mockPlayerState(0, {
          zones: zonesWithCards({
            frontline: [source, target, null],
          }),
        }),
        mockPlayerState(1),
      ],
    });
    state = executeEffect(
      state,
      {
        type: 'modify_stats',
        modifier: { hp: 2 },
        target: { type: 'target_character', side: 'allied' },
        duration: { type: 'while_in_play' },
      },
      { ...context, selectedTargets: ['target'] },
    ).newState;
    expect(cardIn(state, 'target').currentHp).toBe(5);
    state = exileCardFromState(state, 'source', 'effect');
    expect(cardIn(state, 'target').currentHp).toBe(3);
    expect(cardIn(state, 'target').modifiers).toHaveLength(0);
  });
});
