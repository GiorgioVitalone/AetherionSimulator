import { describe, expect, it } from 'vitest';
import { runEffectSequence } from '../../src/effects/effect-runner.js';
import { CURRENT_GAME_CONFIG } from '../../src/rules/manifest.js';
import { transition } from '../../src/transitions/transition.js';
import type { Effect, GameState } from '../../src/index.js';
import {
  mockCard,
  mockGameState,
  mockPlayerState,
  zonesWithCards,
} from '../helpers/card-factory.js';

function cardHp(state: GameState, instanceId: string): number | null {
  for (const player of state.players) {
    for (const zone of [
      player.zones.reserve,
      player.zones.frontline,
      player.zones.highGround,
    ]) {
      const card = zone.find((candidate) => candidate?.instanceId === instanceId);
      if (card !== undefined && card !== null) return card.currentHp;
    }
  }
  return null;
}

describe('effect-path keyed target choices', () => {
  it('pauses and consumes two independent target selections in sequence', () => {
    const source = mockCard({ instanceId: 'source', owner: 0 });
    const firstTarget = mockCard({
      instanceId: 'first-target',
      owner: 1,
      baseHp: 5,
      currentHp: 5,
    });
    const secondTarget = mockCard({
      instanceId: 'second-target',
      owner: 1,
      baseHp: 5,
      currentHp: 5,
    });
    const state = mockGameState({
      config: CURRENT_GAME_CONFIG,
      players: [
        mockPlayerState(0, {
          zones: zonesWithCards({ frontline: [source] }),
        }),
        mockPlayerState(1, {
          zones: zonesWithCards({
            frontline: [firstTarget, secondTarget, null],
          }),
        }),
      ],
    });
    const effects: readonly Effect[] = [
      {
        type: 'deal_damage',
        amount: { type: 'fixed', value: 1 },
        target: { type: 'target_character', side: 'enemy' },
      },
      {
        type: 'deal_damage',
        amount: { type: 'fixed', value: 2 },
        target: { type: 'target_character', side: 'enemy' },
      },
    ];

    const first = runEffectSequence(state, effects, {
      sourceInstanceId: source.instanceId,
      controllerId: 0,
      triggerDepth: 0,
    });
    expect(first.state.pendingChoice?.effectPath).toEqual([0]);

    const firstChoice = first.state.pendingChoice!;
    const afterFirst = transition(first.state, {
      type: 'choice_response',
      interactionId: firstChoice.interactionId!,
      playerId: firstChoice.playerId,
      response: { selectedOptionIds: [firstTarget.instanceId] },
    });
    expect(afterFirst.status).toBe('pending');
    expect(cardHp(afterFirst.state, firstTarget.instanceId)).toBe(4);
    expect(cardHp(afterFirst.state, secondTarget.instanceId)).toBe(5);
    expect(afterFirst.state.pendingChoice?.effectPath).toEqual([1]);

    const secondChoice = afterFirst.state.pendingChoice!;
    const afterSecond = transition(afterFirst.state, {
      type: 'choice_response',
      interactionId: secondChoice.interactionId!,
      playerId: secondChoice.playerId,
      response: { selectedOptionIds: [secondTarget.instanceId] },
    });
    expect(afterSecond.status).toBe('resolved');
    expect(cardHp(afterSecond.state, firstTarget.instanceId)).toBe(4);
    expect(cardHp(afterSecond.state, secondTarget.instanceId)).toBe(3);
  });
});
