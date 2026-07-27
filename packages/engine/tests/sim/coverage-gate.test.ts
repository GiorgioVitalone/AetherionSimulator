import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { evaluateChangedCoverage } from '../../check-changed-coverage.mjs';

const path = 'packages/engine/src/example.ts';
const coverage = {
  [resolve(process.cwd(), 'src/example.ts')]: {
    s: { 0: 1, 1: 0 },
    f: { 0: 1 },
    b: { 0: [1, 0] },
  },
};

describe('changed-code coverage gate', () => {
  it('fails uncovered changed code and accepts only owned, unexpired exceptions', () => {
    const base = {
      changedPaths: [path],
      coverage,
      today: '2026-07-26',
    };
    const thresholds = { statements: 65, branches: 55, functions: 65 };
    const failed = evaluateChangedCoverage({
      ...base,
      policy: { thresholds, exceptions: [] },
    });
    expect(failed.errors.join('\n')).toContain('below threshold');

    const excepted = evaluateChangedCoverage({
      ...base,
      policy: {
        thresholds,
        exceptions: [
          {
            path,
            owner: 'engine-owner',
            expires: '2026-08-26',
            reason: 'bounded migration',
          },
        ],
      },
    });
    expect(excepted.errors).toEqual([]);

    const expired = evaluateChangedCoverage({
      ...base,
      policy: {
        thresholds,
        exceptions: [
          {
            path,
            owner: 'engine-owner',
            expires: '2026-07-25',
            reason: 'bounded migration',
          },
        ],
      },
    });
    expect(expired.errors.join('\n')).toContain('Expired coverage exception');
  });
});
