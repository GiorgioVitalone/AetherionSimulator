import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  resumeAbilityEffects,
  runAbilityEffects,
} from '../../src/effects/effect-runner.js';
import { CURRENT_GAME_CONFIG } from '../../src/rules/index.js';
import type { Effect } from '../../src/types/effects.js';
import type { GameState, PendingChoice } from '../../src/types/game-state.js';
import {
  mockCard,
  mockGameState,
  mockPlayerState,
  zonesWithCards,
} from '../helpers/card-factory.js';

type RawCard = {
  readonly id: number;
  readonly abilities: readonly {
    readonly dsl: { readonly effects: readonly Effect[] } | null;
  }[];
};

const cards = JSON.parse(
  readFileSync(new URL('../../sim-data/aetherion-cards.json', import.meta.url), 'utf8'),
) as RawCard[];

function effects(cardId: number, abilityIndex: number): readonly Effect[] {
  const found = cards.find((card) => card.id === cardId)?.abilities[abilityIndex]?.dsl;
  if (found === null || found === undefined) throw new Error('missing tested card DSL');
  return found.effects;
}

function choose(
  state: GameState,
  pending: PendingChoice,
  labelOrId: string,
): ReturnType<typeof resumeAbilityEffects> {
  const option = pending.options.find(
    (candidate) => candidate.label === labelOrId || candidate.id === labelOrId,
  );
  if (option === undefined) {
    throw new Error(`Missing option ${labelOrId}: ${pending.options.map((item) => item.label).join(', ')}`);
  }
  return resumeAbilityEffects(state, pending, [option.id]);
}

describe('named Verdant semantic scenarios', () => {
  it('Bloom Assembly exposes and executes both printed modes', () => {
    const initial = mockGameState({
      config: CURRENT_GAME_CONFIG,
      players: [mockPlayerState(0), mockPlayerState(1)],
    });

    const deployPending = runAbilityEffects(initial, 'hero_136', effects(136, 0));
    expect(deployPending.state.pendingChoice?.options.map((option) => option.label)).toEqual([
      'Deploy Bio-Construct',
      'Gain temporary Energy',
    ]);
    const deployed = choose(
      deployPending.state,
      deployPending.state.pendingChoice!,
      'Deploy Bio-Construct',
    );
    const token = deployed.state.players[0].zones.reserve.find((card) => card !== null);
    expect(token).toMatchObject({
      name: 'Bio-Construct',
      currentAtk: 1,
      currentHp: 1,
      tags: ['Bio-Construct'],
    });

    const energyPending = runAbilityEffects(initial, 'hero_136', effects(136, 0));
    const energy = choose(
      energyPending.state,
      energyPending.state.pendingChoice!,
      'Gain temporary Energy',
    );
    expect(energy.state.players[0].temporaryResources).toEqual([
      { resourceType: 'energy', amount: 1 },
    ]);
  });

  it('Biotech Harvest does nothing without the prerequisite, deploys into space, and buffs when Reserve is full', () => {
    const empty = mockGameState({
      config: CURRENT_GAME_CONFIG,
      players: [mockPlayerState(0), mockPlayerState(1)],
    });
    const inactive = runAbilityEffects(empty, 'hero_136', effects(136, 1));
    expect(inactive.state.players[0].zones.reserve).toEqual([null, null]);

    const enabled = {
      ...empty,
      turnState: {
        ...empty.turnState,
        gainedTemporaryResource: [true, false] as const,
      },
    };
    const deployed = runAbilityEffects(enabled, 'hero_136', effects(136, 1));
    expect(deployed.state.players[0].zones.reserve[0]).toMatchObject({
      name: 'Bio-Construct',
      tags: ['Bio-Construct'],
    });

    const first = mockCard({
      instanceId: 'reserve-a',
      owner: 0,
      currentAtk: 2,
      currentHp: 2,
      baseAtk: 2,
      baseHp: 2,
    });
    const second = mockCard({ instanceId: 'reserve-b', owner: 0 });
    const full = mockGameState({
      config: CURRENT_GAME_CONFIG,
      turnState: {
        discardedForEnergy: false,
        firstPlayerFirstTurn: false,
        gainedTemporaryResource: [true, false],
      },
      players: [
        mockPlayerState(0, {
          zones: zonesWithCards({ reserve: [first, second] }),
        }),
        mockPlayerState(1),
      ],
    });
    const targetPending = runAbilityEffects(full, 'hero_136', effects(136, 1));
    expect(targetPending.state.pendingChoice?.type).toBe('select_targets');
    const buffed = choose(targetPending.state, targetPending.state.pendingChoice!, 'reserve-a');
    expect(buffed.state.players[0].zones.reserve[0]).toMatchObject({
      currentAtk: 3,
      currentHp: 3,
    });
    expect(
      buffed.state.players[0].zones.reserve.filter(
        (card) => card?.name === 'Bio-Construct',
      ),
    ).toEqual([]);
  });

  it('Overgrowth Protocol modes see the same Bio-Construct identity', () => {
    const construct = mockCard({
      instanceId: 'bio',
      owner: 0,
      tags: ['Bio-Construct'],
      currentAtk: 2,
      currentHp: 2,
      baseAtk: 2,
      baseHp: 2,
    });
    const state = mockGameState({
      config: CURRENT_GAME_CONFIG,
      players: [
        mockPlayerState(0, {
          zones: zonesWithCards({ frontline: [construct, null, null] }),
        }),
        mockPlayerState(1),
      ],
    });
    const buffPending = runAbilityEffects(state, 'hero_103', effects(103, 0));
    const buffed = choose(
      buffPending.state,
      buffPending.state.pendingChoice!,
      'Buff Bio-Constructs',
    );
    expect(buffed.state.players[0].zones.frontline[0]).toMatchObject({
      currentAtk: 4,
      currentHp: 4,
    });

    const deployPending = runAbilityEffects(state, 'hero_103', effects(103, 0));
    const deployed = choose(
      deployPending.state,
      deployPending.state.pendingChoice!,
      'Deploy Bio-Constructs',
    );
    expect(
      deployed.state.players[0].zones.reserve.filter((card) => card !== null),
    ).toEqual([
      expect.objectContaining({ tags: ['Bio-Construct'], currentAtk: 2, currentHp: 2 }),
      expect.objectContaining({ tags: ['Bio-Construct'], currentAtk: 2, currentHp: 2 }),
    ]);
  });

  it('Synthetic Evolution doubles only printed ATK/HP axes and leaves ARM unchanged', () => {
    const construct = mockCard({
      instanceId: 'bio',
      owner: 0,
      tags: ['Bio-Construct'],
      currentAtk: 2,
      currentHp: 3,
      currentArm: 4,
      baseAtk: 2,
      baseHp: 3,
      baseArm: 4,
    });
    const state = mockGameState({
      config: CURRENT_GAME_CONFIG,
      players: [
        mockPlayerState(0, {
          zones: zonesWithCards({ frontline: [construct, null, null] }),
        }),
        mockPlayerState(1),
      ],
    });
    const result = runAbilityEffects(state, 'hero_103', effects(103, 2));
    expect(result.state.players[0].zones.frontline[0]).toMatchObject({
      currentAtk: 4,
      currentHp: 6,
      currentArm: 4,
    });
  });
});
