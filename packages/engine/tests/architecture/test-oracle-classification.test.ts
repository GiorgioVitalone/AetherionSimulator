import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const testsRoot = new URL('../', import.meta.url);

function testFiles(directory: string): readonly string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return testFiles(path);
    return entry.isFile() && entry.name.endsWith('.test.ts') ? [path] : [];
  });
}

describe('test-oracle classification', () => {
  it('keeps pinned historical behavior out of the current correctness suite', () => {
    const rootPath = testsRoot.pathname;
    const legacyRoot = join(rootPath, 'legacy');
    const legacy = testFiles(legacyRoot);
    const current = testFiles(rootPath).filter(
      (path) => !path.startsWith(`${legacyRoot}/`),
    );

    expect(legacy.length).toBeGreaterThan(0);
    for (const path of legacy) {
      expect(readFileSync(path, 'utf8'), path).toContain(
        'Historical compatibility oracle; never evidence for current correctness.',
      );
    }
    for (const path of current) {
      if (path.endsWith('test-oracle-classification.test.ts')) continue;
      const source = readFileSync(path, 'utf8');
      expect(source, path).not.toMatch(/\bPINNED_HASH\b/);
      expect(source, path).not.toMatch(/\blegacyPin\b/);
      expect(source, path).not.toContain('sim-data/ruleset-v1.json');
    }

    const packageJson = JSON.parse(
      readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
    ) as { scripts: Record<string, string> };
    expect(packageJson.scripts['test:correctness']).toContain(
      '--exclude tests/legacy/**',
    );
    expect(packageJson.scripts['test:legacy']).toBe(
      'vitest run tests/legacy',
    );
  });
});
