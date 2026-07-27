export interface IndependentRuleOracle {
  readonly schemaVersion: 1;
  readonly oracleId: string;
  readonly status:
    | 'awaiting_independent_rules_review'
    | 'independently_approved';
  readonly rulebook: {
    readonly path: string;
    readonly revision: string;
    readonly sha256: string;
  };
  readonly authorship: {
    readonly fixtureSource:
      'manually_declared_json_not_generated_from_engine';
    readonly independentAuthor: string | null;
    readonly independentReviewer: string | null;
    readonly approvedAt: string | null;
  };
  readonly scenarios: readonly {
    readonly id: string;
    readonly family: string;
    readonly rulebookAnchor: string;
    readonly operation:
      | 'attack_targets'
      | 'effective_cost'
      | 'empty_draw'
      | 'one_card_draw_two'
      | 'effective_traits';
    readonly input: Readonly<Record<string, unknown>>;
    readonly expected: unknown;
  }[];
}

export interface ExpertPolicyCorpus {
  readonly schemaVersion: 1;
  readonly corpusId: string;
  readonly status:
    | 'awaiting_independent_expert_labels'
    | 'independently_approved';
  readonly rulesProfile: 'current';
  readonly authorship: {
    readonly expertName: string | null;
    readonly expertOrganization: string | null;
    readonly expertQualification: string | null;
    readonly labeledAt: string | null;
    readonly rulesManifestHash: string | null;
    readonly engineBuildHash: string | null;
  };
  readonly claimScope: {
    readonly supported:
      'action agreement and regret against this declared expert corpus';
    readonly humanRankEquivalence:
      'prohibited_without_separate_consented_human_decision_logs';
  };
  readonly humanDecisionLogs: {
    readonly status: 'not_collected' | 'independently_collected';
    readonly consentProtocol: string | null;
    readonly participantPopulation: string | null;
    readonly artifactHash: string | null;
  };
  readonly scenarios: readonly {
    readonly id: string;
    readonly family:
      | 'combat'
      | 'resource'
      | 'equipment'
      | 'reaction'
      | 'choice'
      | 'transform'
      | 'ability'
      | 'movement';
    readonly prompt: string;
    readonly stateArtifact: string | null;
    readonly legalActionKeys: readonly string[];
    readonly expertActionKey: string | null;
    readonly expertValue: number | null;
    readonly rationale: string | null;
  }[];
}

const ORACLE_OPERATIONS = new Set([
  'attack_targets',
  'effective_cost',
  'empty_draw',
  'one_card_draw_two',
  'effective_traits',
]);

const EXPERT_SCENARIOS = Object.freeze({
  'expert-lethal-001': 'combat',
  'expert-defense-001': 'combat',
  'expert-resource-001': 'resource',
  'expert-equipment-001': 'equipment',
  'expert-reaction-001': 'reaction',
  'expert-mode-001': 'choice',
  'expert-transform-001': 'transform',
  'expert-ability-001': 'ability',
  'expert-movement-001': 'movement',
});

export function validateIndependentRuleOracle(
  input: unknown,
): IndependentRuleOracle {
  const root = objectValue(input, 'independent rule oracle');
  if (
    root.schemaVersion !== 1 ||
    typeof root.oracleId !== 'string' ||
    root.oracleId.length === 0 ||
    ![
      'awaiting_independent_rules_review',
      'independently_approved',
    ].includes(String(root.status))
  ) {
    throw new TypeError('independent rule oracle identity/status is invalid');
  }
  const rulebook = objectValue(
    root.rulebook,
    'independent rule oracle rulebook',
  );
  if (
    typeof rulebook.path !== 'string' ||
    rulebook.path.length === 0 ||
    typeof rulebook.revision !== 'string' ||
    rulebook.revision.length === 0 ||
    typeof rulebook.sha256 !== 'string' ||
    !/^[a-f0-9]{64}$/u.test(rulebook.sha256)
  ) {
    throw new TypeError('independent rule oracle rulebook binding is invalid');
  }
  const authorship = objectValue(
    root.authorship,
    'independent rule oracle authorship',
  );
  if (
    authorship.fixtureSource !==
    'manually_declared_json_not_generated_from_engine'
  ) {
    throw new TypeError('independent rule oracle fixture source is invalid');
  }
  if (!Array.isArray(root.scenarios) || root.scenarios.length === 0) {
    throw new TypeError('independent rule oracle scenarios are missing');
  }
  const ids = new Set<string>();
  for (const value of root.scenarios) {
    const scenario = objectValue(value, 'independent rule oracle scenario');
    if (
      typeof scenario.id !== 'string' ||
      scenario.id.length === 0 ||
      ids.has(scenario.id) ||
      typeof scenario.family !== 'string' ||
      scenario.family.length === 0 ||
      typeof scenario.rulebookAnchor !== 'string' ||
      scenario.rulebookAnchor.length < 4 ||
      typeof scenario.operation !== 'string' ||
      !ORACLE_OPERATIONS.has(scenario.operation) ||
      !isPlainObject(scenario.input) ||
      !Object.hasOwn(scenario, 'expected')
    ) {
      throw new TypeError('independent rule oracle scenario is invalid');
    }
    ids.add(scenario.id);
  }
  if (root.status === 'independently_approved') {
    const author = authorship.independentAuthor;
    const reviewer = authorship.independentReviewer;
    if (
      typeof author !== 'string' ||
      author.length === 0 ||
      typeof reviewer !== 'string' ||
      reviewer.length === 0 ||
      author === reviewer ||
      typeof authorship.approvedAt !== 'string' ||
      !Number.isFinite(Date.parse(authorship.approvedAt))
    ) {
      throw new TypeError(
        'approved independent rule oracle lacks independent attributable authorship',
      );
    }
  }
  return input as IndependentRuleOracle;
}

export function validateExpertPolicyCorpus(
  input: unknown,
): ExpertPolicyCorpus {
  const root = objectValue(input, 'expert policy corpus');
  if (
    root.schemaVersion !== 1 ||
    typeof root.corpusId !== 'string' ||
    root.corpusId.length === 0 ||
    ![
      'awaiting_independent_expert_labels',
      'independently_approved',
    ].includes(String(root.status)) ||
    root.rulesProfile !== 'current'
  ) {
    throw new TypeError('expert policy corpus identity/status is invalid');
  }
  const authorship = objectValue(
    root.authorship,
    'expert policy corpus authorship',
  );
  const claimScope = objectValue(
    root.claimScope,
    'expert policy corpus claim scope',
  );
  if (
    claimScope.supported !==
      'action agreement and regret against this declared expert corpus' ||
    claimScope.humanRankEquivalence !==
      'prohibited_without_separate_consented_human_decision_logs'
  ) {
    throw new TypeError('expert policy corpus claim scope is invalid');
  }
  const humanLogs = objectValue(
    root.humanDecisionLogs,
    'expert policy corpus human decision logs',
  );
  if (
    !['not_collected', 'independently_collected'].includes(
      String(humanLogs.status),
    )
  ) {
    throw new TypeError('expert policy corpus human-log status is invalid');
  }
  if (
    !Array.isArray(root.scenarios) ||
    root.scenarios.length !== Object.keys(EXPERT_SCENARIOS).length
  ) {
    throw new TypeError('expert policy corpus scenario inventory is incomplete');
  }
  const ids = new Set<string>();
  for (const value of root.scenarios) {
    const scenario = objectValue(value, 'expert policy corpus scenario');
    if (
      typeof scenario.id !== 'string' ||
      ids.has(scenario.id) ||
      EXPERT_SCENARIOS[
        scenario.id as keyof typeof EXPERT_SCENARIOS
      ] !== scenario.family ||
      typeof scenario.prompt !== 'string' ||
      scenario.prompt.length < 12 ||
      !Array.isArray(scenario.legalActionKeys)
    ) {
      throw new TypeError('expert policy corpus scenario is invalid');
    }
    ids.add(scenario.id);
    if (root.status === 'independently_approved') {
      const actionKeys = scenario.legalActionKeys;
      if (
        typeof scenario.stateArtifact !== 'string' ||
        !scenario.stateArtifact.startsWith(
          'packages/engine/sim-data/expert-policy-scenarios/',
        ) ||
        actionKeys.length < 2 ||
        new Set(actionKeys).size !== actionKeys.length ||
        actionKeys.some(
          (key) => typeof key !== 'string' || !/^[a-f0-9]{64}$/u.test(key),
        ) ||
        typeof scenario.expertActionKey !== 'string' ||
        !actionKeys.includes(scenario.expertActionKey) ||
        typeof scenario.expertValue !== 'number' ||
        !Number.isFinite(scenario.expertValue) ||
        typeof scenario.rationale !== 'string' ||
        scenario.rationale.length < 20
      ) {
        throw new TypeError(
          `approved expert policy scenario ${scenario.id} is incomplete`,
        );
      }
    }
  }
  if (root.status === 'independently_approved') {
    if (
      typeof authorship.expertName !== 'string' ||
      authorship.expertName.length === 0 ||
      typeof authorship.expertOrganization !== 'string' ||
      authorship.expertOrganization.length === 0 ||
      typeof authorship.expertQualification !== 'string' ||
      authorship.expertQualification.length < 12 ||
      typeof authorship.labeledAt !== 'string' ||
      !Number.isFinite(Date.parse(authorship.labeledAt)) ||
      typeof authorship.rulesManifestHash !== 'string' ||
      !/^[a-f0-9]{64}$/u.test(authorship.rulesManifestHash) ||
      typeof authorship.engineBuildHash !== 'string' ||
      !/^[a-f0-9]{64}$/u.test(authorship.engineBuildHash)
    ) {
      throw new TypeError(
        'approved expert policy corpus lacks attributable bound authorship',
      );
    }
  }
  return input as ExpertPolicyCorpus;
}

function objectValue(
  value: unknown,
  path: string,
): Readonly<Record<string, unknown>> {
  if (!isPlainObject(value)) {
    throw new TypeError(`${path} must be an object`);
  }
  return value;
}

function isPlainObject(
  value: unknown,
): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
