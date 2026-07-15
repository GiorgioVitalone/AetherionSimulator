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
import { classifyCandidate, rankOf, selectCampaignEdits } from '../../balance-gates.mjs';
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
    expect(typeof row!.loopRiskNote).toBe('string');
  });

  it('opts.pool lets the maintainer score a candidate set without touching the committed baseline', () => {
    const custom = body(888888, 'Custom Only', 6, 6, 0, { rarity: 'Common' });
    const data = computeSuggestions({ mode: 'author', pool: [custom] });
    expect(data.cards).toHaveLength(1);
    expect(data.cards[0]!.id).toBe(888888);
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
