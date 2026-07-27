export type ExternalReviewRole =
  | 'rulesOwner'
  | 'verificationOwner'
  | 'releaseOwner'
  | 'quantitativeOwner'
  | 'independentRulesReviewer'
  | 'independentPolicyExpert';

export interface ExternalApproval {
  readonly reviewer: string;
  readonly organization: string;
  readonly approvedAt: string;
  readonly candidateCommit: string;
  readonly evidenceHash: string;
  readonly attestation: string;
}

export interface ExternalReviewManifest {
  readonly schemaVersion: 1;
  readonly candidateId: string;
  readonly status: 'awaiting_external_review' | 'approved';
  readonly findings: readonly ['REPRO-07', 'BOT-10', 'EXP-03', 'TEST-07'];
  readonly requiredChecks: {
    readonly cleanTrackedCheckout: true;
    readonly fullGateEvidence: true;
    readonly ratifiedRulesManifest: true;
    readonly ratifiedStudyManifest: true;
    readonly independentlyReviewedRuleOracle: true;
    readonly independentlyLabeledExpertCorpus: true;
  };
  readonly requiredApprovals: Readonly<Record<ExternalReviewRole, ExternalApproval | null>>;
  readonly attestationText: string;
  readonly evidenceSources: Readonly<Record<string, string>>;
}

/**
 * The tracked manifest is the immutable review contract for a candidate. A
 * completed copy is deliberately supplied out-of-tree: committing approvals
 * into the candidate would change the commit and evidence hash they attest to.
 */
export function validateExternalReviewCompletion(
  input: unknown,
  requirements: ExternalReviewManifest,
): ExternalReviewManifest {
  const completion = validateExternalReviewManifest(input);
  if (completion.status !== 'approved') {
    throw new TypeError('external review completion must be approved');
  }
  if (canonicalJson(reviewScope(completion)) !== canonicalJson(reviewScope(requirements))) {
    throw new TypeError(
      'external review completion does not match the tracked review requirements',
    );
  }
  for (const role of REVIEW_ROLES) {
    const approval = completion.requiredApprovals[role];
    if (approval === null || !isApprovalRecord(approval)) {
      throw new TypeError(`external review completion approval ${role} is missing or malformed`);
    }
  }
  return completion;
}

export interface RatificationEvidenceState {
  readonly cleanCheckout: boolean;
  readonly allSemanticInputsTracked: boolean;
  readonly findingLedgerClosed: boolean;
  readonly criticalSummariesClosed: boolean;
  readonly unresolvedRulesDecisions: number;
  readonly candidateCommit: string;
  readonly fullGateEvidenceHash: string | null;
  readonly rulesArtifactStatus: string;
  readonly studyArtifactStatus: string;
  readonly ruleOracleStatus: string;
  readonly independentRuleAuthor: string | null;
  readonly independentRuleReviewer: string | null;
  readonly expertCorpusStatus: string;
  readonly independentPolicyExpert: string | null;
}

const REVIEW_ROLES: readonly ExternalReviewRole[] = [
  'rulesOwner',
  'verificationOwner',
  'releaseOwner',
  'quantitativeOwner',
  'independentRulesReviewer',
  'independentPolicyExpert',
];

const EVIDENCE_SOURCE_IDS = [
  'rulesManifest',
  'studyManifest',
  'policyCalibrationManifest',
  'cardPool',
  'deckPool',
  'semanticExceptions',
  'coverageExceptions',
  'performanceBudgets',
  'simulationEntrypoints',
  'legacyPinReanchors',
  'balanceBudget',
  'rulesDecisionRegister',
  'verificationReport',
  'ruleOracle',
  'expertCorpus',
  'findingLedger',
  'enginePackage',
  'workspaceLock',
] as const;

export function validateExternalReviewManifest(input: unknown): ExternalReviewManifest {
  const root = objectValue(input, 'external review manifest');
  if (
    root.schemaVersion !== 1 ||
    typeof root.candidateId !== 'string' ||
    !['awaiting_external_review', 'approved'].includes(String(root.status))
  ) {
    throw new TypeError('external review identity/status is invalid');
  }
  if (
    !Array.isArray(root.findings) ||
    root.findings.join('|') !== 'REPRO-07|BOT-10|EXP-03|TEST-07'
  ) {
    throw new TypeError('external review finding scope is invalid');
  }
  const checks = objectValue(root.requiredChecks, 'external review checks');
  for (const check of [
    'cleanTrackedCheckout',
    'fullGateEvidence',
    'ratifiedRulesManifest',
    'ratifiedStudyManifest',
    'independentlyReviewedRuleOracle',
    'independentlyLabeledExpertCorpus',
  ]) {
    if (checks[check] !== true) {
      throw new TypeError(`external review check ${check} must be required`);
    }
  }
  const approvals = objectValue(root.requiredApprovals, 'external review approvals');
  if (Object.keys(approvals).sort().join('|') !== [...REVIEW_ROLES].sort().join('|')) {
    throw new TypeError('external review roles are incomplete');
  }
  if (typeof root.attestationText !== 'string' || root.attestationText.length < 40) {
    throw new TypeError('external review attestation text is required');
  }
  const evidenceSources = objectValue(root.evidenceSources, 'external review evidence sources');
  if (
    Object.keys(evidenceSources).sort().join('|') !== [...EVIDENCE_SOURCE_IDS].sort().join('|') ||
    EVIDENCE_SOURCE_IDS.some(
      (id) => typeof evidenceSources[id] !== 'string' || evidenceSources[id].length === 0,
    )
  ) {
    throw new TypeError('external review evidence sources must retain every decisive input');
  }
  return input as ExternalReviewManifest;
}

export function evaluateRatification(
  manifest: ExternalReviewManifest,
  evidence: RatificationEvidenceState,
): {
  readonly releaseEligible: boolean;
  readonly reasons: readonly string[];
} {
  const approvals = REVIEW_ROLES.flatMap((role) => {
    const approval = manifest.requiredApprovals[role];
    if (approval === null) return [`approval_missing:${role}`];
    const reasons = [];
    if (
      approval.reviewer.length === 0 ||
      approval.organization.length === 0 ||
      !Number.isFinite(Date.parse(approval.approvedAt))
    ) {
      reasons.push(`approval_identity_invalid:${role}`);
    }
    if (
      approval.candidateCommit !== evidence.candidateCommit ||
      !/^[a-f0-9]{40}$/u.test(approval.candidateCommit)
    ) {
      reasons.push(`approval_commit_mismatch:${role}`);
    }
    if (!/^[a-f0-9]{64}$/u.test(approval.evidenceHash)) {
      reasons.push(`approval_evidence_hash_invalid:${role}`);
    } else if (approval.evidenceHash !== evidence.fullGateEvidenceHash) {
      reasons.push(`approval_evidence_hash_mismatch:${role}`);
    }
    if (approval.attestation !== manifest.attestationText) {
      reasons.push(`approval_attestation_mismatch:${role}`);
    }
    return reasons;
  });
  const reviewerNames = REVIEW_ROLES.flatMap((role) => {
    const approval = manifest.requiredApprovals[role];
    return approval === null ? [] : [approval.reviewer];
  });
  const reasons = [
    ...(manifest.status !== 'approved' ? [`external_review_status:${manifest.status}`] : []),
    ...(!evidence.cleanCheckout ? ['checkout_dirty'] : []),
    ...(!evidence.allSemanticInputsTracked ? ['semantic_inputs_untracked'] : []),
    ...(!evidence.findingLedgerClosed ? ['finding_ledger_open'] : []),
    ...(!evidence.criticalSummariesClosed ? ['critical_summaries_open'] : []),
    ...(evidence.unresolvedRulesDecisions !== 0
      ? [`unresolved_rules_decisions:${String(evidence.unresolvedRulesDecisions)}`]
      : []),
    ...(!/^[a-f0-9]{40}$/u.test(evidence.candidateCommit) ? ['candidate_commit_invalid'] : []),
    ...(evidence.fullGateEvidenceHash === null ||
    !/^[a-f0-9]{64}$/u.test(evidence.fullGateEvidenceHash)
      ? ['full_gate_evidence_missing']
      : []),
    ...(evidence.rulesArtifactStatus !== 'ratified'
      ? [`rules_artifact_status:${evidence.rulesArtifactStatus}`]
      : []),
    ...(evidence.studyArtifactStatus !== 'ratified'
      ? [`study_artifact_status:${evidence.studyArtifactStatus}`]
      : []),
    ...(evidence.ruleOracleStatus !== 'independently_approved'
      ? [`rule_oracle_status:${evidence.ruleOracleStatus}`]
      : []),
    ...(evidence.independentRuleAuthor === null ? ['independent_rule_author_missing'] : []),
    ...(evidence.independentRuleReviewer === null ? ['independent_rule_reviewer_missing'] : []),
    ...(evidence.independentRuleAuthor !== null &&
    evidence.independentRuleAuthor === evidence.independentRuleReviewer
      ? ['rule_oracle_author_reviewer_not_independent']
      : []),
    ...(evidence.expertCorpusStatus !== 'independently_approved'
      ? [`expert_corpus_status:${evidence.expertCorpusStatus}`]
      : []),
    ...(evidence.independentPolicyExpert === null ? ['independent_policy_expert_missing'] : []),
    ...(new Set(reviewerNames).size !== reviewerNames.length
      ? ['approval_reviewers_not_independent']
      : []),
    ...approvals,
  ];
  return { releaseEligible: reasons.length === 0, reasons };
}

function objectValue(value: unknown, path: string): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function reviewScope(manifest: ExternalReviewManifest): unknown {
  return {
    schemaVersion: manifest.schemaVersion,
    candidateId: manifest.candidateId,
    findings: manifest.findings,
    requiredChecks: manifest.requiredChecks,
    attestationText: manifest.attestationText,
    evidenceSources: manifest.evidenceSources,
  };
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  }
  if (typeof value === 'object' && value !== null) {
    const record = value as Readonly<Record<string, unknown>>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(',')}}`;
  }
  // JSON.stringify's lib type claims `string`, but it returns undefined for
  // undefined/function/symbol inputs — widen so the fallback is visibly needed.
  const json = JSON.stringify(value) as string | undefined;
  return json ?? 'null';
}

function isApprovalRecord(value: unknown): value is ExternalApproval {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const approval = value as Readonly<Record<string, unknown>>;
  return (
    typeof approval.reviewer === 'string' &&
    typeof approval.organization === 'string' &&
    typeof approval.approvedAt === 'string' &&
    typeof approval.candidateCommit === 'string' &&
    typeof approval.evidenceHash === 'string' &&
    typeof approval.attestation === 'string'
  );
}
