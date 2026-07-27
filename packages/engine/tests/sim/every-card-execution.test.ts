import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  resumeAbilityEffects,
  runAbilityEffects,
} from '../../src/effects/effect-runner.js';
import { CURRENT_GAME_CONFIG } from '../../src/rules/index.js';
import {
  buildCardScenarioInventory,
} from '../../src/sim/card-scenario-inventory.js';
import type { ValidatorCard } from '../../src/sim/card-data-validator.js';
import type { Effect } from '../../src/types/effects.js';
import type { GameState } from '../../src/types/game-state.js';
import {
  mockCard,
  mockGameState,
  mockPlayerState,
  zonesWithCards,
} from '../helpers/card-factory.js';

type ExecutableCard = ValidatorCard & {
  readonly abilities: readonly {
    readonly dsl: {
      readonly effects?: readonly Effect[];
    } | null;
  }[];
};

interface ExecutableScenario {
  readonly card: ExecutableCard;
  readonly abilityIndex: number;
  readonly name: string;
  readonly effects: readonly Effect[];
}

const cards = JSON.parse(
  readFileSync(new URL('../../sim-data/aetherion-cards.json', import.meta.url), 'utf8'),
) as ExecutableCard[];
const allPrintedTags = [
  ...new Set([
    ...cards.flatMap((card) => card.tags ?? []),
    'Bio-Construct',
    'Skeleton',
  ]),
];

function modeScenarios(
  card: ExecutableCard,
  abilityIndex: number,
  effects: readonly Effect[],
  prefix: string,
): ExecutableScenario[] {
  const out: ExecutableScenario[] = [];
  effects.forEach((effect, effectIndex) => {
    if (effect.type === 'choose_one') {
      effect.options.forEach((option, optionIndex) => {
        out.push({
          card,
          abilityIndex,
          name: `${prefix}.effects[${String(effectIndex)}].options[${String(optionIndex)}]`,
          effects: option.effects,
        });
        out.push(
          ...modeScenarios(
            card,
            abilityIndex,
            option.effects,
            `${prefix}.effects[${String(effectIndex)}].options[${String(optionIndex)}]`,
          ),
        );
      });
    }
    const children =
      effect.type === 'conditional'
        ? [effect.ifTrue, effect.ifFalse ?? []]
        : effect.type === 'composite' || effect.type === 'scheduled'
          ? [effect.effects]
          : effect.type === 'replacement'
            ? [effect.instead]
            : effect.type === 'grant_ability'
              ? [effect.ability.effects]
              : [];
    children.forEach((nested, nestedIndex) => {
      out.push(
        ...modeScenarios(
          card,
          abilityIndex,
          nested,
          `${prefix}.effects[${String(effectIndex)}].nested[${String(nestedIndex)}]`,
        ),
      );
    });
  });
  return out;
}

const scenarios = cards.flatMap((card) =>
  card.abilities.flatMap((ability, abilityIndex) => {
    const effects = ability.dsl?.effects ?? [];
    const base: ExecutableScenario = {
      card,
      abilityIndex,
      name: `card-${String(card.id)}-ability-${String(abilityIndex)}-base`,
      effects,
    };
    return [
      base,
      ...modeScenarios(card, abilityIndex, effects, base.name),
    ];
  }),
);

function richState(scenario: ExecutableScenario): {
  readonly state: GameState;
  readonly sourceId: string;
} {
  const sourceId = `source-${String(scenario.card.id)}-${String(scenario.abilityIndex)}`;
  const source = mockCard({
    instanceId: sourceId,
    owner: 0,
    cardDefId: scenario.card.id,
    name: scenario.card.name,
    cardType: scenario.card.cardType === 'E' ? 'E' : 'C',
    currentHp: 8,
    baseHp: 8,
    currentAtk: 4,
    baseAtk: 4,
    currentArm: 2,
    baseArm: 2,
    tags: [...(scenario.card.tags ?? [])],
  });
  const ally = mockCard({
    instanceId: 'ally',
    owner: 0,
    currentHp: 6,
    baseHp: 8,
    currentAtk: 3,
    baseAtk: 3,
    tags: allPrintedTags,
  });
  const enemy = mockCard({
    instanceId: 'enemy',
    owner: 1,
    currentHp: 8,
    baseHp: 8,
    currentAtk: 3,
    baseAtk: 3,
  });
  const equipmentHolder =
    scenario.card.cardType === 'E'
      ? { ...ally, equipment: source }
      : ally;
  const sourceOnBoard =
    scenario.card.cardType === 'E' ||
    scenario.card.cardType === 'H' ||
    scenario.card.cardType === 'T'
      ? equipmentHolder
      : source;
  const extraAlly =
    sourceOnBoard.instanceId === equipmentHolder.instanceId
      ? mockCard({
          instanceId: 'ally-two',
          owner: 0,
          tags: allPrintedTags,
        })
      : equipmentHolder;
  const deckCard = mockCard({ instanceId: 'deck-card', owner: 0 });
  const discardCard = mockCard({
    instanceId: 'discard-card',
    owner: 0,
    cardType: 'C',
    cost: { mana: 2, energy: 0, flexible: 0 },
  });
  const enemyDiscard = mockCard({
    instanceId: 'enemy-discard',
    owner: 1,
    cardType: 'C',
  });
  const resources = Array.from({ length: 12 }, (_, index) => ({
    instanceId: `resource-${String(index)}`,
    resourceType: 'mana' as const,
    exhausted: false,
  }));
  const player0 = mockPlayerState(0, {
    hero: {
      ...mockPlayerState(0).hero,
      cardDefId:
        scenario.card.cardType === 'H' || scenario.card.cardType === 'T'
          ? scenario.card.id
          : 100,
      currentLp: 20,
    },
    zones: zonesWithCards({
      reserve: [extraAlly, null],
      frontline: [sourceOnBoard, null, null],
    }),
    hand: [
      mockCard({
        instanceId: 'hand-card',
        owner: 0,
        cardType: 'S',
        tags: allPrintedTags,
      }),
    ],
    mainDeck: [deckCard, mockCard({ instanceId: 'deck-card-two', owner: 0 })],
    discardPile: [
      discardCard,
      mockCard({
        instanceId: 'discard-spell',
        owner: 0,
        cardType: 'S',
        tags: allPrintedTags,
      }),
    ],
    resourceBank: resources,
    temporaryResources: [{ resourceType: 'energy', amount: 3 }],
  });
  const player1 = mockPlayerState(1, {
    hero: { ...mockPlayerState(1).hero, currentLp: 20 },
    zones: zonesWithCards({ frontline: [enemy, null, null] }),
    hand: [mockCard({ instanceId: 'enemy-hand', owner: 1 })],
    mainDeck: [mockCard({ instanceId: 'enemy-deck', owner: 1 })],
    discardPile: [enemyDiscard],
    resourceBank: resources.map((resource, index) => ({
      ...resource,
      instanceId: `enemy-resource-${String(index)}`,
    })),
  });
  return {
    sourceId:
      scenario.card.cardType === 'H' || scenario.card.cardType === 'T'
        ? `hero_${String(scenario.card.id)}`
        : sourceId,
    state: mockGameState({
      config: CURRENT_GAME_CONFIG,
      players: [player0, player1],
      turnState: {
        discardedForEnergy: false,
        firstPlayerFirstTurn: false,
        gainedTemporaryResource: [true, false],
      },
      stack: [
        {
          id: 'spell-on-stack',
          type: 'spell',
          sourceInstanceId: 'enemy-spell',
          sourceCardDefId: 999,
          controllerId: 1,
          effects: [],
          targets: ['ally'],
        },
      ],
    }),
  };
}

function executeScenario(scenario: ExecutableScenario): {
  readonly initialState: GameState;
  readonly state: GameState;
  readonly eventCount: number;
} {
  const fixture = richState(scenario);
  const initialState = structuredClone(fixture.state);
  let eventCount = 0;
  let result = runAbilityEffects(
    fixture.state,
    fixture.sourceId,
    scenario.effects,
    0,
    3,
  );
  eventCount += result.events.length;
  for (let guard = 0; guard < 64 && result.state.pendingChoice !== null; guard++) {
    const pending = result.state.pendingChoice;
    const selectionCount = Math.min(
      pending.maxSelections,
      Math.max(pending.minSelections, pending.options.length > 0 ? 1 : 0),
    );
    result = resumeAbilityEffects(
      result.state,
      pending,
      pending.options.slice(0, selectionCount).map((option) => option.id),
    );
    eventCount += result.events.length;
  }
  expect(result.state.pendingChoice, scenario.name).toBeNull();
  return { initialState, state: result.state, eventCount };
}

describe('generated every-card execution corpus', () => {
  it('maps exactly to every generated ability/mode inventory entry', () => {
    expect(scenarios).toHaveLength(buildCardScenarioInventory(cards).length);
  });

  it('executes every printed ability and every choose-one mode without unresolved interaction or engine failure', () => {
    for (const scenario of scenarios) {
      expect(() => executeScenario(scenario), scenario.name).not.toThrow();
    }
  });

  it('makes every executable printed effect scenario observably change state or emit an event', () => {
    for (const scenario of scenarios.filter((candidate) => candidate.effects.length > 0)) {
      const execution = executeScenario(scenario);
      expect(
        execution.state !== execution.initialState &&
          (JSON.stringify(execution.state) !== JSON.stringify(execution.initialState) ||
            execution.eventCount > 0),
        scenario.name,
      ).toBe(true);
    }
  });
});
