// Standalone deck-legality validator for the WS-C faction-deck sampler.
//
// Re-implements (does NOT edit) the legality rules visible in
// sim-runner.mjs buildDeck (:166): a legal deck has a 40-60 card main deck,
// at most 3 copies of any non-Legendary card (<=1 for Legendary), exactly 12
// resource cards all of the faction's resource type, and a hero whose alignment
// is consistent with every main-deck card's faction.
//
// Pure + data-driven: the caller supplies a `CardIndex` describing the card pool
// (rarity, type, faction, resource type) so this module never reads the card
// JSON itself. Strict-TS, named exports only.

export const MAIN_MIN = 40;
export const MAIN_MAX = 60;
export const COPY_LIMIT = 3;
export const LEGENDARY_COPY_LIMIT = 1;
export const ETHEREAL_COPY_LIMIT = 2;
export const MYTHIC_COPY_LIMIT = 2;
// sim-data/ruleset-v1.json rules.resourceDeckSize (frozen at 12, not the 15-card
// physical starter deck size).
export const RESOURCE_DECK_SIZE = 12;

export type ResourceType = 'mana' | 'energy';

/** Minimal per-card facts the validator needs (built once from the card pool). */
export interface CardFacts {
  readonly id: number;
  readonly cardType: 'C' | 'S' | 'E' | 'R';
  readonly faction: string;
  readonly rarity: string;
  /** For cardType 'R' only: which resource type this card represents. */
  readonly resourceType?: ResourceType;
}

/** A hero's identity for alignment checking. */
export interface HeroFacts {
  readonly id: number;
  readonly faction: string;
  readonly resourceType: ResourceType;
}

/** Lookups the validator uses; supplied by the sampler (read-only card data). */
export interface CardIndex {
  readonly card: (id: number) => CardFacts | undefined;
  readonly hero: (id: number) => HeroFacts | undefined;
}

/** The deck shape resolveDeckSpec (sim-runner.mjs:208) accepts. */
export interface DeckSelection {
  readonly heroDefId: number;
  readonly mainDeckDefIds: readonly number[];
  readonly resourceDeckDefIds: readonly number[];
  readonly faction?: string;
}

export interface LegalityResult {
  readonly legal: boolean;
  readonly errors: readonly string[];
}

function copyLimitFor(rarity: string): number {
  switch (rarity) {
    case 'Legendary':
      return LEGENDARY_COPY_LIMIT;
    case 'Ethereal':
      return ETHEREAL_COPY_LIMIT;
    case 'Mythic':
      return MYTHIC_COPY_LIMIT;
    default:
      return COPY_LIMIT;
  }
}

function checkMain(
  ids: readonly number[],
  index: CardIndex,
  hero: HeroFacts,
  errors: string[],
): void {
  if (ids.length < MAIN_MIN || ids.length > MAIN_MAX) {
    errors.push(
      `main deck size ${String(ids.length)} outside ${String(MAIN_MIN)}-${String(MAIN_MAX)}`,
    );
  }
  const counts = new Map<number, number>();
  for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
  for (const [id, n] of counts) {
    const card = index.card(id);
    if (!card) {
      errors.push(`unknown main-deck card id ${String(id)}`);
      continue;
    }
    if (card.cardType === 'R') {
      errors.push(`resource card ${String(id)} in main deck`);
      continue;
    }
    if (n > copyLimitFor(card.rarity)) {
      errors.push(
        `${String(n)} copies of ${String(id)} exceeds limit ${String(copyLimitFor(card.rarity))}`,
      );
    }
    if (card.faction !== hero.faction) {
      errors.push(`card ${String(id)} faction ${card.faction} != hero ${hero.faction}`);
    }
  }
}

function checkResources(
  ids: readonly number[],
  index: CardIndex,
  hero: HeroFacts,
  errors: string[],
): void {
  if (ids.length !== RESOURCE_DECK_SIZE) {
    errors.push(`resource deck size ${String(ids.length)} != ${String(RESOURCE_DECK_SIZE)}`);
  }
  for (const id of ids) {
    const card = index.card(id);
    if (!card || card.cardType !== 'R') {
      errors.push(`non-resource card ${String(id)} in resource deck`);
      continue;
    }
    if (card.resourceType !== hero.resourceType) {
      errors.push(
        `resource ${String(id)} type ${String(card.resourceType)} != faction ${hero.resourceType}`,
      );
    }
  }
}

/** Validate a DeckSelection against the supplied card index. Pure. */
export function validateDeck(selection: DeckSelection, index: CardIndex): LegalityResult {
  const errors: string[] = [];
  const hero = index.hero(selection.heroDefId);
  if (!hero) {
    return { legal: false, errors: [`unknown hero id ${String(selection.heroDefId)}`] };
  }
  if (selection.faction != null && selection.faction !== hero.faction) {
    errors.push(`selection faction ${selection.faction} != hero faction ${hero.faction}`);
  }
  checkMain(selection.mainDeckDefIds, index, hero, errors);
  checkResources(selection.resourceDeckDefIds, index, hero, errors);
  return { legal: errors.length === 0, errors };
}
