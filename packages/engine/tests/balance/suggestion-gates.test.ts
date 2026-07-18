/**
 * §B2–B4 — author/campaign modes, gates, exposure ranking. Fixture-driven, no
 * simulations. The whole point of this file: the 2026-07-14 27-edit failure
 * happened because computeSuggestions emitted unguarded prescriptions and
 * applying them made the meta WORSE. These tests pin the gate that must never
 * regress: campaign mode fails CLOSED (no data -> no auto edits), BLOCKED/
 * HUMAN_REWRITE/SIM_REQUIRED always win over AUTO_SAFE, and at most one
 * AUTO_SAFE edit auto-applies per run.
 */
import { describe, expect, it } from 'vitest';
import { assessLoopRisk } from '../../src/balance/loop-graph.js';
import type { Effect } from '../../src/types/effects.js';
import {
  classifyCandidate,
  rankOf,
  selectCampaignEdits,
  playRatesMalformed,
} from '../../balance-gates.mjs';
import { computeSuggestions } from '../../balance-suggestions.mjs';
import { body, card, triggered } from './factory.js';

const onCast = { type: 'on_cast' } as const;

/** Mirrors loop-risk.test.ts's Echoes-shaped fixture: on_cast copy_card,
 * filter matches itself (no excludeSelf, same as the real card). */
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

/** A clean, otherwise-AUTO_SAFE candidate row: narrow interval, flag-free,
 * |Δcost| <= 1, no loop risk, faction direction acceptable. Individual tests
 * override only the field under study. */
function baseCandidate(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    faction: 'Onyx',
    copies: 1,
    edge: 2,
    status: 'over',
    abilityShare: 0,
    costK: 1,
    flags: [] as string[],
    proposedLoopRisk: 'none',
    powerLow: 5,
    powerHigh: 5,
    lo: 4,
    hi: 6,
    ...overrides,
  };
}

describe('§B3 gate 1 — BLOCKED (loop risk likely at proposed values)', () => {
  it('a fixture Echoes-shape whose proposed cut turns risk "likely" is BLOCKED, regardless of anything else', () => {
    const risk = assessLoopRisk([echoesShaped(1)]); // cost cut to 1 -> 'likely' (see loop-risk.test.ts)
    expect(risk.get(94)).toBe('likely');
    const c = baseCandidate({ proposedLoopRisk: risk.get(94) });
    const { classification } = classifyCandidate(c, {});
    expect(classification).toBe('BLOCKED');
  });
});

describe('§B3 gate 3 — faction-direction gates', () => {
  it('nerf while the faction sits below the 45% floor is NOT AUTO_SAFE', () => {
    const c = baseCandidate({ status: 'over', faction: 'Onyx' });
    const { classification } = classifyCandidate(c, { marginals: { Onyx: 44 } });
    expect(classification).not.toBe('AUTO_SAFE');
  });

  it('buff while the faction sits above the 55% ceiling is NOT AUTO_SAFE', () => {
    const c = baseCandidate({ status: 'under', faction: 'Onyx' });
    const { classification } = classifyCandidate(c, { marginals: { Onyx: 56 } });
    expect(classification).not.toBe('AUTO_SAFE');
  });

  it('a mid-pack faction (50%) is AUTO_SAFE when otherwise clean', () => {
    const c = baseCandidate({ status: 'over', faction: 'Onyx' });
    const { classification } = classifyCandidate(c, { marginals: { Onyx: 50 } });
    expect(classification).toBe('AUTO_SAFE');
  });
});

describe('§B3 gate 3 — no-marginals conservatism', () => {
  it('omitting opts.marginals entirely yields zero AUTO_SAFE — no data, no auto edits', () => {
    const c = baseCandidate();
    const { classification } = classifyCandidate(c, {});
    expect(classification).not.toBe('AUTO_SAFE');
    expect(classification).toBe('SIM_REQUIRED');
  });
});

describe('§B3 gate 3 — |Δcost| > 1', () => {
  it('a two-or-more resource re-cost is SIM_REQUIRED even when flag-free', () => {
    const c = baseCandidate({ costK: 2, flags: [] });
    const { classification } = classifyCandidate(c, { marginals: { Onyx: 50 } });
    expect(classification).toBe('SIM_REQUIRED');
  });
});

describe('§B3 gate 3 — interval straddle', () => {
  it('a power interval that straddles the budget window is SIM_REQUIRED', () => {
    // window [4, 6]; powerLow=5 is inside, powerHigh=7 is outside -> straddle
    const c = baseCandidate({ lo: 4, hi: 6, powerLow: 5, powerHigh: 7 });
    const { classification } = classifyCandidate(c, { marginals: { Onyx: 50 } });
    expect(classification).toBe('SIM_REQUIRED');
  });

  it('§R2 — an interval that ENCLOSES the whole window is SIM_REQUIRED (auditor repro: [-10,10] vs [4,6])', () => {
    // The old XOR check tested "is powerLow inside" vs "is powerHigh inside" —
    // both endpoints of [-10,10] test as OUTSIDE the [4,6] window, so XOR was
    // false and this fail-open. A wide interval that swallows the entire
    // window is exactly the case a single point estimate can't be trusted for.
    const c = baseCandidate({ lo: 4, hi: 6, powerLow: -10, powerHigh: 10 });
    const { classification } = classifyCandidate(c, { marginals: { Onyx: 50 } });
    expect(classification).toBe('SIM_REQUIRED');
  });

  it('an interval entirely above the window on an "over" card is clean (not a straddle)', () => {
    const c = baseCandidate({ status: 'over', lo: 4, hi: 6, powerLow: 7, powerHigh: 9 });
    const { classification } = classifyCandidate(c, { marginals: { Onyx: 50 } });
    expect(classification).toBe('AUTO_SAFE');
  });

  it('an interval entirely below the window on an "under" card is clean (not a straddle)', () => {
    const c = baseCandidate({ status: 'under', lo: 4, hi: 6, powerLow: 1, powerHigh: 3 });
    const { classification } = classifyCandidate(c, { marginals: { Onyx: 50 } });
    expect(classification).toBe('AUTO_SAFE');
  });

  it('an interval entirely within the window is clean', () => {
    const c = baseCandidate({ lo: 4, hi: 6, powerLow: 4.5, powerHigh: 5.5 });
    const { classification } = classifyCandidate(c, { marginals: { Onyx: 50 } });
    expect(classification).toBe('AUTO_SAFE');
  });
});

describe('§X2 (round-9) — semantic no-op edits never classify AUTO_SAFE or win the autoEdit slot', () => {
  const noOpSc = {
    id: 50,
    cost: { mana: 0, energy: 0, flexible: 0 },
    stats: { atk: 1, hp: 1, arm: 0 },
  };

  it('an at-minimum-cost under-budget card (lever "(min cost)") is HUMAN_REWRITE, not AUTO_SAFE', () => {
    const c = baseCandidate({
      status: 'under',
      sc: noOpSc,
      after: { static: noOpSc, totalCost: 0, lever: '(min cost)' },
    });
    const { classification, reason } = classifyCandidate(c, { marginals: { Onyx: 50 } });
    expect(classification).toBe('HUMAN_REWRITE');
    expect(reason).toMatch(/minimum cost/i);
  });

  it('the no-op never wins the sole autoEdit slot, even when its exposure rank is highest — a genuine edit elsewhere does', () => {
    const noOp = baseCandidate({
      id: 50,
      status: 'under',
      edge: 100,
      copies: 10,
      sc: noOpSc,
      after: { static: noOpSc, totalCost: 0, lever: '(min cost)' },
    });
    const genuineSc = {
      id: 51,
      cost: { mana: 2, energy: 0, flexible: 0 },
      stats: { atk: 1, hp: 2, arm: 0 },
    };
    const genuineAfterSc = {
      id: 51,
      cost: { mana: 2, energy: 0, flexible: 0 },
      stats: { atk: 1, hp: 3, arm: 0 },
    };
    const genuine = baseCandidate({
      id: 51,
      status: 'under',
      edge: 1,
      copies: 1,
      sc: genuineSc,
      after: { static: genuineAfterSc, totalCost: 2, lever: '+1 HP' },
    });
    const opts = { marginals: { Onyx: 50 } };
    const rows = [noOp, genuine];
    for (const c of rows) {
      const gate = classifyCandidate(c, opts);
      (c as Record<string, unknown>).classification = gate.classification;
      (c as Record<string, unknown>).rank = rankOf(c, opts);
    }
    expect((noOp as Record<string, unknown>).classification).toBe('HUMAN_REWRITE');
    expect((genuine as Record<string, unknown>).classification).toBe('AUTO_SAFE');
    const { autoEdit } = selectCampaignEdits(rows);
    expect(autoEdit?.id).toBe(51); // the genuinely-changed card, never the no-op
  });

  it('a real stat/cost change is NOT treated as a no-op (regression, not over-triggered)', () => {
    const before = {
      id: 52,
      cost: { mana: 1, energy: 0, flexible: 0 },
      stats: { atk: 1, hp: 1, arm: 0 },
    };
    const after = {
      id: 52,
      cost: { mana: 0, energy: 0, flexible: 0 },
      stats: { atk: 1, hp: 1, arm: 0 },
    };
    const c = baseCandidate({
      status: 'under',
      sc: before,
      after: { static: after, totalCost: 0, lever: 'cost −1' },
    });
    const { classification } = classifyCandidate(c, { marginals: { Onyx: 50 } });
    expect(classification).toBe('AUTO_SAFE');
  });
});

describe('§B4 — at most one autoEdit, exposure-ranked candidates', () => {
  it('three otherwise-AUTO_SAFE outliers yield exactly one autoEdit; the rest are ranked candidates', () => {
    const opts = { marginals: { Onyx: 50 }, playRates: { 1: 1, 2: 1, 3: 1 } };
    const rows = [
      baseCandidate({ id: 1, edge: 1, copies: 1 }), // rank 1
      baseCandidate({ id: 2, edge: 2, copies: 3 }), // rank 6 -- should win
      baseCandidate({ id: 3, edge: 1, copies: 2 }), // rank 2
    ];
    for (const c of rows) {
      const gate = classifyCandidate(c, opts);
      (c as Record<string, unknown>).classification = gate.classification;
      (c as Record<string, unknown>).rank = rankOf(c, opts);
      expect(gate.classification).toBe('AUTO_SAFE');
    }
    const { autoEdit, candidates } = selectCampaignEdits(rows);
    expect(autoEdit?.id).toBe(2);
    expect(candidates).toHaveLength(2);
    expect(candidates.map((c: { id: number }) => c.id)).toEqual([3, 1]); // descending rank
  });
});

describe('§T3 (round-5) — malformed playRates: ranking falls back to defaults, auto-edit is suppressed', () => {
  function rankedRows(playRates: Record<string, unknown>) {
    const opts = { marginals: { Onyx: 50 }, playRates };
    const rows = [
      baseCandidate({ id: 1, edge: 1, copies: 1 }),
      baseCandidate({ id: 2, edge: 2, copies: 3 }), // would win on a clean playRates object
      baseCandidate({ id: 3, edge: 1, copies: 2 }),
    ];
    for (const c of rows) {
      const gate = classifyCandidate(c, opts);
      (c as Record<string, unknown>).classification = gate.classification;
      (c as Record<string, unknown>).rank = rankOf(c, opts);
    }
    return { rows, opts };
  }

  const noPlayRatesWinner = (() => {
    const { rows } = rankedRows({ 1: 1, 2: 1, 3: 1 });
    return selectCampaignEdits(rows, { playRates: undefined }).autoEdit?.id;
  })();

  it.each([
    ['string "1000"', { 1: 1, 2: '1000', 3: 1 }],
    ['NaN', { 1: 1, 2: NaN, 3: 1 }],
    ['Infinity', { 1: 1, 2: Infinity, 3: 1 }],
  ])(
    '%s anywhere in playRates: playRatesMalformed() is true, rankOf falls back to 1, and NO auto-edit applies',
    (_label, playRates) => {
      expect(playRatesMalformed(playRates)).toBe(true);

      const { rows, opts } = rankedRows(playRates);
      // rankOf falls back to the default (1) for the malformed entry — never
      // NaN/Infinity/string-coerced into the ranking arithmetic.
      const row2 = rows.find((r) => (r as { id: number }).id === 2)!;
      expect(Number.isFinite((row2 as { rank: number }).rank)).toBe(true);
      expect((row2 as { rank: number }).rank).toBeCloseTo(
        rankOf(row2, { playRates: { 2: 1 } }),
        10,
      );

      const { autoEdit } = selectCampaignEdits(rows, opts);
      // The whole-object fail-closed rule: no production auto-edit at all,
      // even though every row is individually AUTO_SAFE and would otherwise
      // produce the SAME winner (id 2) as the clean-playRates case.
      expect(autoEdit).toBeNull();
      expect(noPlayRatesWinner).toBe(2); // sanity: the clean run DOES pick id 2
    },
  );
});

describe('§B2/F2 — author mode withholds nothing, and never leaks campaign gates', () => {
  it('every outlier gets a full arithmetic suggestion, an informational risk note, no gate classification', () => {
    const data = computeSuggestions({ mode: 'author' });
    const outliers = [...data.over, ...data.under];
    expect(outliers.length).toBeGreaterThan(0);
    for (const c of outliers) {
      expect(c.after).toBeTruthy();
      expect(c.after.static).toBeTruthy();
      // F2 — no gate classifications, no faction gates, no sim directive
      // language leak into author rows.
      expect(c.classification).toBeUndefined();
      expect(c.gateReason).toBeUndefined();
      expect(['none', 'possible', 'likely']).toContain(c.loopRisk);
      expect(['none', 'possible', 'likely']).toContain(c.proposedLoopRisk);
      expect(typeof c.loopRiskNote).toBe('string');
      expect(c.loopRiskNote).not.toMatch(/sim arm|SIM_REQUIRED|HUMAN_REWRITE|BLOCKED/i);
      expect(Array.isArray(c.flags)).toBe(true);
      expect(typeof c.powerLow).toBe('number');
      expect(typeof c.powerHigh).toBe('number');
      expect(['mana', 'energy', 'flexible']).toContain(c.resource);
    }
    // author mode never selects/auto-applies anything
    expect(data.autoEdit).toBeNull();
    expect(data.candidates).toBeNull();
  });

  it('author mode scores the FULL committed pool, not just the 4 starter decks', () => {
    const campaign = computeSuggestions({
      mode: 'campaign',
      marginals: { Onyx: 50, Radiant: 50, Sapphire: 50, Verdant: 50 },
    });
    const author = computeSuggestions({ mode: 'author' });
    expect(author.cards.length).toBeGreaterThan(campaign.cards.length);
  });
});

describe("§F2 — author mode serves the maintainer's new-card authoring workflow", () => {
  it('a brand-new card (id in no deck, no pool) is scored via opts.card, given a cost suggestion, no campaign fields', () => {
    const newCard = body(999999, 'Prototype Behemoth', 5, 5, 0, { rarity: 'Common' });
    const data = computeSuggestions({ mode: 'author', card: newCard });
    const row = [...data.over, ...data.under].find((c) => c.id === 999999);
    expect(row).toBeTruthy();
    expect(row!.status).toBe('over'); // 5/5 vanilla at cost 0 is far over the character budget line
    expect(row!.after).toBeTruthy();
    expect(row!.after.static).toBeTruthy(); // a full cost/stat suggestion, not withheld
    expect(row!.classification).toBeUndefined();
    expect(row!.gateReason).toBeUndefined();
    // A vanilla stat-only body (no abilities) is correctly loop-free — unlike
    // the self-copying spell below, 'none' here is the RIGHT answer, not a
    // default that was never checked.
    expect(row!.loopRisk).toBe('none');
    expect(row!.proposedLoopRisk).toBe('none');
    expect(row!.loopRiskNote).toBe('no loop risk at this cost');
  });

  it('opts.pool lets the maintainer score a candidate set without touching the committed baseline', () => {
    const custom = body(888888, 'Custom Only', 6, 6, 0, { rarity: 'Common' });
    const data = computeSuggestions({ mode: 'author', pool: [custom] });
    expect(data.cards).toHaveLength(1);
    expect(data.cards[0]!.id).toBe(888888);
  });

  it('R12-3: a brand-new cost-0 self-copying spell is NOT a false "none" — the authored card must join the loop pool it is scored against', () => {
    // Same shape as echoesShaped (on_cast copy_card, filter matches itself,
    // no excludeSelf) — assessLoopRisk([card]) alone reports 'likely'.
    const selfCopy: Effect = {
      type: 'copy_card',
      source: 'discard',
      destination: 'hand',
      filter: { tag: 'Arcane', cardType: 'S' },
    };
    const newSpell = card({
      id: 999998,
      name: 'Self-Echo Prototype',
      cardType: 'S',
      rarity: 'Common',
      tags: ['Arcane'],
      cost: { mana: 0, energy: 0, flexible: 0 },
      abilities: [triggered(onCast, [selfCopy])],
    });
    expect(assessLoopRisk([newSpell]).get(999998)).toBe('likely');

    // opts.pool: [] — an empty pool, exactly the author "check a new card"
    // workflow with no other cards to lean on.
    const data = computeSuggestions({ mode: 'author', pool: [], card: newSpell });
    const row = [...data.over, ...data.under].find((c) => c.id === 999998);
    expect(row).toBeTruthy();
    // Before the fix: the authored card was scored but absent from the loop
    // pool assessLoopRisk ran over, so both fields defaulted to 'none' — a
    // false safety answer. The card must see ITSELF as a loop source.
    expect(row!.loopRisk).toBe('likely');
    expect(row!.proposedLoopRisk).not.toBe('none');
    expect(row!.loopRiskNote).toMatch(/loop risk at this cost/);
    expect(row!.loopRiskNote).not.toBe('no loop risk at this cost');
  });
});

describe('§Z1 (round-11 auditor) — generated stat search never proposes HP < 1', () => {
  it('the exact reported probe: a 1/1/2 Mythic Defender no longer gets a −1 HP suggestion (would-be 1/0/2)', () => {
    // Before the fix, dh=-1 (mag 1, HP 1->0) beat dr=-1 (mag 1.3, ARM 2->1) as
    // the lowest-magnitude match, even though computeCardPower(1/0/2) scores
    // 4.2 — exactly inside this window ([1.2, 4.2]) — so it was chosen,
    // classified AUTO_SAFE, and written. The fix must skip the HP<1 option
    // and fall through to the ARM trim instead.
    const probe = body(900001, 'Probe Defender', 1, 1, 2, {
      rarity: 'Mythic',
      cost: { mana: 0, energy: 0, flexible: 0 },
      traits: ['defender'],
      alignment: ['Onyx'],
    });
    const data = computeSuggestions({ mode: 'author', pool: [probe] });
    const row = [...data.over, ...data.under].find((c) => c.id === 900001)!;
    expect(row.status).toBe('over');
    expect(row.statEdit).toBeTruthy();
    expect(row.statEdit!.to).not.toBe('1/0/2');
    expect(row.statEdit!.desc).not.toMatch(/HP/);
    expect(row.statEdit!.to).toBe('1/1/1'); // falls through to the −1 ARM trim
    // Defense in depth: whatever the generator ever proposes, the composed
    // body must never be written with HP < 1.
    expect(row.after.static.stats!.hp).toBeGreaterThanOrEqual(1);
  });

  it('HP=1 boundary control: a trim TO exactly 1 HP remains legal (not over-restricted)', () => {
    const probe = body(900002, 'Probe Defender 2', 1, 2, 2, {
      rarity: 'Common',
      cost: { mana: 2, energy: 0, flexible: 0 },
      traits: ['defender'],
      alignment: ['Onyx'],
    });
    const data = computeSuggestions({ mode: 'author', pool: [probe] });
    const row = [...data.over, ...data.under].find((c) => c.id === 900002)!;
    expect(row.status).toBe('over');
    expect(row.statEdit).toBeTruthy();
    expect(row.statEdit!.desc).toBe('-1 HP');
    expect(row.statEdit!.to).toBe('1/1/2'); // 2 -> 1 is legal, never proposed further down
  });

  it('the generator never proposes any stat edit with HP < 1, over the FULL committed pool', () => {
    const data = computeSuggestions({ mode: 'author' });
    for (const c of [...data.over, ...data.under]) {
      if (!c.statEdit) continue;
      const [, hp] = c.statEdit.to.split('/').map(Number);
      expect(hp).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('§B2/B3 — existing consumers keep working', () => {
  it('computeSuggestions() with no opts still returns the model/cards/over/under shapes balance-compare.mjs relies on', () => {
    const data = computeSuggestions();
    expect(data.model).toBeTruthy();
    expect(Array.isArray(data.cards)).toBe(true);
    expect(Array.isArray(data.over)).toBe(true);
    expect(Array.isArray(data.under)).toBe(true);
    for (const c of data.over) {
      expect(c.after).toBeTruthy();
      expect(typeof c.after.totalCost).toBe('number');
    }
    // default mode is 'campaign' per §B2
    expect(data.mode).toBe('campaign');
  });
});
