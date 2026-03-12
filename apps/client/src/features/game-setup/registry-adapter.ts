/**
 * Registry Adapter — bridges SimCard[] from the cards package
 * to the engine's CardDefinitionRegistry interface.
 *
 * Lives in the client (not cards package) to avoid cards→engine dependency.
 * The cards package uses `unknown` for DSL; here we cast to AbilityDSL.
 */
import type { SimCard } from '@aetherion-sim/cards';
import type {
  CardDefinition,
  HeroDefinition,
  CardDefinitionRegistry,
  AbilityDSL,
  PrintedResourceType,
  ResourceCost,
  Trait,
} from '@aetherion-sim/engine';

export interface AbilityMeta {
  readonly name: string;
  readonly effect: string;
}

export interface RegistryWithAbilities {
  readonly registry: CardDefinitionRegistry;
  readonly getAbilities: (cardDefId: number) => readonly AbilityDSL[];
  readonly getHeroAbilities: (cardDefId: number) => readonly AbilityDSL[];
  readonly getAbilityMeta: (cardDefId: number) => readonly AbilityMeta[];
  readonly getHeroAbilityMeta: (cardDefId: number) => readonly AbilityMeta[];
}

/**
 * Converts SimCard's cost to the engine's ResourceCost format,
 * preserving xMana/xEnergy flags for X-cost cards.
 */
function toResourceCost(cost: SimCard['cost']): ResourceCost {
  return {
    mana: cost.mana,
    energy: cost.energy,
    flexible: cost.flexible,
    ...(cost.xMana === true ? { xMana: true } : {}),
    ...(cost.xEnergy === true ? { xEnergy: true } : {}),
  };
}

function inferExplicitResourceTypes(
  cost: ResourceCost,
  abilities: readonly AbilityDSL[],
): readonly PrintedResourceType[] {
  const types = new Set<PrintedResourceType>();
  if (cost.mana > 0 || cost.xMana === true) {
    types.add('mana');
  }
  if (cost.energy > 0 || cost.xEnergy === true) {
    types.add('energy');
  }
  for (const ability of abilities) {
    if (ability.type !== 'triggered' || ability.trigger.type !== 'activated') {
      continue;
    }
    if (ability.trigger.cost.mana > 0 || ability.trigger.cost.xMana === true) {
      types.add('mana');
    }
    if (ability.trigger.cost.energy > 0 || ability.trigger.cost.xEnergy === true) {
      types.add('energy');
    }
  }
  return [...types];
}

function inferResourceCardType(card: SimCard): PrintedResourceType | undefined {
  if (card.cardType !== 'R') {
    return undefined;
  }
  return card.name.toLowerCase().includes('energy') ? 'energy' : 'mana';
}

interface ParsedCardRecord {
  readonly card: SimCard;
  readonly dslAbilities: readonly AbilityDSL[];
  readonly meta: readonly AbilityMeta[];
}

function buildAlignmentResourceTypeLookup(
  cards: readonly ParsedCardRecord[],
): ReadonlyMap<string, readonly PrintedResourceType[]> {
  const resourceTypesByAlignment = new Map<string, Set<PrintedResourceType>>();

  for (const { card, dslAbilities } of cards) {
    const alignments = card.alignment ?? [];
    if (alignments.length === 0) {
      continue;
    }

    const explicitTypes = new Set(
      inferExplicitResourceTypes(toResourceCost(card.cost), dslAbilities),
    );
    const resourceCardType = inferResourceCardType(card);
    if (resourceCardType !== undefined) {
      explicitTypes.add(resourceCardType);
    }

    for (const alignment of alignments) {
      if (!resourceTypesByAlignment.has(alignment)) {
        resourceTypesByAlignment.set(alignment, new Set());
      }
      const typeSet = resourceTypesByAlignment.get(alignment)!;
      for (const resourceType of explicitTypes) {
        typeSet.add(resourceType);
      }
    }
  }

  return new Map(
    [...resourceTypesByAlignment.entries()].map(([alignment, resourceTypes]) => [
      alignment,
      [...resourceTypes] as readonly PrintedResourceType[],
    ]),
  );
}

function inferAlignedResourceTypes(
  alignment: readonly string[] | undefined,
  alignmentResourceTypes: ReadonlyMap<string, readonly PrintedResourceType[]>,
): readonly PrintedResourceType[] {
  if (alignment === undefined || alignment.length === 0) {
    return [];
  }

  const resourceTypes = new Set<PrintedResourceType>();
  for (const faction of alignment) {
    for (const resourceType of alignmentResourceTypes.get(faction) ?? []) {
      resourceTypes.add(resourceType);
    }
  }
  return [...resourceTypes];
}

function resolveHeroResourceTypes(
  card: SimCard,
  cost: ResourceCost,
  abilities: readonly AbilityDSL[],
  alignmentResourceTypes: ReadonlyMap<string, readonly PrintedResourceType[]>,
): readonly PrintedResourceType[] {
  const explicitTypes = inferExplicitResourceTypes(cost, abilities);
  if (explicitTypes.length > 0) {
    return explicitTypes;
  }

  const alignedTypes = inferAlignedResourceTypes(card.alignment, alignmentResourceTypes);
  return alignedTypes.length > 0 ? alignedTypes : ['mana'];
}

function resolveCardResourceTypes(
  card: SimCard,
  cost: ResourceCost,
  abilities: readonly AbilityDSL[],
  alignmentResourceTypes: ReadonlyMap<string, readonly PrintedResourceType[]>,
): readonly PrintedResourceType[] {
  const explicitTypes = inferExplicitResourceTypes(cost, abilities);
  if (explicitTypes.length > 0) {
    return explicitTypes;
  }

  return inferAlignedResourceTypes(card.alignment, alignmentResourceTypes);
}

function normalizeTraits(traits: readonly string[]): readonly Trait[] {
  return traits.flatMap(trait => {
    const normalized = trait.trim().toLowerCase().replace(/\s+/g, '_');
    switch (normalized) {
      case 'haste':
      case 'sniper':
      case 'elite':
      case 'flying':
      case 'defender':
      case 'stealth':
      case 'swift':
      case 'volatile':
        return [normalized as Trait];
      default:
        if (normalized === 'rush' || normalized.startsWith('rush_')) {
          return ['rush'];
        }
        if (normalized === 'recycle' || normalized.startsWith('recycle_')) {
          return ['recycle'];
        }
        return [];
    }
  });
}

/**
 * Creates a CardDefinitionRegistry from SimCard[], plus ability lookup maps.
 */
export function createRegistry(cards: readonly SimCard[]): RegistryWithAbilities {
  const cardMap = new Map<number, CardDefinition>();
  const heroMap = new Map<number, HeroDefinition>();
  const abilityMap = new Map<number, readonly AbilityDSL[]>();
  const heroAbilityMap = new Map<number, readonly AbilityDSL[]>();
  const metaMap = new Map<number, readonly AbilityMeta[]>();
  const heroMetaMap = new Map<number, readonly AbilityMeta[]>();

  const parsedCards: ParsedCardRecord[] = cards.map(card => {
    const dslAbilities = card.abilities
      .map(a => a.dsl as AbilityDSL | null)
      .filter((dsl): dsl is AbilityDSL => dsl !== null);
    const meta: AbilityMeta[] = card.abilities.map(a => ({
      name: a.name,
      effect: a.effect,
    }));
    return {
      card,
      dslAbilities,
      meta,
    };
  });

  const alignmentResourceTypes = buildAlignmentResourceTypeLookup(parsedCards);

  for (const { card, dslAbilities, meta } of parsedCards) {

    if (card.cardType === 'H' || card.cardType === 'T') {
      // Hero cards: LP comes from stats.hp
      const lp = card.stats?.hp ?? 25;
      const cost = toResourceCost(card.cost);
      heroMap.set(card.id, {
        id: card.id,
        name: card.name,
        lp,
        rarity: card.rarity,
        alignment: card.alignment,
        resourceTypes: resolveHeroResourceTypes(
          card,
          cost,
          dslAbilities,
          alignmentResourceTypes,
        ),
        transformsInto: card.transformsInto,
        abilities: dslAbilities,
      });
      heroAbilityMap.set(card.id, dslAbilities);
      heroMetaMap.set(card.id, meta);
    } else {
      // All other card types
      const cost = toResourceCost(card.cost);
      cardMap.set(card.id, {
        id: card.id,
        name: card.name,
        cardType: card.cardType,
        rarity: card.rarity,
        cost,
        stats: card.stats ?? undefined,
        traits: normalizeTraits(card.traits),
        tags: card.traits,
        alignment: card.alignment,
        resourceTypes: resolveCardResourceTypes(
          card,
          cost,
          dslAbilities,
          alignmentResourceTypes,
        ),
        resourceType: inferResourceCardType(card),
        artUrl: card.artUrl,
        transformsInto: card.transformsInto,
        abilities: dslAbilities,
      });
      abilityMap.set(card.id, dslAbilities);
      metaMap.set(card.id, meta);
    }
  }

  const registry: CardDefinitionRegistry = {
    getCard: (id: number) => cardMap.get(id),
    getHero: (id: number) => heroMap.get(id),
  };

  return {
    registry,
    getAbilities: (cardDefId: number) => abilityMap.get(cardDefId) ?? [],
    getHeroAbilities: (cardDefId: number) => heroAbilityMap.get(cardDefId) ?? [],
    getAbilityMeta: (cardDefId: number) => metaMap.get(cardDefId) ?? [],
    getHeroAbilityMeta: (cardDefId: number) => heroMetaMap.get(cardDefId) ?? [],
  };
}
