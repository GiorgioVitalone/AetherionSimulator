/**
 * Reach-discard resource math — pure helpers backing the bot's optional
 * "discard-to-reach" policy (GameConfig.reachDiscard).
 *
 * `discard_for_energy` grants exactly +1 *temporary* resource matching the
 * discarded card's type (Mana or Energy), once per turn. So a play that is short
 * by exactly one resource can be funded by pitching a single matching-type card.
 * These functions answer "is this a one-resource reach, and of which type?" — with
 * no value or policy judgement (that lives in the heuristic).
 */
import type { ResourceCost } from '../types/common.js';

export interface ResourcePool {
  readonly mana: number;
  readonly energy: number;
}

/**
 * Mirror of `cost-checker.canAfford` on a plain pool: specific costs are paid from
 * their own type first, then flexible from whatever remains of either type.
 */
export function canAffordPool(pool: ResourcePool, cost: ResourceCost): boolean {
  const remainingMana = pool.mana - cost.mana;
  const remainingEnergy = pool.energy - cost.energy;
  if (remainingMana < 0 || remainingEnergy < 0) return false;
  return remainingMana + remainingEnergy >= cost.flexible;
}

/**
 * The resource type(s) for which adding exactly +1 flips `cost` from unaffordable
 * to affordable, given `pool`. Empty when the cost is already affordable, or needs
 * more than one extra resource — a discard grants only +1, so multi-short plays are
 * out of reach. A flexible-only shortfall returns both types (either funds it).
 */
export function reachAffordTypes(
  pool: ResourcePool,
  cost: ResourceCost,
): readonly ('mana' | 'energy')[] {
  if (canAffordPool(pool, cost)) return [];
  const types: ('mana' | 'energy')[] = [];
  if (canAffordPool({ mana: pool.mana + 1, energy: pool.energy }, cost)) types.push('mana');
  if (canAffordPool({ mana: pool.mana, energy: pool.energy + 1 }, cost)) types.push('energy');
  return types;
}
