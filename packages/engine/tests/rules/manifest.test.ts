import { describe, expect, it } from 'vitest';
import {
  CURRENT_GAME_CONFIG,
  CURRENT_RULES_MANIFEST,
  assertRatified,
  validateRulesManifest,
} from '../../src/rules/index.js';

function cloneManifest(): unknown {
  return JSON.parse(JSON.stringify(CURRENT_RULES_MANIFEST)) as unknown;
}

describe('canonical current-rules manifest', () => {
  it('is complete, immutable, and explicitly diagnostic', () => {
    expect(validateRulesManifest(cloneManifest())).toEqual(CURRENT_RULES_MANIFEST);
    expect(CURRENT_RULES_MANIFEST.status).toBe('diagnostic');
    expect(Object.isFrozen(CURRENT_RULES_MANIFEST)).toBe(true);
    expect(Object.isFrozen(CURRENT_RULES_MANIFEST.rules.effects)).toBe(true);
    expect(Object.isFrozen(CURRENT_GAME_CONFIG)).toBe(true);
  });

  it('rejects an omitted setting', () => {
    const candidate = cloneManifest() as {
      engineConfig: Record<string, unknown>;
    };
    delete candidate.engineConfig.heroAuras;
    expect(() => validateRulesManifest(candidate)).toThrow(/heroAuras.*required/);
  });

  it('rejects unknown settings', () => {
    const candidate = cloneManifest() as {
      engineConfig: Record<string, unknown>;
    };
    candidate.engineConfig.silentAlternateRules = true;
    expect(() => validateRulesManifest(candidate)).toThrow(/silentAlternateRules.*unknown/);
  });

  it('rejects incoherent or weakened current semantics', () => {
    const candidate = cloneManifest() as {
      engineConfig: Record<string, unknown>;
    };
    candidate.engineConfig.responseWindowsOnAllActions = false;
    expect(() => validateRulesManifest(candidate)).toThrow(
      /responseWindowsOnAllActions must be true/,
    );
  });

  it('cannot be presented as ratified', () => {
    expect(() => assertRatified()).toThrow(/diagnostic, not ratified/);
  });
});
