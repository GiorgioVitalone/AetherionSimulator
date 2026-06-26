/**
 * Card resource-type inference — which concrete resource (Mana or Energy) a card
 * is associated with for Discard-for-Energy (Rulebook 11) and Reserve Energy
 * Generation (Rulebook 8, Upkeep step 4). Both rules grant a resource "matching
 * that card's resource type (Magic or Tech)".
 *
 * The card's authored cost is the most direct signal: a cost requiring only Mana
 * is Magic-aligned; only Energy is Tech-aligned. When the cost is ambiguous
 * (flexible-only, hybrid, or free) we fall back to the card's faction alignment —
 * only Verdant is a Tech (Energy) faction in the core set; all others are Magic.
 */
import type { CardInstance } from '../types/game-state.js';

const ENERGY_ALIGNMENTS: ReadonlySet<string> = new Set(['Verdant']);

/** The concrete resource (Mana or Energy) a card is associated with. */
export function cardResourceType(card: CardInstance): 'mana' | 'energy' {
  const { mana, energy } = card.cost;
  if (mana > 0 && energy === 0) return 'mana';
  if (energy > 0 && mana === 0) return 'energy';
  return card.alignment.some(a => ENERGY_ALIGNMENTS.has(a)) ? 'energy' : 'mana';
}
