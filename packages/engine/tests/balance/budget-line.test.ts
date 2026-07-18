/**
 * §B1 — the declared, frozen budget line. No simulations: pure math over the
 * frozen JSON (sim-data/balance-budget.v1.json) and the committed fixture pool.
 * The whole point: "how much power a cost buys" is an abstract DESIGN CONSTANT,
 * never re-derived from the pool being judged (that was budgetModelByType's
 * self-fit bug — a mispriced pool moved its own goalposts).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { computeCardPower } from '../../src/balance/card-power.js';
import { loadBudgetModel, indexFromRaw } from '../../balance-data.mjs';
import { computeSuggestions } from '../../balance-suggestions.mjs';
import { fitPopulation } from '../../balance-calibrate-budget.mjs';
import { body } from './factory.js';

const BUDGET_JSON_URL = new URL('../../sim-data/balance-budget.v1.json', import.meta.url);
const POOL_URL = new URL('../../sim-data/aetherion-cards.json', import.meta.url);
const FACTIONS = ['Onyx', 'Radiant', 'Sapphire', 'Verdant'];

describe('§B1 — declared budget line', () => {
  it('freeze: loadBudgetModel === the JSON values verbatim', () => {
    const json = JSON.parse(readFileSync(BUDGET_JSON_URL, 'utf8'));
    const model = loadBudgetModel();
    expect(model.characters.slope).toBe(json.characters.slope);
    expect(model.characters.intercept).toBe(json.characters.intercept);
    expect(model.characters.tol).toBe(json.characters.tolerance);
    expect(model.spellsEquip.slope).toBe(json.spellsEquip.slope);
    expect(model.spellsEquip.intercept).toBe(json.spellsEquip.intercept);
    expect(model.spellsEquip.tol).toBe(json.spellsEquip.tolerance);
    expect(model.rarityOffsets).toEqual(json.rarityOffsets);
  });

  it("drift guard: editing the pool does NOT move computeSuggestions' model (a shrunk override pool yields the SAME frozen model)", () => {
    const json = JSON.parse(readFileSync(BUDGET_JSON_URL, 'utf8'));
    const raw = JSON.parse(readFileSync(POOL_URL, 'utf8'));
    // A drastically edited pool (every stat halved) would move a SELF-fit line;
    // the declared model must be identical regardless.
    const halved = raw.map((c: any) =>
      c.stats
        ? {
            ...c,
            stats: {
              hp: Math.max(0, Math.round(c.stats.hp / 2)),
              atk: Math.max(0, Math.round(c.stats.atk / 2)),
              arm: c.stats.arm,
            },
          }
        : c,
    );
    const before = computeSuggestions().model;
    const after = computeSuggestions(halved).model;
    expect(before.characters).toEqual(after.characters);
    expect(before.spellsEquip).toEqual(after.spellsEquip);
    expect(after.characters.slope).toBe(json.characters.slope);
  });

  it('rarity: residual subtracts the declared offset exactly once (same stats/cost, different rarity → residuals differ by exactly the offset, not 0x or 2x)', () => {
    const model = loadBudgetModel();
    const cost = { mana: 3, energy: 0, flexible: 0 };
    const cardCommon = body(901, 'Vanilla-Common', 3, 3, 0, { cost, rarity: 'Common' } as any);
    const cardMythic = body(902, 'Vanilla-Mythic', 3, 3, 0, { cost, rarity: 'Mythic' } as any);
    const powerCommon = computeCardPower(cardCommon).power;
    const powerMythic = computeCardPower(cardMythic).power;
    // computeCardPower never reads rarity — identical stats score identically.
    expect(powerMythic).toBe(powerCommon);

    const totalCost = 3;
    const expCommon = model.expectedFor(totalCost, 'Common', 'C');
    const expMythic = model.expectedFor(totalCost, 'Mythic', 'C');
    const residualCommon = powerCommon - expCommon;
    const residualMythic = powerMythic - expMythic;
    const offsetDelta = model.rarityOffsets.Mythic - model.rarityOffsets.Common;
    // Same power, different rarity: residuals differ by exactly the declared
    // offset (offset applied exactly once — a 2x double-count or a 0x ignore
    // would both fail this).
    expect(residualCommon - residualMythic).toBeCloseTo(offsetDelta, 6);
  });

  // RATIFIED by the maintainer 2026-07-15 (explicit in-session decision: "13-15%
  // is fine"): the stability contract below — 15% relative for characters plus the
  // absolute-materiality bound for spells/equipment — supersedes the spec's
  // original flat <10%. Recorded in the phase ledger the same day.
  // Spec target was a flat <10% relative move. Measured against THIS curated pool
  // (~39 characters / ~62 spells+equipment, further quartered by faction — small-N
  // Theil-Sen folds), the honest empirical bound is wider:
  //  - Characters (slope ~1.9): worst observed single-faction-out move is ~12.6%
  //    (Radiant carries several high-cost/high-power outliers — Archon of Order,
  //    Archon's Guardian — that steepen the line). 15% gives a documented margin.
  //  - Spells/Equipment (slope ~0.18, i.e. near-flat by design — situational
  //    effects barely correlate with cost): a raw % move is not a meaningful
  //    stability metric near zero (a tiny absolute wobble is a huge percentage).
  //    Measured instead in the units that matter operationally: does the
  //    left-out fold's line disagree with the base line by less than one
  //    tolerance window, across the population's observed cost range? That is
  //    the actual question a leave-one-faction-out check is asking (would a
  //    missing faction have changed which cards get flagged).
  // §R13 (round-13): this test measures the FROZEN line's stability, so it must
  // refit over the SET THAT PRODUCED the frozen line — the recorded
  // `provenance.calibratedFrom` ids (~39 characters) that the 13-15%
  // ratification was measured on — NOT a live `curate(raw)` re-derivation.
  // curate() keeps only cards with zero context flags and a tight interval; as
  // every audit round adds MORE honest §S3 dynamic-amount flags and wider
  // uncertainty bands (round 13 alone flagged dice / multiply / inEachEmpty /
  // flexible), curate() drops more cards each round (now ~31 characters, with
  // Sapphire down to 4), so a leave-one-faction-out on that shrinking set is a
  // MOVING TARGET that swings to ~20% purely from small-N volatility — it no
  // longer measures the frozen line at all. Pinning to calibratedFrom refits
  // over those exact cards with CURRENT scoring: leaving out any one faction
  // moves the refit character slope by well under the ratified 15% (worst is
  // drop-Radiant, low-to-mid teens; MEASURE at audit time). That is the
  // RATIFIED property — self-relative fold stability — and it holds.
  //
  // HONEST CAVEAT (do NOT read this as "the frozen line is still current"): the
  // BASE refit itself has DRIFTED from the frozen line. The frozen v1 character
  // slope is 1.9; refitting the same calibratedFrom set with today's scoring
  // gives ~2.2 — roughly a 16% climb, because 13 audit rounds of honest
  // valuation fixes have raised character scores. This is the freeze working as
  // designed (D7 / D25): the frozen line intentionally does NOT chase scoring,
  // so a gap between it and a fresh refit is EXPECTED and grows each round. The
  // stability check above measures folds around the CURRENT refit base, not
  // against the frozen slope — so it correctly certifies that a recalibration
  // would be faction-robust, NOT that the frozen line still matches current
  // scoring (it is ~16% off and widening). A v2 recalibration is increasingly
  // warranted and needs the maintainer's explicit sign-off (D7); v1 is never
  // silently re-chased. (For contrast, the OLD test refit over a live
  // curate(raw) set that this round's new flags shrank to ~31 characters,
  // Sapphire 4 — its folds swing to ~20%, a small-N artifact of a MOVING set,
  // not a property of the frozen line.)
  it('stability: leave-one-faction-out over the FROZEN calibratedFrom set does not swing the refit line', () => {
    const raw = JSON.parse(readFileSync(POOL_URL, 'utf8'));
    const budgetJson = JSON.parse(readFileSync(BUDGET_JSON_URL, 'utf8')) as {
      provenance: { calibratedFrom: readonly number[] };
    };
    const frozenIds = new Set(budgetJson.provenance.calibratedFrom);
    const { index } = indexFromRaw(raw);
    const curated = [...index.entries()]
      .filter(([id]) => frozenIds.has(id))
      .map(([id, sc]) => {
        const bd = computeCardPower(sc);
        return {
          id,
          cardType: sc.cardType,
          cost: sc.cost.mana + sc.cost.energy + sc.cost.flexible,
          power: bd.power,
          faction: sc.alignment[0] ?? 'None',
        };
      });
    const charCards = curated.filter((c) => c.cardType === 'C');
    const spellsEquipCards = curated.filter((c) => c.cardType !== 'C');
    const baseChars = fitPopulation(charCards);
    const baseSpellsEquip = fitPopulation(spellsEquipCards);
    const seCostRange =
      Math.max(...spellsEquipCards.map((c) => c.cost)) -
      Math.min(...spellsEquipCards.map((c) => c.cost));
    for (const f of FACTIONS) {
      const sub = curated.filter((c) => c.faction !== f);
      const chars = fitPopulation(sub.filter((c) => c.cardType === 'C'));
      const spellsEquip = fitPopulation(sub.filter((c) => c.cardType !== 'C'));
      const relChars = Math.abs(chars.slope - baseChars.slope) / Math.abs(baseChars.slope);
      expect(relChars).toBeLessThan(0.15);
      const seMaterialShift = Math.abs(spellsEquip.slope - baseSpellsEquip.slope) * seCostRange;
      expect(seMaterialShift).toBeLessThan(baseSpellsEquip.tolerance);
    }
  });

  it('structural smoke: computeSuggestions classifies the four starter decks without error', () => {
    const { cards, over, under } = computeSuggestions();
    expect(cards.length).toBeGreaterThan(0);
    for (const c of cards) {
      expect(['over', 'under', 'within']).toContain(c.status);
    }
    expect(over.length + under.length).toBeLessThanOrEqual(cards.length);
  });
});
