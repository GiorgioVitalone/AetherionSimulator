import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildCardScenarioInventory,
  validateCardScenarioInventory,
} from '../../src/sim/card-scenario-inventory.js';
import type { ValidatorCard } from '../../src/sim/card-data-validator.js';

const cards = JSON.parse(
  readFileSync(new URL('../../sim-data/aetherion-cards.json', import.meta.url), 'utf8'),
) as ValidatorCard[];
const inventory = buildCardScenarioInventory(cards);

function countModes(value: unknown): number {
  if (Array.isArray(value)) return value.reduce((sum, child) => sum + countModes(child), 0);
  if (typeof value !== 'object' || value === null) return 0;
  const node = value as Record<string, unknown>;
  const own =
    node.type === 'choose_one' && Array.isArray(node.options)
      ? node.options.length
      : 0;
  return own + Object.values(node).reduce((sum, child) => sum + countModes(child), 0);
}

describe('generated every-card scenario inventory', () => {
  it('has one base scenario per printed ability and one scenario per choose-one mode', () => {
    const abilityCount = cards.reduce((sum, card) => sum + card.abilities.length, 0);
    const modeCount = cards.reduce(
      (sum, card) =>
        sum +
        card.abilities.reduce(
          (abilitySum, ability) => abilitySum + countModes(ability.dsl),
          0,
        ),
      0,
    );
    expect(inventory).toHaveLength(abilityCount + modeCount);
    expect(validateCardScenarioInventory(cards, inventory)).toEqual([]);
  });

  it('carries explicit state-variant obligations for optional targets, sides, zones, and expiry', () => {
    const all = new Set(inventory.flatMap((item) => item.requirements));
    expect(all).toEqual(
      new Set([
        'trigger_or_declaration',
        'choose_mode',
        'optional_zero',
        'optional_max',
        'allied_target',
        'enemy_target',
        'any_target',
        'empty_zone',
        'full_zone',
        'duration_expiry',
      ]),
    );
  });

  it('contains stable named entries for the modal Verdant regressions', () => {
    expect(
      inventory.map((item) => item.scenarioId),
    ).toEqual(
      expect.arrayContaining([
        'core1-h-v-097-ability-0-mode-deploy-bio-construct',
        'core1-h-v-097-ability-0-mode-gain-temporary-energy',
        'core1-h-v-097-ability-1-base',
        'core1-t-v-098-ability-0-mode-buff-bio-constructs',
        'core1-t-v-098-ability-0-mode-deploy-bio-constructs',
        'core1-t-v-098-ability-2-base',
        'core1-t-s-066-ability-0-base',
      ]),
    );
  });
});
