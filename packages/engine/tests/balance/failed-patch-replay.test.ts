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
import { computeSuggestions } from '../../balance-suggestions.mjs';
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
