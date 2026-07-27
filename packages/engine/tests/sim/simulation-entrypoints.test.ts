import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

interface EntrypointRecord {
  readonly path: string;
  readonly defaultProfile:
    | 'current'
    | 'custom-diagnostic'
    | 'legacy-v3'
    | 'explicit-legacy';
}

const workspace = resolve(import.meta.dirname, '../../../..');
const inventory = JSON.parse(
  readFileSync(
    new URL('../../sim-data/simulation-entrypoints.json', import.meta.url),
    'utf8',
  ),
) as {
  readonly schemaVersion: number;
  readonly currentManifest: string;
  readonly entrypoints: readonly EntrypointRecord[];
};

describe('simulation entry-point profile inventory', () => {
  it('classifies every direct simulator driver and keeps current defaults manifest-bound', () => {
    const paths = inventory.entrypoints.map((entrypoint) => entrypoint.path);
    expect(new Set(paths).size).toBe(paths.length);
    expect(inventory.currentManifest).toBe(
      'packages/engine/sim-data/ruleset-current.json',
    );

    for (const entrypoint of inventory.entrypoints) {
      const source = readFileSync(resolve(workspace, entrypoint.path), 'utf8');
      if (entrypoint.defaultProfile === 'current') {
        expect(
          /rulesProfile['"]?\s*[:,]\s*['"]current['"]/.test(source) ||
            (/rulesProfile\s*:/.test(source) &&
              /rulesetName\s*=.*:\s*['"]current['"]/.test(source)),
        ).toBe(true);
      } else if (entrypoint.defaultProfile === 'custom-diagnostic') {
        expect(source).toContain('custom-diagnostic');
      } else {
        expect(source).toContain('legacy-');
      }
    }
  });

  it('keeps every inventoried script syntactically valid', () => {
    for (const entrypoint of inventory.entrypoints) {
      expect(() =>
        execFileSync(process.execPath, ['--check', resolve(workspace, entrypoint.path)], {
          stdio: 'pipe',
        }),
      ).not.toThrow();
    }
  });
});
