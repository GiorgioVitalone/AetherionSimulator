import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateStudyManifest } from '../../src/sim/study-manifest.js';

const manifest = JSON.parse(
  readFileSync(
    new URL('../../sim-data/current-study-manifest.json', import.meta.url),
    'utf8',
  ),
) as unknown;

describe('predeclared current study manifest', () => {
  it('fully specifies artifacts, policies, termination, population, statistics, and gates', () => {
    expect(validateStudyManifest(manifest)).toMatchObject({
      status: 'diagnostic',
      artifacts: {
        rules: {
          profile: 'current',
          binding: 'runtime_required',
        },
        engineBuild: {
          packageName: '@aetherion-sim/engine',
          binding: 'runtime_required',
        },
        harnessBuild: {
          binding: 'runtime_required',
        },
        botImplementation: {
          binding: 'runtime_required',
        },
        policyCalibration: {
          binding: 'runtime_required',
          requiredRulesArtifactStatus: 'ratified',
        },
      },
      policies: {
        population: 'uniform_heuristic_v1',
        reaction: 'chooseReactiveAction',
        mulligan: 'shouldKeepHand',
      },
      termination: {
        turnCap: 80,
        turnCapOutcome: 'typed_turn_cap_draw',
        tiebreak: 'disabled',
      },
      population: {
        factions: ['Onyx', 'Radiant', 'Sapphire', 'Verdant'],
        minimumDistinctDecksPerFaction: 2,
      },
      deckPopulation: {
        source: 'deterministic_seeded_sampler',
        seed: 20260726,
        decksPerFaction: 5,
      },
      schedule: {
        gameSeedBase: 20260726,
        counterbalanceBlockSize: 4,
        clusterUnit: 'matchup_x_schedule_block',
        firstPlayerAssignment: 'alternating_by_replicate',
      },
      endpoints: {
        leaderModel: {
          id: 'multicomponent_leader_v1',
          snapshotTurn: 10,
        },
      },
      multiplicity: {
        method: 'schedule_preserving_permutation_maxT',
        familywiseAlpha: 0.05,
      },
      power: {
        target: 0.8,
        nominalIndependentGamesPerFactionArm: 946,
        calibrationRequired: true,
      },
      validityGates: {
        requiredRulesArtifactStatus: 'ratified',
        independentRuleOracle: 'required',
      },
    });
  });

  it('rejects incomplete, incoherent, or weakened study contracts', () => {
    const candidate = structuredClone(manifest) as Record<string, any>;
    candidate.practicalThresholds.factionSpreadFailPctPoints = 4;
    expect(() => validateStudyManifest(candidate)).toThrow(/fail threshold/);

    const weakened = structuredClone(manifest) as Record<string, any>;
    weakened.validityGates.independentRuleOracle = 'optional';
    expect(() => validateStudyManifest(weakened)).toThrow(/release gate/);

    const unknown = {
      ...(structuredClone(manifest) as Record<string, unknown>),
      postHocEndpoint: true,
    };
    expect(() => validateStudyManifest(unknown)).toThrow(/unknown field/);

    const overclaim = structuredClone(manifest) as Record<string, any>;
    overclaim.population.claimScope = 'full_game_metagame';
    expect(() => validateStudyManifest(overclaim)).toThrow(/scoped four-faction/);

    const underpowered = structuredClone(manifest) as Record<string, any>;
    underpowered.power.nominalIndependentGamesPerFactionArm = 100;
    expect(() => validateStudyManifest(underpowered)).toThrow(/design calculation/);

    const missingBuild = structuredClone(manifest) as Record<string, any>;
    delete missingBuild.artifacts.engineBuild;
    expect(() => validateStudyManifest(missingBuild)).toThrow(/engineBuild/);

    const incompletePolicy = structuredClone(manifest) as Record<string, any>;
    delete incompletePolicy.policies.reaction;
    expect(() => validateStudyManifest(incompletePolicy)).toThrow(/bot lifecycle/);

    const unboundCalibration = structuredClone(manifest) as Record<string, any>;
    delete unboundCalibration.artifacts.policyCalibration;
    expect(() => validateStudyManifest(unboundCalibration)).toThrow(
      /policyCalibration/,
    );

    const unboundDecks = structuredClone(manifest) as Record<string, any>;
    unboundDecks.runtimeBindings = unboundDecks.runtimeBindings.filter(
      (binding: string) => binding !== 'deckContentHashes',
    );
    expect(() => validateStudyManifest(unboundDecks)).toThrow(/required hash/);
  });
});
