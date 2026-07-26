import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('unhandled-error CI gate', () => {
  it('makes an injected unhandled rejection fail an isolated Vitest run', () => {
    const engineDir = resolve(import.meta.dirname, '../..');
    const result = spawnSync(
      resolve(engineDir, 'node_modules/.bin/vitest'),
      [
        'run',
        'tests/fixtures/unhandled-rejection.test.ts',
        '--config',
        'vitest.config.ts',
      ],
      {
        cwd: engineDir,
        encoding: 'utf8',
        env: {
          ...process.env,
          CI: '',
          AETHERION_UNHANDLED_PROBE: '1',
        },
      },
    );
    const output = `${result.stdout}\n${result.stderr}`;
    expect(result.status).not.toBe(0);
    expect(output).toContain('intentional-unhandled-rejection-probe');
    expect(output).toContain('Unhandled Rejection');
  });
});
