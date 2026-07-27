export type StudyArtifactStatus = 'diagnostic' | 'candidate' | 'ratified';

export interface StudyManifest {
  readonly schemaVersion: 1;
  readonly studyId: string;
  readonly status: StudyArtifactStatus;
  readonly artifacts: {
    readonly rules: {
      readonly profile: 'current';
      readonly source: 'sim-data/ruleset-current.json';
      readonly hashAlgorithm: 'sha256_json_stringify';
      readonly binding: 'runtime_required';
    };
    readonly cardPool: {
      readonly source: 'sim-data/aetherion-cards.json';
      readonly hashAlgorithm: 'sha256_json_stringify';
      readonly binding: 'runtime_required';
    };
    readonly engineBuild: {
      readonly packageName: '@aetherion-sim/engine';
      readonly source: 'dist/**/*.js';
      readonly hashAlgorithm: 'sha256_sorted_relative_path_nul_bytes_nul';
      readonly binding: 'runtime_required';
    };
    readonly harnessBuild: {
      readonly source: 'sim-runner.mjs+deck-loader.mjs+deck-sampler.mjs+pilot-rollout.mjs+pilot-value.mjs';
      readonly hashAlgorithm: 'sha256_sorted_relative_path_nul_bytes_nul';
      readonly binding: 'runtime_required';
    };
    readonly botImplementation: {
      readonly source: 'dist/bot/**/*.js+pilot-rollout.mjs+pilot-value.mjs+sim-runner.mjs';
      readonly hashAlgorithm: 'sha256_sorted_relative_path_nul_bytes_nul';
      readonly binding: 'runtime_required';
    };
    readonly policyCalibration: {
      readonly source: 'sim-data/policy-calibration-manifest.json';
      readonly hashAlgorithm: 'sha256_canonical_json';
      readonly binding: 'runtime_required';
      readonly requiredRulesArtifactStatus: 'ratified';
    };
  };
  readonly policies: {
    readonly population: 'uniform_heuristic_v1';
    readonly policyBySeat: 'same_policy_both_seats';
    readonly action: 'chooseAction';
    readonly reaction: 'chooseReactiveAction';
    readonly choice: 'chooseChoiceResponse';
    readonly mulligan: 'shouldKeepHand';
    readonly stochasticTieBreaking: 'mulberry32-v1';
  };
  readonly termination: {
    readonly turnCap: 80;
    readonly turnCapOutcome: 'typed_turn_cap_draw';
    readonly tiebreak: 'disabled';
    readonly engineTerminalReasons: readonly [
      'normal_win',
      'concession',
      'deck_exhaustion',
    ];
  };
  readonly runtimeBindings: readonly [
    'rulesManifestHash',
    'studyManifestHash',
    'cardPoolHash',
    'engineBuildHash',
    'harnessBuildHash',
    'botImplementationHash',
    'deckContentHashes',
    'policyConfigHash',
    'policyCalibrationManifestHash',
  ];
  readonly population: {
    readonly factions: readonly string[];
    readonly claimScope: string;
    readonly deckSelection: 'predeclared_legal_decks';
    readonly minimumDistinctDecksPerFaction: number;
  };
  readonly deckPopulation: {
    readonly source: 'deterministic_seeded_sampler';
    readonly samplerVersion: 'faction_archetype_v1';
    readonly seed: 20260726;
    readonly decksPerFaction: 5;
    readonly archetypes: readonly [
      'Aggro',
      'Midrange',
      'Control',
      'Tempo',
      'Ramp',
    ];
    readonly sourceOrder: 'card_id_ascending';
    readonly pairing: 'all_unordered_deck_pairs';
  };
  readonly schedule: {
    readonly seedScheduleVersion: string;
    readonly gameSeedBase: 20260726;
    readonly gamesPerPairingMultiple: number;
    readonly counterbalanceBlockSize: number;
    readonly clusterUnit: 'matchup_x_schedule_block';
    readonly seatAlternation: true;
    readonly firstPlayerAssignment: 'alternating_by_replicate';
  };
  readonly endpoints: {
    readonly primary: string;
    readonly leaderModel: {
      readonly id: 'multicomponent_leader_v1';
      readonly snapshotTurn: 10;
      readonly tieTolerance: number;
      readonly weights: {
        readonly heroLp: number;
        readonly boardPower: number;
        readonly availableResources: number;
        readonly handSize: number;
        readonly deckRemaining: number;
        readonly transformed: number;
        readonly readyFrontline: number;
      };
    };
    readonly secondary: readonly {
      readonly id: string;
      readonly definition: string;
    }[];
  };
  readonly multiplicity: {
    readonly family: string;
    readonly method: 'schedule_preserving_permutation_maxT';
    readonly familywiseAlpha: number;
  };
  readonly practicalThresholds: {
    readonly factionSpreadFlagPctPoints: number;
    readonly factionSpreadFailPctPoints: number;
    readonly mirrorFirstPlayerFlagPctPoints: number;
    readonly minimumDecidedPct: number;
  };
  readonly decisionTable: readonly {
    readonly metric: string;
    readonly pass: string;
    readonly flag: string;
    readonly fail: string;
  }[];
  readonly power: {
    readonly target: number;
    readonly minimumDetectableFactionDifferencePctPoints: number;
    readonly nominalIndependentGamesPerFactionArm: number;
    readonly calibrationModel:
      'two_sided_bonferroni_six_contrasts_worst_case_p_0_5';
    readonly clusterInflationRequired: true;
    readonly calibrationRequired: true;
  };
  readonly validityGates: {
    readonly requiredRulesArtifactStatus: 'ratified';
    readonly maximumInfrastructureFailures: 0;
    readonly semanticCardValidation: 'required';
    readonly policyCalibration: 'required';
    readonly independentRuleOracle: 'required';
  };
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

function finiteNumber(
  value: unknown,
  path: string,
  minimum: number,
  maximum: number,
): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new RangeError(`${path} must be between ${String(minimum)} and ${String(maximum)}`);
  }
  return value;
}

/**
 * Fail-closed validation for the predeclared current-study contract. Returning
 * the typed input is safe because every required field and fixed semantic label
 * is checked below; unknown top-level sections are rejected.
 */
export function validateStudyManifest(input: unknown): StudyManifest {
  const root = record(input, 'study');
  const allowed = new Set([
    'schemaVersion',
    'studyId',
    'status',
    'artifacts',
    'policies',
    'termination',
    'runtimeBindings',
    'population',
    'deckPopulation',
    'schedule',
    'endpoints',
    'multiplicity',
    'practicalThresholds',
    'decisionTable',
    'power',
    'validityGates',
  ]);
  const unknown = Object.keys(root).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw new TypeError(`study has unknown field ${String(unknown[0])}`);
  }
  if (root.schemaVersion !== 1) throw new TypeError('study.schemaVersion must be 1');
  if (typeof root.studyId !== 'string' || root.studyId.length === 0) {
    throw new TypeError('study.studyId is required');
  }
  if (!['diagnostic', 'candidate', 'ratified'].includes(String(root.status))) {
    throw new TypeError('study.status is invalid');
  }

  const artifacts = record(root.artifacts, 'study.artifacts');
  const rulesArtifact = record(artifacts.rules, 'study.artifacts.rules');
  const cardPoolArtifact = record(
    artifacts.cardPool,
    'study.artifacts.cardPool',
  );
  const engineBuildArtifact = record(
    artifacts.engineBuild,
    'study.artifacts.engineBuild',
  );
  const harnessBuildArtifact = record(
    artifacts.harnessBuild,
    'study.artifacts.harnessBuild',
  );
  const botImplementationArtifact = record(
    artifacts.botImplementation,
    'study.artifacts.botImplementation',
  );
  const policyCalibrationArtifact = record(
    artifacts.policyCalibration,
    'study.artifacts.policyCalibration',
  );
  if (
    rulesArtifact.profile !== 'current' ||
    rulesArtifact.source !== 'sim-data/ruleset-current.json' ||
    rulesArtifact.hashAlgorithm !== 'sha256_json_stringify' ||
    rulesArtifact.binding !== 'runtime_required' ||
    cardPoolArtifact.source !== 'sim-data/aetherion-cards.json' ||
    cardPoolArtifact.hashAlgorithm !== 'sha256_json_stringify' ||
    cardPoolArtifact.binding !== 'runtime_required' ||
    engineBuildArtifact.packageName !== '@aetherion-sim/engine' ||
    engineBuildArtifact.source !== 'dist/**/*.js' ||
    engineBuildArtifact.hashAlgorithm !==
      'sha256_sorted_relative_path_nul_bytes_nul' ||
    engineBuildArtifact.binding !== 'runtime_required' ||
    harnessBuildArtifact.source !==
      'sim-runner.mjs+deck-loader.mjs+deck-sampler.mjs+pilot-rollout.mjs+pilot-value.mjs' ||
    harnessBuildArtifact.hashAlgorithm !==
      'sha256_sorted_relative_path_nul_bytes_nul' ||
    harnessBuildArtifact.binding !== 'runtime_required' ||
    botImplementationArtifact.source !==
      'dist/bot/**/*.js+pilot-rollout.mjs+pilot-value.mjs+sim-runner.mjs' ||
    botImplementationArtifact.hashAlgorithm !==
      'sha256_sorted_relative_path_nul_bytes_nul' ||
    botImplementationArtifact.binding !== 'runtime_required' ||
    policyCalibrationArtifact.source !==
      'sim-data/policy-calibration-manifest.json' ||
    policyCalibrationArtifact.hashAlgorithm !== 'sha256_canonical_json' ||
    policyCalibrationArtifact.binding !== 'runtime_required' ||
    policyCalibrationArtifact.requiredRulesArtifactStatus !== 'ratified'
  ) {
    throw new TypeError('study.artifacts must retain every executable binding');
  }

  const policies = record(root.policies, 'study.policies');
  if (
    policies.population !== 'uniform_heuristic_v1' ||
    policies.policyBySeat !== 'same_policy_both_seats' ||
    policies.action !== 'chooseAction' ||
    policies.reaction !== 'chooseReactiveAction' ||
    policies.choice !== 'chooseChoiceResponse' ||
    policies.mulligan !== 'shouldKeepHand' ||
    policies.stochasticTieBreaking !== 'mulberry32-v1'
  ) {
    throw new TypeError('study.policies must retain the complete bot lifecycle');
  }

  const termination = record(root.termination, 'study.termination');
  if (
    termination.turnCap !== 80 ||
    termination.turnCapOutcome !== 'typed_turn_cap_draw' ||
    termination.tiebreak !== 'disabled' ||
    !Array.isArray(termination.engineTerminalReasons) ||
    termination.engineTerminalReasons.join('|') !==
      'normal_win|concession|deck_exhaustion'
  ) {
    throw new TypeError('study.termination must retain the typed endpoint contract');
  }

  if (
    !Array.isArray(root.runtimeBindings) ||
    root.runtimeBindings.join('|') !==
      'rulesManifestHash|studyManifestHash|cardPoolHash|engineBuildHash|harnessBuildHash|botImplementationHash|deckContentHashes|policyConfigHash|policyCalibrationManifestHash'
  ) {
    throw new TypeError('study.runtimeBindings must retain every required hash');
  }

  const population = record(root.population, 'study.population');
  const factions = population.factions;
  if (
    !Array.isArray(factions) ||
    factions.length < 2 ||
    factions.some((faction) => typeof faction !== 'string') ||
    new Set(factions).size !== factions.length
  ) {
    throw new TypeError('study.population.factions must be unique strings');
  }
  if (population.deckSelection !== 'predeclared_legal_decks') {
    throw new TypeError('study.population.deckSelection must be predeclared_legal_decks');
  }
  finiteNumber(
    population.minimumDistinctDecksPerFaction,
    'study.population.minimumDistinctDecksPerFaction',
    1,
    100,
  );
  if (typeof population.claimScope !== 'string' || population.claimScope.length === 0) {
    throw new TypeError('study.population.claimScope is required');
  }
  if (
    population.claimScope !== 'committed_four_faction_card_pool' ||
    factions.join('|') !== 'Onyx|Radiant|Sapphire|Verdant'
  ) {
    throw new TypeError('study.population must retain the scoped four-faction claim');
  }
  const deckPopulation = record(
    root.deckPopulation,
    'study.deckPopulation',
  );
  if (
    deckPopulation.source !== 'deterministic_seeded_sampler' ||
    deckPopulation.samplerVersion !== 'faction_archetype_v1' ||
    deckPopulation.seed !== 20260726 ||
    deckPopulation.decksPerFaction !== 5 ||
    deckPopulation.sourceOrder !== 'card_id_ascending' ||
    deckPopulation.pairing !== 'all_unordered_deck_pairs' ||
    !Array.isArray(deckPopulation.archetypes) ||
    deckPopulation.archetypes.join('|') !==
      'Aggro|Midrange|Control|Tempo|Ramp'
  ) {
    throw new TypeError('study.deckPopulation must retain the executable deck design');
  }

  const schedule = record(root.schedule, 'study.schedule');
  if (
    schedule.seedScheduleVersion !== 'semantic-key-v1' ||
    schedule.gameSeedBase !== 20260726 ||
    schedule.gamesPerPairingMultiple !== 4 ||
    schedule.counterbalanceBlockSize !== 4 ||
    schedule.clusterUnit !== 'matchup_x_schedule_block' ||
    schedule.seatAlternation !== true ||
    schedule.firstPlayerAssignment !== 'alternating_by_replicate'
  ) {
    throw new TypeError('study.schedule does not match the counterbalanced current design');
  }

  const endpoints = record(root.endpoints, 'study.endpoints');
  if (
    typeof endpoints.primary !== 'string' ||
    !Array.isArray(endpoints.secondary) ||
    endpoints.secondary.length === 0
  ) {
    throw new TypeError('study.endpoints must predeclare primary and secondary endpoints');
  }
  const leaderModel = record(endpoints.leaderModel, 'study.endpoints.leaderModel');
  const weights = record(
    leaderModel.weights,
    'study.endpoints.leaderModel.weights',
  );
  const expectedWeights = {
    heroLp: 1,
    boardPower: 0.5,
    availableResources: 0.75,
    handSize: 0.5,
    deckRemaining: 0.1,
    transformed: 2,
    readyFrontline: 1,
  };
  if (
    leaderModel.id !== 'multicomponent_leader_v1' ||
    leaderModel.snapshotTurn !== 10 ||
    leaderModel.tieTolerance !== 1e-12 ||
    Object.keys(expectedWeights).some(
      (key) => weights[key] !== expectedWeights[key as keyof typeof expectedWeights],
    )
  ) {
    throw new TypeError('study.endpoints.leaderModel must match the executable model');
  }
  for (const [index, endpoint] of endpoints.secondary.entries()) {
    const item = record(endpoint, `study.endpoints.secondary[${String(index)}]`);
    if (typeof item.id !== 'string' || typeof item.definition !== 'string') {
      throw new TypeError('every secondary endpoint requires id and definition');
    }
  }

  const multiplicity = record(root.multiplicity, 'study.multiplicity');
  if (
    typeof multiplicity.family !== 'string' ||
    multiplicity.method !== 'schedule_preserving_permutation_maxT'
  ) {
    throw new TypeError('study.multiplicity must predeclare the maxT comparison family');
  }
  finiteNumber(multiplicity.familywiseAlpha, 'study.multiplicity.familywiseAlpha', 0, 1);

  const thresholds = record(root.practicalThresholds, 'study.practicalThresholds');
  const flag = finiteNumber(
    thresholds.factionSpreadFlagPctPoints,
    'study.practicalThresholds.factionSpreadFlagPctPoints',
    0,
    100,
  );
  const fail = finiteNumber(
    thresholds.factionSpreadFailPctPoints,
    'study.practicalThresholds.factionSpreadFailPctPoints',
    0,
    100,
  );
  if (fail <= flag) throw new RangeError('faction spread fail threshold must exceed flag');
  finiteNumber(
    thresholds.mirrorFirstPlayerFlagPctPoints,
    'study.practicalThresholds.mirrorFirstPlayerFlagPctPoints',
    0,
    50,
  );
  finiteNumber(
    thresholds.minimumDecidedPct,
    'study.practicalThresholds.minimumDecidedPct',
    0,
    100,
  );

  if (!Array.isArray(root.decisionTable) || root.decisionTable.length !== 3) {
    throw new TypeError('study.decisionTable must define all three decisions');
  }
  const decisionMetrics = new Set<string>();
  for (const [index, rawDecision] of root.decisionTable.entries()) {
    const decision = record(
      rawDecision,
      `study.decisionTable[${String(index)}]`,
    );
    if (
      typeof decision.metric !== 'string' ||
      typeof decision.pass !== 'string' ||
      typeof decision.flag !== 'string' ||
      typeof decision.fail !== 'string'
    ) {
      throw new TypeError('every study decision requires metric/pass/flag/fail');
    }
    decisionMetrics.add(decision.metric);
  }
  if (
    ![
      'faction_spread_pct_points',
      'mirror_first_player_pct_points',
      'decided_pct',
    ].every((metric) => decisionMetrics.has(metric))
  ) {
    throw new TypeError('study.decisionTable is missing a required metric');
  }

  const power = record(root.power, 'study.power');
  finiteNumber(power.target, 'study.power.target', 0, 1);
  finiteNumber(
    power.minimumDetectableFactionDifferencePctPoints,
    'study.power.minimumDetectableFactionDifferencePctPoints',
    0,
    100,
  );
  if (power.calibrationRequired !== true) {
    throw new TypeError('study.power.calibrationRequired must be true');
  }
  if (
    power.nominalIndependentGamesPerFactionArm !== 946 ||
    power.calibrationModel !==
      'two_sided_bonferroni_six_contrasts_worst_case_p_0_5' ||
    power.clusterInflationRequired !== true
  ) {
    throw new TypeError('study.power must retain its predeclared design calculation');
  }

  const gates = record(root.validityGates, 'study.validityGates');
  if (
    gates.requiredRulesArtifactStatus !== 'ratified' ||
    gates.maximumInfrastructureFailures !== 0 ||
    gates.semanticCardValidation !== 'required' ||
    gates.policyCalibration !== 'required' ||
    gates.independentRuleOracle !== 'required'
  ) {
    throw new TypeError('study.validityGates must retain every release gate');
  }
  return input as StudyManifest;
}
