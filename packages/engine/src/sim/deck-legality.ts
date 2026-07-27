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
  /** Full printed alignments. Absent preserves the historical single-faction
   * `faction` field used by current callers. */
  readonly alignments?: readonly string[];
  readonly rarity: string;
  /** Resource channels required by the card's printed costs. Flexible-only and
   * zero costs require neither channel. */
  readonly requiredResourceTypes?: readonly ResourceType[];
  /** For cardType 'R' only: which resource type this card represents. */
  readonly resourceType?: ResourceType;
}

/** A hero's identity for alignment checking. */
export interface HeroFacts {
  readonly id: number;
  readonly faction: string;
  readonly resourceType: ResourceType;
  /** All Hero alignments. A dual-alignment deck declares its primary through
   * DeckSelection.faction; the other alignment is secondary. */
  readonly alignments?: readonly string[];
  /** All resource types the Hero permits. Absent preserves resourceType. */
  readonly resourceTypes?: readonly ResourceType[];
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
  primaryAlignment: string,
  errors: string[],
): void {
  const heroAlignments = alignmentsFor(hero);
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
    const cardAlignments = card.alignments ?? [card.faction];
    const matchingAlignments = cardAlignments.filter((alignment) =>
      heroAlignments.includes(alignment),
    );
    if (matchingAlignments.length === 0) {
      if (heroAlignments.length === 1 && cardAlignments.length === 1) {
        errors.push(
          `card ${String(id)} faction ${card.faction} != hero ${hero.faction}`,
        );
      } else {
        errors.push(
          `card ${String(id)} alignments ${cardAlignments.join('/')} are outside hero alignments ${heroAlignments.join('/')}`,
        );
      }
      continue;
    }
    if (
      !matchingAlignments.includes(primaryAlignment) &&
      card.rarity !== 'Common' &&
      card.rarity !== 'Ethereal'
    ) {
      errors.push(
        `card ${String(id)} rarity ${card.rarity} is not permitted from secondary alignment ${matchingAlignments.join('/')}`,
      );
    }
    const unsupportedResourceTypes = [
      ...new Set(card.requiredResourceTypes ?? []),
    ].filter((resourceType) => !resourceTypesFor(hero).includes(resourceType));
    if (unsupportedResourceTypes.length > 0) {
      errors.push(
        `card ${String(id)} requires ${unsupportedResourceTypes.join('/')} outside hero resources ${resourceTypesFor(hero).join('/')}`,
      );
    }
  }
}

function checkResources(
  ids: readonly number[],
  index: CardIndex,
  hero: HeroFacts,
  errors: string[],
): void {
  const permittedResourceTypes = resourceTypesFor(hero);
  if (ids.length !== RESOURCE_DECK_SIZE) {
    errors.push(`resource deck size ${String(ids.length)} != ${String(RESOURCE_DECK_SIZE)}`);
  }
  for (const id of ids) {
    const card = index.card(id);
    if (!card || card.cardType !== 'R') {
      errors.push(`non-resource card ${String(id)} in resource deck`);
      continue;
    }
    if (
      card.resourceType === undefined ||
      !permittedResourceTypes.includes(card.resourceType)
    ) {
      if (permittedResourceTypes.length === 1) {
        errors.push(
          `resource ${String(id)} type ${String(card.resourceType)} != faction ${hero.resourceType}`,
        );
      } else {
        errors.push(
          `resource ${String(id)} type ${String(card.resourceType)} is outside hero resources ${permittedResourceTypes.join('/')}`,
        );
      }
    }
  }
}

function alignmentsFor(hero: HeroFacts): readonly string[] {
  const alignments = hero.alignments ?? [hero.faction];
  return [...new Set(alignments)];
}

function resourceTypesFor(hero: HeroFacts): readonly ResourceType[] {
  const resourceTypes = hero.resourceTypes ?? [hero.resourceType];
  return [...new Set(resourceTypes)];
}

/** Validate a DeckSelection against the supplied card index. Pure. */
export function validateDeck(selection: DeckSelection, index: CardIndex): LegalityResult {
  const errors: string[] = [];
  const hero = index.hero(selection.heroDefId);
  if (!hero) {
    return { legal: false, errors: [`unknown hero id ${String(selection.heroDefId)}`] };
  }
  const heroAlignments = alignmentsFor(hero);
  let primaryAlignment = selection.faction;
  if (primaryAlignment === undefined) {
    primaryAlignment = heroAlignments[0] ?? hero.faction;
    if (heroAlignments.length > 1) {
      errors.push('dual-alignment decks must declare selection.faction as the primary alignment');
    }
  } else if (!heroAlignments.includes(primaryAlignment)) {
    if (heroAlignments.length === 1) {
      errors.push(`selection faction ${primaryAlignment} != hero faction ${hero.faction}`);
    } else {
      errors.push(
        `selection faction ${primaryAlignment} is outside hero alignments ${heroAlignments.join('/')}`,
      );
    }
    // Continue validation against a real Hero alignment so one invalid primary
    // declaration does not misreport every higher-rarity card as secondary.
    primaryAlignment = heroAlignments[0] ?? hero.faction;
  }
  checkMain(selection.mainDeckDefIds, index, hero, primaryAlignment, errors);
  checkResources(selection.resourceDeckDefIds, index, hero, errors);
  return { legal: errors.length === 0, errors };
}
