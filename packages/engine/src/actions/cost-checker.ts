/**
 * Cost Checker — determines resource affordability and deducts costs.
 *
 * Payment priority: specific resources first (mana pays mana, energy pays energy),
 * then flexible resources cover any remaining shortfall from either type.
 */
import type { PlayerState, ResourceCard } from '../types/game-state.js';
import type { ResourceCost } from '../types/common.js';

/** Total available resources (permanent bank + temporary). */
export function getAvailableResources(player: PlayerState): {
  readonly mana: number;
  readonly energy: number;
} {
  let mana = 0;
  let energy = 0;

  for (const rc of player.resourceBank) {
    if (!rc.exhausted) {
      if (rc.resourceType === 'mana') mana++;
      else if (rc.resourceType === 'energy') energy++;
    }
  }

  for (const tmp of player.temporaryResources) {
    if (tmp.resourceType === 'mana') mana += tmp.amount;
    else if (tmp.resourceType === 'energy') energy += tmp.amount;
  }

  return { mana, energy };
}

/** Can the player afford the given cost? */
export function canAfford(player: PlayerState, cost: ResourceCost): boolean {
  const avail = getAvailableResources(player);

  // After paying specific costs, how much of each remains?
  const remainingMana = avail.mana - cost.mana;
  const remainingEnergy = avail.energy - cost.energy;

  // If either specific cost exceeds available, can't afford
  if (remainingMana < 0 || remainingEnergy < 0) return false;

  // Flexible can be paid from either remaining resource
  const totalRemaining = remainingMana + remainingEnergy;
  return totalRemaining >= cost.flexible;
}

/** Deduct cost from player resources. Returns updated PlayerState. Throws if insufficient. */
export function payCost(
  player: PlayerState,
  cost: ResourceCost,
): PlayerState {
  if (!canAfford(player, cost)) {
    throw new Error('Insufficient resources to pay cost');
  }

  let manaNeeded = cost.mana;
  let energyNeeded = cost.energy;
  let flexNeeded = cost.flexible;

  // Exhaust resource bank cards — specific first, then flexible
  const newBank: ResourceCard[] = player.resourceBank.map(rc => {
    if (rc.exhausted) return rc;

    if (rc.resourceType === 'mana' && manaNeeded > 0) {
      manaNeeded--;
      return { ...rc, exhausted: true };
    }
    if (rc.resourceType === 'energy' && energyNeeded > 0) {
      energyNeeded--;
      return { ...rc, exhausted: true };
    }

    return rc;
  });

  // Pay flexible from remaining unexhausted bank cards
  const finalBank: ResourceCard[] = newBank.map(rc => {
    if (rc.exhausted || flexNeeded <= 0) return rc;
    flexNeeded--;
    return { ...rc, exhausted: true };
  });

  // Deduct from temporary resources if bank wasn't enough
  let tempResources = player.temporaryResources;
  if (manaNeeded > 0 || energyNeeded > 0 || flexNeeded > 0) {
    tempResources = tempResources
      .map(tmp => {
        if (tmp.resourceType === 'mana' && manaNeeded > 0) {
          const deduct = Math.min(tmp.amount, manaNeeded);
          manaNeeded -= deduct;
          return { ...tmp, amount: tmp.amount - deduct };
        }
        if (tmp.resourceType === 'energy' && energyNeeded > 0) {
          const deduct = Math.min(tmp.amount, energyNeeded);
          energyNeeded -= deduct;
          return { ...tmp, amount: tmp.amount - deduct };
        }
        if (flexNeeded > 0) {
          const deduct = Math.min(tmp.amount, flexNeeded);
          flexNeeded -= deduct;
          return { ...tmp, amount: tmp.amount - deduct };
        }
        return tmp;
      })
      .filter(tmp => tmp.amount > 0);
  }

  return {
    ...player,
    resourceBank: finalBank,
    temporaryResources: tempResources,
  };
}
