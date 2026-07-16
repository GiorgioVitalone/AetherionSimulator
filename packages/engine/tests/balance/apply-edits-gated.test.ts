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
import { applyEdits, classifyProposals } from '../../balance-apply-edits.mjs';
import { computeSuggestions } from '../../balance-suggestions.mjs';
import { loadBalanceData } from '../../balance-data.mjs';
import { rankOf, selectCampaignEdits } from '../../balance-gates.mjs';

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

describe('§Z1 (round-11 auditor) — HP >= 1 floor at the explicit-proposal boundary', () => {
  const MARGINALS_ALL = { Onyx: 50, Radiant: 50, Sapphire: 50, Verdant: 50 };

  it('an explicit proposal that would push HP to 0 is HUMAN_REWRITE, never AUTO_SAFE/written (isolated from the bulk floor)', () => {
    // arm high enough that HP+ARM stays >= MIN_BULK after the cut, so this
    // probe isolates the HP-specific floor, not the pre-existing bulk floor.
    const raw = [
      {
        id: 777001,
        name: 'Synthetic Probe',
        cardType: 'C',
        rarity: 'Common',
        cost: { mana: 1, energy: 0, flexible: 0 },
        stats: { atk: 1, hp: 1, arm: 3 },
        traits: [],
        tags: [],
        alignment: ['Onyx'],
        abilities: [],
      },
    ];
    const rows = classifyProposals(raw, [{ id: 777001, statDelta: { hp: -1 } }], {
      marginals: MARGINALS_ALL,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.classification).toBe('HUMAN_REWRITE');
    expect(rows[0]!.reason).toMatch(/HP 0 below viability floor/);

    const result = applyEdits(raw, {
      mode: 'production',
      marginals: MARGINALS_ALL,
      proposals: [{ id: 777001, statDelta: { hp: -1 } }],
    });
    expect(result.changes).toHaveLength(0);
  });

  it('HP=1 boundary control: an explicit proposal trimming TO exactly HP 1 is not vetoed by the floor', () => {
    const raw = [
      {
        id: 777002,
        name: 'Synthetic Probe 2',
        cardType: 'C',
        rarity: 'Common',
        cost: { mana: 1, energy: 0, flexible: 0 },
        stats: { atk: 1, hp: 2, arm: 3 },
        traits: [],
        tags: [],
        alignment: ['Onyx'],
        abilities: [],
      },
    ];
    const rows = classifyProposals(raw, [{ id: 777002, statDelta: { hp: -1 } }], {
      marginals: MARGINALS_ALL,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.classification).not.toBe('HUMAN_REWRITE');
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

/**
 * §H2-1/H2-2 (2026-07-17 auditor) — the dose contract is integer steps: a
 * fractional costDelta/statDelta component is finite and can compose to
 * |Δcost| <= 1, so it slipped past the costK > 1 gate and got written
 * (repro: id9 Ghoul Marshal cost 3 -> 2.9 via costDelta -0.9; atk +0.5
 * applied). Fixed at BOTH layers: proposalViabilityVeto (classification-time,
 * on both the raw delta AND the composed result) and unwritableReason (the
 * independent write-boundary check).
 */
describe('§H2-1/H2-2 — fractional deltas are never AUTO_SAFE and never applied', () => {
  const GHOUL_MARSHAL_ID = 9; // Onyx, cost 3 mana / 1 ATK / 3 HP

  it.each([
    ['costDelta -0.9', { id: GHOUL_MARSHAL_ID, costDelta: -0.9 }],
    ['costDelta -0.5', { id: GHOUL_MARSHAL_ID, costDelta: -0.5 }],
    ['costDelta -0.99', { id: GHOUL_MARSHAL_ID, costDelta: -0.99 }],
    ['statDelta atk 0.5', { id: GHOUL_MARSHAL_ID, statDelta: { atk: 0.5 } }],
  ])(
    '%s classifies SIM_REQUIRED naming the fractional field, never AUTO_SAFE',
    (_label, proposal) => {
      const { raw } = loadBalanceData();
      const rows = classifyProposals(raw, [proposal], { marginals: MARGINALS });
      expect(rows).toHaveLength(1);
      expect(rows[0]!.classification).toBe('SIM_REQUIRED');
      expect(rows[0]!.classification).not.toBe('AUTO_SAFE');
      expect(rows[0]!.reason).toMatch(/integer/i);
    },
  );

  it.each([
    ['costDelta -0.9', { id: GHOUL_MARSHAL_ID, costDelta: -0.9 }],
    ['statDelta atk 0.5', { id: GHOUL_MARSHAL_ID, statDelta: { atk: 0.5 } }],
  ])('%s is never mechanically applied via applyEdits', (_label, proposal) => {
    const { raw } = loadBalanceData();
    const result = applyEdits(raw, {
      mode: 'production',
      marginals: MARGINALS,
      proposals: [proposal],
    });
    expect(result.changes).toHaveLength(0);
  });

  it('an integer ±1 cost control on the same card is NOT blocked by the fractional-dose gate (whatever else gates it, the reason never mentions "integer")', () => {
    const { raw } = loadBalanceData();
    for (const costDelta of [-1, 1]) {
      const rows = classifyProposals(raw, [{ id: GHOUL_MARSHAL_ID, costDelta }], {
        marginals: MARGINALS,
      });
      expect(rows).toHaveLength(1);
      if (rows[0]!.classification !== 'AUTO_SAFE') {
        expect(rows[0]!.reason).not.toMatch(/dose contract is integer steps/);
      }
    }
  });

  it('an integer ±1 statDelta control on the same card is NOT blocked by the fractional-dose gate', () => {
    const { raw } = loadBalanceData();
    for (const atk of [-1, 1]) {
      const rows = classifyProposals(raw, [{ id: GHOUL_MARSHAL_ID, statDelta: { atk } }], {
        marginals: MARGINALS,
      });
      expect(rows).toHaveLength(1);
      if (rows[0]!.classification !== 'AUTO_SAFE') {
        expect(rows[0]!.reason).not.toMatch(/dose contract is integer steps/);
      }
    }
  });
});

/**
 * §H2-3 (2026-07-17 auditor) — a `proposals` option that isn't an array (a
 * single object instead of a one-element array) used to TypeError deep
 * inside classifyProposals/applyEdits. Both entry points must fail closed:
 * zero rows/zero changes, a recorded reason, never a throw.
 */
describe('§H2-3 — non-array proposals fail closed, never throw', () => {
  it('classifyProposals returns zero rows for a non-array proposals argument', () => {
    const { raw } = loadBalanceData();
    expect(() => classifyProposals(raw, { id: 9, costDelta: -1 } as never)).not.toThrow();
    const rows = classifyProposals(raw, { id: 9, costDelta: -1 } as never);
    expect(rows).toHaveLength(0);
  });

  it('applyEdits applies zero changes and records a reason for a non-array proposals option', () => {
    const { raw } = loadBalanceData();
    expect(() =>
      applyEdits(raw, {
        mode: 'production',
        marginals: MARGINALS,
        proposals: { id: 9, costDelta: -1 } as never,
      }),
    ).not.toThrow();
    const result = applyEdits(raw, {
      mode: 'production',
      marginals: MARGINALS,
      proposals: { id: 9, costDelta: -1 } as never,
    });
    expect(result.changes).toHaveLength(0);
    expect(result.vetoed.some((v: string) => /must be an array/.test(v))).toBe(true);
  });
});

/**
 * §H2-4 (2026-07-17 auditor) — an unknown-id row from classifyProposals
 * ("unknown card id" branch) carries no `edge`/`copies`, so rankOf's
 * Math.abs(undefined) * undefined produced NaN, corrupting
 * selectCampaignEdits' descending sort. rankOf must default missing/
 * non-finite edge/copies to 0 and never return a non-finite rank.
 */
describe('§H2-4 — rankOf never returns NaN on an unknown-id (edge/copies-less) row', () => {
  it('an unknown card id classifies SIM_REQUIRED with no edge/copies, and rankOf on it is a finite 0, not NaN', () => {
    const { raw } = loadBalanceData();
    const rows = classifyProposals(raw, [{ id: 999999999, costDelta: -1 }], {
      marginals: MARGINALS,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.classification).toBe('SIM_REQUIRED');
    expect(rows[0]!.reason).toMatch(/unknown card id/);
    const rank = rankOf(rows[0]!, {});
    expect(Number.isFinite(rank)).toBe(true);
    expect(rank).toBe(0);
  });

  it('a mixed batch (unknown id + a normal candidate row) sorts without NaN corrupting the winner selection', () => {
    const { raw } = loadBalanceData();
    const rows = classifyProposals(
      raw,
      [
        { id: 999999999, costDelta: -1 },
        { id: 9, costDelta: -1 },
      ],
      { marginals: MARGINALS },
    );
    expect(rows).toHaveLength(2);
    for (const r of rows) r.rank = rankOf(r, {});
    expect(rows.every((r: { rank: number }) => Number.isFinite(r.rank))).toBe(true);
    const { autoEdit, candidates } = selectCampaignEdits(rows);
    // neither row is AUTO_SAFE in this fixture, but the point is the sort/
    // selection completes cleanly with no NaN in the candidate list.
    expect(autoEdit).toBeNull();
    expect(candidates.every((c: { rank: number }) => Number.isFinite(c.rank))).toBe(true);
  });
});
