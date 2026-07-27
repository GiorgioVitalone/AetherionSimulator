#!/usr/bin/env node
import { spawnSync, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REQUIRED_GATE_INVOCATIONS } from './ratification-commands.mjs';

const engineDir = fileURLToPath(new URL('.', import.meta.url));
const repositoryRoot = resolve(engineDir, '../..');
const gateIds = Array.from({ length: 12 }, (_, index) => `G${String(index)}`);

function optionValue(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || process.argv[index + 1] === undefined) return null;
  return process.argv[index + 1];
}

function git(args) {
  return execFileSync('git', args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function packageManagerInvocation(args) {
  const npmExecPath = process.env.npm_execpath;
  return npmExecPath === undefined
    ? { file: 'pnpm', args }
    : { file: process.execPath, args: [npmExecPath, ...args] };
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

const outputOption = optionValue('--output');
if (outputOption === null) {
  console.error(
    'Usage: node ratification-evidence.mjs --output /outside/repo/full-gate-evidence.json',
  );
  process.exit(2);
}

if (git(['status', '--porcelain']).length !== 0) {
  console.error(
    'Refusing to generate ratification evidence from a dirty checkout.',
  );
  process.exit(1);
}
const candidateCommit = git(['rev-parse', 'HEAD']);

const outputPath = resolve(process.cwd(), outputOption);
if (
  outputPath === repositoryRoot ||
  outputPath.startsWith(`${repositoryRoot}/`)
) {
  console.error(
    'Ratification evidence must be written outside the candidate checkout.',
  );
  process.exit(2);
}
const logDirectory = resolve(
  dirname(outputPath),
  `${basename(outputPath, '.json')}.logs`,
);
mkdirSync(logDirectory, { recursive: true });

const commands = [];
for (const [id, invocation] of Object.entries(REQUIRED_GATE_INVOCATIONS)) {
  console.error(`Running ${id}: ${invocation.command}`);
  const executable = packageManagerInvocation(invocation.args);
  const result = spawnSync(executable.file, executable.args, {
    cwd: repositoryRoot,
    encoding: 'buffer',
    env: process.env,
    maxBuffer: 256 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const stdout = result.stdout ?? Buffer.alloc(0);
  const stderr =
    result.error === undefined
      ? (result.stderr ?? Buffer.alloc(0))
      : Buffer.concat([
          result.stderr ?? Buffer.alloc(0),
          Buffer.from(`\n${result.error.stack ?? result.error.message}\n`),
        ]);
  const output = Buffer.concat([
    Buffer.from('=== stdout ===\n'),
    stdout,
    Buffer.from('\n=== stderr ===\n'),
    stderr,
  ]);
  const logName = `${id}.log`;
  writeFileSync(resolve(logDirectory, logName), output);
  const exitCode =
    result.status ?? (result.error === undefined ? 1 : 127);
  commands.push({
    id,
    command: invocation.command,
    exitCode,
    outputHash: sha256(output),
    outputLog: `${basename(logDirectory)}/${logName}`,
  });
  if (exitCode !== 0) {
    console.error(
      `${id} failed with exit code ${String(exitCode)}; see ${resolve(logDirectory, logName)}`,
    );
    process.exit(1);
  }
}

const { currentRatificationStatus } = await import(
  new URL('./ratification-status.mjs', import.meta.url)
);
const current = currentRatificationStatus();
if (!current.evidence.cleanCheckout) {
  console.error(
    'The checkout became dirty while running gates; refusing to emit evidence.',
  );
  process.exit(1);
}
if (current.candidateCommit !== candidateCommit) {
  console.error(
    'The candidate commit changed while running gates; refusing to emit evidence.',
  );
  process.exit(1);
}
const preApprovalBlockers = current.gate.reasons.filter(
  (reason) =>
    reason !== 'external_review_status:awaiting_external_review' &&
    reason !== 'full_gate_evidence_missing' &&
    !reason.startsWith('approval_missing:'),
);
if (preApprovalBlockers.length > 0) {
  console.error(
    `The candidate still has non-approval blockers: ${preApprovalBlockers.join(', ')}`,
  );
  process.exit(1);
}

const evidence = {
  schemaVersion: 1,
  status: 'passed',
  candidateId: current.candidateId,
  candidateCommit: current.candidateCommit,
  generatedAt: new Date().toISOString(),
  contentHashes: current.contentHashes,
  gates: Object.fromEntries(gateIds.map((gate) => [gate, 'passed'])),
  commands,
};
writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`);

// Validate the persisted bytes through the same consumer reviewers and release
// automation use. This catches any producer/validator drift before publication.
const persisted = JSON.parse(readFileSync(outputPath, 'utf8'));
const { validateFullGateEvidence } = await import(
  new URL('./ratification-status.mjs', import.meta.url)
);
const evidenceHash = validateFullGateEvidence(persisted, {
  candidateId: current.candidateId,
  candidateCommit: current.candidateCommit,
  contentHashes: current.contentHashes,
});
console.error(`Wrote ${outputPath}`);
console.log(evidenceHash);
