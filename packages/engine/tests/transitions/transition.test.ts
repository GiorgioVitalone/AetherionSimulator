import { describe, expect, it } from 'vitest';
import { transition } from '../../src/transitions/index.js';
import { runAbilityEffects } from '../../src/effects/effect-runner.js';
import { CURRENT_GAME_CONFIG } from '../../src/rules/index.js';
import { recomputeAuras } from '../../src/runtime/aura-recompute.js';
import {
  computeAvailableActions,
  enumerateConcretePlayerActions,
  keyOfPlayerAction,
} from '../../src/actions/index.js';
import type { PlayerAction } from '../../src/state-machine/types.js';
import type { GamePhase } from '../../src/types/game-state.js';
import {
  mockCard,
  mockGameState,
  mockPlayerState,
  zonesWithCards,
} from '../helpers/card-factory.js';

describe('authoritative transition boundary', () => {
  it('rejects at least 2,000 seeded adversarial submissions across every action, phase, and controller', () => {
    const phases: readonly GamePhase[] = [
      'setup',
      'mulligan',
      'upkeep',
      'strategy',
      'action',
      'end',
      'game_over',
    ];
    const actionFactories: readonly ((sample: number) => PlayerAction)[] = [
      (sample) => ({
        type: 'deploy',
        cardInstanceId: `missing-${String(sample)}`,
        zone: sample % 2 === 0 ? 'frontline' : 'high_ground',
        slotIndex: sample % 5,
        xValue: sample % 3,
      }),
      (sample) => ({
        type: 'cast_spell',
        cardInstanceId: `missing-${String(sample)}`,
        xValue: sample % 4,
        selectedTargetIds: [`forged-${String(sample)}`],
      }),
      (sample) => ({
        type: 'attach_equipment',
        cardInstanceId: `missing-${String(sample)}`,
        targetInstanceId: `enemy-${String(sample)}`,
        xValue: sample % 3,
      }),
      (sample) => ({
        type: 'remove_equipment',
        equipmentInstanceId: `missing-${String(sample)}`,
      }),
      (sample) => ({
        type: 'transfer_equipment',
        equipmentInstanceId: `missing-${String(sample)}`,
        targetInstanceId: `enemy-${String(sample)}`,
      }),
      (sample) => ({
        type: 'move',
        cardInstanceId: `missing-${String(sample)}`,
        toZone: sample % 2 === 0 ? 'reserve' : 'frontline',
      }),
      (sample) => ({
        type: 'activate_ability',
        cardInstanceId: `missing-${String(sample)}`,
        abilityIndex: sample % 7,
        xValue: sample % 3,
      }),
      (sample) => ({
        type: 'declare_attack',
        attackerInstanceId: `missing-${String(sample)}`,
        targetId: `forged-${String(sample)}`,
      }),
      (sample) => ({
        type: 'discard_for_energy',
        cardInstanceId: `missing-${String(sample)}`,
      }),
      () => ({ type: 'declare_transform' }),
      (sample) => ({
        type: 'tap_reserve',
        cardInstanceId: `missing-${String(sample)}`,
      }),
    ];
    const states = phases.flatMap((phase) =>
      ([0, 1] as const).map((activePlayerIndex) =>
        mockGameState({
          phase,
          activePlayerIndex,
          winner: phase === 'game_over' ? (1 - activePlayerIndex) as 0 | 1 : null,
          config: CURRENT_GAME_CONFIG,
          players: [
            mockPlayerState(0, {
              hero: {
                ...mockPlayerState(0).hero,
                canTransformThisGame: false,
              },
            }),
            mockPlayerState(1, {
              hero: {
                ...mockPlayerState(1).hero,
                canTransformThisGame: false,
              },
            }),
          ],
        }),
      ),
    );

    let submissions = 0;
    for (let sample = 0; submissions < 2_000; sample++) {
      const state = states[sample % states.length]!;
      const action = actionFactories[(sample * 17 + 3) % actionFactories.length]!(sample);
      const result = transition(state, { type: 'player_action', action });
      expect(result.status).toBe('rejected');
      expect(result.state).toBe(state);
      expect(result.state.rng).toBe(state.rng);
      submissions++;
    }
    expect(submissions).toBe(2_000);
  });

  it('rejects a Spell fabricated as an upkeep deploy without mutation or RNG use', () => {
    const spell = mockCard({ instanceId: 'S', cardType: 'S' });
    const state = mockGameState({
      phase: 'upkeep',
      players: [mockPlayerState(0, { hand: [spell] }), mockPlayerState(1)],
    });
    const result = transition(state, {
      type: 'player_action',
      action: {
        type: 'deploy',
        cardInstanceId: 'S',
        zone: 'frontline',
        slotIndex: 0,
      },
    });
    expect(result.status).toBe('rejected');
    if (result.status !== 'rejected') throw new Error('expected rejection');
    expect(result.state).toBe(state);
    expect(result.state.rng).toBe(state.rng);
    expect(result.violations[0]?.code).toBe('phase');
  });

  it('rejects a Character fabricated as a spell with a typed card-kind violation', () => {
    const character = mockCard({ instanceId: 'C', cardType: 'C' });
    const state = mockGameState({
      phase: 'strategy',
      players: [mockPlayerState(0, { hand: [character] }), mockPlayerState(1)],
    });
    const result = transition(state, {
      type: 'player_action',
      action: { type: 'cast_spell', cardInstanceId: 'C' },
    });
    expect(result.status).toBe('rejected');
    if (result.status !== 'rejected') throw new Error('expected rejection');
    expect(result.violations[0]?.code).toBe('card_kind');
    expect(result.state).toBe(state);
  });

  it('rejects equipment targeting an opposing character', () => {
    const equipment = mockCard({
      instanceId: 'E',
      cardType: 'E',
      cost: { mana: 0, energy: 0, flexible: 0 },
    });
    const enemy = mockCard({ instanceId: 'enemy', owner: 1 });
    const state = mockGameState({
      phase: 'strategy',
      players: [
        mockPlayerState(0, { hand: [equipment] }),
        mockPlayerState(1, {
          zones: {
            reserve: [enemy, null],
            frontline: [null, null, null],
            highGround: [null, null],
          },
        }),
      ],
    });
    const result = transition(state, {
      type: 'player_action',
      action: {
        type: 'attach_equipment',
        cardInstanceId: 'E',
        targetInstanceId: 'enemy',
      },
    });
    expect(result.status).toBe('rejected');
    if (result.status !== 'rejected') throw new Error('expected rejection');
    expect(result.violations[0]?.code).toBe('target');
    expect(result.state).toBe(state);
  });

  it('resolves an enumerated action and returns a stable action ID', () => {
    const character = mockCard({
      instanceId: 'C',
      cardType: 'C',
      cost: { mana: 0, energy: 0, flexible: 0 },
    });
    const state = mockGameState({
      phase: 'strategy',
      players: [mockPlayerState(0, { hand: [character] }), mockPlayerState(1)],
    });
    const command = {
      type: 'player_action' as const,
      action: {
        type: 'deploy' as const,
        cardInstanceId: 'C',
        zone: 'frontline' as const,
        slotIndex: 0,
      },
    };
    const first = transition(state, command);
    const second = transition(state, command);
    expect(first.status).toBe('resolved');
    expect(second.status).toBe('resolved');
    expect(first.actionId).toBe(second.actionId);
    expect(first.state).not.toBe(state);
  });

  it('rejects stale response-window IDs', () => {
    const state = mockGameState({
      pendingPriority: {
        type: 'priority',
        toRespondPlayerId: 1,
        window: 'cast',
        baseStackItemId: 'window-current',
        passes: 0,
      },
    });
    const result = transition(state, {
      type: 'priority_pass',
      windowId: 'window-stale',
    });
    expect(result.status).toBe('rejected');
    if (result.status !== 'rejected') throw new Error('expected rejection');
    expect(result.violations[0]?.code).toBe('stale_window');
    expect(result.state).toBe(state);
  });

  it('owns current-rules mulligan decisions with stable interaction IDs', () => {
    const interactionId = 'mulligan:seed:0';
    const state = mockGameState({
      phase: 'mulligan',
      config: CURRENT_GAME_CONFIG,
      pendingChoice: {
        interactionId,
        validationToken: interactionId,
        type: 'mulligan',
        playerId: 0,
        options: [
          { id: 'keep', label: 'Keep hand' },
          { id: 'mulligan', label: 'Mulligan' },
        ],
        minSelections: 1,
        maxSelections: 1,
        context: 'Opening hand',
      },
    });
    const first = transition(state, {
      type: 'mulligan_decision',
      interactionId,
      playerId: 0,
      keep: true,
    });
    expect(first.status).toBe('pending');
    expect(first.state.pendingChoice).toMatchObject({
      type: 'mulligan',
      playerId: 1,
      interactionId: expect.any(String),
      validationToken: expect.any(String),
    });
    const nextId = first.state.pendingChoice!.interactionId!;
    const second = transition(first.state, {
      type: 'mulligan_decision',
      interactionId: nextId,
      playerId: 1,
      keep: true,
    });
    expect(second.status).toBe('pending');
    expect(second.state.pendingChoice).toMatchObject({
      type: 'choose_first_player',
      playerId: second.state.activePlayerIndex,
      interactionId: expect.any(String),
      validationToken: expect.any(String),
    });
    const firstPlayerChoice = second.state.pendingChoice!;
    const selectedFirstPlayer = `player_${String(firstPlayerChoice.playerId)}`;
    const selected = transition(second.state, {
      type: 'choice_response',
      interactionId: firstPlayerChoice.interactionId!,
      playerId: firstPlayerChoice.playerId,
      response: { selectedOptionIds: [selectedFirstPlayer] },
    });
    expect(selected.status).toBe('resolved');
    expect(selected.state.phase).toBe('upkeep');
    expect(selected.state.pendingChoice).toBeNull();
    expect(selected.state.activePlayerIndex).toBe(firstPlayerChoice.playerId);
  });

  it('rejects a stale mulligan and preserves the exact state object', () => {
    const state = mockGameState({
      phase: 'mulligan',
      pendingChoice: {
        interactionId: 'live',
        validationToken: 'live',
        type: 'mulligan',
        playerId: 0,
        options: [{ id: 'keep', label: 'Keep' }],
        minSelections: 1,
        maxSelections: 1,
        context: 'Opening hand',
      },
    });
    const result = transition(state, {
      type: 'mulligan_decision',
      interactionId: 'stale',
      playerId: 0,
      keep: true,
    });
    expect(result.status).toBe('rejected');
    expect(result.state).toBe(state);
  });

  it('advances phases and completes the current turn boundary through one command', () => {
    const strategy = mockGameState({
      phase: 'strategy',
      config: CURRENT_GAME_CONFIG,
      activePlayerIndex: 0,
    });
    const action = transition(strategy, { type: 'advance_phase', playerId: 0 });
    expect(action.status).toBe('resolved');
    expect(action.state.phase).toBe('action');
    expect(action.events.map((event) => event.type)).toEqual(['PHASE_CHANGED']);

    const ended = transition(action.state, { type: 'advance_phase', playerId: 0 });
    expect(ended.status).toBe('resolved');
    expect(ended.state.activePlayerIndex).toBe(1);
    expect(ended.state.turnNumber).toBe(strategy.turnNumber + 1);
    expect(ended.events.map((event) => event.type)).toContain('TURN_END');
    expect(ended.events.map((event) => event.type)).toContain('TURN_START');
    expect(ended.events.every((event) => event.eventId !== undefined)).toBe(true);
  });

  it('resumes the turn boundary after the authoritative hand-limit interaction', () => {
    const hand = Array.from({ length: 9 }, (_, index) =>
      mockCard({ instanceId: `hand-${String(index)}` }),
    );
    const state = mockGameState({
      phase: 'action',
      config: CURRENT_GAME_CONFIG,
      activePlayerIndex: 0,
      players: [
        mockPlayerState(0, { hand }),
        mockPlayerState(1),
      ],
    });
    const pending = transition(state, { type: 'advance_phase', playerId: 0 });
    expect(pending.status).toBe('pending');
    const choice = pending.state.pendingChoice!;
    expect(choice.type).toBe('discard_to_hand_limit');
    expect(choice.turnBoundaryContinuation?.stage).toBe('after_hand_limit');

    const resolved = transition(pending.state, {
      type: 'choice_response',
      interactionId: choice.interactionId!,
      playerId: 0,
      response: { selectedOptionIds: [choice.options[0]!.id] },
    });
    expect(resolved.status).toBe('resolved');
    expect(resolved.state.players[0].hand).toHaveLength(8);
    expect(resolved.state.activePlayerIndex).toBe(1);
    expect(resolved.events.map((event) => event.type)).toContain('TURN_START');
  });

  it('records concession as a terminal authoritative event', () => {
    const state = mockGameState({ config: CURRENT_GAME_CONFIG });
    const result = transition(state, { type: 'concede', playerId: 0 });
    expect(result.status).toBe('resolved');
    expect(result.state).toMatchObject({ winner: 1, phase: 'game_over' });
    expect(result.events.map((event) => event.type)).toEqual([
      'GAME_CONCEDED',
      'PHASE_CHANGED',
    ]);
  });

  it('pauses and resumes an explicit effect choice exactly once', () => {
    const initial = mockGameState({
      config: CURRENT_GAME_CONFIG,
      players: [
        mockPlayerState(0, {
          hero: { ...mockPlayerState(0).hero, currentLp: 20 },
        }),
        mockPlayerState(1),
      ],
    });
    const pending = runAbilityEffects(initial, 'source', [
      {
        type: 'choose_one',
        options: [
          {
            label: 'Heal',
            effects: [
              {
                type: 'heal',
                amount: { type: 'fixed', value: 2 },
                target: { type: 'owner_hero' },
              },
            ],
          },
          {
            label: 'Harm',
            effects: [
              {
                type: 'deal_damage',
                amount: { type: 'fixed', value: 4 },
                target: { type: 'hero', side: 'enemy' },
              },
            ],
          },
        ],
      },
      {
        type: 'heal',
        amount: { type: 'fixed', value: 1 },
        target: { type: 'owner_hero' },
      },
    ]);
    const choice = pending.state.pendingChoice;
    expect(choice?.interactionId).toBeTypeOf('string');
    expect(choice?.continuation).toBeDefined();

    const command = {
      type: 'choice_response' as const,
      interactionId: choice!.interactionId!,
      playerId: 0 as const,
      response: { selectedOptionIds: ['1'] },
    };
    const resolved = transition(pending.state, command);
    expect(resolved.status).toBe('resolved');
    expect(resolved.state.pendingChoice).toBeNull();
    expect(resolved.state.players[0]!.hero.currentLp).toBe(21);
    expect(resolved.state.players[1]!.hero.currentLp).toBe(21);

    const replay = transition(resolved.state, command);
    expect(replay.status).toBe('rejected');
    expect(replay.state).toBe(resolved.state);
  });

  it('rejects forged effect-choice responses without changing state', () => {
    const initial = mockGameState({ config: CURRENT_GAME_CONFIG });
    const pending = runAbilityEffects(initial, 'source', [
      {
        type: 'choose_one',
        options: [
          { label: 'A', effects: [] },
          { label: 'B', effects: [] },
        ],
      },
    ]).state;
    const choice = pending.pendingChoice!;
    const attempts = [
      {
        interactionId: 'stale',
        playerId: 0 as const,
        selectedOptionIds: ['0'],
      },
      {
        interactionId: choice.interactionId!,
        playerId: 1 as const,
        selectedOptionIds: ['0'],
      },
      {
        interactionId: choice.interactionId!,
        playerId: 0 as const,
        selectedOptionIds: ['0', '0'],
      },
      {
        interactionId: choice.interactionId!,
        playerId: 0 as const,
        selectedOptionIds: ['not-an-option'],
      },
    ];

    for (const attempt of attempts) {
      const result = transition(pending, {
        type: 'choice_response',
        interactionId: attempt.interactionId,
        playerId: attempt.playerId,
        response: { selectedOptionIds: attempt.selectedOptionIds },
      });
      expect(result.status).toBe('rejected');
      expect(result.state).toBe(pending);
      expect(result.state.rng).toBe(pending.rng);
    }
  });

  it('resumes nested compound choices without replaying completed subeffects', () => {
    const enemy = mockCard({ instanceId: 'enemy', owner: 1 });
    const initial = mockGameState({
      config: CURRENT_GAME_CONFIG,
      players: [
        mockPlayerState(0, {
          hero: { ...mockPlayerState(0).hero, currentLp: 10 },
        }),
        mockPlayerState(1, {
          zones: {
            reserve: [enemy, null],
            frontline: [null, null, null],
            highGround: [null, null],
          },
        }),
      ],
    });
    const firstPause = runAbilityEffects(initial, 'source', [
      {
        type: 'composite',
        effects: [
          {
            type: 'heal',
            amount: { type: 'fixed', value: 1 },
            target: { type: 'owner_hero' },
          },
          {
            type: 'choose_one',
            options: [
              {
                label: 'Destroy',
                effects: [
                  {
                    type: 'destroy',
                    target: { type: 'target_character', side: 'enemy' },
                  },
                  {
                    type: 'heal',
                    amount: { type: 'fixed', value: 2 },
                    target: { type: 'owner_hero' },
                  },
                ],
              },
              { label: 'Nothing', effects: [] },
            ],
          },
        ],
      },
      {
        type: 'heal',
        amount: { type: 'fixed', value: 3 },
        target: { type: 'owner_hero' },
      },
    ]).state;
    expect(firstPause.players[0].hero.currentLp).toBe(11);
    const mode = firstPause.pendingChoice!;

    const secondPause = transition(firstPause, {
      type: 'choice_response',
      interactionId: mode.interactionId!,
      playerId: 0,
      response: { selectedOptionIds: ['0'] },
    });
    expect(secondPause.status).toBe('pending');
    expect(secondPause.state.players[0].hero.currentLp).toBe(11);
    const target = secondPause.state.pendingChoice!;

    const resolved = transition(secondPause.state, {
      type: 'choice_response',
      interactionId: target.interactionId!,
      playerId: 0,
      response: { selectedOptionIds: ['enemy'] },
    });
    expect(resolved.status).toBe('resolved');
    expect(resolved.state.players[0].hero.currentLp).toBe(16);
    expect(resolved.state.players[1].zones.reserve[0]).toBeNull();
  });

  it('pauses trigger-generated choices and resumes the remaining trigger batch', () => {
    const watcher = mockCard({
      instanceId: 'watcher',
      owner: 0,
      registeredTriggers: [
        {
          id: 'trigger:watcher:0',
          sourceInstanceId: 'watcher',
          ownerPlayerId: 0,
          trigger: { type: 'on_spell_cast', side: 'allied' },
          effects: [
            {
              type: 'choose_one',
              options: [
                {
                  label: 'Heal one',
                  effects: [
                    {
                      type: 'heal',
                      amount: { type: 'fixed', value: 1 },
                      target: { type: 'owner_hero' },
                    },
                  ],
                },
                {
                  label: 'Heal two',
                  effects: [
                    {
                      type: 'heal',
                      amount: { type: 'fixed', value: 2 },
                      target: { type: 'owner_hero' },
                    },
                  ],
                },
              ],
            },
          ],
          abilityIndex: 0,
        },
        {
          id: 'trigger:watcher:1',
          sourceInstanceId: 'watcher',
          ownerPlayerId: 0,
          trigger: { type: 'on_spell_cast', side: 'allied' },
          effects: [
            {
              type: 'draw_cards',
              count: { type: 'fixed', value: 1 },
              player: 'allied',
            },
          ],
          abilityIndex: 1,
        },
      ],
    });
    const spell = mockCard({
      instanceId: 'spell',
      owner: 0,
      cardType: 'S',
      cost: { mana: 0, energy: 0, flexible: 0 },
      abilities: [],
    });
    const top = mockCard({ instanceId: 'top', owner: 0 });
    const state = mockGameState({
      phase: 'strategy',
      config: CURRENT_GAME_CONFIG,
      players: [
        mockPlayerState(0, {
          hero: { ...mockPlayerState(0).hero, currentLp: 10 },
          hand: [spell],
          mainDeck: [top],
          zones: {
            reserve: [watcher, null],
            frontline: [null, null, null],
            highGround: [null, null],
          },
        }),
        mockPlayerState(1),
      ],
    });
    const paused = transition(state, {
      type: 'player_action',
      action: { type: 'cast_spell', cardInstanceId: 'spell' },
    });
    expect(paused.status).toBe('pending');
    expect(paused.state.pendingChoice?.type).toBe('choose_trigger_order');
    expect(paused.state.pendingChoice?.triggerOrderContinuation).toBeDefined();
    expect(paused.state.players[0].hand).toHaveLength(0);
    expect(paused.events.every((event) => event.eventId !== undefined)).toBe(true);
    expect(new Set(paused.events.map((event) => event.eventId)).size).toBe(
      paused.events.length,
    );
    const castEvent = paused.events.find((event) => event.type === 'SPELL_CAST');
    const requestEvent = paused.events.find(
      (event) => event.type === 'CHOICE_REQUESTED',
    );
    expect(requestEvent?.parentEventId).toBe(castEvent?.eventId);
    expect(requestEvent?.actionId).toBe(paused.actionId);

    const orderChoice = paused.state.pendingChoice!;
    const ordered = transition(paused.state, {
      type: 'choice_response',
      interactionId: orderChoice.interactionId!,
      playerId: 0,
      response: {
        selectedOptionIds: ['trigger:watcher:0', 'trigger:watcher:1'],
      },
    });
    expect(ordered.status).toBe('pending');
    expect(ordered.state.pendingChoice?.dispatchContinuation).toBeDefined();
    const modeChoice = ordered.state.pendingChoice!;
    const resolved = transition(ordered.state, {
      type: 'choice_response',
      interactionId: modeChoice.interactionId!,
      playerId: 0,
      response: { selectedOptionIds: ['1'] },
    });
    expect(resolved.status).toBe('resolved');
    expect(resolved.state.players[0].hero.currentLp).toBe(12);
    expect(resolved.state.players[0].hand.map((card) => card.instanceId)).toEqual(['top']);
    expect(resolved.events.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        'CHOICE_SUBMITTED',
        'CHOICE_ACCEPTED',
        'CHOICE_RESOLVED',
      ]),
    );
    expect(resolved.events.every((event) => event.eventId !== undefined)).toBe(true);
  });

  it('does not let cast-trigger ordering replace a spell target choice', () => {
    const watcher = mockCard({
      instanceId: 'choice-watcher',
      owner: 0,
      registeredTriggers: [
        {
          id: 'trigger:choice-watcher:0',
          sourceInstanceId: 'choice-watcher',
          ownerPlayerId: 0,
          trigger: { type: 'on_spell_cast', side: 'allied' },
          effects: [{
            type: 'heal',
            amount: { type: 'fixed', value: 1 },
            target: { type: 'owner_hero' },
          }],
          abilityIndex: 0,
        },
        {
          id: 'trigger:choice-watcher:1',
          sourceInstanceId: 'choice-watcher',
          ownerPlayerId: 0,
          trigger: { type: 'on_spell_cast', side: 'allied' },
          effects: [{
            type: 'heal',
            amount: { type: 'fixed', value: 2 },
            target: { type: 'owner_hero' },
          }],
          abilityIndex: 1,
        },
      ],
    });
    const spell = mockCard({
      instanceId: 'targeted-spell',
      owner: 0,
      cardType: 'S',
      cost: { mana: 0, energy: 0, flexible: 0 },
      abilities: [{
        type: 'triggered',
        trigger: { type: 'on_deploy' },
        effects: [{
          type: 'destroy',
          target: { type: 'target_character', side: 'enemy' },
        }],
      }],
    });
    const enemy = mockCard({ instanceId: 'spell-target', owner: 1 });
    const state = mockGameState({
      phase: 'strategy',
      config: CURRENT_GAME_CONFIG,
      players: [
        mockPlayerState(0, {
          hero: { ...mockPlayerState(0).hero, currentLp: 10 },
          hand: [spell],
          zones: zonesWithCards({ reserve: [watcher, null] }),
        }),
        mockPlayerState(1, {
          zones: zonesWithCards({ frontline: [enemy, null, null] }),
        }),
      ],
    });

    const targetPause = transition(state, {
      type: 'player_action',
      action: { type: 'cast_spell', cardInstanceId: spell.instanceId },
    });
    expect(targetPause.status).toBe('pending');
    expect(targetPause.state.pendingChoice?.type).toBe('select_targets');
    expect(targetPause.state.pendingChoice?.dispatchContinuation).toBeDefined();
    expect(
      targetPause.state.pendingChoice?.stackResolutionContinuation,
    ).toBeDefined();

    const targetChoice = targetPause.state.pendingChoice!;
    const orderPause = transition(targetPause.state, {
      type: 'choice_response',
      interactionId: targetChoice.interactionId!,
      playerId: 0,
      response: { selectedOptionIds: [enemy.instanceId] },
    });
    expect(orderPause.status).toBe('pending');
    expect(orderPause.state.pendingChoice?.type).toBe('choose_trigger_order');
    expect(
      orderPause.state.pendingChoice?.stackResolutionContinuation,
    ).toBeDefined();

    const orderChoice = orderPause.state.pendingChoice!;
    const resolved = transition(orderPause.state, {
      type: 'choice_response',
      interactionId: orderChoice.interactionId!,
      playerId: 0,
      response: {
        selectedOptionIds: [
          'trigger:choice-watcher:0',
          'trigger:choice-watcher:1',
        ],
      },
    });

    expect(resolved.status).toBe('resolved');
    expect(resolved.state.pendingChoice).toBeNull();
    expect(resolved.state.players[1].zones.frontline[0]).toBeNull();
    expect(resolved.state.players[0].hero.currentLp).toBe(13);
    expect(resolved.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'STACK_ITEM_RESOLVED',
          stackItemId: `spell_${spell.instanceId}`,
        }),
      ]),
    );
  });

  it('normalizes the terminal aura graph after an ordered trigger ends the game', () => {
    const watcher = mockCard({
      instanceId: 'terminal-aura-source',
      owner: 0,
      abilities: [{
        type: 'aura',
        effects: [{
          type: 'modify_stats',
          target: { type: 'all_characters', side: 'allied' },
          modifier: { atk: 1 },
          duration: { type: 'while_in_play' },
        }],
      }],
      registeredTriggers: [
        {
          id: 'trigger:destroy-source',
          sourceInstanceId: 'terminal-aura-source',
          ownerPlayerId: 0,
          trigger: { type: 'on_spell_cast', side: 'allied' },
          effects: [{ type: 'destroy', target: { type: 'self' } }],
          abilityIndex: 1,
        },
        {
          id: 'trigger:deckout',
          sourceInstanceId: 'terminal-aura-source',
          ownerPlayerId: 0,
          trigger: { type: 'on_spell_cast', side: 'allied' },
          effects: [{
            type: 'draw_cards',
            count: { type: 'fixed', value: 1 },
            player: 'allied',
          }],
          abilityIndex: 2,
        },
      ],
    });
    const ally = mockCard({
      instanceId: 'terminal-aura-target',
      owner: 0,
      baseAtk: 2,
      currentAtk: 2,
    });
    const spell = mockCard({
      instanceId: 'terminal-spell',
      owner: 0,
      cardType: 'S',
      cost: { mana: 0, energy: 0, flexible: 0 },
      abilities: [],
    });
    const state = recomputeAuras(mockGameState({
      phase: 'strategy',
      config: CURRENT_GAME_CONFIG,
      players: [
        mockPlayerState(0, {
          hand: [spell],
          mainDeck: [],
          zones: zonesWithCards({
            reserve: [watcher, null],
            frontline: [ally, null, null],
          }),
        }),
        mockPlayerState(1),
      ],
    }));
    expect(state.players[0].zones.frontline[0]?.currentAtk).toBe(3);

    const paused = transition(state, {
      type: 'player_action',
      action: { type: 'cast_spell', cardInstanceId: spell.instanceId },
    });
    expect(paused.status).toBe('pending');
    const choice = paused.state.pendingChoice!;

    const resolved = transition(paused.state, {
      type: 'choice_response',
      interactionId: choice.interactionId!,
      playerId: 0,
      response: {
        selectedOptionIds: ['trigger:destroy-source', 'trigger:deckout'],
      },
    });

    expect(resolved.status).toBe('resolved');
    expect(resolved.state.winner).toBe(1);
    expect(resolved.state.players[0].zones.reserve[0]).toBeNull();
    expect(resolved.state.players[0].zones.frontline[0]?.currentAtk).toBe(2);
    expect(resolved.state.auraDerivation).toEqual({
      sourceKeys: [],
      contributionKeys: [],
    });
  });

  it('fizzles every declared stack item when a cast trigger causes deck exhaustion', () => {
    const watcher = mockCard({
      instanceId: 'deckout-watcher',
      owner: 0,
      registeredTriggers: [{
        id: 'trigger:deckout-on-cast',
        sourceInstanceId: 'deckout-watcher',
        ownerPlayerId: 0,
        trigger: { type: 'on_spell_cast', side: 'allied' },
        effects: [{
          type: 'draw_cards',
          count: { type: 'fixed', value: 1 },
          player: 'allied',
        }],
        abilityIndex: 0,
      }],
    });
    const spell = mockCard({
      instanceId: 'declared-before-deckout',
      owner: 0,
      cardType: 'S',
      cost: { mana: 0, energy: 0, flexible: 0 },
      abilities: [],
    });
    const response = mockCard({
      instanceId: 'available-response',
      owner: 1,
      cardType: 'S',
      cost: { mana: 0, energy: 0, flexible: 0 },
      abilities: [{
        type: 'triggered',
        trigger: { type: 'on_counter' },
        effects: [{ type: 'counter_spell', target: { type: 'target_spell' } }],
      }],
    });
    const state = mockGameState({
      phase: 'strategy',
      config: CURRENT_GAME_CONFIG,
      players: [
        mockPlayerState(0, {
          hand: [spell],
          mainDeck: [],
          zones: zonesWithCards({ reserve: [watcher, null] }),
        }),
        mockPlayerState(1, { hand: [response] }),
      ],
    });

    const result = transition(state, {
      type: 'player_action',
      action: { type: 'cast_spell', cardInstanceId: spell.instanceId },
    });

    expect(result.status).toBe('resolved');
    expect(result.state.winner).toBe(1);
    expect(result.state.stack).toEqual([]);
    expect(result.state.pendingPriority).toBeNull();
    expect(result.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'STACK_ITEM_DECLARED',
          stackItemId: `spell_${spell.instanceId}`,
        }),
        expect.objectContaining({
          type: 'STACK_ITEM_FIZZLED',
          stackItemId: `spell_${spell.instanceId}`,
          reason: 'game ended before stack resolution',
        }),
        expect.objectContaining({
          type: 'SPELL_FIZZLED',
          stackItemId: `spell_${spell.instanceId}`,
        }),
      ]),
    );
  });

  it('enumerates and enforces typed X payment on its authored resource channel', () => {
    const spell = mockCard({
      instanceId: 'typed-x',
      cardType: 'S',
      cost: { mana: 1, energy: 0, flexible: 0 },
      xCostResource: 'mana',
      abilities: [],
    });
    const state = mockGameState({
      phase: 'strategy',
      config: CURRENT_GAME_CONFIG,
      players: [
        mockPlayerState(0, {
          hand: [spell],
          resourceBank: [
            { instanceId: 'm1', resourceType: 'mana', exhausted: false },
            { instanceId: 'm2', resourceType: 'mana', exhausted: false },
            { instanceId: 'e1', resourceType: 'energy', exhausted: false },
            { instanceId: 'e2', resourceType: 'energy', exhausted: false },
          ],
        }),
        mockPlayerState(1),
      ],
    });
    const xValues = enumerateConcretePlayerActions(state, 'full')
      .filter((action) => action.type === 'cast_spell')
      .map((action) => action.xValue);
    expect(xValues).toEqual([0, 1]);

    const rejected = transition(state, {
      type: 'player_action',
      action: { type: 'cast_spell', cardInstanceId: 'typed-x', xValue: 2 },
    });
    expect(rejected.status).toBe('rejected');
    expect(rejected.state).toBe(state);

    const resolved = transition(state, {
      type: 'player_action',
      action: { type: 'cast_spell', cardInstanceId: 'typed-x', xValue: 1 },
    });
    expect(resolved.status).toBe('resolved');
    expect(
      resolved.state.players[0].resourceBank.filter(
        (resource) => resource.resourceType === 'mana' && resource.exhausted,
      ),
    ).toHaveLength(2);
    expect(
      resolved.state.players[0].resourceBank.filter(
        (resource) => resource.resourceType === 'energy' && resource.exhausted,
      ),
    ).toHaveLength(0);

    const omittedZero = transition(state, {
      type: 'player_action',
      action: { type: 'cast_spell', cardInstanceId: 'typed-x' },
    });
    expect(omittedZero.status).toBe('resolved');
  });

  it('uses X in deterministic action identity', () => {
    expect(
      keyOfPlayerAction({
        type: 'cast_spell',
        cardInstanceId: 'typed-x',
        xValue: 0,
      }),
    ).not.toBe(
      keyOfPlayerAction({
        type: 'cast_spell',
        cardInstanceId: 'typed-x',
        xValue: 1,
      }),
    );
  });

  it('offers movement and ordinary activated abilities only in Strategy under the current rules', () => {
    const body = mockCard({
      instanceId: 'body',
      summoningSick: false,
      exhausted: false,
      abilities: [
        {
          type: 'triggered',
          trigger: {
            type: 'activated',
            cost: { mana: 0, energy: 0, flexible: 0 },
          },
          effects: [],
        },
      ],
    });
    const player = mockPlayerState(0, {
      zones: {
        reserve: [body, null],
        frontline: [null, null, null],
        highGround: [null, null],
      },
    });
    const strategy = mockGameState({
      phase: 'strategy',
      config: CURRENT_GAME_CONFIG,
      players: [player, mockPlayerState(1)],
    });
    const action = { ...strategy, phase: 'action' as const };
    expect(computeAvailableActions(strategy).canMove).toHaveLength(1);
    expect(computeAvailableActions(strategy).canActivateAbility).toHaveLength(1);
    expect(computeAvailableActions(action).canMove).toHaveLength(0);
    expect(computeAvailableActions(action).canActivateAbility).toHaveLength(0);
  });

  it('enforces typed X values in reactive windows', () => {
    const counter = mockCard({
      instanceId: 'typed-counter',
      owner: 1,
      cardType: 'S',
      cost: { mana: 0, energy: 1, flexible: 0 },
      xCostResource: 'energy',
      abilities: [
        {
          type: 'triggered',
          trigger: { type: 'on_counter' },
          effects: [{ type: 'counter_spell', target: { type: 'target_spell' } }],
        },
      ],
    });
    const state = mockGameState({
      config: CURRENT_GAME_CONFIG,
      stack: [
        {
          id: 'base-spell',
          type: 'spell',
          sourceInstanceId: 'enemy-spell',
          controllerId: 0,
          effects: [],
          targets: [],
        },
      ],
      pendingPriority: {
        type: 'priority',
        toRespondPlayerId: 1,
        window: 'cast',
        baseStackItemId: 'base-spell',
        passes: 0,
      },
      players: [
        mockPlayerState(0),
        mockPlayerState(1, {
          hand: [counter],
          resourceBank: [
            { instanceId: 'e1', resourceType: 'energy', exhausted: false },
            { instanceId: 'e2', resourceType: 'energy', exhausted: false },
            { instanceId: 'm1', resourceType: 'mana', exhausted: false },
            { instanceId: 'm2', resourceType: 'mana', exhausted: false },
          ],
        }),
      ],
    });
    const rejected = transition(state, {
      type: 'reactive_action',
      windowId: 'base-spell',
      action: { type: 'cast_spell', cardInstanceId: 'typed-counter', xValue: 2 },
    });
    expect(rejected.status).toBe('rejected');
    expect(rejected.state).toBe(state);

    const resolved = transition(state, {
      type: 'reactive_action',
      windowId: 'base-spell',
      action: { type: 'cast_spell', cardInstanceId: 'typed-counter', xValue: 1 },
    });
    expect(resolved.status).not.toBe('rejected');
    expect(
      resolved.state.players[1].resourceBank.filter(
        (resource) => resource.resourceType === 'energy' && resource.exhausted,
      ),
    ).toHaveLength(2);
  });
});
