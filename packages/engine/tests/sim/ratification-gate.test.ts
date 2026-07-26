import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  evaluateRatification,
  validateExternalReviewManifest,
  type ExternalApproval,
  type ExternalReviewRole,
} from '../../src/sim/ratification.js';
import {
  currentRatificationStatus,
  REQUIRED_GATE_COMMANDS,
  validateFullGateEvidence,
} from '../../ratification-status.mjs';

const manifest = validateExternalReviewManifest(
  JSON.parse(
    readFileSync(new URL('../../sim-data/external-review-manifest.json', import.meta.url), 'utf8'),
  ),
);
const roles: ExternalReviewRole[] = [
  'rulesOwner',
  'verificationOwner',
  'releaseOwner',
  'quantitativeOwner',
  'independentRulesReviewer',
  'independentPolicyExpert',
];

describe('external ratification gate', () => {
  it('reports every real current blocker and never fabricates approval', () => {
    // The dirty-checkout blocker depends on where the test runs (a CI checkout
    // is clean; a dev checkout usually is not), so assert the gate MIRRORS the
    // real git state in both directions instead of pinning one environment.
    const actuallyDirty =
      execFileSync('git', ['status', '--porcelain'], {
        cwd: fileURLToPath(new URL('.', import.meta.url)),
        encoding: 'utf8',
      }).trim().length > 0;
    const report = currentRatificationStatus();
    expect(report.gate.releaseEligible).toBe(false);
    expect(report.evidence.cleanCheckout).toBe(!actuallyDirty);
    if (actuallyDirty) {
      expect(report.gate.reasons).toContain('checkout_dirty');
    } else {
      expect(report.gate.reasons).not.toContain('checkout_dirty');
    }
    expect(report.gate.reasons).toContain('finding_ledger_open');
    expect(report.gate.reasons).toContain('critical_summaries_open');
    expect(report.evidence.unresolvedRulesDecisions).toBe(0);
    expect(
      report.gate.reasons.some((reason) => reason.startsWith('unresolved_rules_decisions:')),
    ).toBe(false);
    expect(report.gate.reasons).toContain('rules_artifact_status:diagnostic');
    expect(report.gate.reasons).toContain('rule_oracle_status:awaiting_independent_rules_review');
    expect(report.gate.reasons).toContain(
      'expert_corpus_status:awaiting_independent_expert_labels',
    );
    for (const role of roles) {
      expect(report.gate.reasons).toContain(`approval_missing:${role}`);
    }
  });

  it('requires attributable, independent approvals bound to one commit and evidence hash', () => {
    const candidateCommit = 'a'.repeat(40);
    const approvals = Object.fromEntries(
      roles.map((role, index) => [
        role,
        {
          reviewer: `reviewer-${String(index)}`,
          organization: `organization-${String(index)}`,
          approvedAt: '2026-07-26T00:00:00.000Z',
          candidateCommit,
          evidenceHash: 'c'.repeat(64),
          attestation: manifest.attestationText,
        } satisfies ExternalApproval,
      ]),
    ) as Record<ExternalReviewRole, ExternalApproval>;
    const approvedManifest = {
      ...manifest,
      status: 'approved' as const,
      requiredApprovals: approvals,
    };
    const result = evaluateRatification(approvedManifest, {
      cleanCheckout: true,
      allSemanticInputsTracked: true,
      findingLedgerClosed: true,
      criticalSummariesClosed: true,
      unresolvedRulesDecisions: 0,
      candidateCommit,
      fullGateEvidenceHash: 'c'.repeat(64),
      rulesArtifactStatus: 'ratified',
      studyArtifactStatus: 'ratified',
      ruleOracleStatus: 'independently_approved',
      independentRuleAuthor: 'oracle-author',
      independentRuleReviewer: 'oracle-reviewer',
      expertCorpusStatus: 'independently_approved',
      independentPolicyExpert: 'policy-expert',
    });
    expect(result).toEqual({ releaseEligible: true, reasons: [] });
  });

  it('accepts only complete G0-G11 command evidence bound to the exact candidate content', () => {
    const current = currentRatificationStatus();
    const commandIds = Object.keys(REQUIRED_GATE_COMMANDS);
    const fullGateEvidence = {
      schemaVersion: 1,
      status: 'passed',
      candidateId: current.candidateId,
      candidateCommit: current.candidateCommit,
      generatedAt: '2026-07-27T00:00:00.000Z',
      contentHashes: current.contentHashes,
      gates: Object.fromEntries(
        Array.from({ length: 12 }, (_, index) => [`G${String(index)}`, 'passed']),
      ),
      commands: commandIds.map((id) => ({
        id,
        command: REQUIRED_GATE_COMMANDS[id as keyof typeof REQUIRED_GATE_COMMANDS],
        exitCode: 0,
        outputHash: 'a'.repeat(64),
      })),
    };
    expect(
      validateFullGateEvidence(fullGateEvidence, {
        candidateId: current.candidateId,
        candidateCommit: current.candidateCommit,
        contentHashes: current.contentHashes,
      }),
    ).toMatch(/^[a-f0-9]{64}$/);

    expect(() =>
      validateFullGateEvidence(
        {
          ...fullGateEvidence,
          gates: { ...fullGateEvidence.gates, G7: 'failed' },
        },
        {
          candidateId: current.candidateId,
          candidateCommit: current.candidateCommit,
          contentHashes: current.contentHashes,
        },
      ),
    ).toThrow(/G0 through G11/);
    expect(() =>
      validateFullGateEvidence(
        {
          ...fullGateEvidence,
          commands: fullGateEvidence.commands.slice(1),
        },
        {
          candidateId: current.candidateId,
          candidateCommit: current.candidateCommit,
          contentHashes: current.contentHashes,
        },
      ),
    ).toThrow(/inventory is incomplete/);
    expect(() =>
      validateFullGateEvidence(
        {
          ...fullGateEvidence,
          commands: fullGateEvidence.commands.map((command) =>
            command.id === 'root_build' ? { ...command, command: 'echo passed' } : command,
          ),
        },
        {
          candidateId: current.candidateId,
          candidateCommit: current.candidateCommit,
          contentHashes: current.contentHashes,
        },
      ),
    ).toThrow(/required passing command/);
  });

  it('rejects weakened checklists and non-independent reviewers', () => {
    const weakened = structuredClone(manifest) as Record<string, any>;
    weakened.requiredChecks.fullGateEvidence = false;
    expect(() => validateExternalReviewManifest(weakened)).toThrow(/must be required/);

    const duplicate = {
      ...manifest,
      requiredApprovals: Object.fromEntries(
        roles.map((role) => [
          role,
          {
            reviewer: 'same-person',
            organization: 'same-organization',
            approvedAt: '2026-07-26T00:00:00.000Z',
            candidateCommit: 'a'.repeat(40),
            evidenceHash: 'b'.repeat(64),
            attestation: manifest.attestationText,
          },
        ]),
      ) as Record<ExternalReviewRole, ExternalApproval>,
    };
    expect(
      evaluateRatification(duplicate, {
        cleanCheckout: true,
        allSemanticInputsTracked: true,
        findingLedgerClosed: true,
        criticalSummariesClosed: true,
        unresolvedRulesDecisions: 0,
        candidateCommit: 'a'.repeat(40),
        fullGateEvidenceHash: 'c'.repeat(64),
        rulesArtifactStatus: 'ratified',
        studyArtifactStatus: 'ratified',
        ruleOracleStatus: 'independently_approved',
        independentRuleAuthor: 'oracle-author',
        independentRuleReviewer: 'oracle-reviewer',
        expertCorpusStatus: 'independently_approved',
        independentPolicyExpert: 'policy-expert',
      }).reasons,
    ).toContain('approval_reviewers_not_independent');
  });

  it('validates every external-review manifest boundary', () => {
    expect(() => validateExternalReviewManifest(null)).toThrow(/must be an object/);
    for (const patch of [{ schemaVersion: 2 }, { candidateId: 42 }, { status: 'self_approved' }]) {
      expect(() => validateExternalReviewManifest({ ...manifest, ...patch })).toThrow(
        /identity\/status/,
      );
    }
    expect(() => validateExternalReviewManifest({ ...manifest, findings: 'all' })).toThrow(
      /finding scope/,
    );
    expect(() =>
      validateExternalReviewManifest({
        ...manifest,
        findings: ['REPRO-07'],
      }),
    ).toThrow(/finding scope/);
    expect(() =>
      validateExternalReviewManifest({
        ...manifest,
        requiredChecks: null,
      }),
    ).toThrow(/checks must be an object/);
    expect(() =>
      validateExternalReviewManifest({
        ...manifest,
        requiredApprovals: { rulesOwner: null },
      }),
    ).toThrow(/roles are incomplete/);
    expect(() =>
      validateExternalReviewManifest({
        ...manifest,
        attestationText: 42,
      }),
    ).toThrow(/attestation text/);
    expect(() =>
      validateExternalReviewManifest({
        ...manifest,
        attestationText: 'short',
      }),
    ).toThrow(/attestation text/);
    expect(() =>
      validateExternalReviewManifest({
        ...manifest,
        evidenceSources: [],
      }),
    ).toThrow(/evidence sources must be an object/);
    const unboundCardPool = structuredClone(manifest) as Record<string, any>;
    delete unboundCardPool.evidenceSources.cardPool;
    expect(() => validateExternalReviewManifest(unboundCardPool)).toThrow(/every decisive input/);
  });

  it('rejects malformed approval identity, binding, evidence, and attestation', () => {
    const candidateCommit = 'a'.repeat(40);
    const baseApproval: ExternalApproval = {
      reviewer: 'reviewer',
      organization: 'organization',
      approvedAt: '2026-07-26T00:00:00.000Z',
      candidateCommit,
      evidenceHash: 'b'.repeat(64),
      attestation: manifest.attestationText,
    };
    const evidence = {
      cleanCheckout: true,
      allSemanticInputsTracked: true,
      findingLedgerClosed: true,
      criticalSummariesClosed: true,
      unresolvedRulesDecisions: 0,
      candidateCommit,
      fullGateEvidenceHash: 'c'.repeat(64),
      rulesArtifactStatus: 'ratified',
      studyArtifactStatus: 'ratified',
      ruleOracleStatus: 'independently_approved',
      independentRuleAuthor: 'same-oracle-person',
      independentRuleReviewer: 'same-oracle-person',
      expertCorpusStatus: 'independently_approved',
      independentPolicyExpert: 'expert',
    };
    const cases: {
      patch: Partial<ExternalApproval>;
      reason: string;
    }[] = [
      { patch: { reviewer: '' }, reason: 'approval_identity_invalid:rulesOwner' },
      {
        patch: { organization: '' },
        reason: 'approval_identity_invalid:rulesOwner',
      },
      {
        patch: { approvedAt: 'not-a-date' },
        reason: 'approval_identity_invalid:rulesOwner',
      },
      {
        patch: { candidateCommit: 'd'.repeat(40) },
        reason: 'approval_commit_mismatch:rulesOwner',
      },
      {
        patch: { candidateCommit: 'invalid' },
        reason: 'approval_commit_mismatch:rulesOwner',
      },
      {
        patch: { evidenceHash: 'invalid' },
        reason: 'approval_evidence_hash_invalid:rulesOwner',
      },
      {
        patch: { attestation: 'different' },
        reason: 'approval_attestation_mismatch:rulesOwner',
      },
    ];
    for (const { patch, reason } of cases) {
      const approvals = Object.fromEntries(
        roles.map((role, index) => [
          role,
          {
            ...baseApproval,
            reviewer: `reviewer-${String(index)}`,
            ...(role === 'rulesOwner' ? patch : {}),
          },
        ]),
      ) as Record<ExternalReviewRole, ExternalApproval>;
      expect(
        evaluateRatification({ ...manifest, requiredApprovals: approvals }, evidence).reasons,
      ).toContain(reason);
    }
    const invalidEvidence = evaluateRatification(
      {
        ...manifest,
        requiredApprovals: Object.fromEntries(
          roles.map((role, index) => [
            role,
            {
              ...baseApproval,
              reviewer: `reviewer-${String(index)}`,
              candidateCommit: 'invalid',
            },
          ]),
        ) as Record<ExternalReviewRole, ExternalApproval>,
      },
      {
        ...evidence,
        candidateCommit: 'invalid',
        fullGateEvidenceHash: 'invalid',
      },
    );
    expect(invalidEvidence.reasons).toContain('candidate_commit_invalid');
    expect(invalidEvidence.reasons).toContain('full_gate_evidence_missing');
    expect(invalidEvidence.reasons).toContain('rule_oracle_author_reviewer_not_independent');
  });
});
