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

const RARITY_COPY_LIMITS: Record<string, number> = {
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

  // Build resource deck from faction's resource cards
  const resourceCards = getCardsByFaction(faction).filter(c => c.cardType === 'R');
  const resourceDeckDefIds: number[] = [];

  // Fill to 15 by cycling through available resource cards
  if (resourceCards.length > 0) {
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
