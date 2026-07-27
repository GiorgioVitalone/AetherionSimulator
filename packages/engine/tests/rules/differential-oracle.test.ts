import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { effectiveCost } from '../../src/actions/cost-checker.js';
import { attemptDraw, type DrawCause } from '../../src/effects/draw-service.js';
import { effectiveTraits } from '../../src/selectors/card-semantics.js';
import { CURRENT_GAME_CONFIG, CURRENT_RULES_MANIFEST } from '../../src/rules/manifest.js';
import type { ResourceCost, Trait, ZoneType } from '../../src/types/common.js';
import { getValidAttackTargets } from '../../src/zones/targeting.js';
import { validateIndependentRuleOracle } from '../../src/sim/independent-review.js';
import {
  mockCard,
  mockGameState,
  mockPlayerState,
  zonesWithCards,
} from '../helpers/card-factory.js';

interface OracleScenario {
  readonly id: string;
  readonly family: string;
  readonly rulebookAnchor: string;
  readonly operation: string;
  readonly input: Record<string, any>;
  readonly expected: unknown;
}

const oracle = validateIndependentRuleOracle(JSON.parse(
  readFileSync(
    new URL(
      '../../sim-data/independent-rule-oracle-candidate.json',
      import.meta.url,
    ),
    'utf8',
  ),
)) as ReturnType<typeof validateIndependentRuleOracle> & {
  scenarios: OracleScenario[];
};

function executeScenario(scenario: OracleScenario): unknown {
  switch (scenario.operation) {
    case 'attack_targets': {
      const defenders = scenario.input.defenders as {
        id: string;
        zone: ZoneType;
        traits: Trait[];
      }[];
      const slots = {
        reserve: [null, null] as (ReturnType<typeof mockCard> | null)[],
        frontline: [null, null, null] as (
          | ReturnType<typeof mockCard>
          | null
        )[],
        highGround: [null, null] as (ReturnType<typeof mockCard> | null)[],
      };
      for (const defender of defenders) {
        const key =
          defender.zone === 'high_ground' ? 'highGround' : defender.zone;
        const index = slots[key].findIndex((card) => card === null);
        slots[key][index] = mockCard({
          instanceId: defender.id,
          owner: 1,
          traits: defender.traits,
        });
      }
      return getValidAttackTargets(
        scenario.input.attackerZone as ZoneType,
        scenario.input.attackerTraits as Trait[],
        zonesWithCards(slots),
        CURRENT_GAME_CONFIG,
        0,
      )
        .map((target) =>
          target.type === 'hero' ? 'hero' : target.instanceId ?? '',
        )
        .sort();
    }
    case 'effective_cost': {
      const card = mockCard({
        cost: scenario.input.printed as ResourceCost,
      });
      const player = mockPlayerState(0, {
        costReductions: [
          {
            reduction: scenario.input.reduction as number,
            appliesTo: {},
            duration: { type: 'permanent' },
            usedThisTurn: false,
            sourceInstanceId: 'oracle-reduction',
          },
        ],
      });
      return effectiveCost(player, card, {
        ...CURRENT_GAME_CONFIG,
        costFloor: scenario.input.costFloor as boolean,
      });
    }
    case 'empty_draw':
    case 'one_card_draw_two': {
      const mainDeck =
        scenario.operation === 'one_card_draw_two' ? [mockCard()] : [];
      const state = mockGameState({
        config: CURRENT_GAME_CONFIG,
        players: [
          mockPlayerState(0, { mainDeck }),
          mockPlayerState(1),
        ],
      });
      const result = attemptDraw(
        state,
        0,
        scenario.input.count as number,
        scenario.input.cause as DrawCause,
      );
      return {
        winner: result.state.winner,
        failedAttempt: result.failedAttempt,
        drawnCount: result.drawnCount,
        eventTypes: result.events.map(({ type }) => type),
      };
    }
    case 'effective_traits': {
      return effectiveTraits(
        mockCard({
          traits: scenario.input.printed as Trait[],
          grantedTraits: (scenario.input.granted as Trait[]).map((trait) => ({
            trait,
            duration: { type: 'permanent' },
          })),
        }),
      );
    }
    default:
      throw new Error(`unknown oracle operation ${scenario.operation}`);
  }
}

describe('declarative rulebook differential oracle candidate', () => {
  it('is manually declared, rulebook-bound, unique, and valid for its declared review status', () => {
    expect(oracle.schemaVersion).toBe(1);
    expect(oracle.rulebook.sha256).toBe(
      CURRENT_RULES_MANIFEST.rulebook.sha256,
    );
    expect(oracle.authorship.fixtureSource).toBe(
      'manually_declared_json_not_generated_from_engine',
    );
    if (oracle.status === 'awaiting_independent_rules_review') {
      expect(oracle.authorship).toMatchObject({
        independentAuthor: null,
        independentReviewer: null,
        approvedAt: null,
      });
    } else {
      expect(oracle.authorship.independentAuthor).not.toBe(
        oracle.authorship.independentReviewer,
      );
      expect(Date.parse(oracle.authorship.approvedAt!)).not.toBeNaN();
    }
    expect(new Set(oracle.scenarios.map(({ id }) => id)).size).toBe(
      oracle.scenarios.length,
    );
    for (const scenario of oracle.scenarios) {
      expect(scenario.rulebookAnchor.length, scenario.id).toBeGreaterThan(3);
    }
  });

  for (const scenario of oracle.scenarios) {
    it(`${scenario.id} agrees with the declarative expected result`, () => {
      expect(executeScenario(scenario)).toEqual(scenario.expected);
    });
  }
});
