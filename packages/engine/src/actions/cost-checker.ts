/**
 * Cost Checker — determines resource affordability and deducts costs.
 *
 * Payment priority: specific resources first (mana pays mana, energy pays energy),
 * then flexible resources cover any remaining shortfall from either type.
 */
import type { CardInstance, PlayerState, ResourceCard } from '../types/game-state.js';
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

/** Can the player afford the given cost? Accepts optional xValue for X-cost cards. */
export function canAfford(
  player: PlayerState,
  cost: ResourceCost,
  xValue?: number,
): boolean {
  const avail = getAvailableResources(player);
  const totalAvailable = avail.mana + avail.energy;

  // Flexible flag (0 or 1): when set, the total cost (mana + energy) can be
  // paid with any mix of resources. E.g. {mana:0, energy:3, flexible:1} means
  // 3 total cost payable with any combination of mana and energy.
  if (cost.flexible > 0) {
    const baseCost = cost.mana + cost.energy;
    return totalAvailable >= baseCost;
  }

  // X-cost: base cost + X (X can be 0, so always affordable if base is)
  if (cost.xMana === true || cost.xEnergy === true) {
    const x = xValue ?? 0;
    const totalCost = cost.mana + cost.energy + x;
    return totalAvailable >= totalCost;
  }

  // Standard cost: specific resources first, then remainder
  const remainingMana = avail.mana - cost.mana;
  const remainingEnergy = avail.energy - cost.energy;

  if (remainingMana < 0 || remainingEnergy < 0) return false;

  return true;
}

export function getReducedCardCost(
  player: PlayerState,
  card: Pick<CardInstance, 'cardType' | 'tags' | 'cost'>,
): ResourceCost {
  let totalReduction = 0;

  for (const reduction of player.activeCostReductions) {
    if (
      reduction.appliesTo.cardType !== undefined &&
      reduction.appliesTo.cardType !== card.cardType
    ) {
      continue;
    }
    if (
      reduction.appliesTo.tag !== undefined &&
      !card.tags.includes(reduction.appliesTo.tag)
    ) {
      continue;
    }
    if (reduction.appliesTo.firstPerTurn === true && !isFirstEligiblePlayThisTurn(player, card.cardType)) {
      continue;
    }
    totalReduction += reduction.reduction;
  }

  if (totalReduction <= 0) {
    return card.cost;
  }

  const totalCost = card.cost.mana + card.cost.energy + card.cost.flexible;
  return {
    mana: 0,
    energy: 0,
    flexible: Math.max(0, totalCost - totalReduction),
    ...(card.cost.xMana === true ? { xMana: true } : {}),
    ...(card.cost.xEnergy === true ? { xEnergy: true } : {}),
  };
}

/** Maximum X value a player can afford for an X-cost card. */
export function computeMaxX(player: PlayerState, cost: ResourceCost): number {
  const avail = getAvailableResources(player);
  const totalAvailable = avail.mana + avail.energy;
  const baseCost = cost.mana + cost.energy;
  return Math.max(0, totalAvailable - baseCost);
}

/** Deduct cost from player resources. Returns updated PlayerState. Throws if insufficient. */
export function payCost(
  player: PlayerState,
  cost: ResourceCost,
  xValue?: number,
): PlayerState {
  if (!canAfford(player, cost, xValue)) {
    throw new Error('Insufficient resources to pay cost');
  }

  // Flexible flag: total cost payable with any resource mix
  if (cost.flexible > 0) {
    const totalNeeded = cost.mana + cost.energy;
    return exhaustAnyResources(player, totalNeeded);
  }

  // X-cost: base + X in any mix
  if ((cost.xMana === true || cost.xEnergy === true) && xValue !== undefined) {
    const totalNeeded = cost.mana + cost.energy + xValue;
    return exhaustAnyResources(player, totalNeeded);
  }

  let manaNeeded = cost.mana;
  let energyNeeded = cost.energy;

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

  // Deduct from temporary resources if bank wasn't enough
  let tempResources = player.temporaryResources;
  if (manaNeeded > 0 || energyNeeded > 0) {
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
        return tmp;
      })
      .filter(tmp => tmp.amount > 0);
  }

  return {
    ...player,
    resourceBank: newBank,
    temporaryResources: tempResources,
  };
}

/** Exhaust any available resources totaling the given amount. */
function exhaustAnyResources(
  player: PlayerState,
  totalNeeded: number,
): PlayerState {
  let remaining = totalNeeded;

  const newBank: ResourceCard[] = player.resourceBank.map(rc => {
    if (rc.exhausted || remaining <= 0) return rc;
    remaining--;
    return { ...rc, exhausted: true };
  });

  let tempResources = player.temporaryResources;
  if (remaining > 0) {
    tempResources = tempResources
      .map(tmp => {
        if (remaining <= 0) return tmp;
        const deduct = Math.min(tmp.amount, remaining);
        remaining -= deduct;
        return { ...tmp, amount: tmp.amount - deduct };
      })
      .filter(tmp => tmp.amount > 0);
  }

  return {
    ...player,
    resourceBank: newBank,
    temporaryResources: tempResources,
  };
}

function isFirstEligiblePlayThisTurn(
  player: PlayerState,
  cardType: CardInstance['cardType'],
): boolean {
  switch (cardType) {
    case 'S':
      return player.turnCounters.spellsCast === 0;
    case 'E':
      return player.turnCounters.equipmentPlayed === 0;
    case 'C':
      return player.turnCounters.charactersDeployed === 0;
    default:
      return false;
  }
}
