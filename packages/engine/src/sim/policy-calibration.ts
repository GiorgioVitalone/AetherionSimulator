import { bootstrapCI } from '../stats/bootstrap.js';
import { wilsonInterval } from '../stats/wilson.js';

export type PolicyScenarioFamily =
  | 'combat'
  | 'development'
  | 'resource'
  | 'equipment'
  | 'ability'
  | 'movement'
  | 'reaction'
  | 'choice'
  | 'transform';

export interface PolicyCandidateValue {
  readonly actionKey: string;
  readonly value: number;
}

export interface PolicyDecisionObservation {
  readonly scenarioId: string;
  readonly clusterId: string;
  readonly family: PolicyScenarioFamily;
  readonly candidates: readonly PolicyCandidateValue[];
  readonly heuristicActionKey: string | null;
  readonly rolloutActionKey: string;
}

export interface PolicySensitivityObservation {
  readonly clusterId: string;
  /** Outcome from the same declared seat/faction perspective in [-1, 1]. */
  readonly heuristicOutcome: number;
  readonly rolloutOutcome: number;
}

export interface PolicyCalibrationManifest {
  readonly schemaVersion: 1;
  readonly calibrationId: string;
  readonly status: 'diagnostic' | 'candidate' | 'ratified';
  readonly corpus: {
    readonly source: 'runtime_current_tactical_positions';
    readonly labelSource: 'rollout_outcome_estimates_not_human_truth';
    readonly minimumDecisions: number;
    readonly requiredFamilies: readonly PolicyScenarioFamily[];
  };
  readonly policies: {
    readonly student: 'heuristic';
    readonly reference: 'rollout';
    readonly candidateGeneration: 'full';
  };
  readonly uncertainty: {
    readonly agreement: 'wilson_95';
    readonly regret: 'cluster_bootstrap_percentile_95';
    readonly policySensitivity: 'paired_cluster_bootstrap_percentile_95';
  };
  readonly engineGate: {
    readonly profile: 'current';
    readonly requiredRulesArtifactStatus: 'ratified';
    readonly requiredStudyArtifactStatus: 'ratified';
    readonly rulesManifestBinding: 'runtime_required';
    readonly engineBuildBinding: 'runtime_required';
    readonly completeActionGeneration: 'required';
  };
  readonly claimScope: {
    readonly decisionAgreement: 'heuristic_vs_rollout_diagnostic';
    readonly humanSkillEquivalence:
      'prohibited_without_independent_expert_labels_and_human_logs';
  };
}

export interface PolicyCalibrationBindings {
  readonly rulesArtifactStatus: string;
  readonly studyArtifactStatus: string;
  readonly rulesManifestHash: string;
  readonly engineBuildHash: string;
  readonly candidateGeneration: string;
}

interface DecisionSummary {
  readonly decisions: number;
  readonly agreements: number;
  readonly agreementRate: number;
  readonly agreementInterval95: {
    readonly lo: number;
    readonly hi: number;
  };
  readonly heuristicOffList: number;
  readonly heuristicOffListRate: number;
  readonly meanRegret: number | null;
  readonly regretInterval95: {
    readonly lo: number;
    readonly hi: number;
  } | null;
}

export function validatePolicyCalibrationManifest(
  input: unknown,
): PolicyCalibrationManifest {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new TypeError('policy calibration manifest must be an object');
  }
  const manifest = input as Record<string, unknown>;
  const allowed = [
    'schemaVersion',
    'calibrationId',
    'status',
    'corpus',
    'policies',
    'uncertainty',
    'engineGate',
    'claimScope',
  ];
  const unknown = Object.keys(manifest).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) {
    throw new TypeError(
      `policy calibration manifest has unknown field ${String(unknown[0])}`,
    );
  }
  if (
    manifest.schemaVersion !== 1 ||
    typeof manifest.calibrationId !== 'string' ||
    !['diagnostic', 'candidate', 'ratified'].includes(String(manifest.status))
  ) {
    throw new TypeError('policy calibration identity/status is invalid');
  }
  const corpus = objectValue(manifest.corpus, 'policy calibration corpus');
  if (
    corpus.source !== 'runtime_current_tactical_positions' ||
    corpus.labelSource !==
      'rollout_outcome_estimates_not_human_truth' ||
    !Number.isSafeInteger(corpus.minimumDecisions) ||
    typeof corpus.minimumDecisions !== 'number' ||
    corpus.minimumDecisions < 1 ||
    !Array.isArray(corpus.requiredFamilies)
  ) {
    throw new TypeError('policy calibration corpus contract is invalid');
  }
  const policies = objectValue(manifest.policies, 'policy calibration policies');
  if (
    policies.student !== 'heuristic' ||
    policies.reference !== 'rollout' ||
    policies.candidateGeneration !== 'full'
  ) {
    throw new TypeError('policy calibration policy contract is invalid');
  }
  const uncertainty = objectValue(
    manifest.uncertainty,
    'policy calibration uncertainty',
  );
  if (
    uncertainty.agreement !== 'wilson_95' ||
    uncertainty.regret !== 'cluster_bootstrap_percentile_95' ||
    uncertainty.policySensitivity !==
      'paired_cluster_bootstrap_percentile_95'
  ) {
    throw new TypeError('policy calibration uncertainty contract is invalid');
  }
  const engineGate = objectValue(
    manifest.engineGate,
    'policy calibration engine gate',
  );
  if (
    engineGate.profile !== 'current' ||
    engineGate.requiredRulesArtifactStatus !== 'ratified' ||
    engineGate.requiredStudyArtifactStatus !== 'ratified' ||
    engineGate.rulesManifestBinding !== 'runtime_required' ||
    engineGate.engineBuildBinding !== 'runtime_required' ||
    engineGate.completeActionGeneration !== 'required'
  ) {
    throw new TypeError('policy calibration engine gate is weakened');
  }
  const claimScope = objectValue(
    manifest.claimScope,
    'policy calibration claim scope',
  );
  if (
    claimScope.decisionAgreement !==
      'heuristic_vs_rollout_diagnostic' ||
    claimScope.humanSkillEquivalence !==
      'prohibited_without_independent_expert_labels_and_human_logs'
  ) {
    throw new TypeError('policy calibration claim scope is invalid');
  }
  return input as PolicyCalibrationManifest;
}

function objectValue(
  value: unknown,
  path: string,
): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object`);
  }
  return value as Readonly<Record<string, unknown>>;
}

export function summarizePolicyDecisions(
  observations: readonly PolicyDecisionObservation[],
): {
  readonly overall: DecisionSummary;
  readonly byFamily: Readonly<Record<string, DecisionSummary>>;
} {
  const seen = new Set<string>();
  for (const observation of observations) {
    if (seen.has(observation.scenarioId)) {
      throw new Error(`duplicate policy scenario ${observation.scenarioId}`);
    }
    seen.add(observation.scenarioId);
    if (observation.candidates.length === 0) {
      throw new Error(`${observation.scenarioId} has no candidate values`);
    }
    if (
      observation.candidates.some(
        (candidate) =>
          candidate.actionKey.length === 0 || !Number.isFinite(candidate.value),
      )
    ) {
      throw new Error(`${observation.scenarioId} has an invalid candidate value`);
    }
  }
  const families = [...new Set(observations.map(({ family }) => family))].sort();
  return {
    overall: decisionSummary(observations, 0x504f4c59),
    byFamily: Object.fromEntries(
      families.map((family, index) => [
        family,
        decisionSummary(
          observations.filter((observation) => observation.family === family),
          0x504f4c59 ^ (index + 1),
        ),
      ]),
    ),
  };
}

export function summarizePolicySensitivity(
  observations: readonly PolicySensitivityObservation[],
): {
  readonly clusters: number;
  readonly meanOutcomeDifference: number;
  readonly interval95: { readonly lo: number; readonly hi: number };
} {
  const clusters = new Set<string>();
  const differences = observations.map((observation) => {
    if (
      clusters.has(observation.clusterId) ||
      !Number.isFinite(observation.heuristicOutcome) ||
      !Number.isFinite(observation.rolloutOutcome) ||
      Math.abs(observation.heuristicOutcome) > 1 ||
      Math.abs(observation.rolloutOutcome) > 1
    ) {
      throw new Error(`invalid policy sensitivity cluster ${observation.clusterId}`);
    }
    clusters.add(observation.clusterId);
    return observation.rolloutOutcome - observation.heuristicOutcome;
  });
  const interval = bootstrapCI(differences, mean, 0.95, 2_000, 0x53454e53);
  return {
    clusters: observations.length,
    meanOutcomeDifference: interval.point,
    interval95: { lo: interval.lo, hi: interval.hi },
  };
}

export function evaluatePolicyCalibrationGate(
  manifest: PolicyCalibrationManifest,
  bindings: PolicyCalibrationBindings,
  observed: {
    readonly decisionCount: number;
    readonly families: readonly PolicyScenarioFamily[];
  },
): {
  readonly releaseEligible: boolean;
  readonly reasons: readonly string[];
} {
  const reasons = [
    ...(bindings.rulesArtifactStatus !==
    manifest.engineGate.requiredRulesArtifactStatus
      ? [`rules_artifact_status:${bindings.rulesArtifactStatus}`]
      : []),
    ...(bindings.studyArtifactStatus !==
    manifest.engineGate.requiredStudyArtifactStatus
      ? [`study_artifact_status:${bindings.studyArtifactStatus}`]
      : []),
    ...(!/^[a-f0-9]{64}$/u.test(bindings.rulesManifestHash)
      ? ['rules_manifest_hash_missing']
      : []),
    ...(!/^[a-f0-9]{64}$/u.test(bindings.engineBuildHash)
      ? ['engine_build_hash_missing']
      : []),
    ...(bindings.candidateGeneration !==
    manifest.policies.candidateGeneration
      ? [`candidate_generation:${bindings.candidateGeneration}`]
      : []),
    ...(observed.decisionCount < manifest.corpus.minimumDecisions
      ? [
          `insufficient_decisions:${String(observed.decisionCount)}/${String(
            manifest.corpus.minimumDecisions,
          )}`,
        ]
      : []),
    ...manifest.corpus.requiredFamilies
      .filter((family) => !observed.families.includes(family))
      .map((family) => `missing_family:${family}`),
  ];
  return { releaseEligible: reasons.length === 0, reasons };
}

function decisionSummary(
  observations: readonly PolicyDecisionObservation[],
  seed: number,
): DecisionSummary {
  const agreements = observations.filter(
    ({ heuristicActionKey, rolloutActionKey }) =>
      heuristicActionKey !== null && heuristicActionKey === rolloutActionKey,
  ).length;
  const heuristicOffList = observations.filter(
    ({ heuristicActionKey }) => heuristicActionKey === null,
  ).length;
  const regrets = observations.flatMap((observation) => {
    if (observation.heuristicActionKey === null) return [];
    const heuristic = observation.candidates.find(
      ({ actionKey }) => actionKey === observation.heuristicActionKey,
    );
    const best = Math.max(
      ...observation.candidates.map(({ value }) => value),
    );
    return heuristic === undefined ? [] : [Math.max(0, best - heuristic.value)];
  });
  const agreementInterval = wilsonInterval(agreements, observations.length);
  const regretInterval =
    regrets.length === 0
      ? null
      : bootstrapCI(regrets, mean, 0.95, 2_000, seed);
  return {
    decisions: observations.length,
    agreements,
    agreementRate:
      observations.length === 0 ? 0 : agreements / observations.length,
    agreementInterval95: {
      lo: agreementInterval.lo,
      hi: agreementInterval.hi,
    },
    heuristicOffList,
    heuristicOffListRate:
      observations.length === 0
        ? 0
        : heuristicOffList / observations.length,
    meanRegret: regretInterval?.point ?? null,
    regretInterval95:
      regretInterval === null
        ? null
        : { lo: regretInterval.lo, hi: regretInterval.hi },
  };
}

function mean(values: readonly number[]): number {
  return values.length === 0
    ? 0
    : values.reduce((total, value) => total + value, 0) / values.length;
}
