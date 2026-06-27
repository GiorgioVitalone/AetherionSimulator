/**
 * Assemble a card's Signals (what it offers) and Demands (what it wants),
 * tagging each with its `source` (trait / ability index) so intra-card synergy
 * can require the provide and demand to come from DIFFERENT sources.
 */
import type { AbilityDSL } from '../types/ability.js';
import type { Demand, HeroInput, Signal, StaticCard } from './types.js';
import {
  conditionDemands,
  effectDemands,
  effectProvides,
  flattenEffects,
  triggerDemands,
} from './signal-extract.js';

function cardLevelProvides(card: StaticCard): Signal[] {
  const out: Signal[] = [];
  const s = card.stats;
  if (card.cardType === 'C' && s) {
    out.push({ kind: 'body', weight: Math.max(1, s.atk + s.hp), source: 'stats' });
    if (card.traits.includes('defender')) {
      out.push({ kind: 'wall', weight: Math.max(1, s.hp + s.arm), source: 'trait:defender' });
    }
  }
  if (card.cardType === 'S') out.push({ kind: 'spell_cast', weight: 1, source: 'card' });
  if (card.cardType === 'E') out.push({ kind: 'equipment', weight: 1, source: 'card' });
  for (const tag of card.tags) {
    out.push({ kind: 'tag', weight: 1, tag, source: `tag:${tag}` });
    if (card.cardType === 'C')
      out.push({ kind: 'death_trigger', weight: 1, tag, source: `tag:${tag}` });
  }
  return out;
}

function cardLevelDemands(card: StaticCard): Demand[] {
  const out: Demand[] = [];
  const s = card.stats;
  if (s && card.traits.includes('defender')) {
    out.push({
      kind: 'wall_to_sustain',
      weight: Math.max(1, s.hp + s.arm),
      source: 'trait:defender',
    });
  }
  if (card.cardType === 'E') out.push({ kind: 'attach_target', weight: 2, source: 'card' });
  return out;
}

function abilityProvides(ab: AbilityDSL, idx: number): Signal[] {
  const source = `ability:${String(idx)}`;
  if (ab.type === 'stat_grant') {
    const gain = (ab.modifier.atk ?? 0) + (ab.modifier.hp ?? 0) + (ab.modifier.arm ?? 0);
    return [{ kind: 'buff', weight: Math.max(1, gain), source }];
  }
  return flattenEffects(ab.effects)
    .flatMap(effectProvides)
    .map((p) => ({ ...p, source }));
}

function abilityDemands(ab: AbilityDSL, idx: number): Demand[] {
  const source = `ability:${String(idx)}`;
  if (ab.type === 'stat_grant') return [];
  const specs = [
    ...(ab.type === 'triggered' ? triggerDemands(ab.trigger) : []),
    ...(ab.condition ? conditionDemands(ab.condition) : []),
    ...flattenEffects(ab.effects).flatMap(effectDemands),
  ];
  return specs.map((d) => ({ ...d, source }));
}

export function emitSignals(card: StaticCard): Signal[] {
  return [...cardLevelProvides(card), ...card.abilities.flatMap(abilityProvides)];
}

export function emitDemands(card: StaticCard): Demand[] {
  return [...cardLevelDemands(card), ...card.abilities.flatMap(abilityDemands)];
}

/** A hero is a payoff engine: its abilities' demands define what the deck wants
 * to supply (Kaelthar → death_of_tag{Undead}, Lyria → spell_density + large_hand). */
export function heroDemands(hero: HeroInput): Demand[] {
  return hero.abilities.flatMap(abilityDemands);
}
