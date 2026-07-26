#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const engineDir = fileURLToPath(new URL('.', import.meta.url));
const repoDir = resolve(engineDir, '../..');
const evidence = JSON.parse(
  readFileSync(resolve(engineDir, 'sim-data/finding-evidence.json'), 'utf8'),
);
const sourceReview = readFileSync(
  resolve(repoDir, evidence.sourceReview),
  'utf8',
);
const plan = readFileSync(resolve(repoDir, evidence.sourceLedger), 'utf8');
const ledgerSection = plan
  .split('## 8. Finding-by-finding traceability ledger')[1]
  ?.split('## 9. Implementation slices')[0];
const criticalSummarySection = plan
  .split('## 7. Critical-summary closure map')[1]
  ?.split('## 8. Finding-by-finding traceability ledger')[0];

if (ledgerSection === undefined || criticalSummarySection === undefined) {
  throw new Error('Could not locate the closure maps in the remediation plan');
}

const statuses = [
  'planned',
  'test-red',
  'implemented',
  'evidence-green',
  'rules/quant review',
  'closed',
];

export function buildFindingLedger() {
  const rows = [...ledgerSection.matchAll(
    /^\| ([A-Z]+-\d{2}) \| ([^|]+) \| ([^|]+) \| ([^|]+) \|$/gm,
  )].map((match) => ({
    id: match[1],
    workPackage: match[2].trim(),
    requiredRemediation: match[3].trim(),
    closureEvidence: match[4].trim(),
  }));
  const ids = new Set(rows.map((row) => row.id));
  const sourceIds = [
    ...sourceReview.matchAll(/^### ([A-Z]+-\d{2})\b/gm),
  ]
    .map((match) => match[1])
    .filter((id) => !id.startsWith('C-'));
  const uniqueSourceIds = new Set(sourceIds);
  const errors = [];
  if (rows.length !== 167 || ids.size !== 167) {
    errors.push(`Expected 167 unique plan findings, found ${String(rows.length)}/${String(ids.size)}`);
  }
  if (sourceIds.length !== 167 || uniqueSourceIds.size !== 167) {
    errors.push(
      `Expected 167 unique source-review findings, found ${String(
        sourceIds.length,
      )}/${String(uniqueSourceIds.size)}`,
    );
  }
  for (const id of uniqueSourceIds) {
    if (!ids.has(id)) errors.push(`Source-review finding ${id} is absent from plan`);
  }
  for (const id of ids) {
    if (!uniqueSourceIds.has(id)) {
      errors.push(`Plan finding ${id} is absent from source review`);
    }
  }
  for (const id of Object.keys(evidence.records)) {
    if (!ids.has(id)) errors.push(`Unknown evidence finding ${id}`);
  }

  const records = rows.map((row) => {
    const override = evidence.records[row.id] ?? {};
    const status = override.status ?? evidence.defaultStatus;
    if (!statuses.includes(status)) errors.push(`${row.id} has invalid status ${String(status)}`);
    const paths = [
      ...(override.tests ?? []),
      ...(override.implementationChanges ?? []),
      ...(override.invariants ?? []),
      ...(override.evidenceArtifacts ?? []),
    ];
    for (const path of paths) {
      if (!existsSync(resolve(repoDir, path))) {
        errors.push(`${row.id} references missing path ${path}`);
      }
    }
    if (
      ['evidence-green', 'rules/quant review', 'closed'].includes(status) &&
      (override.tests?.length ?? 0) === 0
    ) {
      errors.push(`${row.id} status ${status} requires retained test evidence`);
    }
    return {
      ...row,
      sourceReview: evidence.sourceReview,
      status,
      rulesDecision: override.rulesDecision ?? null,
      implementationChanges: override.implementationChanges ?? [],
      tests: override.tests ?? [],
      invariants: override.invariants ?? [],
      evidenceArtifacts: override.evidenceArtifacts ?? [],
      manifestVersions: override.manifestVersions ?? [],
      owner: override.owner ?? null,
      reviewers: override.reviewers ?? [],
      closedAt: override.closedAt ?? null,
    };
  });
  return { records, errors };
}

export function buildCriticalSummaryLedger() {
  const rows = [...criticalSummarySection.matchAll(
    /^\| (C-\d{2}) — ([^|]+) \| ([^|]+) \| ([^|]+) \|$/gm,
  )].map((match) => ({
    id: match[1],
    title: match[2].trim(),
    requiredPackages: match[3].split(',').map((item) => item.trim()),
    decisiveEvidence: match[4].trim(),
  }));
  const ids = new Set(rows.map((row) => row.id));
  const sourceIds = [
    ...sourceReview.matchAll(/^### (C-\d{2})\b/gm),
  ].map((match) => match[1]);
  const uniqueSourceIds = new Set(sourceIds);
  const errors = [];
  if (rows.length !== 12 || ids.size !== 12) {
    errors.push(
      `Expected 12 unique critical summaries, found ${String(rows.length)}/${String(ids.size)}`,
    );
  }
  if (sourceIds.length !== 12 || uniqueSourceIds.size !== 12) {
    errors.push(
      `Expected 12 unique source-review critical summaries, found ${String(
        sourceIds.length,
      )}/${String(uniqueSourceIds.size)}`,
    );
  }
  for (const id of uniqueSourceIds) {
    if (!ids.has(id)) {
      errors.push(`Source-review critical summary ${id} is absent from plan`);
    }
  }
  for (const id of ids) {
    if (!uniqueSourceIds.has(id)) {
      errors.push(`Plan critical summary ${id} is absent from source review`);
    }
  }
  const overrides = evidence.criticalSummaries ?? {};
  for (const id of Object.keys(overrides)) {
    if (!ids.has(id)) errors.push(`Unknown critical summary ${id}`);
  }
  const records = rows.map((row) => {
    const override = overrides[row.id] ?? {};
    const status = override.status ?? evidence.defaultStatus;
    if (!statuses.includes(status)) {
      errors.push(`${row.id} has invalid status ${String(status)}`);
    }
    const paths = [
      ...(override.tests ?? []),
      ...(override.evidenceArtifacts ?? []),
    ];
    for (const path of paths) {
      if (!existsSync(resolve(repoDir, path))) {
        errors.push(`${row.id} references missing path ${path}`);
      }
    }
    if (
      ['evidence-green', 'rules/quant review', 'closed'].includes(status) &&
      (override.tests?.length ?? 0) === 0
    ) {
      errors.push(`${row.id} status ${status} requires retained test evidence`);
    }
    return {
      ...row,
      status,
      tests: override.tests ?? [],
      evidenceArtifacts: override.evidenceArtifacts ?? [],
      owner: override.owner ?? null,
      reviewers: override.reviewers ?? [],
      closedAt: override.closedAt ?? null,
    };
  });
  return { records, errors };
}

export function auditFindingLedger({ requireClosed = false } = {}) {
  const built = buildFindingLedger();
  const critical = buildCriticalSummaryLedger();
  const errors = [...built.errors, ...critical.errors];
  const workPackages = new Set(
    built.records.flatMap((record) => record.workPackage.split('/')),
  );
  for (const record of critical.records) {
    for (const requiredPackage of record.requiredPackages) {
      if (!workPackages.has(requiredPackage)) {
        errors.push(
          `${record.id} required package ${requiredPackage} has no finding record`,
        );
      }
    }
  }
  if (requireClosed) {
    for (const record of built.records) {
      if (record.status !== 'closed') errors.push(`${record.id} is ${record.status}, not closed`);
      if (record.owner === null || record.reviewers.length === 0 || record.closedAt === null) {
        errors.push(`${record.id} lacks closure ownership/review/timestamp`);
      }
    }
    for (const record of critical.records) {
      if (record.status !== 'closed') errors.push(`${record.id} is ${record.status}, not closed`);
      if (record.owner === null || record.reviewers.length === 0 || record.closedAt === null) {
        errors.push(`${record.id} lacks closure ownership/review/timestamp`);
      }
    }
  }
  return {
    ok: errors.length === 0,
    errors,
    total: built.records.length,
    criticalSummaryTotal: critical.records.length,
    counts: Object.fromEntries(
      statuses.map((status) => [
        status,
        built.records.filter((record) => record.status === status).length,
      ]),
    ),
    criticalSummaryCounts: Object.fromEntries(
      statuses.map((status) => [
        status,
        critical.records.filter((record) => record.status === status).length,
      ]),
    ),
    records: built.records,
    criticalSummaries: critical.records,
  };
}

function markdownCell(value) {
  return String(value ?? '—')
    .replaceAll('|', '\\|')
    .replaceAll('\n', ' ');
}

export function renderClosureReport(report) {
  const countRows = statuses.map(
    (status) =>
      `| ${status} | ${String(report.counts[status])} | ${String(
        report.criticalSummaryCounts[status],
      )} |`,
  );
  const findingRows = report.records.map(
    (record) =>
      `| ${record.id} | ${markdownCell(record.status)} | ${markdownCell(
        record.owner,
      )} | ${String(record.tests.length)} | ${String(
        record.evidenceArtifacts.length,
      )} |`,
  );
  const criticalRows = report.criticalSummaries.map(
    (record) =>
      `| ${record.id} | ${markdownCell(record.status)} | ${markdownCell(
        record.owner,
      )} | ${String(record.tests.length)} | ${String(
        record.evidenceArtifacts.length,
      )} |`,
  );
  return [
    '# Simulation engine closure report',
    '',
    `Structural audit: ${report.ok ? 'PASS' : 'FAIL'}`,
    '',
    '| Status | Findings | Critical summaries |',
    '|---|---:|---:|',
    ...countRows,
    '',
    '## Findings',
    '',
    '| ID | Status | Owner | Tests | Evidence artifacts |',
    '|---|---|---|---:|---:|',
    ...findingRows,
    '',
    '## Critical summaries',
    '',
    '| ID | Status | Owner | Tests | Evidence artifacts |',
    '|---|---|---|---:|---:|',
    ...criticalRows,
    ...(report.errors.length === 0
      ? []
      : [
          '',
          '## Audit errors',
          '',
          ...report.errors.map((error) => `- ${error}`),
        ]),
    '',
  ].join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const report = auditFindingLedger({
    requireClosed: process.argv.includes('--require-closed'),
  });
  console.log(
    process.argv.includes('--markdown')
      ? renderClosureReport(report)
      : JSON.stringify(report, null, 2),
  );
  if (!report.ok) process.exitCode = 1;
}
