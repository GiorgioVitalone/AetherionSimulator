/**
 * Value pilot (GameConfig.valuePilot) — lets the heuristic bot consult the
 * first-principles card-power / synergy engine (src/balance) ON TOP of its existing
 * context-aware heuristics. `computeCardPower` is on the same scale as the bot's
 * atk+hp `power()` but strictly richer (keywords, abilities, intra-card synergy);
 * board + hero inter-card synergy is added as a bounded bonus, so the bot deploys
 * and keeps the cards that actually combo with its board and hero.
 *
 * Pure + deterministic. Memoized by card definition (cardDefId) using BASE stats and
 * PRINTED traits, so a card's intrinsic power and signals are a property of its
 * definition — independent of runtime buffs/damage and of evaluation order.
 */
import type { CardInstance, PlayerState, HeroState } from '../types/game-state.js';
import type { Demand, HeroInput, Signal, StaticCard } from '../balance/index.js';
import {
  computeCardPower,
  emitDemands,
  emitSignals,
  heroDemands,
  pairSynergy,
} from '../balance/index.js';
import { getAllCards } from '../zones/zone-manager.js';

// Inter-card synergy is a bounded amplifier, never a dominant term (mirrors the
// deck-value global cap): the per-deploy board+hero synergy bonus is capped here.
const SYNERGY_BONUS_CAP = 4;

interface CardSignals {
  readonly provides: readonly Signal[];
  readonly demands: readonly Demand[];
}
const powerMemo = new Map<number, number>();
const signalMemo = new Map<number, CardSignals>();

/** Adapt a runtime CardInstance to the context-free StaticCard the balance core
 * consumes. `abilities` are already AbilityDSL; base stats + printed traits keep the
 * view a pure definition property (so it is safe to memoize by cardDefId). */
export function staticFromInstance(card: CardInstance): StaticCard {
  const body = card.cardType === 'C' || card.cardType === 'T';
  return {
    id: card.cardDefId,
    name: card.name,
    cardType: card.cardType,
    cost: card.cost,
    stats: body ? { hp: card.baseHp, atk: card.baseAtk, arm: card.baseArm } : null,
    traits: card.traits,
    ...(card.rushValue !== undefined ? { rushValue: card.rushValue } : {}),
    ...(card.recycleValue !== undefined ? { recycleValue: card.recycleValue } : {}),
    tags: card.tags,
    abilities: card.abilities,
    alignment: card.alignment,
  };
}

/** First-principles intrinsic power (stats + keywords + abilities + intra-card
 * synergy), on the same scale as atk+hp. Memoized by definition. */
export function intrinsicValue(card: CardInstance): number {
  const hit = powerMemo.get(card.cardDefId);
  if (hit !== undefined) return hit;
  const value = computeCardPower(staticFromInstance(card)).power;
  powerMemo.set(card.cardDefId, value);
  return value;
}

function signalsOf(card: CardInstance): CardSignals {
  const hit = signalMemo.get(card.cardDefId);
  if (hit !== undefined) return hit;
  const sc = staticFromInstance(card);
  const sig: CardSignals = { provides: emitSignals(sc), demands: emitDemands(sc) };
  signalMemo.set(card.cardDefId, sig);
  return sig;
}

function heroInput(hero: HeroState): HeroInput {
  return {
    id: hero.cardDefId,
    name: hero.name,
    lp: hero.currentLp,
    abilities: hero.abilities,
    alignment: [],
  };
}

/** Bonus value of adding `card` to `player`'s side: how its signals mesh with the
 * live board bodies and the hero's payoff demands (bidirectional), bounded. */
export function boardHeroSynergy(card: CardInstance, player: PlayerState): number {
  const cand = signalsOf(card);
  const provided: Signal[] = [];
  const wanted: Demand[] = [];
  for (const c of getAllCards(player.zones)) {
    if (c.cardType !== 'C') continue;
    const s = signalsOf(c);
    provided.push(...s.provides);
    wanted.push(...s.demands);
  }
  wanted.push(...heroDemands(heroInput(player.hero)));
  const synergy = pairSynergy(cand.provides, wanted) + pairSynergy(provided, cand.demands);
  return Math.min(synergy, SYNERGY_BONUS_CAP);
}

/** The pilot's value for deploying `card`: intrinsic power + bounded board/hero
 * synergy. Same units as atk+hp, so it slots into the existing deploy ranking. */
export function deployValue(card: CardInstance, player: PlayerState): number {
  return intrinsicValue(card) + boardHeroSynergy(card, player);
}
