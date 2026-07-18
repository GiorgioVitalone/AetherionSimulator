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
import { rankOf, selectCampaignEdits, playRatesMalformed } from '../../balance-gates.mjs';

const MARGINALS = { Onyx: 50, Radiant: 50, Sapphire: 50, Verdant: 50 };

describe('§R14-1 — a dice-derived TARGET COUNT widens the interval, blocking an unsafe AUTO_SAFE', () => {
  it('Arcane Barrage (id 139, "2 dmg to 1d4 targets") no longer AUTO_SAFEs a cost cut — its widened interval straddles the window', () => {
    // Round-14 auditor: the dice target-count was priced at a single point
    // (interval [4,4]), so a costDelta:-1 slipped through AUTO_SAFE and applied.
    // With the count widened to [2,5], the interval straddles the budget window
    // -> SIM_REQUIRED, never applied.
    const { raw } = loadBalanceData();
    const rows = classifyProposals(raw, [{ id: 139, costDelta: -1 }], { marginals: MARGINALS });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.classification).not.toBe('AUTO_SAFE');
    expect(rows[0]!.reason).toMatch(/straddle/i);

    const result = applyEdits(raw, {
      mode: 'production',
      marginals: MARGINALS,
      proposals: [{ id: 139, costDelta: -1 }],
    });
    expect(result.changes).toHaveLength(0);
  });
});

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

/**
 * §R12-1 (fresh-auditor fix, 2026-07-18) — two confirmed fail-OPEN paths:
 * (a) `proposalViabilityVeto`'s gate was `Number.isFinite(v) && !Number.isInteger(v)`
 *     — a BOOLEAN fails `Number.isFinite` too, so the whole check was false and
 *     `{ id: 78, costDelta: true }` was NOT rejected; JS then coerced
 *     `true -> 1` in the cost arithmetic and Crystal Golem's cost went 3 -> 4
 *     via AUTO_SAFE. (b) `applyEdits`'s `if (proposals)` treated an explicitly
 *     supplied `proposals: false | '' | 0` as OMITTED, silently falling
 *     through to the generated-suggestions auto-apply path instead of failing
 *     closed on a malformed-but-supplied container.
 */
describe('§R12-1 — malformed proposals fail CLOSED, never open', () => {
  const CRYSTAL_GOLEM_ID = 78; // Sapphire, cost 3 mana / 1 ATK / 3 HP

  it('costDelta: true (boolean) classifies SIM_REQUIRED, never AUTO_SAFE, and is never applied', () => {
    const { raw } = loadBalanceData();
    const rows = classifyProposals(raw, [{ id: CRYSTAL_GOLEM_ID, costDelta: true }], {
      marginals: MARGINALS,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.classification).toBe('SIM_REQUIRED');
    expect(rows[0]!.classification).not.toBe('AUTO_SAFE');
    expect(rows[0]!.reason).toMatch(/integer/i);

    const result = applyEdits(raw, {
      mode: 'production',
      marginals: MARGINALS,
      proposals: [{ id: CRYSTAL_GOLEM_ID, costDelta: true }],
    });
    expect(result.changes).toHaveLength(0);
  });

  it('statDelta: true (boolean, not an object) classifies SIM_REQUIRED, never AUTO_SAFE', () => {
    const { raw } = loadBalanceData();
    const rows = classifyProposals(raw, [{ id: CRYSTAL_GOLEM_ID, statDelta: true }] as never, {
      marginals: MARGINALS,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.classification).toBe('SIM_REQUIRED');
    expect(rows[0]!.reason).toMatch(/integer/i);
  });

  it('a boxed Number costDelta (`new Number(-1)`) classifies SIM_REQUIRED, never AUTO_SAFE', () => {
    const { raw } = loadBalanceData();
    const boxed = new Number(-1); // deliberately a boxed Number, not a primitive — the malformed input under test
    const rows = classifyProposals(raw, [{ id: CRYSTAL_GOLEM_ID, costDelta: boxed }] as never, {
      marginals: MARGINALS,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.classification).toBe('SIM_REQUIRED');
    expect(rows[0]!.reason).toMatch(/integer/i);
  });

  it('a null entry sharing the proposals array never throws and applies zero changes', () => {
    const { raw } = loadBalanceData();
    expect(() => classifyProposals(raw, [null] as never)).not.toThrow();
    expect(classifyProposals(raw, [null] as never)).toHaveLength(0);

    expect(() =>
      applyEdits(raw, { mode: 'production', marginals: MARGINALS, proposals: [null] as never }),
    ).not.toThrow();
    const result = applyEdits(raw, {
      mode: 'production',
      marginals: MARGINALS,
      proposals: [null] as never,
    });
    expect(result.changes).toHaveLength(0);
  });

  it.each([
    ['false', false],
    ['empty string', ''],
    ['zero', 0],
  ])(
    'proposals: %s (supplied but non-array) applies ZERO changes — distinct from omitting `proposals`',
    (_label, proposals) => {
      const { raw } = loadBalanceData();
      const result = applyEdits(raw, {
        mode: 'production',
        marginals: MARGINALS,
        proposals: proposals as never,
      });
      expect(result.changes).toHaveLength(0);
      expect(result.vetoed.some((v: string) => /must be an array/.test(v))).toBe(true);
    },
  );

  it('a valid integer proposal on the same card still classifies and applies normally (control)', () => {
    const { raw } = loadBalanceData();
    const rows = classifyProposals(raw, [{ id: CRYSTAL_GOLEM_ID, costDelta: -1 }], {
      marginals: MARGINALS,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.reason).not.toMatch(/dose contract is integer steps/);
  });
});

/**
 * §R12-2 (fresh-auditor fix, 2026-07-18) — the ±1 dose discipline was
 * enforced for COST (`costK > 1`, balance-gates.mjs) but had no equivalent
 * cap on stat deltas: an explicit `statDelta: { hp: -2 }` classified
 * AUTO_SAFE even though `{ hp: -1 }` alone already succeeds, and same-card
 * entries ACCUMULATE (applyAllProposals composes them before classification),
 * so two `{ hp: -1 }` entries silently compose to -2 with the same gap.
 * Fix: `statK` — §R12-2b (round-12 re-review): the SUM of absolute per-stat
 * deltas across hp/atk/arm (each touched stat is one dose). The first fix used
 * a per-axis MAX, so a two-stat edit like { hp: -1, atk: -1 } scored statK 1
 * and slipped the gate while the analogous two-axis cost move (costK 2) was
 * blocked. Summing forces SIM_REQUIRED once the total |Δstat| across stats > 1.
 */
describe('§R12-2 — |Δstat| > 1 is never AUTO_SAFE, mirroring the |Δcost| > 1 dose cap', () => {
  const STABLE_DOSE_ID = 11; // §R15-1: Zombie Horde — a STABLE (no board-wide effect) card whose single -1 HP trim is AUTO_SAFE, so the dose gate (not a straddle) decides. id 51 now has a widened all_characters interval and straddles for any edit.

  it('an explicit statDelta: { hp: -2 } classifies SIM_REQUIRED naming |Δstat|, never AUTO_SAFE', () => {
    const { raw } = loadBalanceData();
    const rows = classifyProposals(raw, [{ id: STABLE_DOSE_ID, statDelta: { hp: -2 } }], {
      marginals: MARGINALS,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.classification).toBe('SIM_REQUIRED');
    expect(rows[0]!.reason).toMatch(/\|Δstat\| = 2 > 1/);

    const result = applyEdits(raw, {
      mode: 'production',
      marginals: MARGINALS,
      proposals: [{ id: STABLE_DOSE_ID, statDelta: { hp: -2 } }],
    });
    expect(result.changes).toHaveLength(0);
  });

  it('two ACCUMULATED { hp: -1 } entries on the same card compose to -2 and classify SIM_REQUIRED', () => {
    const { raw } = loadBalanceData();
    const rows = classifyProposals(
      raw,
      [
        { id: STABLE_DOSE_ID, statDelta: { hp: -1 } },
        { id: STABLE_DOSE_ID, statDelta: { hp: -1 } },
      ],
      { marginals: MARGINALS },
    );
    expect(rows).toHaveLength(1); // §P3: classified ONCE at the combined state
    expect(rows[0]!.classification).toBe('SIM_REQUIRED');
    expect(rows[0]!.reason).toMatch(/\|Δstat\| = 2 > 1/);
  });

  it('a single { hp: -1 } on the same card is still AUTO_SAFE (control — the ±1 dose is not over-restricted)', () => {
    const { raw } = loadBalanceData();
    const rows = classifyProposals(raw, [{ id: STABLE_DOSE_ID, statDelta: { hp: -1 } }], {
      marginals: MARGINALS,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.classification).toBe('AUTO_SAFE');
  });

  it('§R12-2b: a two-stat { hp: -1, atk: -1 } edit is a 2-unit dose and classifies SIM_REQUIRED (per-axis MAX would have passed it AUTO_SAFE)', () => {
    // The round-12 re-review (Kimi K3) showed the original per-axis-max statK
    // let a combined two-stat edit through: max(1,1,0) = 1 <= 1 -> AUTO_SAFE and
    // auto-applied a 2-power-point nerf, while the analogous two-axis cost move
    // (costK = |Δtotal| = 2) is blocked. Sum-of-|Δ| = 1 + 1 = 2 -> SIM_REQUIRED.
    const { raw } = loadBalanceData();
    const rows = classifyProposals(raw, [{ id: STABLE_DOSE_ID, statDelta: { hp: -1, atk: -1 } }], {
      marginals: MARGINALS,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.classification).toBe('SIM_REQUIRED');
    expect(rows[0]!.reason).toMatch(/\|Δstat\| = 2 > 1/);

    const result = applyEdits(raw, {
      mode: 'production',
      marginals: MARGINALS,
      proposals: [{ id: STABLE_DOSE_ID, statDelta: { hp: -1, atk: -1 } }],
    });
    expect(result.changes).toHaveLength(0);
  });
});

/**
 * §R13-4 (round-13 auditor) — a faction win rate outside [0,100] is DOMAIN-invalid
 * (structurally impossible), not merely dishonest-but-valid evidence (the D21 trust
 * boundary). The gate previously rejected only non-finite marginals, so a Verdant:-1 or
 * Radiant:101 slipped through and silently defeated the faction-direction protection. The
 * whole marginals object must now fail closed if ANY supplied value is non-finite OR out of
 * [0,100].
 */
describe('§R13-4 — out-of-[0,100] marginals fail CLOSED, never AUTO_SAFE', () => {
  const STABLE_DOSE_ID = 11; // §R15-1: stable, no board-wide widening

  it.each([
    ['a negative marginal (Verdant:-1)', { Onyx: 50, Radiant: 50, Sapphire: 50, Verdant: -1 }],
    ['an over-100 marginal (Radiant:101)', { Onyx: 50, Radiant: 101, Sapphire: 50, Verdant: 50 }],
  ])(
    '%s makes the whole marginals object fail closed — a single-unit trim is not AUTO_SAFE',
    (_label, marginals) => {
      const { raw } = loadBalanceData();
      const rows = classifyProposals(raw, [{ id: STABLE_DOSE_ID, statDelta: { hp: -1 } }], {
        marginals,
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]!.classification).not.toBe('AUTO_SAFE');
      expect(rows[0]!.reason).toMatch(/outside \[0,100\]|non-finite|invalid value/);

      const result = applyEdits(raw, {
        mode: 'production',
        marginals,
        proposals: [{ id: STABLE_DOSE_ID, statDelta: { hp: -1 } }],
      });
      expect(result.changes).toHaveLength(0);
    },
  );

  it('control: the same trim with all marginals in [0,100] is still AUTO_SAFE', () => {
    const { raw } = loadBalanceData();
    const rows = classifyProposals(raw, [{ id: STABLE_DOSE_ID, statDelta: { hp: -1 } }], {
      marginals: MARGINALS,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.classification).toBe('AUTO_SAFE');
  });
});

describe('§R15-1 — board-wide/up_to cardinality widens the interval, blocking unsafe AUTO_SAFE cuts', () => {
  it('Celestial Aegis (id 72, heal-all) — the all_characters interval spans [0, capacity] and straddles → SIM_REQUIRED, not AUTO_SAFE', () => {
    const { raw } = loadBalanceData();
    const rows = classifyProposals(raw, [{ id: 72, costDelta: -1 }], { marginals: MARGINALS });
    expect(rows[0]!.classification).not.toBe('AUTO_SAFE');
    const result = applyEdits(raw, {
      mode: 'production',
      marginals: MARGINALS,
      proposals: [{ id: 72, costDelta: -1 }],
    });
    expect(result.changes).toHaveLength(0);
  });

  it('Chain Lightning (id 89, up_to) — realized 0..N targets (minSelections:0) widen the interval → SIM_REQUIRED', () => {
    const { raw } = loadBalanceData();
    const rows = classifyProposals(raw, [{ id: 89, costDelta: -1 }], { marginals: MARGINALS });
    expect(rows[0]!.classification).not.toBe('AUTO_SAFE');
  });
});

describe('§R15-3 — prototyped/exotic evidence fails CLOSED (inherited properties cannot be trusted)', () => {
  it('a marginals object with a poisoned PROTOTYPE (no own keys) is rejected — Object.create({Onyx:101}) never AUTO_SAFE', () => {
    // id 11 is AUTO_SAFE for a single {hp:-1} with a plain [0,100] marginals
    // object (the R13-4 control), so the ONLY thing flipping it here is the
    // prototype poisoning — the guard is the deciding factor.
    const { raw } = loadBalanceData();
    const poisoned = Object.create({ Onyx: 101 });
    const rows = classifyProposals(raw, [{ id: 11, statDelta: { hp: -1 } }], {
      marginals: poisoned,
    });
    expect(rows[0]!.classification).not.toBe('AUTO_SAFE');
    expect(rows[0]!.reason).toMatch(/prototyped|exotic|not a plain/i);
    const result = applyEdits(raw, {
      mode: 'production',
      marginals: poisoned,
      proposals: [{ id: 11, statDelta: { hp: -1 } }],
    });
    expect(result.changes).toHaveLength(0);
  });

  it('a statDelta with a poisoned PROTOTYPE (Object.create({hp:true})) is rejected — the inherited boolean cannot coerce to a written stat', () => {
    const { raw } = loadBalanceData();
    const rows = classifyProposals(raw, [{ id: 143, statDelta: Object.create({ hp: true }) }], {
      marginals: MARGINALS,
    });
    expect(rows[0]!.classification).not.toBe('AUTO_SAFE');
    expect(rows[0]!.reason).toMatch(/plain object|integer/i);
  });
});

describe('§R15-2 — §B4 exposure ranks on |power − expected| × copies × play-rate (residual), not the tolerance-window edge', () => {
  it('a card 1.55 off the line at 2 copies outranks one 1.65 off at 1 copy — the residual×copies product, which the old edge formula (0 for a within-window card) inverted', () => {
    // Auditor's concrete inversion: Celestial-shaped (residual 1.55, 2 copies,
    // edge 0 because within the tolerance window) vs Uriel-shaped (residual
    // 1.65, 1 copy). Contract rank: 3.10 vs 1.65. Old edge rank: 0 vs ~0.2 —
    // inverted. rankOf must use residual.
    const celestial = { id: 1, residual: 1.55, copies: 2, edge: 0 };
    const uriel = { id: 2, residual: 1.65, copies: 1, edge: 0.2 };
    expect(rankOf(celestial, {})).toBeCloseTo(3.1, 5);
    expect(rankOf(uriel, {})).toBeCloseTo(1.65, 5);
    expect(rankOf(celestial, {})).toBeGreaterThan(rankOf(uriel, {}));
  });

  it('play-rate scales the residual exposure', () => {
    const c = { id: 7, residual: 2, copies: 3, edge: 0 };
    expect(rankOf(c, { playRates: { 7: 0.5 } })).toBeCloseTo(3, 5); // 2 × 3 × 0.5
  });
});

describe('§R15-3b — a prototyped playRates object is treated as malformed (parity with marginals/statDelta)', () => {
  it('Object.create({7:1e6}) is malformed — the inherited rate cannot silently inflate a rank', () => {
    expect(playRatesMalformed(Object.create({ 7: 1e6 }))).toBe(true);
    // a plain object and a null-proto object are fine
    expect(playRatesMalformed({ 7: 0.5 })).toBe(false);
    const np = Object.create(null);
    np[7] = 0.5;
    expect(playRatesMalformed(np)).toBe(false);
  });
});
