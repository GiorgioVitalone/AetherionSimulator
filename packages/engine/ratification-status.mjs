#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import {
  evaluateRatification,
  validateExternalReviewCompletion,
  validateExternalReviewManifest,
} from './dist/sim/ratification.js';
import { auditFindingLedger } from './audit-findings.mjs';
import {
  canonicalHash,
  computeBotImplementationHash,
  computeEngineBuildHash,
  computeHarnessBuildHash,
} from './sim-runner.mjs';
import { REQUIRED_GATE_COMMANDS } from './ratification-commands.mjs';

const readJson = (path) =>
  JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const review = validateExternalReviewManifest(
  readJson('./sim-data/external-review-manifest.json'),
);
const rules = readJson('./sim-data/ruleset-current.json');
const study = readJson('./sim-data/current-study-manifest.json');
const oracle = readJson('./sim-data/independent-rule-oracle-candidate.json');
const expert = readJson('./sim-data/expert-policy-corpus-template.json');
const decisions = readFileSync(
  new URL('../../docs/simulation-engine-rules-decisions-2026-07-26.md', import.meta.url),
  'utf8',
);
const semanticPaths = Object.values(review.evidenceSources);
const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url));
const REQUIRED_GATE_IDS = Array.from({ length: 12 }, (_, index) => `G${String(index)}`);
export { REQUIRED_GATE_COMMANDS };
const REQUIRED_COMMAND_IDS = Object.keys(REQUIRED_GATE_COMMANDS);

function git(args) {
  return execFileSync('git', args, {
    cwd: new URL('../..', import.meta.url),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function allTracked(paths) {
  return paths.every((path) => {
    try {
      git(['ls-files', '--error-unmatch', path]);
      return true;
    } catch {
      return false;
    }
  });
}

function hashEvidenceSource(path) {
  const bytes = readFileSync(resolve(repositoryRoot, path));
  if (path.endsWith('.json')) {
    return canonicalHash(JSON.parse(bytes.toString('utf8')));
  }
  return createHash('sha256').update(bytes).digest('hex');
}

export function currentRatificationStatus({
  fullGateEvidence = null,
  externalReview = null,
} = {}) {
  const audit = auditFindingLedger();
  const candidateCommit = git(['rev-parse', 'HEAD']);
  const completedReview =
    externalReview === null
      ? review
      : validateExternalReviewCompletion(externalReview, review);
  const unresolvedRulesDecisions =
    decisions.match(/\|\s*Provisional[^|]*\|/gu)?.length ?? 0;
  const contentHashes = {
    ...Object.fromEntries(
      Object.entries(review.evidenceSources).map(([id, path]) => [
        id,
        hashEvidenceSource(path),
      ]),
    ),
    engineBuild: computeEngineBuildHash(),
    harnessBuild: computeHarnessBuildHash(),
    botImplementation: computeBotImplementationHash(),
    documentationCommit: canonicalHash(git(['rev-parse', 'HEAD:Documentation'])),
    externalReviewRequirements: canonicalHash(review),
  };
  const fullGateEvidenceHash =
    fullGateEvidence === null
      ? null
      : validateFullGateEvidence(fullGateEvidence, {
          candidateId: review.candidateId,
          candidateCommit,
          contentHashes,
        });
  const evidence = {
    cleanCheckout: git(['status', '--porcelain']).length === 0,
    allSemanticInputsTracked: allTracked(semanticPaths),
    findingLedgerClosed: audit.counts.closed === audit.total,
    criticalSummariesClosed:
      audit.criticalSummaryCounts.closed === audit.criticalSummaryTotal,
    unresolvedRulesDecisions,
    candidateCommit,
    fullGateEvidenceHash,
    rulesArtifactStatus: rules.status,
    studyArtifactStatus: study.status,
    ruleOracleStatus: oracle.status,
    independentRuleAuthor: oracle.authorship.independentAuthor,
    independentRuleReviewer: oracle.authorship.independentReviewer,
    expertCorpusStatus: expert.status,
    independentPolicyExpert: expert.authorship.expertName,
  };
  return {
    schemaVersion: 1,
    candidateId: review.candidateId,
    candidateCommit,
    contentHashes,
    findingCounts: audit.counts,
    criticalSummaryCounts: audit.criticalSummaryCounts,
    externalReview: {
      source:
        externalReview === null
          ? 'tracked_requirements'
          : 'detached_completion',
      requirementsHash: contentHashes.externalReviewRequirements,
      status: completedReview.status,
    },
    evidence,
    gate: evaluateRatification(completedReview, evidence),
  };
}

export function validateFullGateEvidence(input, bindings) {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new TypeError('full gate evidence must be an object');
  }
  if (
    input.schemaVersion !== 1 ||
    input.status !== 'passed' ||
    input.candidateId !== bindings.candidateId ||
    input.candidateCommit !== bindings.candidateCommit ||
    !Number.isFinite(Date.parse(input.generatedAt))
  ) {
    throw new TypeError('full gate evidence identity/status binding is invalid');
  }
  if (
    canonicalHash(input.contentHashes) !== canonicalHash(bindings.contentHashes)
  ) {
    throw new TypeError('full gate evidence content hashes do not match the candidate');
  }
  if (
    typeof input.gates !== 'object' ||
    input.gates === null ||
    Array.isArray(input.gates) ||
    Object.keys(input.gates).sort().join('|') !==
      [...REQUIRED_GATE_IDS].sort().join('|') ||
    REQUIRED_GATE_IDS.some((gate) => input.gates[gate] !== 'passed')
  ) {
    throw new TypeError('full gate evidence must pass exactly G0 through G11');
  }
  if (!Array.isArray(input.commands)) {
    throw new TypeError('full gate evidence commands must be an array');
  }
  const commands = new Map(input.commands.map((command) => [command?.id, command]));
  if (
    commands.size !== REQUIRED_COMMAND_IDS.length ||
    REQUIRED_COMMAND_IDS.some((id) => !commands.has(id))
  ) {
    throw new TypeError('full gate evidence command inventory is incomplete');
  }
  for (const id of REQUIRED_COMMAND_IDS) {
    const command = commands.get(id);
    if (
      command.command !== REQUIRED_GATE_COMMANDS[id] ||
      command.exitCode !== 0 ||
      !/^[a-f0-9]{64}$/u.test(String(command.outputHash))
    ) {
      throw new TypeError(
        `full gate evidence command ${id} is not the required passing command`,
      );
    }
  }
  return canonicalHash(input);
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const gateEvidenceIndex = process.argv.indexOf('--gate-evidence');
  const fullGateEvidence =
    gateEvidenceIndex < 0
      ? null
      : JSON.parse(
          readFileSync(
            resolve(process.cwd(), process.argv[gateEvidenceIndex + 1]),
            'utf8',
          ),
        );
  const externalReviewIndex = process.argv.indexOf('--external-review');
  const externalReview =
    externalReviewIndex < 0
      ? null
      : JSON.parse(
          readFileSync(
            resolve(process.cwd(), process.argv[externalReviewIndex + 1]),
            'utf8',
          ),
        );
  const report = currentRatificationStatus({
    fullGateEvidence,
    externalReview,
  });
  console.log(JSON.stringify(report, null, 2));
  if (
    process.argv.includes('--require-approved') &&
    !report.gate.releaseEligible
  ) {
    process.exitCode = 1;
  }
}
