/**
 * §B5 — failed-patch regression fixture. Replays the 2026-07-14 disaster (the
 * 27-edit prescription applied against that day's faction marginals) through
 * campaign mode and asserts the §B3 gates actually catch it. This is the
 * certification teeth for the whole rebuild: if this test ever goes red, the
 * gate machinery has regressed back toward the failure mode that produced the
 * catastrophe in the first place.
 */
import { describe, expect, it } from 'vitest';
import { assessLoopRisk } from '../../src/balance/loop-graph.js';
import type { Effect } from '../../src/types/effects.js';
import { classifyCandidate } from '../../balance-gates.mjs';
import { computeSuggestions } from '../../balance-suggestions.mjs';
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
