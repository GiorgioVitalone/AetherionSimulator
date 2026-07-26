import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  evaluatePolicyCalibrationGate,
  summarizePolicyDecisions,
  summarizePolicySensitivity,
  validatePolicyCalibrationManifest,
} from '../../src/sim/policy-calibration.js';
import {
  runPolicyCalibration,
  verifyPolicyCalibration,
} from '../../policy-calibration.mjs';

const manifest = validatePolicyCalibrationManifest(
  JSON.parse(
    readFileSync(
      new URL('../../sim-data/policy-calibration-manifest.json', import.meta.url),
      'utf8',
    ),
  ),
);

describe('current policy calibration', () => {
  it('reports agreement, regret, and paired policy sensitivity with uncertainty', () => {
    const decisions = summarizePolicyDecisions([
      {
        scenarioId: 'combat-lethal-1',
        clusterId: 'puzzle-1',
        family: 'combat',
        candidates: [
          { actionKey: 'attack', value: 1 },
          { actionKey: 'pass', value: -1 },
        ],
        heuristicActionKey: 'pass',
        rolloutActionKey: 'attack',
      },
      {
        scenarioId: 'combat-defense-1',
        clusterId: 'puzzle-2',
        family: 'combat',
        candidates: [
          { actionKey: 'block', value: 0.8 },
          { actionKey: 'pass', value: -0.4 },
        ],
        heuristicActionKey: 'block',
        rolloutActionKey: 'block',
      },
    ]);
    expect(decisions.overall).toMatchObject({
      decisions: 2,
      agreements: 1,
      agreementRate: 0.5,
      meanRegret: 1,
    });
    expect(decisions.overall.agreementInterval95.lo).toBeLessThan(0.5);
    expect(decisions.overall.agreementInterval95.hi).toBeGreaterThan(0.5);
    expect(decisions.overall.regretInterval95).not.toBeNull();

    const sensitivity = summarizePolicySensitivity([
      {
        clusterId: 'schedule-1',
        heuristicOutcome: -1,
        rolloutOutcome: 1,
      },
      {
        clusterId: 'schedule-2',
        heuristicOutcome: 0,
        rolloutOutcome: 0,
      },
    ]);
    expect(sensitivity).toMatchObject({
      clusters: 2,
      meanOutcomeDifference: 1,
    });
    expect(sensitivity.interval95.lo).toBeLessThanOrEqual(1);
    expect(sensitivity.interval95.hi).toBeGreaterThanOrEqual(1);
  });

  it('binds the current forward model and fails closed until ratification and full corpus coverage', () => {
    const blocked = evaluatePolicyCalibrationGate(
      manifest,
      {
        rulesArtifactStatus: 'diagnostic',
        studyArtifactStatus: 'diagnostic',
        rulesManifestHash: 'a'.repeat(64),
        engineBuildHash: 'b'.repeat(64),
        candidateGeneration: 'full',
      },
      {
        decisionCount: 100,
        families: ['combat', 'development'],
      },
    );
    expect(blocked.releaseEligible).toBe(false);
    expect(blocked.reasons).toContain('rules_artifact_status:diagnostic');
    expect(blocked.reasons).toContain('missing_family:reaction');

    const eligible = evaluatePolicyCalibrationGate(
      manifest,
      {
        rulesArtifactStatus: 'ratified',
        studyArtifactStatus: 'ratified',
        rulesManifestHash: 'a'.repeat(64),
        engineBuildHash: 'b'.repeat(64),
        candidateGeneration: 'full',
      },
      {
        decisionCount: 100,
        families: [...manifest.corpus.requiredFamilies],
      },
    );
    expect(eligible).toEqual({ releaseEligible: true, reasons: [] });
  });

  it('measures actual current-engine heuristic/rollout disagreement without overclaiming human skill', () => {
    const report = runPolicyCalibration();
    expect(verifyPolicyCalibration(report)).toEqual([]);
    expect(report.corpus.decisions).toBeGreaterThanOrEqual(
      manifest.corpus.minimumDecisions,
    );
    expect(report.corpus.observedFamilies).toEqual(
      [...manifest.corpus.requiredFamilies].sort(),
    );
    expect(report.corpus.missingFamilies).toEqual([]);
    expect(report.decisionCalibration.byFamily.reaction?.decisions).toBeGreaterThan(
      0,
    );
    expect(
      report.decisionCalibration.byFamily.transform?.decisions,
    ).toBeGreaterThan(0);
    expect(report.decisionCalibration.overall.agreementRate).toBeLessThan(1);
    expect(report.decisionCalibration.overall.regretInterval95).not.toBeNull();
    expect(report.policySensitivity.interval95).toBeDefined();
    expect(report.gate.releaseEligible).toBe(false);
    expect(report.claimLimitations.join(' ')).toMatch(
      /not expert or human truth/i,
    );
  });

  it('rejects weakened or post-hoc calibration manifests', () => {
    const weakened = structuredClone(manifest) as Record<string, any>;
    weakened.engineGate.requiredRulesArtifactStatus = 'diagnostic';
    expect(() => validatePolicyCalibrationManifest(weakened)).toThrow(
      /engine gate is weakened/,
    );

    const overclaim = structuredClone(manifest) as Record<string, any>;
    overclaim.claimScope.humanSkillEquivalence = 'allowed';
    expect(() => validatePolicyCalibrationManifest(overclaim)).toThrow(
      /claim scope/,
    );

    const postHoc = {
      ...structuredClone(manifest),
      preferredResult: 'heuristic',
    };
    expect(() => validatePolicyCalibrationManifest(postHoc)).toThrow(
      /unknown field/,
    );
  });
});
