#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const engineDir = fileURLToPath(new URL('.', import.meta.url));
const repoDir = resolve(engineDir, '../..');

function percentage(hit, total) {
  return total === 0 ? 100 : (100 * hit) / total;
}

function metricCoverage(file, metric) {
  const counters =
    metric === 'statements'
      ? Object.values(file.s ?? {})
      : metric === 'functions'
        ? Object.values(file.f ?? {})
        : Object.values(file.b ?? {}).flat();
  return {
    hit: counters.filter((count) => count > 0).length,
    total: counters.length,
    pct: percentage(
      counters.filter((count) => count > 0).length,
      counters.length,
    ),
  };
}

export function evaluateChangedCoverage({
  changedPaths,
  coverage,
  policy,
  today,
}) {
  const errors = [];
  const reports = [];
  const exceptions = new Map(
    policy.exceptions.map((exception) => [exception.path, exception]),
  );
  for (const exception of policy.exceptions) {
    if (
      typeof exception.owner !== 'string' ||
      exception.owner.length === 0 ||
      typeof exception.reason !== 'string' ||
      exception.reason.length === 0 ||
      !/^20\d{2}-\d{2}-\d{2}$/.test(exception.expires)
    ) {
      errors.push(`Malformed coverage exception for ${String(exception.path)}`);
    } else if (exception.expires < today) {
      errors.push(`Expired coverage exception for ${exception.path}`);
    }
  }

  const byPath = new Map(
    Object.entries(coverage).map(([absolute, file]) => [
      relative(repoDir, absolute),
      file,
    ]),
  );
  for (const path of changedPaths) {
    if (!path.startsWith('packages/engine/src/') || !path.endsWith('.ts')) {
      continue;
    }
    if (path.endsWith('/index.ts') || path.includes('/src/types/')) continue;
    const file = byPath.get(path);
    if (file === undefined) {
      errors.push(`${path} is changed but absent from the coverage report`);
      continue;
    }
    const metrics = Object.fromEntries(
      ['statements', 'branches', 'functions'].map((metric) => [
        metric,
        metricCoverage(file, metric),
      ]),
    );
    const failed = Object.entries(policy.thresholds).filter(
      ([metric, threshold]) => metrics[metric].pct < threshold,
    );
    reports.push({ path, metrics, exception: exceptions.get(path) ?? null });
    if (failed.length > 0 && !exceptions.has(path)) {
      errors.push(
        `${path} changed coverage below threshold: ${failed
          .map(
            ([metric, threshold]) =>
              `${metric} ${metrics[metric].pct.toFixed(1)}% < ${String(threshold)}%`,
          )
          .join(', ')}`,
      );
    }
  }
  return { errors, reports };
}

function gitLines(args) {
  return execFileSync('git', ['-C', repoDir, ...args], {
    encoding: 'utf8',
  })
    .split(/\r?\n/u)
    .filter(Boolean);
}

function changedPaths() {
  const base = process.env.COVERAGE_BASE_SHA;
  const tracked =
    base === undefined || base.length === 0
      ? gitLines(['diff', '--name-only', 'HEAD', '--', 'packages/engine/src'])
      : gitLines([
          'diff',
          '--name-only',
          `${base}...HEAD`,
          '--',
          'packages/engine/src',
        ]);
  const untracked = gitLines([
    'ls-files',
    '--others',
    '--exclude-standard',
    '--',
    'packages/engine/src',
  ]);
  return [...new Set([...tracked, ...untracked])].sort();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const coverage = JSON.parse(
    readFileSync(resolve(engineDir, 'coverage/current/coverage-final.json'), 'utf8'),
  );
  const policy = JSON.parse(
    readFileSync(resolve(engineDir, 'sim-data/coverage-exceptions.json'), 'utf8'),
  );
  const result = evaluateChangedCoverage({
    changedPaths: changedPaths(),
    coverage,
    policy,
    today: new Date().toISOString().slice(0, 10),
  });
  for (const report of result.reports) {
    const metrics = Object.entries(report.metrics)
      .map(([name, value]) => `${name}=${value.pct.toFixed(1)}%`)
      .join(' ');
    console.log(`${report.path} ${metrics}${report.exception ? ' EXCEPTED' : ''}`);
  }
  if (result.errors.length > 0) {
    for (const error of result.errors) console.error(error);
    process.exitCode = 1;
  } else {
    console.log(`Changed-code coverage gate passed (${String(result.reports.length)} file(s))`);
  }
}
