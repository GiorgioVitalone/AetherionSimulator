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
import type { StaticCard } from '../../src/balance/types.js';
import { classifyCandidate, primaryResourceKey } from '../../balance-gates.mjs';
import { computeSuggestions } from '../../balance-suggestions.mjs';
import { applyEdits } from '../../balance-apply-edits.mjs';
import { loadBalanceData, loadBudgetModel } from '../../balance-data.mjs';
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
 * §F3 — a TRUE replay of the 27-cost/3-stat, 30-proposal 2026-07-14
 * prescription (certification finding F3). Unlike the tests above (today's
 * RE-DERIVED suggestions run through today's marginals), this section takes
 * the ACTUAL historical costDeltas/statDeltas verbatim (committed fixture),
 * builds each proposed card state by hand, and classifies it through the
 * production gate classifier directly — then separately proves the fixed
 * production `applyEdits` path (F1) would still only ever touch one card.
 */
describe('§F3 — TRUE replay of the 2026-07-14 prescription (verbatim fixture)', () => {
  const fixture = JSON.parse(
    readFileSync(new URL('./fixtures/failed-patch-2026-07-14.json', import.meta.url), 'utf8'),
  ) as {
    costDeltas: Record<string, number>;
    statDeltas: Record<string, { atk?: number; hp?: number; arm?: number }>;
    marginals: Record<string, number>;
  };
  const FACTIONS = ['Onyx', 'Radiant', 'Sapphire', 'Verdant'];
  const totalCost = (sc: StaticCard) => sc.cost.mana + sc.cost.energy + sc.cost.flexible;

  function factionOf(id: number): string {
    for (const f of FACTIONS) if (getDeck(f).mainDeckDefIds.includes(id)) return f;
    return 'Unaligned';
  }
  function applyCostDelta(sc: StaticCard, delta: number): StaticCard {
    const cost = { ...sc.cost };
    const key = primaryResourceKey(cost) as 'mana' | 'energy' | 'flexible';
    cost[key] = Math.max(0, cost[key] + delta);
    return { ...sc, cost };
  }
  function applyStatDelta(
    sc: StaticCard,
    delta: { atk?: number; hp?: number; arm?: number },
  ): StaticCard {
    const stats = sc.stats!;
    return {
      ...sc,
      stats: {
        atk: stats.atk + (delta.atk ?? 0),
        hp: stats.hp + (delta.hp ?? 0),
        arm: stats.arm + (delta.arm ?? 0),
      },
    };
  }

  const { index } = loadBalanceData();
  const model = loadBudgetModel();
  const basePool = [...index.values()];
  // Apply ALL 30 proposals simultaneously — the historical patch's own shape —
  // so loop risk is assessed against the full proposed pool, not one edit at
  // a time.
  const proposedPool = basePool.map((sc) => {
    const cd = fixture.costDeltas[String(sc.id)];
    if (cd != null) return applyCostDelta(sc, cd);
    const sd = fixture.statDeltas[String(sc.id)];
    if (sd != null) return applyStatDelta(sc, sd);
    return sc;
  });
  const proposedRisk = assessLoopRisk(proposedPool);
  const currentRisk = assessLoopRisk(basePool);

  function classifyProposal(id: number, status: 'over' | 'under', costK: number) {
    const sc = index.get(id)!;
    const bd = computeCardPower(sc);
    const exp = model.expectedFor(totalCost(sc), sc.rarity, sc.cardType);
    const tol = model.tolFor(sc.cardType);
    const row = {
      id,
      faction: factionOf(id),
      copies: 1,
      status,
      abilityShare: bd.power > 0 ? bd.abilityValue / bd.power : 0,
      costK,
      flags: bd.flags,
      proposedLoopRisk: proposedRisk.get(id) ?? 'none',
      powerLow: bd.powerLow,
      powerHigh: bd.powerHigh,
      lo: exp - tol,
      hi: exp + tol,
    };
    return classifyCandidate(row, { marginals: fixture.marginals });
  }

  const proposals = [
    ...Object.entries(fixture.costDeltas).map(([id, delta]) => ({
      id: Number(id),
      status: (delta > 0 ? 'over' : 'under') as 'over' | 'under',
      costK: Math.abs(delta),
    })),
    ...Object.entries(fixture.statDeltas).map(([id]) => ({
      id: Number(id),
      status: 'over' as const,
      costK: 0,
    })),
  ];

  it('fixture carries exactly 30 proposals (27 cost + 3 stat)', () => {
    expect(Object.keys(fixture.costDeltas)).toHaveLength(27);
    expect(Object.keys(fixture.statDeltas)).toHaveLength(3);
    expect(proposals).toHaveLength(30);
  });

  it('id94 (Arcane Echoes, -4 cut) classifies BLOCKED or SIM_REQUIRED — never AUTO_SAFE', () => {
    const { classification } = classifyProposal(94, 'under', 4);
    expect(['BLOCKED', 'SIM_REQUIRED']).toContain(classification);
  });

  it('id141 (Master Archivist, -3 cut) classifies BLOCKED or SIM_REQUIRED — never AUTO_SAFE', () => {
    const { classification } = classifyProposal(141, 'under', 3);
    expect(['BLOCKED', 'SIM_REQUIRED']).toContain(classification);
  });

  it('every Radiant nerf in the prescription (58, 47/48/49 trims) is not AUTO_SAFE (marginal 28.0 < 45 floor)', () => {
    const radiantNerfIds = [58, 47, 48, 49];
    for (const id of radiantNerfIds) {
      expect(factionOf(id)).toBe('Radiant');
      const p = proposals.find((x) => x.id === id)!;
      const { classification } = classifyProposal(id, p.status, p.costK);
      expect(classification).not.toBe('AUTO_SAFE');
    }
  });

  it('current-state loop risk sanity: assessLoopRisk resolves for both pools without throwing', () => {
    expect(currentRisk).toBeInstanceOf(Map);
    expect(proposedRisk).toBeInstanceOf(Map);
  });

  it("production applyEdits, fed this run's historical marginals, mutates AT MOST ONE card of the real pool", () => {
    const { raw } = loadBalanceData();
    const result = applyEdits(raw, { mode: 'production', marginals: fixture.marginals });
    expect(result.changes.length).toBeLessThanOrEqual(1);
  });
});
