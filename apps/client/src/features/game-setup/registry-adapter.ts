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

function inferResourceTypes(
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
  return types.size === 0 ? ['mana'] : [...types];
}

function inferResourceCardType(card: SimCard): PrintedResourceType | undefined {
  if (card.cardType !== 'R') {
    return undefined;
  }
  return card.name.toLowerCase().includes('energy') ? 'energy' : 'mana';
}

function normalizeTraits(traits: readonly string[]): readonly Trait[] {
  return traits.flatMap(trait => {
    const normalized = trait.trim().toLowerCase().replace(/\s+/g, '_');
    switch (normalized) {
      case 'haste':
      case 'rush':
      case 'sniper':
      case 'elite':
      case 'flying':
      case 'defender':
      case 'stealth':
      case 'recycle':
      case 'swift':
      case 'volatile':
        return [normalized as Trait];
      default:
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

  for (const card of cards) {
    // Extract DSL abilities from the card data
    const dslAbilities = card.abilities
      .map(a => a.dsl as AbilityDSL | null)
      .filter((dsl): dsl is AbilityDSL => dsl !== null);

    // Extract ability metadata (name + effect text)
    const meta: AbilityMeta[] = card.abilities.map(a => ({
      name: a.name,
      effect: a.effect,
    }));

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
        resourceTypes: inferResourceTypes(cost, dslAbilities),
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
        resourceTypes: inferResourceTypes(cost, dslAbilities),
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
