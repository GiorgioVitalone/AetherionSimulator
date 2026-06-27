/**
 * computeDeckValue — sum of card powers (copies with diminishing returns) +
 * consistency (curve + color) + inter-card synergy (capped) + hero synergy.
 * The deck is more than its cards: synergy is a bounded amplifier on real card
 * quality, never the dominant term. See docs/balance-valuation.md.
 */
import type { AbilityDSL } from '../types/ability.js';
import type {
  CardIndex,
  DeckValueBreakdown,
  HeroInput,
  Signal,
  StaticCard,
  CardPowerBreakdown,
} from './types.js';
import { abilityContribution, computeCardPower } from './card-power.js';
import { heroDemands } from './signals.js';
import { deckInterSynergy, pairSynergy, type CardSignals } from './synergy.js';
import { HERO_FLOOR, LP_BASELINE, LP_VALUE, REDUNDANCY_DECAY } from './weights.js';

export interface DeckInput {
  readonly faction: string;
  readonly mainDeckDefIds: readonly number[];
}

const CURVE_PENALTY = 12;
const COLOR_BONUS = 8;
// Target curve fractions by total cost bucket 0..7 (7 = 7+). A smooth, slightly
// low curve; a first-principles template, NOT fit to win rates.
const IDEAL_CURVE: readonly number[] = [0.06, 0.12, 0.2, 0.2, 0.16, 0.12, 0.08, 0.06];

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

/** Value of n copies with diminishing returns: Σ_{k=1..n} (1 - decay)^(k-1). */
function copyFactor(n: number): number {
  let factor = 0;
  let term = 1;
  for (let k = 0; k < n; k++) {
    factor += term;
    term *= 1 - REDUNDANCY_DECAY;
  }
  return factor;
}

interface Distinct {
  readonly card: StaticCard;
  readonly copies: number;
  readonly power: CardPowerBreakdown;
}

function resolveDistinct(deck: DeckInput, index: CardIndex): Distinct[] {
  const counts = new Map<number, number>();
  for (const id of deck.mainDeckDefIds) counts.set(id, (counts.get(id) ?? 0) + 1);
  const out: Distinct[] = [];
  for (const [id, copies] of counts) {
    const card = index.get(id);
    if (card !== undefined) out.push({ card, copies, power: computeCardPower(card) });
  }
  return out;
}

function consistencyScore(distinct: readonly Distinct[], total: number, faction: string): number {
  const buckets = new Array<number>(8).fill(0);
  let onColor = 0;
  for (const d of distinct) {
    const cost = d.card.cost.mana + d.card.cost.energy + d.card.cost.flexible;
    const b = Math.min(cost, 7);
    buckets[b] = (buckets[b] ?? 0) + d.copies;
    if (d.card.alignment.includes(faction)) onColor += d.copies;
  }
  let curveDev = 0;
  for (let b = 0; b <= 7; b++)
    curveDev += Math.abs((buckets[b] ?? 0) / total - (IDEAL_CURVE[b] ?? 0));
  return -CURVE_PENALTY * curveDev + COLOR_BONUS * (onColor / total - 0.5);
}

function heroEngineValue(abilities: readonly AbilityDSL[]): number {
  return abilities.reduce((s, ab) => s + abilityContribution(ab), 0);
}

/** Aggregate every distinct card's provides, scaled by presence (copies/3), so a
 * tribal-dense deck hands the hero a strong matched payoff. */
function aggregateProvides(cards: readonly CardSignals[]): Signal[] {
  const out: Signal[] = [];
  for (const c of cards) {
    const presence = Math.min(c.copies, 3) / 3;
    for (const p of c.provides) out.push({ ...p, weight: p.weight * presence });
  }
  return out;
}

function heroSynergyValue(
  hero: HeroInput,
  deckProvides: readonly Signal[],
): { readonly total: number; readonly lpBaseline: number } {
  const lpBaseline = (hero.lp - LP_BASELINE) * LP_VALUE;
  const engine = heroEngineValue(hero.abilities);
  const match = Math.min(pairSynergy(deckProvides, heroDemands(hero)), 0.5 * Math.max(engine, 1));
  const transform = hero.transform
    ? heroEngineValue(hero.transform.abilities) * 0.4 + hero.transform.lpDelta * 0.6 * LP_VALUE
    : 0;
  return { total: HERO_FLOOR + lpBaseline + engine + match + transform, lpBaseline };
}

export function computeDeckValue(
  deck: DeckInput,
  hero: HeroInput,
  index: CardIndex,
): DeckValueBreakdown {
  const distinct = resolveDistinct(deck, index);
  const total = deck.mainDeckDefIds.length;
  const cardPowerSum = distinct.reduce((s, d) => s + d.power.power * copyFactor(d.copies), 0);
  const consistency = consistencyScore(distinct, total, deck.faction);
  const cardSignals: CardSignals[] = distinct.map((d) => ({
    id: d.card.id,
    name: d.card.name,
    copies: d.copies,
    provides: d.power.provides,
    demands: d.power.demands,
  }));
  const interSynergy = deckInterSynergy(cardSignals, cardPowerSum);
  const hero2 = heroSynergyValue(hero, aggregateProvides(cardSignals));
  const value = cardPowerSum + consistency + interSynergy.capped + hero2.total;
  return {
    faction: deck.faction,
    value: round2(value),
    cardPowerSum: round2(cardPowerSum),
    consistency: round2(consistency),
    interSynergy,
    heroSynergy: round2(hero2.total),
    heroLpBaseline: round2(hero2.lpBaseline),
    perCard: distinct.map((d) => d.power),
  };
}
