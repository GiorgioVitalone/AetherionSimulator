import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = new URL('../../../../', import.meta.url);

function repoFile(path: string): string {
  return readFileSync(new URL(path, repoRoot), 'utf8');
}

describe('current architecture documentation contract', () => {
  it('keeps every required current document substantive and manifest-bound', () => {
    const manifest = JSON.parse(
      repoFile('packages/engine/sim-data/ruleset-current.json'),
    ) as { semanticVersion: string; status: string };
    const required = [
      'docs/architecture.md',
      'docs/dsl-spec.md',
      'docs/card-effect-system.md',
      'docs/game-rules-summary.md',
      'docs/simulator-roadmap.md',
    ];

    for (const path of required) {
      const source = repoFile(path);
      expect(source.length, path).toBeGreaterThan(1_000);
      const currentSection =
        path === 'docs/simulator-roadmap.md'
          ? source.split('## Executive Summary')[0]
          : source;
      expect(currentSection, path).not.toMatch(
        /to be written|placeholder|ruleset-v1 is current/iu,
      );
    }
    expect(repoFile('docs/game-rules-summary.md')).toContain(
      manifest.semanticVersion,
    );
    expect(manifest.status).toBe('diagnostic');
    expect(repoFile('docs/architecture.md')).toContain(
      'current-study-manifest.json',
    );
  });

  it('retains all required architecture decisions and their candidate status', () => {
    const adrDirectory = new URL('../../../../docs/adr/', import.meta.url);
    const decisions = readdirSync(adrDirectory)
      .filter((name) => /^\d{3}-.+\.md$/u.test(name))
      .sort();
    expect(decisions).toHaveLength(8);
    for (const decision of decisions) {
      const source = readFileSync(new URL(decision, adrDirectory), 'utf8');
      expect(source, decision).toContain(
        'Status: accepted for the diagnostic current profile.',
      );
      expect(source.length, decision).toBeGreaterThan(450);
    }
  });

  it('keeps core semantic authority independent of simulator and bot adapters', () => {
    const sourceRoot = new URL('../../src/', import.meta.url).pathname;
    const authorityDirectories = [
      'actions',
      'combat',
      'effects',
      'events',
      'invariants',
      'rules',
      'runtime',
      'setup',
      'state-machine',
      'transitions',
      'types',
      'zones',
    ];
    const files = authorityDirectories.flatMap((directory) => {
      const root = join(sourceRoot, directory);
      const visit = (path: string): string[] =>
        readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
          const child = join(path, entry.name);
          if (entry.isDirectory()) return visit(child);
          return entry.isFile() && entry.name.endsWith('.ts') ? [child] : [];
        });
      return existsSync(root) ? visit(root) : [];
    });

    for (const path of files) {
      const source = readFileSync(path, 'utf8');
      expect(source, path).not.toMatch(
        /from\s+['"][^'"]*(?:\/bot\/|\/sim\/|\.\.\/bot\/|\.\.\/sim\/)/u,
      );
    }
  });

  it('keeps compatibility language out of current semantic owners', () => {
    const owners = [
      'packages/engine/src/actions/available-actions.ts',
      'packages/engine/src/actions/cost-checker.ts',
      'packages/engine/src/actions/reactive-actions.ts',
      'packages/engine/src/combat/combat-resolver.ts',
      'packages/engine/src/effects/interpreter.ts',
      'packages/engine/src/effects/stack-resolver.ts',
      'packages/engine/src/transitions/transition.ts',
      'packages/engine/src/transitions/validation.ts',
      'packages/engine/src/state-machine/actions.ts',
      'packages/engine/src/state-machine/game-machine.ts',
      'packages/engine/src/state-machine/turn-boundary.ts',
      'packages/engine/src/runtime/event-envelope.ts',
      'packages/engine/src/runtime/state-based-stabilizer.ts',
      'packages/engine/src/runtime/aura-derivation.ts',
      'packages/engine/src/runtime/aura-recompute.ts',
      'packages/engine/src/runtime/dispatch.ts',
      'packages/engine/src/invariants/game-state-invariants.ts',
      'packages/engine/src/rules/manifest.ts',
      'packages/engine/src/types/ability.ts',
      'packages/engine/src/types/game-state.ts',
    ];
    for (const path of owners) {
      expect(repoFile(path), path).not.toMatch(
        /byte-identical|legacy behavior|legacy inline|historical hash/iu,
      );
    }
    expect(repoFile('docs/legacy-simulation-compatibility.md')).toContain(
      'Historical simulation behavior',
    );
  });
});
