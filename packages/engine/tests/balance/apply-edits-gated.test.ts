/**
 * §F1 — applyEdits gated production default (certification finding F1). The
 * 2026-07-14 disaster happened because applyEdits called campaign suggestions
 * (without marginals!) and applied sug.over/sug.under WHOLESALE — 16
 * SIM_REQUIRED changes, zero vetoes. Fix: the default 'production' mode
 * applies ONLY the single campaign autoEdit (0 or 1 change); the old bulk
 * behavior survives ONLY behind an explicit `mode: 'exploratory'` opt-in.
 * These tests are the certification teeth — they must never go red.
 */
import { describe, expect, it } from 'vitest';
import { applyEdits } from '../../balance-apply-edits.mjs';
import { computeSuggestions } from '../../balance-suggestions.mjs';
import { loadBalanceData } from '../../balance-data.mjs';

const MARGINALS = { Onyx: 50, Radiant: 50, Sapphire: 50, Verdant: 50 };

describe('§F1 — production default applies ONLY the campaign autoEdit', () => {
  it('production + marginals applies exactly the campaign autoEdit (0 or 1 change)', () => {
    const { raw } = loadBalanceData();
    const sug = computeSuggestions({ mode: 'campaign', marginals: MARGINALS });
    const result = applyEdits(raw, { mode: 'production', marginals: MARGINALS });
    expect(result.changes.length).toBeLessThanOrEqual(1);
    if (sug.autoEdit) {
      expect(result.changes).toHaveLength(1);
      expect(result.changes[0]).toContain(sug.autoEdit.sc.name);
    } else {
      expect(result.changes).toHaveLength(0);
    }
  });

  it('production WITHOUT marginals applies zero changes — fail closed', () => {
    const { raw } = loadBalanceData();
    const result = applyEdits(raw, { mode: 'production' });
    expect(result.changes).toHaveLength(0);
  });

  it('SIM_REQUIRED / HUMAN_REWRITE / BLOCKED candidates are never in the applied list', () => {
    const { raw } = loadBalanceData();
    const sug = computeSuggestions({ mode: 'campaign', marginals: MARGINALS });
    const outliers = [...sug.over, ...sug.under];
    const nonAutoSafeIds = new Set(
      outliers.filter((c) => c.classification !== 'AUTO_SAFE').map((c) => c.id),
    );
    const result = applyEdits(raw, { mode: 'production', marginals: MARGINALS });
    for (const change of result.changes) {
      const name = change.split(':')[0];
      const gated = outliers.find((c) => c.sc.name === name && nonAutoSafeIds.has(c.id));
      expect(gated).toBeUndefined();
    }
  });

  it('omitting `mode` entirely defaults to the SAME gated production behavior (throw-free gated default)', () => {
    const { raw } = loadBalanceData();
    const withDefault = applyEdits(raw, {});
    const explicit = applyEdits(raw, { mode: 'production' });
    expect(withDefault.changes).toEqual(explicit.changes);
    expect(withDefault.changes.length).toBeLessThanOrEqual(1);
  });
});

describe('§F1 — exploratory mode is bulk, but requires the explicit opt-in', () => {
  it('mode: "exploratory" applies the full bulk arm (both over + under), unlike production', () => {
    const { raw } = loadBalanceData();
    const result = applyEdits(raw, { mode: 'exploratory', arm: 'all' });
    expect(result.changes.length).toBeGreaterThan(1);
  });

  it('exploratory arm=nerfs / arm=buffs / arm=none select the right sub-lists', () => {
    const { raw } = loadBalanceData();
    const nerfs = applyEdits(raw, { mode: 'exploratory', arm: 'nerfs' });
    const buffs = applyEdits(raw, { mode: 'exploratory', arm: 'buffs' });
    const none = applyEdits(raw, { mode: 'exploratory', arm: 'none' });
    const all = applyEdits(raw, { mode: 'exploratory', arm: 'all' });
    expect(none.changes).toHaveLength(0);
    expect(nerfs.changes.length + buffs.changes.length).toBe(all.changes.length);
  });

  it('an unrecognized mode throws rather than risking a silent bulk apply', () => {
    const { raw } = loadBalanceData();
    expect(() => applyEdits(raw, { mode: 'bogus' })).toThrow();
  });

  it('never mutates the input array (production or exploratory)', () => {
    const { raw } = loadBalanceData();
    const before = JSON.stringify(raw);
    applyEdits(raw, { mode: 'exploratory', arm: 'all' });
    expect(JSON.stringify(raw)).toBe(before);
    applyEdits(raw, { mode: 'production', marginals: MARGINALS });
    expect(JSON.stringify(raw)).toBe(before);
  });
});
