/**
 * Deck Loader — queries card data and builds starter decks.
 *
 * Card data is injected via `initCardData()` rather than statically imported,
 * because the JSON file is generated at build time (`pnpm generate:cards`)
 * and may not exist during type-checking or in CI environments.
 */
import type { SimCard, Alignment } from '@aetherion-sim/cards';
import type { DeckSelection } from '@aetherion-sim/engine';

// ── Module-level card store (initialized lazily) ────────────────────────────

let cardStore: readonly SimCard[] = [];

/**
 * Initialize the card data store. Must be called before any queries.
 * In production, pass the imported JSON data. In tests, pass mock data.
 */
export function initCardData(cards: readonly SimCard[]): void {
  cardStore = cards;
}

// ── Card Queries ────────────────────────────────────────────────────────────

export function getAllCards(): readonly SimCard[] {
  return cardStore;
}

export function getCardsByFaction(faction: string): readonly SimCard[] {
  return cardStore.filter(c => c.alignment.includes(faction as Alignment));
}

export function getHeroForFaction(faction: string): SimCard | undefined {
  return cardStore.find(
    c => c.cardType === 'H' && c.alignment.includes(faction as Alignment),
  );
}

// ── Rarity Copy Limits ──────────────────────────────────────────────────────

export const RARITY_COPY_LIMITS: Record<string, number> = {
  Common: 3,
  Ethereal: 2,
  Mythic: 2,
  Legendary: 1,
};

const TARGET_MAIN_DECK_SIZE = 40;
const RESOURCE_DECK_SIZE = 15;

// ── Starter Deck Builder ────────────────────────────────────────────────────

/**
 * Auto-builds a legal starter deck for a faction:
 * - Finds the faction hero
 * - Fills main deck up to 40 cards, respecting rarity copy limits
 * - Fills resource deck with 15 resource cards
 */
export function buildStarterDeck(faction: string): DeckSelection {
  const hero = getHeroForFaction(faction);
  if (!hero) {
    throw new Error(`No hero found for faction: ${faction}`);
  }

  // Get all playable non-Hero, non-Transformed, non-Resource cards for this faction
  const factionCards = getCardsByFaction(faction).filter(
    c => c.cardType !== 'H' && c.cardType !== 'T' && c.cardType !== 'R',
  );

  // Fill main deck respecting copy limits
  const mainDeckDefIds: number[] = [];
  const copyCounts = new Map<number, number>();

  // Sort by cost (cheaper first) for a front-loaded curve
  const sorted = [...factionCards].sort((a, b) => {
    const costA = a.cost.mana + a.cost.energy + a.cost.flexible;
    const costB = b.cost.mana + b.cost.energy + b.cost.flexible;
    return costA - costB;
  });

  for (const card of sorted) {
    if (mainDeckDefIds.length >= TARGET_MAIN_DECK_SIZE) break;

    const maxCopies = RARITY_COPY_LIMITS[card.rarity] ?? 3;
    const currentCopies = copyCounts.get(card.id) ?? 0;

    // Add copies up to the limit
    const copiesToAdd = Math.min(
      maxCopies - currentCopies,
      TARGET_MAIN_DECK_SIZE - mainDeckDefIds.length,
    );

    for (let i = 0; i < copiesToAdd; i++) {
      mainDeckDefIds.push(card.id);
    }
    copyCounts.set(card.id, currentCopies + copiesToAdd);
  }

  // Resource cards are faction-neutral (alignment: []) — fetch from full card pool
  const allCards = getAllCards();
  const resourceCards = allCards.filter(c => c.cardType === 'R');
  const resourceDeckDefIds: number[] = [];

  // Compute resource affinity from the faction's card costs
  const manaCard = resourceCards.find(c => c.name.toLowerCase().includes('mana'));
  const energyCard = resourceCards.find(c => c.name.toLowerCase().includes('energy'));

  if (manaCard && energyCard) {
    let totalMana = 0;
    let totalEnergy = 0;
    for (const c of factionCards) {
      totalMana += c.cost.mana;
      totalEnergy += c.cost.energy;
    }

    let manaCount: number;
    if (totalMana + totalEnergy === 0) {
      manaCount = RESOURCE_DECK_SIZE; // Fallback to all mana
    } else if (totalEnergy === 0) {
      manaCount = RESOURCE_DECK_SIZE; // Pure mana faction
    } else if (totalMana === 0) {
      manaCount = 0; // Pure energy faction
    } else {
      // Proportional split, rounded, with at least 2 of the minority type
      const manaRatio = totalMana / (totalMana + totalEnergy);
      manaCount = Math.round(manaRatio * RESOURCE_DECK_SIZE);
      manaCount = Math.max(2, Math.min(RESOURCE_DECK_SIZE - 2, manaCount));
    }
    const energyCount = RESOURCE_DECK_SIZE - manaCount;

    for (let i = 0; i < manaCount; i++) resourceDeckDefIds.push(manaCard.id);
    for (let i = 0; i < energyCount; i++) resourceDeckDefIds.push(energyCard.id);
  } else if (resourceCards.length > 0) {
    // Fallback: cycle through whatever resource cards exist
    let idx = 0;
    while (resourceDeckDefIds.length < RESOURCE_DECK_SIZE) {
      resourceDeckDefIds.push(resourceCards[idx % resourceCards.length]!.id);
      idx++;
    }
  }

  return {
    heroDefId: hero.id,
    mainDeckDefIds,
    resourceDeckDefIds,
  };
}
