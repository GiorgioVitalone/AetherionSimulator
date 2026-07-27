#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import {
  canonicalHash,
  runSim,
} from './sim-runner.mjs';
import {
  evaluatePolicyCalibrationGate,
  summarizePolicyDecisions,
  summarizePolicySensitivity,
  validatePolicyCalibrationManifest,
} from './dist/sim/policy-calibration.js';

const manifest = validatePolicyCalibrationManifest(
  JSON.parse(
    readFileSync(
      new URL('./sim-data/policy-calibration-manifest.json', import.meta.url),
      'utf8',
    ),
  ),
);
const rulesManifest = JSON.parse(
  readFileSync(
    new URL('./sim-data/ruleset-current.json', import.meta.url),
    'utf8',
  ),
);

const baseConfig = {
  rulesProfile: 'current',
  matchups: {
    factions: ['Onyx', 'Radiant'],
    includeMirrors: false,
  },
  decks: {
    Onyx: 'Onyx',
    Radiant: 'Radiant',
  },
  gamesPerPairing: 4,
  turnCap: 6,
  termination: 'tiebreak',
  seedBase: 0x504f4c59,
  pairedPolicySeedKey: 'current-policy-calibration-v1',
  seatAlternation: true,
  observation: { finalState: true },
  collectReplay: true,
};

function actionKey(action) {
  return canonicalHash(action);
}

function scenarioFamily(row) {
  if (
    row.family === 'reaction' ||
    row.family === 'choice'
  ) {
    return row.family;
  }
  const candidates = row.candidates;
  const kinds = new Set(
    candidates
      .map(({ action }) => action?.type)
      .filter((kind) => typeof kind === 'string'),
  );
  if (kinds.has('declare_transform')) return 'transform';
  if (kinds.has('declare_attack')) return 'combat';
  if (
    kinds.has('attach_equipment') ||
    kinds.has('remove_equipment') ||
    kinds.has('transfer_equipment')
  ) {
    return 'equipment';
  }
  if (kinds.has('activate_ability')) return 'ability';
  if (kinds.has('move')) return 'movement';
  if (kinds.has('tap_reserve') || kinds.has('discard_for_energy')) {
    return 'resource';
  }
  return 'development';
}

function outcomeValue(outcome) {
  if (outcome.winner === 0) return 1;
  if (outcome.winner === 1) return -1;
  return 0;
}

function decisionObservations(run, panelId) {
  return run.decisionLog.flatMap((row, index) => {
    const candidates = row.candidates.flatMap((candidate) =>
      Number.isFinite(candidate.value)
        ? [{ actionKey: actionKey(candidate.action), value: candidate.value }]
        : [],
    );
    const rolloutCandidate = row.candidates[row.chosenIdx];
    // A forced interaction with only one legal response is runtime coverage,
    // but not a policy decision and therefore cannot calibrate agreement/regret.
    if (candidates.length < 2 || rolloutCandidate === undefined) return [];
    const heuristicCandidate =
      row.heuristicIdx >= 0 ? row.candidates[row.heuristicIdx] : undefined;
    return [
      {
        scenarioId: `${panelId}-game-${String(row.game)}-turn-${String(
          row.turn,
        )}-mover-${String(row.mover)}-decision-${String(index)}`,
        clusterId: `${panelId}-game-${String(row.game)}`,
        family: scenarioFamily(row),
        candidates,
        heuristicActionKey:
          heuristicCandidate === undefined
            ? null
            : actionKey(heuristicCandidate.action),
        rolloutActionKey: actionKey(rolloutCandidate.action),
      },
    ];
  });
}

export function runPolicyCalibration() {
  const heuristic = runSim({
    ...baseConfig,
    botPolicy: 'heuristic',
  });
  const rollout = runSim({
    ...baseConfig,
    botPolicy: 'rollout',
    rollouts: 2,
    rolloutDepth: 1,
    maxCandidates: 6,
    candidateGen: 'full',
    playoutBackend: 'snapshot',
    rolloutPlayout: 'heuristic',
    collectDecisionLog: true,
    rolloutInteractions: true,
  });
  const reactionRollout = runSim({
    ...baseConfig,
    matchups: {
      factions: ['Sapphire', 'Onyx'],
      includeMirrors: false,
    },
    decks: {
      Sapphire: 'Sapphire',
      Onyx: 'Onyx',
    },
    gamesPerPairing: 4,
    turnCap: 20,
    // Fixed current-profile schedule with five observed legal reaction choices.
    // Keep this directed seed instead of relying on incidental reaction draws in
    // the baseline panel.
    seedBase: 0x504f4c00,
    botPolicy: 'rollout',
    rollouts: 1,
    rolloutDepth: 1,
    maxCandidates: 6,
    candidateGen: 'full',
    playoutBackend: 'snapshot',
    rolloutPlayout: 'heuristic',
    collectDecisionLog: true,
    rolloutInteractions: true,
  });
  const transformRollout = runSim({
    ...baseConfig,
    gamesPerPairing: 1,
    turnCap: 3,
    heroLpOverride: { faction: 'Onyx', lp: 10 },
    botPolicy: 'rollout',
    rollouts: 1,
    rolloutDepth: 1,
    maxCandidates: 8,
    candidateGen: 'full',
    playoutBackend: 'snapshot',
    rolloutPlayout: 'heuristic',
    collectDecisionLog: true,
    rolloutInteractions: true,
  });
  const decisions = [
    ...decisionObservations(rollout, 'baseline'),
    ...decisionObservations(reactionRollout, 'reaction'),
    ...decisionObservations(transformRollout, 'transform'),
  ];
  const observedFamilies = [
    ...new Set(decisions.map(({ family }) => family)),
  ].sort();
  const sensitivityRows = rollout.observations.map((observed, index) => {
    const heuristicObserved = heuristic.observations[index];
    if (
      heuristicObserved === undefined ||
      heuristicObserved.seed !== observed.seed ||
      heuristicObserved.factionA !== observed.factionA ||
      heuristicObserved.factionB !== observed.factionB
    ) {
      throw new Error(`policy schedules diverged at observation ${String(index)}`);
    }
    return {
      clusterId: `${observed.factionA}-vs-${observed.factionB}-${String(
        observed.seed,
      )}`,
      heuristicOutcome: outcomeValue(heuristicObserved.outcome),
      rolloutOutcome: outcomeValue(observed.outcome),
    };
  });
  const bindings = {
    rulesArtifactStatus: rulesManifest.status,
    studyArtifactStatus: rollout.config.studyArtifactStatus,
    rulesManifestHash: canonicalHash(rulesManifest),
    engineBuildHash:
      rollout.replays[0]?.provenance.engine.buildHash ?? 'missing',
    harnessBuildHash:
      rollout.replays[0]?.provenance.engine.harnessBuildHash ?? 'missing',
    botImplementationHash:
      rollout.replays[0]?.provenance.bot.implementationHash ?? 'missing',
    candidateGeneration: rollout.config.candidateGen,
  };
  const gate = evaluatePolicyCalibrationGate(manifest, bindings, {
    decisionCount: decisions.length,
    families: observedFamilies,
  });
  return {
    schemaVersion: 1,
    calibrationId: manifest.calibrationId,
    artifactStatus: 'diagnostic',
    bindings: {
      ...bindings,
      policyCalibrationManifestHash: canonicalHash(manifest),
      heuristicRunHash: heuristic.runHash,
      rolloutRunHash: rollout.runHash,
      reactionPanelRunHash: reactionRollout.runHash,
      transformPanelRunHash: transformRollout.runHash,
    },
    corpus: {
      decisions: decisions.length,
      observedFamilies,
      missingFamilies: manifest.corpus.requiredFamilies.filter(
        (family) => !observedFamilies.includes(family),
      ),
      labelSource: manifest.corpus.labelSource,
    },
    decisionCalibration: summarizePolicyDecisions(decisions),
    policySensitivity: summarizePolicySensitivity(sensitivityRows),
    infrastructureFailures: {
      heuristic: heuristic.infrastructureFailureCount,
      rollout:
        rollout.infrastructureFailureCount +
        reactionRollout.infrastructureFailureCount +
        transformRollout.infrastructureFailureCount,
    },
    gate,
    claimLimitations: [
      'Rollout values are a second policy lens, not expert or human truth.',
      'Human-skill equivalence is prohibited without independently authored labels and human logs.',
      'Release eligibility requires ratified rules/study artifacts and every required tactical family.',
    ],
  };
}

export function verifyPolicyCalibration(report) {
  const errors = [];
  if (report.corpus.decisions < manifest.corpus.minimumDecisions) {
    errors.push(
      `insufficient decisions ${String(report.corpus.decisions)}/${String(
        manifest.corpus.minimumDecisions,
      )}`,
    );
  }
  if (report.corpus.missingFamilies.length > 0) {
    errors.push(
      `missing required policy families: ${report.corpus.missingFamilies.join(
        ', ',
      )}`,
    );
  }
  if (
    report.infrastructureFailures.heuristic !== 0 ||
    report.infrastructureFailures.rollout !== 0
  ) {
    errors.push('policy calibration encountered infrastructure failures');
  }
  if (
    !/^[a-f0-9]{64}$/u.test(report.bindings.rulesManifestHash) ||
    !/^[a-f0-9]{64}$/u.test(report.bindings.engineBuildHash) ||
    !/^[a-f0-9]{64}$/u.test(report.bindings.harnessBuildHash) ||
    !/^[a-f0-9]{64}$/u.test(report.bindings.botImplementationHash)
  ) {
    errors.push(
      'policy calibration lacks content-addressed engine/harness/bot bindings',
    );
  }
  if (
    report.bindings.rulesArtifactStatus !== 'ratified' &&
    report.gate.releaseEligible
  ) {
    errors.push('unratified rules unexpectedly passed the release gate');
  }
  return errors;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const report = runPolicyCalibration();
  const errors = verifyPolicyCalibration(report);
  console.log(JSON.stringify({ ...report, verificationErrors: errors }, null, 2));
  if (process.argv.includes('--verify') && errors.length > 0) {
    process.exitCode = 1;
  }
}
