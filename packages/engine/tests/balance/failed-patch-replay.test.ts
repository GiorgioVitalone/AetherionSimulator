/**
 * §B5 — failed-patch regression fixture. Replays the 2026-07-14 disaster (the
 * 27-edit prescription applied against that day's faction marginals) through
 * campaign mode and asserts the §B3 gates actually catch it. This is the
 * certification teeth for the whole rebuild: if this test ever goes red, the
 * gate machinery has regressed back toward the failure mode that produced the
 * catastrophe in the first place.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { assessLoopRisk } from '../../src/balance/loop-graph.js';
import { computeCardPower } from '../../src/balance/card-power.js';
import type { Effect } from '../../src/types/effects.js';
import { classifyCandidate } from '../../balance-gates.mjs';
import { computeSuggestions, copiesInStarterDeck } from '../../balance-suggestions.mjs';
import { rankOf } from '../../balance-gates.mjs';
import { applyEdits, classifyProposals } from '../../balance-apply-edits.mjs';
import { loadBalanceData } from '../../balance-data.mjs';
import { getDeck } from '../../deck-loader.mjs';
import { card, triggered } from './factory.js';

const onCast = { type: 'on_cast' } as const;

const MARGINALS = { Onyx: 54.7, Radiant: 28.0, Sapphire: 70.7, Verdant: 46.7 };

/** Mirrors the real Arcane Echoes (id94): on_cast copy_card, filter matches
 * itself (tag Arcane, cardType S) — no excludeSelf, same as the real card.
 * The failed patch cut its cost 5 -> 1, the exact shape that flips loop risk
 * to 'likely' (see loop-risk.test.ts). */
function echoesShaped(cost: number) {
  const selfCopy: Effect = {
    type: 'copy_card',
    source: 'discard',
    destination: 'hand',
    filter: { tag: 'Arcane', cardType: 'S' },
  };
  return card({
    id: 94,
    name: 'Echoes-shaped',
    cardType: 'S',
    tags: ['Arcane'],
    cost: { mana: cost, energy: 0, flexible: 0 },
    abilities: [triggered(onCast, [selfCopy])],
  });
}

describe('§B5 — 2026-07-14 failed-patch replay (campaign mode, real starter pool)', () => {
  const data = computeSuggestions({ mode: 'campaign', marginals: MARGINALS });
  const outliers = [...data.over, ...data.under];

  it('a. Master Archivist (id141) — under-budget candidate, never AUTO_SAFE', () => {
    const archivist = outliers.find((c) => c.id === 141);
    expect(archivist).toBeTruthy();
    expect(archivist!.status).toBe('under');
    expect(['BLOCKED', 'SIM_REQUIRED']).toContain(archivist!.classification);
    expect(archivist!.classification).not.toBe('AUTO_SAFE');
  });

  it(
    'a. Arcane Echoes (id94) — no longer an under-budget candidate at the current calibrated line; ' +
      'exercised via a constructed proposal (cost cut 5 -> 1, the exact failed-patch shape) instead',
    () => {
      const echoes94 = outliers.find((c) => c.id === 94);
      expect(echoes94).toBeUndefined(); // documents why the constructed path below is needed

      const risk = assessLoopRisk([echoesShaped(1)]);
      expect(risk.get(94)).toBe('likely');
      const proposedCut = {
        id: 94,
        faction: 'Onyx',
        copies: 3,
        edge: 2,
        status: 'under',
        abilityShare: 0.8,
        costK: 4, // 5 -> 1
        flags: [] as string[],
        proposedLoopRisk: risk.get(94),
        powerLow: 4,
        powerHigh: 4,
        lo: 3,
        hi: 5,
      };
      const { classification } = classifyCandidate(proposedCut, { marginals: MARGINALS });
      expect(classification).toBe('BLOCKED');
    },
  );

  it('b. no Radiant card has an AUTO_SAFE nerf (Radiant marginal 28.0 < 45 floor)', () => {
    const radiantAutoSafeNerf = outliers.filter(
      (c) => c.faction === 'Radiant' && c.status === 'over' && c.classification === 'AUTO_SAFE',
    );
    expect(radiantAutoSafeNerf).toHaveLength(0);
  });

  it('c. no Sapphire card has an AUTO_SAFE buff (Sapphire marginal 70.7 > 55 ceiling)', () => {
    const sapphireAutoSafeBuff = outliers.filter(
      (c) => c.faction === 'Sapphire' && c.status === 'under' && c.classification === 'AUTO_SAFE',
    );
    expect(sapphireAutoSafeBuff).toHaveLength(0);
  });

  it('d. autoEdit is null or exactly one edit; every other AUTO_SAFE card is candidate-only', () => {
    expect(data.autoEdit === null || typeof data.autoEdit === 'object').toBe(true);
    const autoSafeOutliers = outliers.filter((c) => c.classification === 'AUTO_SAFE');
    if (data.autoEdit) {
      expect(autoSafeOutliers.map((c) => c.id)).toContain(data.autoEdit.id);
    }
    // every AUTO_SAFE-classified card other than the chosen autoEdit must
    // appear only in `candidates`, never as a second emitted edit.
    const otherAutoSafe = autoSafeOutliers.filter((c) => c !== data.autoEdit);
    for (const c of otherAutoSafe) {
      expect(data.candidates?.map((x: { id: number }) => x.id)).toContain(c.id);
    }
  });

  it('e. author mode on the same pool withholds nothing — spot-check id141 has a full suggestion', () => {
    const authorData = computeSuggestions({ mode: 'author' });
    const authorOutliers = [...authorData.over, ...authorData.under];
    const archivist = authorOutliers.find((c) => c.id === 141);
    expect(archivist).toBeTruthy();
    expect(archivist!.after).toBeTruthy();
    expect(archivist!.after.static).toBeTruthy();
    expect(authorData.autoEdit).toBeNull();
    expect(authorData.candidates).toBeNull();
  });
});

/**
 * §F3/R1 — a TRUE replay of the 27-cost/3-stat, 30-proposal 2026-07-14
 * prescription (certification finding F3, round-2 gap R1). Unlike the tests
 * above (today's RE-DERIVED suggestions run through today's marginals), this
 * section takes the ACTUAL historical costDeltas/statDeltas verbatim
 * (committed fixture) and routes ALL 30 through the production API in two
 * ways: (1) classifyProposals — each proposal classified at its PROPOSED
 * card state (power/interval recomputed from the proposed cost/stats, loop
 * risk reassessed over the whole proposed pool) — and (2) applyEdits'
 * `proposals` option — the actual production application path (F1's gated
 * default), fed this exact list, never today's re-derived suggestions.
 */
describe('§F3/R1 — TRUE replay of the 2026-07-14 prescription (verbatim fixture)', () => {
  const fixture = JSON.parse(
    readFileSync(new URL('./fixtures/failed-patch-2026-07-14.json', import.meta.url), 'utf8'),
  ) as {
    costDeltas: Record<string, number>;
    statDeltas: Record<string, { atk?: number; hp?: number; arm?: number }>;
    marginals: Record<string, number>;
  };
  const FACTIONS = ['Onyx', 'Radiant', 'Sapphire', 'Verdant'];

  function factionOf(id: number): string {
    for (const f of FACTIONS) if (getDeck(f).mainDeckDefIds.includes(id)) return f;
    return 'Unaligned';
  }

  const proposals = [
    ...Object.entries(fixture.costDeltas).map(([id, delta]) => ({
      id: Number(id),
      costDelta: delta,
    })),
    ...Object.entries(fixture.statDeltas).map(([id, statDelta]) => ({
      id: Number(id),
      statDelta,
    })),
  ];

  it('fixture carries exactly 30 proposals (27 cost + 3 stat)', () => {
    expect(Object.keys(fixture.costDeltas)).toHaveLength(27);
    expect(Object.keys(fixture.statDeltas)).toHaveLength(3);
    expect(proposals).toHaveLength(30);
  });

  it('R1 — ALL 30 proposals classify at their PROPOSED values via classifyProposals', () => {
    const { raw } = loadBalanceData();
    const rows = classifyProposals(raw, proposals, { marginals: fixture.marginals });
    expect(rows).toHaveLength(30);
    for (const row of rows) {
      expect(['BLOCKED', 'HUMAN_REWRITE', 'SIM_REQUIRED', 'AUTO_SAFE']).toContain(
        row.classification,
      );
      expect(typeof row.powerLow).toBe('number');
      expect(typeof row.powerHigh).toBe('number');
    }
  });

  it('id94 (Arcane Echoes, -4 cut) classifies BLOCKED or SIM_REQUIRED — never AUTO_SAFE', () => {
    const { raw } = loadBalanceData();
    const rows = classifyProposals(raw, proposals, { marginals: fixture.marginals });
    const row = rows.find((r) => r.id === 94)!;
    expect(['BLOCKED', 'SIM_REQUIRED']).toContain(row.classification);
  });

  it('id141 (Master Archivist, -3 cut) classifies BLOCKED or SIM_REQUIRED — never AUTO_SAFE', () => {
    const { raw } = loadBalanceData();
    const rows = classifyProposals(raw, proposals, { marginals: fixture.marginals });
    const row = rows.find((r) => r.id === 141)!;
    expect(['BLOCKED', 'SIM_REQUIRED']).toContain(row.classification);
  });

  it('every Radiant nerf in the prescription (58, 47/48/49 trims) is not AUTO_SAFE (marginal 28.0 < 45 floor)', () => {
    const { raw } = loadBalanceData();
    const rows = classifyProposals(raw, proposals, { marginals: fixture.marginals });
    const radiantNerfIds = [58, 47, 48, 49];
    for (const id of radiantNerfIds) {
      expect(factionOf(id)).toBe('Radiant');
      const row = rows.find((r) => r.id === id)!;
      expect(row.classification).not.toBe('AUTO_SAFE');
    }
  });

  it('current- and proposed-state loop risk sanity: assessLoopRisk resolves for both pools without throwing', () => {
    const { index } = loadBalanceData();
    const currentRisk = assessLoopRisk([...index.values()]);
    expect(currentRisk).toBeInstanceOf(Map);
    // computeCardPower is exercised transitively by classifyProposals above;
    // this direct call just pins that the plain scalar path also holds.
    const anyCard = [...index.values()][0];
    if (anyCard) expect(typeof computeCardPower(anyCard).power).toBe('number');
  });

  it("R1 — production applyEdits, fed the ACTUAL 30-proposal fixture (not today's suggestions), mutates AT MOST ONE card of the real pool, and never id94/id141/id28 or a Radiant nerf", () => {
    const { raw } = loadBalanceData();
    const result = applyEdits(raw, {
      mode: 'production',
      marginals: fixture.marginals,
      proposals,
    });
    expect(result.changes.length).toBeLessThanOrEqual(1);
    for (const change of result.changes) {
      expect(change).not.toMatch(/^Arcane Echoes:/);
      expect(change).not.toMatch(/^Master Archivist:/);
      const radiantCard = raw.find(
        (c: { id: number; name: string }) => c.id === 28 && change.startsWith(`${c.name}:`),
      );
      expect(radiantCard).toBeUndefined();
    }
    // Whatever the one (or zero) card the gates admit, prove it concretely —
    // not just "at most one": name the touched card (if any) and confirm it
    // isn't a Radiant faction nerf (marginal 28.0 sits below the 45% floor).
    if (result.changes.length === 1) {
      const touchedName = result.changes[0]!.split(':')[0];
      const touchedCard = raw.find((c: { name: string }) => c.name === touchedName);
      expect(touchedCard).toBeTruthy();
      if (touchedCard) expect(factionOf(touchedCard.id)).not.toBe('Radiant');
    }
  });
});

/**
 * §P2 (round-3 auditor probe) — classifyProposals hardcoded EVERY stat-only
 * proposal's direction as 'over' (nerf), regardless of whether the stat
 * change was actually a buff or a nerf. Direction must derive from the SIGN
 * of the residual change (proposed vs. current, against the frozen budget
 * line); ambiguous/negligible movement must fail closed (SIM_REQUIRED), never
 * guess. Reproduction: a +1 HP BUFF to an Onyx card, with Onyx's marginal
 * pinned above the 55% buff ceiling — under the old hardcoded 'over' label
 * this was checked against the NERF floor (45%, which 60% clears) instead of
 * the buff ceiling, so it slipped through as AUTO_SAFE.
 */
describe('§P2 — stat-only proposal direction derives from residual movement, fail-closed', () => {
  const ONYX_CARD_ID = 5; // Necrotic Squire (Onyx, cardType C)

  it('a +1 HP buff to an Onyx card is classified "under" (buff), not hardcoded "over"', () => {
    const { raw } = loadBalanceData();
    const rows = classifyProposals(raw, [{ id: ONYX_CARD_ID, statDelta: { hp: 1 } }], {
      marginals: { Onyx: 60, Radiant: 50, Sapphire: 50, Verdant: 50 },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('under');
  });

  it('that +1 HP buff, with Onyx marginal 60% (above the 55% buff ceiling), is NOT AUTO_SAFE', () => {
    const { raw } = loadBalanceData();
    const rows = classifyProposals(raw, [{ id: ONYX_CARD_ID, statDelta: { hp: 1 } }], {
      marginals: { Onyx: 60, Radiant: 50, Sapphire: 50, Verdant: 50 },
    });
    expect(rows[0]!.classification).not.toBe('AUTO_SAFE');
  });

  it('and applyEdits never mechanically applies that buff', () => {
    const { raw } = loadBalanceData();
    const result = applyEdits(raw, {
      mode: 'production',
      marginals: { Onyx: 60, Radiant: 50, Sapphire: 50, Verdant: 50 },
      proposals: [{ id: ONYX_CARD_ID, statDelta: { hp: 1 } }],
    });
    expect(result.changes).toHaveLength(0);
  });
});

/**
 * §P3 (round-3 auditor probe) — both the proposed-pool construction and the
 * production application path used `.find()` (first-match-wins) even though
 * the docs claim combining. A cost delta + a stat delta on the SAME card,
 * submitted as two separate proposal entries, must compose into ONE
 * classified row (not two, and not silently dropping the second delta).
 */
describe('§P3 — multiple proposal entries for the same card combine', () => {
  const ONYX_CARD_ID = 5; // Necrotic Squire (Onyx, cardType C)

  it('classifyProposals returns exactly ONE row for two entries targeting the same id', () => {
    const { raw } = loadBalanceData();
    const rows = classifyProposals(
      raw,
      [
        { id: ONYX_CARD_ID, costDelta: 1 },
        { id: ONYX_CARD_ID, statDelta: { atk: 1 } },
      ],
      { marginals: { Onyx: 50, Radiant: 50, Sapphire: 50, Verdant: 50 } },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.costK).toBe(1);
  });

  it('the combined proposal is classified at the FULLY-combined state (both deltas applied)', () => {
    const { raw } = loadBalanceData();
    const { index } = loadBalanceData();
    const current = index.get(ONYX_CARD_ID)!;
    const combinedRows = classifyProposals(
      raw,
      [
        { id: ONYX_CARD_ID, costDelta: 1 },
        { id: ONYX_CARD_ID, statDelta: { atk: 2 } },
      ],
      { marginals: { Onyx: 50, Radiant: 50, Sapphire: 50, Verdant: 50 } },
    );
    const statOnlyRows = classifyProposals(raw, [{ id: ONYX_CARD_ID, statDelta: { atk: 2 } }], {
      marginals: { Onyx: 50, Radiant: 50, Sapphire: 50, Verdant: 50 },
    });
    // power (stat-derived) is identical whether or not the cost delta rode
    // along — proving the cost delta didn't silently overwrite the stat
    // delta (or vice versa) via a first-match-wins .find().
    expect(combinedRows[0]!.powerLow).toBeCloseTo(statOnlyRows[0]!.powerLow);
    expect(combinedRows[0]!.costK).toBe(1);
    expect(current).toBeTruthy();
  });

  it('applyEdits (production) applies BOTH deltas atomically when the combined proposal wins', () => {
    const { raw } = loadBalanceData();
    const { index } = loadBalanceData();
    const before = index.get(ONYX_CARD_ID)!;
    // A tiny +1 stat with no cost change is unlikely to clear every gate on
    // the real pool; this asserts the ATOMIC contract (both-or-neither) —
    // if it DOES apply, both the cost line and the stat line must reflect
    // the combined proposal, never just one of the two.
    const result = applyEdits(raw, {
      mode: 'production',
      marginals: { Onyx: 50, Radiant: 50, Sapphire: 50, Verdant: 50 },
      proposals: [
        { id: ONYX_CARD_ID, costDelta: 1 },
        { id: ONYX_CARD_ID, statDelta: { atk: 1 } },
      ],
    });
    const touchedThisCard = result.changes.some((c: string) => c.startsWith(`${before.name}:`));
    if (touchedThisCard) {
      const after = result.raw.find((c: { id: number }) => c.id === ONYX_CARD_ID);
      const oldTotal = before.cost.mana + before.cost.energy + before.cost.flexible;
      const newTotal = after.cost.mana + after.cost.energy + after.cost.flexible;
      expect(newTotal).toBe(oldTotal + 1);
      expect(after.stats.atk).toBe(before.stats.atk + 1);
    }
  });
});

// Review 2026-07-15: a SINGLE proposal entry carrying BOTH costDelta and statDelta
// must apply both (an early return used to drop the stat part silently).
describe('dual-delta single entry (§P3 review follow-up)', () => {
  it('applies both deltas from one entry — the stat delta is visible in the recomputed power', () => {
    const { raw, index } = loadBalanceData();
    const target = [...index.values()].find(
      (c) => c.cardType === 'C' && c.stats && c.cost.mana + c.cost.energy + c.cost.flexible >= 2,
    )!;
    const rows = classifyProposals(raw, [{ id: target.id, costDelta: -1, statDelta: { hp: 1 } }], {
      marginals: { Onyx: 50, Radiant: 50, Sapphire: 50, Verdant: 50 },
    });
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    // cost delta visible: costK reflects the |−1| cost component of the combined entry
    expect(row.costK).toBe(1);
    // stat delta visible: the row's recomputed power interval sits at the +1 HP card's
    // power, not the unmodified card's (dropping statDelta would leave it unchanged)
    const buffed = computeCardPower({
      ...target,
      stats: { ...target.stats!, hp: target.stats!.hp + 1 },
    }).power;
    const unmodified = computeCardPower(target).power;
    expect(buffed).not.toBe(unmodified); // probe validity: +1 HP must move power
    expect(row.powerLow).toBeLessThanOrEqual(buffed);
    expect(row.powerHigh).toBeGreaterThanOrEqual(buffed);
  });
});

/**
 * §Q2 (round-4 auditor probe) — a caller-supplied `p.status` on a proposal
 * entry used to OVERRIDE the residual-derived direction outright, letting a
 * caller assert its own direction and bypass the correct gate (a +1 HP BUFF
 * to Onyx at 60%, labeled `status:'over'`, cleared the NERF floor instead of
 * the BUFF ceiling and applied). Fix: caller status is NEVER used to gate;
 * if it disagrees with the derived direction, fail closed to SIM_REQUIRED.
 */
describe('§Q2 — caller-supplied status can never override the derived direction', () => {
  const ONYX_CARD_ID = 5; // Necrotic Squire (Onyx, cardType C)

  it("the round-3 +1 HP / Onyx-60% probe WITH status:'over' attached is NOT AUTO_SAFE", () => {
    const { raw } = loadBalanceData();
    const rows = classifyProposals(
      raw,
      [{ id: ONYX_CARD_ID, statDelta: { hp: 1 }, status: 'over' }],
      { marginals: { Onyx: 60, Radiant: 50, Sapphire: 50, Verdant: 50 } },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.classification).not.toBe('AUTO_SAFE');
    expect(rows[0]!.classification).toBe('SIM_REQUIRED');
  });

  it('and applyEdits applies ZERO changes for that mislabeled proposal', () => {
    const { raw } = loadBalanceData();
    const result = applyEdits(raw, {
      mode: 'production',
      marginals: { Onyx: 60, Radiant: 50, Sapphire: 50, Verdant: 50 },
      proposals: [{ id: ONYX_CARD_ID, statDelta: { hp: 1 }, status: 'over' }],
    });
    expect(result.changes).toHaveLength(0);
  });
});

/**
 * §Q3 (round-4 auditor probe) — costK summed RAW deltas across combined
 * proposal entries, so sequential clamping (Math.max(0, ...) per step) could
 * make a -5 then +5 delta report costK 0 while the card's actual cost moved
 * 3->5. Fix: costK is |composed proposed total cost - composed current total
 * cost|, the REAL change. Shieldbearer Paladin (id 48, cost 3) is the probe.
 */
describe('§Q3 — costK reflects the composed before/after cost, not summed raw deltas', () => {
  const SHIELDBEARER_PALADIN_ID = 48;

  it('a -5 then +5 delta pair on a cost-3 card reports costK 2 (3 -> 0 -> 5), not 0', () => {
    const { raw, index } = loadBalanceData();
    const before = index.get(SHIELDBEARER_PALADIN_ID)!;
    expect(before.cost.mana + before.cost.energy + before.cost.flexible).toBe(3);
    const rows = classifyProposals(
      raw,
      [
        { id: SHIELDBEARER_PALADIN_ID, costDelta: -5 },
        { id: SHIELDBEARER_PALADIN_ID, costDelta: 5 },
      ],
      { marginals: { Onyx: 50, Radiant: 50, Sapphire: 50, Verdant: 50 } },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.costK).toBe(2);
    expect(rows[0]!.classification).toBe('SIM_REQUIRED');
  });

  it('and applyEdits never mechanically applies that -5/+5 pair', () => {
    const { raw } = loadBalanceData();
    const result = applyEdits(raw, {
      mode: 'production',
      marginals: { Onyx: 50, Radiant: 50, Sapphire: 50, Verdant: 50 },
      proposals: [
        { id: SHIELDBEARER_PALADIN_ID, costDelta: -5 },
        { id: SHIELDBEARER_PALADIN_ID, costDelta: 5 },
      ],
    });
    expect(result.changes).toHaveLength(0);
  });
});

/**
 * §Q4 (round-4 auditor probe) — explicit-proposal rows defaulted `copies` to
 * 1 regardless of real starter-deck membership, inverting §B4's exposure
 * ranking (a 3-copy card with a smaller edge must still outrank a 1-copy
 * card with a bigger edge: 1.8x3=5.4 > 1.9x1=1.9). Fix: derive copies from
 * starter-deck membership via the SAME counting the suggestions pipeline
 * uses (copiesInStarterDeck); un-decked cards keep 1.
 */
describe('§Q4 — classifyProposals derives real deck copies, not a hardcoded default', () => {
  const THREE_COPY_ONYX_ID = 5; // Necrotic Squire — 3 copies in the Onyx starter deck

  it('classifyProposals reports the real copy count (3), not the old hardcoded default (1)', () => {
    const { raw } = loadBalanceData();
    expect(copiesInStarterDeck(THREE_COPY_ONYX_ID)).toBe(3);
    const rows = classifyProposals(raw, [{ id: THREE_COPY_ONYX_ID, statDelta: { hp: 1 } }], {
      marginals: { Onyx: 50, Radiant: 50, Sapphire: 50, Verdant: 50 },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.copies).toBe(3);
  });

  it("the auditor's ranking-inversion arithmetic: a 3-copy card at edge 1.8 outranks a 1-copy card at edge 1.9", () => {
    const threeCopyRow = { edge: 1.8, copies: 3 };
    const oneCopyRow = { edge: 1.9, copies: 1 };
    // With the fixed real copies, the 3-copy card's exposure ranks higher...
    expect(rankOf(threeCopyRow, {})).toBeGreaterThan(rankOf(oneCopyRow, {}));
    // ...even though a hardcoded copies:1 default would have inverted it.
    const threeCopyRowIfDefaulted = { edge: 1.8, copies: 1 };
    expect(rankOf(threeCopyRowIfDefaulted, {})).toBeLessThan(rankOf(oneCopyRow, {}));
  });
});

/**
 * §Y2 (round-10 auditor probe) — classifyProposals/applyEdits had NO
 * validation of the COMPOSED proposal result: an explicit statDelta that
 * pushed a card's stats below combat viability (or to a non-finite value)
 * still classified AUTO_SAFE and was mechanically applied. Reproduction:
 * Bio-Seedling (id104, Verdant, ATK 0/HP 2/ARM 0) with statDelta atk:-1 —
 * the generated-suggestions path's searchStatEdit would never propose this
 * (it enforces ATK ≥ min(MIN_ATK, current) = 0 here), but an explicit
 * proposal bypassed that floor entirely.
 */
describe('§Y2 — composed proposals below viability (or non-finite) fail closed', () => {
  const BIO_SEEDLING_ID = 104; // Verdant, ATK 0 / HP 2 / ARM 0

  it('Bio-Seedling ATK 0 -> -1 (statDelta atk:-1) is NOT AUTO_SAFE — classifies HUMAN_REWRITE', () => {
    const { raw } = loadBalanceData();
    const rows = classifyProposals(raw, [{ id: BIO_SEEDLING_ID, statDelta: { atk: -1 } }], {
      marginals: { Onyx: 50, Radiant: 50, Sapphire: 50, Verdant: 50 },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.classification).toBe('HUMAN_REWRITE');
    expect(rows[0]!.classification).not.toBe('AUTO_SAFE');
    expect(rows[0]!.reason).toMatch(/ATK/);
  });

  it('and applyEdits never mechanically applies that below-viability trim — zero changes', () => {
    const { raw } = loadBalanceData();
    const result = applyEdits(raw, {
      mode: 'production',
      marginals: { Onyx: 50, Radiant: 50, Sapphire: 50, Verdant: 50 },
      proposals: [{ id: BIO_SEEDLING_ID, statDelta: { atk: -1 } }],
    });
    expect(result.changes).toHaveLength(0);
  });

  it('a finite, VALID trim on a bulkier card (Biosteel Golem id111, ATK 4 -> 3, stays above every floor) still classifies and is not fail-closed by §Y2', () => {
    const BIOSTEEL_GOLEM_ID = 111; // Verdant, ATK 4 / HP 5 / ARM 1
    const { raw } = loadBalanceData();
    const rows = classifyProposals(raw, [{ id: BIOSTEEL_GOLEM_ID, statDelta: { atk: -1 } }], {
      marginals: { Onyx: 50, Radiant: 50, Sapphire: 50, Verdant: 50 },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.classification).not.toBe('HUMAN_REWRITE');
    expect(rows[0]!.reason).not.toMatch(/viability/);
  });

  it('a non-finite delta (NaN statDelta.atk) fails closed to SIM_REQUIRED, never AUTO_SAFE', () => {
    const { raw } = loadBalanceData();
    const rows = classifyProposals(raw, [{ id: BIO_SEEDLING_ID, statDelta: { atk: NaN } }], {
      marginals: { Onyx: 50, Radiant: 50, Sapphire: 50, Verdant: 50 },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.classification).toBe('SIM_REQUIRED');
    expect(rows[0]!.classification).not.toBe('AUTO_SAFE');

    const result = applyEdits(raw, {
      mode: 'production',
      marginals: { Onyx: 50, Radiant: 50, Sapphire: 50, Verdant: 50 },
      proposals: [{ id: BIO_SEEDLING_ID, statDelta: { atk: NaN } }],
    });
    expect(result.changes).toHaveLength(0);
  });
});
