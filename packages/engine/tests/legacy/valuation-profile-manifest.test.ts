// Historical compatibility oracle; never evidence for current correctness.
/**
 * §S2 round-5 cross-layer test (auditor-prescribed): reads the RATIFIED
 * sim-data/ruleset-v1.json manifest directly and asserts the valuation
 * profile's rule assumptions (valuation-profile.ts) match it exactly, flag by
 * flag. Without this test, a future ruleset change could silently invalidate
 * the shield/ARM pricing derivation with nothing failing — the exact failure
 * mode that produced the round-5 finding (a false "both flags locked" claim
 * that no test caught). This test must fail if the manifest ever adds/removes
 * `armFirstInstanceOnly` or `shieldFirstInstanceOnly`.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { VALUATION_PROFILE_V1 } from '../../src/balance/valuation-profile.js';

const here = dirname(fileURLToPath(import.meta.url));
const manifestPath = join(here, '..', '..', 'sim-data', 'ruleset-v1.json');

// Mirrors tests/sim/ruleset-v1-lock.test.ts's graceful skip when the manifest
// doesn't exist yet (no ratified lock).
const d = existsSync(manifestPath) ? describe : describe.skip;

interface RulesetManifest {
  rules: Record<string, unknown>;
}

function readManifest(): RulesetManifest {
  return JSON.parse(readFileSync(manifestPath, 'utf8')) as RulesetManifest;
}

d('valuation-profile <-> ruleset-v1 manifest cross-check', () => {
  it('armFirstInstanceOnly is present and true — ARM valuation assumes first-instance-per-turn', () => {
    const manifest = readManifest();
    expect(manifest.rules.armFirstInstanceOnly).toBe(true);
    expect(VALUATION_PROFILE_V1.armMitigation).toBe('first_instance_per_turn');
  });

  it('shieldFirstInstanceOnly is ABSENT from the manifest — shield valuation assumes per-instance (engine default)', () => {
    const manifest = readManifest();
    expect(manifest.rules).not.toHaveProperty('shieldFirstInstanceOnly');
    expect(VALUATION_PROFILE_V1.shieldMitigation).toBe('per_instance');
  });
});
