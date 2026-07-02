/**
 * Cost Checker — determines resource affordability and deducts costs.
 *
 * Payment priority: specific resources first (mana pays mana, energy pays energy),
 * then flexible resources cover any remaining shortfall from either type.
 */
import type {
  PlayerState,
  ResourceCard,
  CardInstance,
  ActiveCostReduction,
  GameConfig,
} from '../types/game-state.js';
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

/** Does a cost reduction's filter match the card being played? A reduction with
 * no cardType/tag constraints matches any card. `firstPerTurn` reductions only
 * match while unused this turn. */
function reductionMatches(red: ActiveCostReduction, card: CardInstance): boolean {
  const f = red.appliesTo;
  if (f.firstPerTurn === true && red.usedThisTurn) return false;
  if (f.cardType !== undefined && f.cardType !== card.cardType) return false;
  if (f.tag !== undefined && !card.tags.includes(f.tag)) return false;
  return true;
}

/** Total generic discount the player's active reductions grant for `card`. */
function totalReduction(player: PlayerState, card: CardInstance): number {
  let sum = 0;
  for (const red of player.costReductions ?? []) {
    if (reductionMatches(red, card)) sum += red.reduction;
  }
  return sum;
}

/** Apply a generic discount to a cost. The discount lowers the loosest part of
 * the cost first (flexible → energy → mana) and never goes below zero. */
function discountCost(cost: ResourceCost, reduction: number): ResourceCost {
  let left = reduction;
  const take = (n: number): number => {
    const d = Math.min(n, left);
    left -= d;
    return n - d;
  };
  const flexible = take(cost.flexible);
  const energy = take(cost.energy);
  const mana = take(cost.mana);
  return { mana, energy, flexible };
}

/** The effective cost of playing `card` after the player's active reductions.
 * Under `config.costFloor`, stacked discounts can never take a card below an
 * effective TOTAL of 1 unless its printed cost is already 0 — the engine-wide
 * "(minimum 1)" that kills the 0-cost self-copy loop class (§12c Echoes×Robe).
 * `config` omitted / flag absent ⇒ byte-identical legacy behavior. (The bot's
 * reach-estimate call site passes no config — the engine sites are the
 * authoritative gate, so a floored play simply never becomes available.) */
export function effectiveCost(
  player: PlayerState,
  card: CardInstance,
  config?: GameConfig,
): ResourceCost {
  let reduction = totalReduction(player, card);
  if (config?.costFloor === true) {
    const printed = card.cost.mana + card.cost.energy + card.cost.flexible;
    if (printed >= 1) reduction = Math.min(reduction, printed - 1);
  }
  return discountCost(card.cost, reduction);
}

/** Mark `firstPerTurn` reductions that matched `card` as used this turn. Pure. */
export function consumeReductions(player: PlayerState, card: CardInstance): PlayerState {
  const reductions = player.costReductions;
  if (reductions === undefined || reductions.length === 0) return player;
  const next = reductions.map((red) => {
    if (red.appliesTo.firstPerTurn === true && !red.usedThisTurn && reductionMatches(red, card)) {
      return { ...red, usedThisTurn: true };
    }
    return red;
  });
  const changed = next.some((red, i) => red !== reductions[i]);
  return changed ? { ...player, costReductions: next } : player;
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
export function payCost(player: PlayerState, cost: ResourceCost): PlayerState {
  if (!canAfford(player, cost)) {
    throw new Error('Insufficient resources to pay cost');
  }

  let manaNeeded = cost.mana;
  let energyNeeded = cost.energy;
  let flexNeeded = cost.flexible;

  // Exhaust resource bank cards — specific first, then flexible
  const newBank: ResourceCard[] = player.resourceBank.map((rc) => {
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
  const finalBank: ResourceCard[] = newBank.map((rc) => {
    if (rc.exhausted || flexNeeded <= 0) return rc;
    flexNeeded--;
    return { ...rc, exhausted: true };
  });

  // Deduct from temporary resources if bank wasn't enough
  let tempResources = player.temporaryResources;
  if (manaNeeded > 0 || energyNeeded > 0 || flexNeeded > 0) {
    tempResources = tempResources
      .map((tmp) => {
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
      .filter((tmp) => tmp.amount > 0);
  }

  return {
    ...player,
    resourceBank: finalBank,
    temporaryResources: tempResources,
  };
}
