/**
 * Unit tests for the card-data validator (src/sim/card-data-validator.ts).
 *
 * One passing case + one violating case per rule. Cards are built with a
 * helper so each test only sets the fields relevant to the rule under test.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  validateCardData,
  RULES,
  type ValidatorCard,
  type ValidatorAbility,
} from '../../src/sim/card-data-validator.js';

const ACTIVATED_DSL = { type: 'triggered', trigger: { type: 'activated' } };
const ON_DEPLOY_DSL = { type: 'triggered', trigger: { type: 'on_deploy' } };
const AURA_DSL = { type: 'aura' };

function ability(overrides: Partial<ValidatorAbility>): ValidatorAbility {
  return {
    type: 'Deploy',
    cost: { mana: 0, energy: 0 },
    dsl: ON_DEPLOY_DSL,
    ...overrides,
  };
}

function card(overrides: Partial<ValidatorCard>): ValidatorCard {
  return {
    id: 1,
    name: 'Test Card',
    cardType: 'C',
    abilities: [],
    ...overrides,
  };
}

function findingsFor(rule: string, cards: readonly ValidatorCard[]) {
  return validateCardData(cards).filter((f) => f.rule === rule);
}

function strictCard(overrides: Partial<ValidatorCard> = {}): ValidatorCard {
  return {
    id: 1,
    cardCode: 'CORE1-C-O-001',
    name: 'Strict Card',
    cardType: 'C',
    alignment: ['Onyx'],
    tags: [],
    traits: [],
    cost: { mana: 1, energy: 0, flexible: 0 },
    stats: { hp: 2, atk: 1, arm: 0 },
    abilities: [],
    transformationId: null,
    originalHeroId: null,
    ...overrides,
  };
}

describe('validateCardData — dsl-null', () => {
  it('passes when every ability has a dsl', () => {
    const c = card({ abilities: [ability({ dsl: ON_DEPLOY_DSL })] });
    expect(findingsFor(RULES.DSL_NULL, [c])).toEqual([]);
  });

  it('flags an ability with dsl: null', () => {
    const c = card({ abilities: [ability({ dsl: null })] });
    const findings = findingsFor(RULES.DSL_NULL, [c]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ severity: 'error', cardId: 1, abilityIndex: 0 });
  });
});

describe('validateCardData — hero-ability-count', () => {
  it('passes a Hero with exactly one Aura and one Trigger', () => {
    const c = card({
      cardType: 'H',
      abilities: [
        ability({ type: 'Aura', dsl: AURA_DSL }),
        ability({ type: 'Trigger', dsl: ACTIVATED_DSL }),
      ],
    });
    expect(findingsFor(RULES.HERO_ABILITY_COUNT, [c])).toEqual([]);
  });

  it('flags a Hero missing an Aura', () => {
    const c = card({
      cardType: 'H',
      abilities: [ability({ type: 'Trigger', dsl: ACTIVATED_DSL })],
    });
    const findings = findingsFor(RULES.HERO_ABILITY_COUNT, [c]);
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain('0 [Aura]');
  });
});

describe('validateCardData — transformed-ability-count', () => {
  it('passes a Transformed card with exactly one Aura, Trigger, and Ultimate', () => {
    const c = card({
      cardType: 'T',
      abilities: [
        ability({ type: 'Aura', dsl: AURA_DSL }),
        ability({ type: 'Trigger', dsl: ACTIVATED_DSL }),
        ability({ type: 'Ultimate', dsl: ACTIVATED_DSL }),
      ],
    });
    expect(findingsFor(RULES.TRANSFORMED_ABILITY_COUNT, [c])).toEqual([]);
  });

  it('flags a Transformed card with two Aura abilities', () => {
    const c = card({
      cardType: 'T',
      abilities: [
        ability({ type: 'Aura', dsl: AURA_DSL }),
        ability({ type: 'Aura', dsl: AURA_DSL }),
        ability({ type: 'Trigger', dsl: ACTIVATED_DSL }),
        ability({ type: 'Ultimate', dsl: ACTIVATED_DSL }),
      ],
    });
    const findings = findingsFor(RULES.TRANSFORMED_ABILITY_COUNT, [c]);
    expect(findings.some((f) => f.message.includes('2 [Aura]'))).toBe(true);
  });
});

describe('validateCardData — activated-mismatch', () => {
  it('passes a [Trigger] whose dsl.trigger.type is activated', () => {
    const c = card({ abilities: [ability({ type: 'Trigger', dsl: ACTIVATED_DSL })] });
    expect(findingsFor(RULES.ACTIVATED_MISMATCH, [c])).toEqual([]);
  });

  it('flags a [Trigger] that is actually event-driven', () => {
    const c = card({ abilities: [ability({ type: 'Trigger', dsl: ON_DEPLOY_DSL })] });
    const findings = findingsFor(RULES.ACTIVATED_MISMATCH, [c]);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('error');
  });
});

describe('validateCardData — react-on-hero', () => {
  it('passes a [React] ability on a Character', () => {
    const c = card({
      cardType: 'C',
      abilities: [ability({ type: 'React', dsl: { ...ON_DEPLOY_DSL, react: true } })],
    });
    expect(findingsFor(RULES.REACT_ON_HERO, [c])).toEqual([]);
  });

  it('flags a [React] ability on a Hero', () => {
    const c = card({
      cardType: 'H',
      abilities: [ability({ type: 'React', dsl: { ...ON_DEPLOY_DSL, react: true } })],
    });
    const findings = findingsFor(RULES.REACT_ON_HERO, [c]);
    expect(findings).toHaveLength(1);
  });
});

describe('validateCardData — react-flag-mismatch', () => {
  it('passes when type React and dsl.react agree', () => {
    const c = card({
      abilities: [ability({ type: 'React', dsl: { ...ON_DEPLOY_DSL, react: true } })],
    });
    expect(findingsFor(RULES.REACT_FLAG_MISMATCH, [c])).toEqual([]);
  });

  it('flags a [React]-typed ability whose dsl.react is not true', () => {
    const c = card({ abilities: [ability({ type: 'React', dsl: ON_DEPLOY_DSL })] });
    const findings = findingsFor(RULES.REACT_FLAG_MISMATCH, [c]);
    expect(findings).toHaveLength(1);
  });

  it('flags dsl.react === true on an ability not typed [React]', () => {
    const c = card({
      abilities: [ability({ type: 'Deploy', dsl: { ...ON_DEPLOY_DSL, react: true } })],
    });
    const findings = findingsFor(RULES.REACT_FLAG_MISMATCH, [c]);
    expect(findings).toHaveLength(1);
  });
});

describe('validateCardData — event-driven-cost', () => {
  it('passes a zero-cost event-driven ability', () => {
    const c = card({ abilities: [ability({ cost: { mana: 0, energy: 0 }, dsl: ON_DEPLOY_DSL })] });
    expect(findingsFor(RULES.EVENT_DRIVEN_COST, [c])).toEqual([]);
  });

  it('passes a nonzero-cost activated ability', () => {
    const c = card({ abilities: [ability({ cost: { mana: 2, energy: 0 }, dsl: ACTIVATED_DSL })] });
    expect(findingsFor(RULES.EVENT_DRIVEN_COST, [c])).toEqual([]);
  });

  it('flags a nonzero-cost event-driven ability', () => {
    const c = card({ abilities: [ability({ cost: { mana: 0, energy: 2 }, dsl: ON_DEPLOY_DSL })] });
    const findings = findingsFor(RULES.EVENT_DRIVEN_COST, [c]);
    expect(findings).toHaveLength(1);
  });
});

describe('validateCardData — react-on-equipment', () => {
  it('passes a [React] ability on a Character (not Equipment)', () => {
    const c = card({
      cardType: 'C',
      abilities: [ability({ type: 'React', dsl: { ...ON_DEPLOY_DSL, react: true } })],
    });
    expect(findingsFor(RULES.REACT_ON_EQUIPMENT, [c])).toEqual([]);
  });

  it('warns on a [React] ability on Equipment', () => {
    const c = card({
      cardType: 'E',
      abilities: [ability({ type: 'React', dsl: { ...ON_DEPLOY_DSL, react: true } })],
    });
    const findings = findingsFor(RULES.REACT_ON_EQUIPMENT, [c]);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('warn');
  });
});

describe('validateCardData — ability-count-regression', () => {
  it('passes when ability count stays the same or grows', () => {
    const previous = [card({ id: 1, abilities: [ability({}), ability({})] })];
    const current = [card({ id: 1, abilities: [ability({}), ability({}), ability({})] })];
    const findings = validateCardData(current, { previousCards: previous }).filter(
      (f) => f.rule === RULES.ABILITY_COUNT_REGRESSION,
    );
    expect(findings).toEqual([]);
  });

  it('warns when a card loses abilities vs a previous export', () => {
    const previous = [card({ id: 1, abilities: [ability({}), ability({})] })];
    const current = [card({ id: 1, abilities: [ability({})] })];
    const findings = validateCardData(current, { previousCards: previous }).filter(
      (f) => f.rule === RULES.ABILITY_COUNT_REGRESSION,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('warn');
  });
});

describe('validateCardData — strict semantic families', () => {
  it('accepts the complete committed 130-definition corpus with no exceptions', () => {
    const cards = JSON.parse(
      readFileSync(new URL('../../sim-data/aetherion-cards.json', import.meta.url), 'utf8'),
    ) as ValidatorCard[];
    const exceptions = JSON.parse(
      readFileSync(
        new URL('../../sim-data/card-semantic-exceptions.json', import.meta.url),
        'utf8',
      ),
    );
    expect(cards).toHaveLength(130);
    expect(validateCardData(cards, { exceptions })).toEqual([]);
  });

  it.each([
    [
      RULES.CHARACTER_BASE_HP,
      [strictCard({ stats: { hp: 0, atk: 1, arm: 0 } })],
    ],
    [
      RULES.UNIQUE_DEFINITION_ID,
      [
        strictCard(),
        strictCard({ cardCode: 'CORE1-C-O-002' }),
      ],
    ],
    [
      RULES.UNIQUE_STABLE_SLUG,
      [
        strictCard(),
        strictCard({ id: 2 }),
      ],
    ],
    [
      RULES.RESOURCE_TYPE,
      [strictCard({ cardType: 'R', cardCode: 'CORE1-R-N-001' })],
    ],
    [
      RULES.UNKNOWN_DSL_NODE,
      [
        strictCard({
          abilities: [
            ability({
              dsl: {
                type: 'triggered',
                trigger: { type: 'on_deploy' },
                effects: [{ type: 'not_supported' }],
              },
            }),
          ],
        }),
      ],
    ],
    [
      RULES.CHOOSE_ONE_REACHABILITY,
      [
        strictCard({
          abilities: [
            ability({
              dsl: {
                type: 'triggered',
                trigger: { type: 'on_deploy' },
                effects: [{ type: 'choose_one', options: [{ label: 'Only', effects: [] }] }],
              },
            }),
          ],
        }),
      ],
    ],
    [
      RULES.TARGET_REACHABILITY,
      [
        strictCard({
          abilities: [
            ability({
              dsl: {
                type: 'triggered',
                trigger: { type: 'on_deploy' },
                effects: [
                  {
                    type: 'deal_damage',
                    amount: { type: 'fixed', value: 1 },
                    target: { type: 'target_character' },
                  },
                ],
              },
            }),
          ],
        }),
      ],
    ],
    [
      RULES.TAG_POPULATION,
      [
        strictCard({
          abilities: [
            ability({
              dsl: {
                type: 'triggered',
                trigger: { type: 'on_deploy' },
                effects: [
                  {
                    type: 'destroy',
                    target: {
                      type: 'target_character',
                      side: 'enemy',
                      filter: { tag: 'Missing-Population' },
                    },
                  },
                ],
              },
            }),
          ],
        }),
      ],
    ],
    [
      RULES.DURATION_COMPATIBILITY,
      [
        strictCard({
          abilities: [
            ability({
              dsl: {
                type: 'triggered',
                trigger: { type: 'on_deploy' },
                effects: [
                  {
                    type: 'grant_trait',
                    trait: 'haste',
                    target: { type: 'self' },
                    duration: { type: 'instant' },
                  },
                ],
              },
            }),
          ],
        }),
      ],
    ],
    [
      RULES.CONDITION_SEMANTICS,
      [
        strictCard({
          abilities: [
            ability({
              dsl: {
                type: 'triggered',
                trigger: { type: 'on_deploy' },
                effects: [
                  {
                    type: 'conditional',
                    condition: {
                      type: 'triggering_card_cost',
                      comparison: 'less_equal',
                      relativeTo: 'triggering_spell',
                    },
                    ifTrue: [{ type: 'draw_cards', count: { type: 'fixed', value: 1 }, player: 'allied' }],
                  },
                ],
              },
            }),
          ],
        }),
      ],
    ],
    [
      RULES.DYNAMIC_STAT_AXIS,
      [
        strictCard({
          abilities: [
            ability({
              dsl: {
                type: 'triggered',
                trigger: { type: 'on_deploy' },
                effects: [
                  {
                    type: 'modify_stats',
                    modifier: {},
                    dynamicModifier: { type: 'multiply', factor: 2 },
                    target: { type: 'self' },
                    duration: { type: 'permanent' },
                  },
                ],
              },
            }),
          ],
        }),
      ],
    ],
    [
      RULES.TEXT_DSL_HINT,
      [
        strictCard({
          abilities: [
            ability({
              effect: 'Choose one: draw a card or heal.',
              dsl: {
                type: 'triggered',
                trigger: { type: 'on_deploy' },
                effects: [{ type: 'draw_cards', count: { type: 'fixed', value: 1 }, player: 'allied' }],
              },
            }),
          ],
        }),
      ],
    ],
  ] as const)('rejects a corrupted fixture for %s', (rule, cards) => {
    expect(findingsFor(rule, cards)).not.toEqual([]);
  });

  it('rejects non-reciprocal Hero transformation references', () => {
    const hero = strictCard({
      id: 10,
      cardCode: 'CORE1-H-O-010',
      cardType: 'H',
      transformationId: 11,
      stats: { hp: 30, atk: 0, arm: 0 },
    });
    const transformed = strictCard({
      id: 11,
      cardCode: 'CORE1-T-O-011',
      cardType: 'T',
      originalHeroId: 99,
      stats: { hp: 0, atk: 0, arm: 0 },
    });
    expect(findingsFor(RULES.REFERENCE, [hero, transformed])).not.toEqual([]);
  });

  it('only suppresses a semantic finding through a complete, owned, non-stale exception', () => {
    const broken = strictCard({
      abilities: [
        ability({
          effect: 'Choose one: draw or heal.',
          dsl: {
            type: 'triggered',
            trigger: { type: 'on_deploy' },
            effects: [{ type: 'draw_cards', count: { type: 'fixed', value: 1 }, player: 'allied' }],
          },
        }),
      ],
    });
    const exception = {
      cardId: 1,
      abilityIndex: 0,
      rule: RULES.TEXT_DSL_HINT,
      owner: 'dsl-owner',
      rationale: 'Comparison requires authored review.',
      expectedSemantics: 'Draw exactly one card.',
      scenarioId: 'card-1-ability-0-draw',
    };
    expect(validateCardData([broken], { exceptions: [exception] })).toEqual([]);
    expect(
      validateCardData([broken], {
        exceptions: [{ ...exception, rule: RULES.DYNAMIC_STAT_AXIS }],
      }).some((finding) => finding.rule === RULES.EXCEPTION_REGISTER),
    ).toBe(true);
  });
});
