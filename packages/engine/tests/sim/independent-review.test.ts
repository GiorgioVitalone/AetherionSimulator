/**
 * Boundary tests for the independent-review validators — every rejection
 * branch plus the fully-approved happy paths of both document kinds. The
 * committed "awaiting" fixtures are the mutation bases, mirroring
 * ratification-gate.test.ts's clone-and-patch style.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  validateExpertPolicyCorpus,
  validateIndependentRuleOracle,
} from '../../src/sim/independent-review.js';

const oracleFixture = JSON.parse(
  readFileSync(
    new URL('../../sim-data/independent-rule-oracle-candidate.json', import.meta.url),
    'utf8',
  ),
) as Record<string, any>;
const corpusFixture = JSON.parse(
  readFileSync(
    new URL('../../sim-data/expert-policy-corpus-template.json', import.meta.url),
    'utf8',
  ),
) as Record<string, any>;

function oracleWith(patch: (draft: Record<string, any>) => void): Record<string, any> {
  const draft = structuredClone(oracleFixture) as Record<string, any>;
  patch(draft);
  return draft;
}
function corpusWith(patch: (draft: Record<string, any>) => void): Record<string, any> {
  const draft = structuredClone(corpusFixture) as Record<string, any>;
  patch(draft);
  return draft;
}

function approvedOracle(): Record<string, any> {
  return oracleWith((draft) => {
    draft.status = 'independently_approved';
    draft.authorship.independentAuthor = 'oracle-author';
    draft.authorship.independentReviewer = 'oracle-reviewer';
    draft.authorship.approvedAt = '2026-07-27T00:00:00.000Z';
  });
}

function approvedCorpus(): Record<string, any> {
  return corpusWith((draft) => {
    draft.status = 'independently_approved';
    draft.authorship = {
      expertName: 'expert-name',
      expertOrganization: 'expert-organization',
      expertQualification: 'competitive TCG finalist',
      labeledAt: '2026-07-27T00:00:00.000Z',
      rulesManifestHash: 'c'.repeat(64),
      engineBuildHash: 'd'.repeat(64),
    };
    for (const scenario of draft.scenarios) {
      scenario.stateArtifact = `packages/engine/sim-data/expert-policy-scenarios/${String(scenario.id)}.json`;
      scenario.legalActionKeys = ['a'.repeat(64), 'b'.repeat(64)];
      scenario.expertActionKey = 'a'.repeat(64);
      scenario.expertValue = 0.5;
      scenario.rationale = 'Chosen because it is the highest-value legal line.';
    }
  });
}

describe('validateIndependentRuleOracle', () => {
  it('accepts the committed awaiting candidate and a fully attributed approval', () => {
    expect(validateIndependentRuleOracle(oracleFixture)).toBe(oracleFixture);
    const approved = approvedOracle();
    expect(validateIndependentRuleOracle(approved)).toBe(approved);
  });

  it('rejects non-objects and identity/status violations', () => {
    expect(() => validateIndependentRuleOracle(null)).toThrow(/must be an object/);
    expect(() => validateIndependentRuleOracle([])).toThrow(/must be an object/);
    for (const patch of [
      (d: Record<string, any>) => (d.schemaVersion = 2),
      (d: Record<string, any>) => (d.oracleId = ''),
      (d: Record<string, any>) => (d.status = 'self_approved'),
    ]) {
      expect(() => validateIndependentRuleOracle(oracleWith(patch))).toThrow(
        /identity\/status is invalid/,
      );
    }
  });

  it('rejects broken rulebook bindings and non-manual fixture sources', () => {
    for (const patch of [
      (d: Record<string, any>) => (d.rulebook.path = ''),
      (d: Record<string, any>) => (d.rulebook.revision = ''),
      (d: Record<string, any>) => (d.rulebook.sha256 = 'not-a-hash'),
    ]) {
      expect(() => validateIndependentRuleOracle(oracleWith(patch))).toThrow(
        /rulebook binding is invalid/,
      );
    }
    expect(() =>
      validateIndependentRuleOracle(
        oracleWith((d) => (d.authorship.fixtureSource = 'generated_from_engine')),
      ),
    ).toThrow(/fixture source is invalid/);
  });

  it('rejects missing, duplicate, and malformed scenarios', () => {
    expect(() => validateIndependentRuleOracle(oracleWith((d) => (d.scenarios = [])))).toThrow(
      /scenarios are missing/,
    );
    expect(() => validateIndependentRuleOracle(oracleWith((d) => (d.scenarios = 'none')))).toThrow(
      /scenarios are missing/,
    );
    for (const patch of [
      (d: Record<string, any>) => (d.scenarios[1].id = d.scenarios[0].id),
      (d: Record<string, any>) => (d.scenarios[0].operation = 'coin_flip'),
      (d: Record<string, any>) => (d.scenarios[0].rulebookAnchor = 'ab'),
      (d: Record<string, any>) => (d.scenarios[0].input = 'not-an-object'),
      (d: Record<string, any>) => delete d.scenarios[0].expected,
      (d: Record<string, any>) => (d.scenarios[0].family = ''),
    ]) {
      expect(() => validateIndependentRuleOracle(oracleWith(patch))).toThrow(/scenario is invalid/);
    }
  });

  it('requires attributable, distinct authorship once approved', () => {
    for (const patch of [
      (d: Record<string, any>) => (d.authorship.independentAuthor = ''),
      (d: Record<string, any>) => (d.authorship.independentReviewer = null),
      (d: Record<string, any>) =>
        (d.authorship.independentReviewer = d.authorship.independentAuthor),
      (d: Record<string, any>) => (d.authorship.approvedAt = 'not-a-date'),
    ]) {
      const draft = approvedOracle();
      patch(draft as Record<string, any>);
      expect(() => validateIndependentRuleOracle(draft)).toThrow(
        /lacks independent attributable authorship/,
      );
    }
  });
});

describe('validateExpertPolicyCorpus', () => {
  it('accepts the committed awaiting template and a fully labeled approval', () => {
    expect(validateExpertPolicyCorpus(corpusFixture)).toBe(corpusFixture);
    const approved = approvedCorpus();
    expect(validateExpertPolicyCorpus(approved)).toBe(approved);
  });

  it('rejects non-objects and identity/status violations', () => {
    expect(() => validateExpertPolicyCorpus(undefined)).toThrow(/must be an object/);
    for (const patch of [
      (d: Record<string, any>) => (d.schemaVersion = 0),
      (d: Record<string, any>) => (d.corpusId = ''),
      (d: Record<string, any>) => (d.status = 'labeled'),
      (d: Record<string, any>) => (d.rulesProfile = 'legacy-v1'),
    ]) {
      expect(() => validateExpertPolicyCorpus(corpusWith(patch))).toThrow(
        /identity\/status is invalid/,
      );
    }
  });

  it('rejects weakened claim scopes and unknown human-log statuses', () => {
    expect(() =>
      validateExpertPolicyCorpus(
        corpusWith((d) => (d.claimScope.supported = 'human-equivalent play')),
      ),
    ).toThrow(/claim scope is invalid/);
    expect(() =>
      validateExpertPolicyCorpus(
        corpusWith((d) => (d.claimScope.humanRankEquivalence = 'allowed')),
      ),
    ).toThrow(/claim scope is invalid/);
    expect(() =>
      validateExpertPolicyCorpus(corpusWith((d) => (d.humanDecisionLogs.status = 'ad_hoc'))),
    ).toThrow(/human-log status is invalid/);
  });

  it('rejects incomplete inventories and malformed scenarios', () => {
    expect(() => validateExpertPolicyCorpus(corpusWith((d) => d.scenarios.pop()))).toThrow(
      /scenario inventory is incomplete/,
    );
    for (const patch of [
      (d: Record<string, any>) => (d.scenarios[1].id = d.scenarios[0].id),
      (d: Record<string, any>) => (d.scenarios[0].family = 'resource'),
      (d: Record<string, any>) => (d.scenarios[0].prompt = 'too short'),
      (d: Record<string, any>) => (d.scenarios[0].legalActionKeys = 'none'),
    ]) {
      expect(() => validateExpertPolicyCorpus(corpusWith(patch))).toThrow(/scenario is invalid/);
    }
  });

  it('requires complete bound scenarios and authorship once approved', () => {
    for (const patch of [
      (d: Record<string, any>) => (d.scenarios[0].stateArtifact = 'elsewhere/state.json'),
      (d: Record<string, any>) => (d.scenarios[0].legalActionKeys = ['a'.repeat(64)]),
      (d: Record<string, any>) =>
        (d.scenarios[0].legalActionKeys = ['a'.repeat(64), 'a'.repeat(64)]),
      (d: Record<string, any>) => (d.scenarios[0].legalActionKeys = ['a'.repeat(64), 'nope']),
      (d: Record<string, any>) => (d.scenarios[0].expertActionKey = 'e'.repeat(64)),
      (d: Record<string, any>) => (d.scenarios[0].expertValue = Number.NaN),
      (d: Record<string, any>) => (d.scenarios[0].rationale = 'too short'),
    ]) {
      const draft = approvedCorpus();
      patch(draft as Record<string, any>);
      expect(() => validateExpertPolicyCorpus(draft)).toThrow(/is incomplete/);
    }
    for (const patch of [
      (d: Record<string, any>) => (d.authorship.expertName = ''),
      (d: Record<string, any>) => (d.authorship.expertQualification = 'short'),
      (d: Record<string, any>) => (d.authorship.labeledAt = 'never'),
      (d: Record<string, any>) => (d.authorship.rulesManifestHash = 'bad'),
      (d: Record<string, any>) => (d.authorship.engineBuildHash = null),
    ]) {
      const draft = approvedCorpus();
      patch(draft as Record<string, any>);
      expect(() => validateExpertPolicyCorpus(draft)).toThrow(
        /lacks attributable bound authorship/,
      );
    }
  });
});
