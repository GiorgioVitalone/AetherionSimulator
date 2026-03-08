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
  ResourceCost,
} from '@aetherion-sim/engine';

export interface RegistryWithAbilities {
  readonly registry: CardDefinitionRegistry;
  readonly getAbilities: (cardDefId: number) => readonly AbilityDSL[];
  readonly getHeroAbilities: (cardDefId: number) => readonly AbilityDSL[];
}

/**
 * Converts the engine's cost format (no xMana/xEnergy) from SimCard's cost
 * which includes the X-cost booleans the engine doesn't need.
 */
function toResourceCost(cost: SimCard['cost']): ResourceCost {
  return {
    mana: cost.mana,
    energy: cost.energy,
    flexible: cost.flexible,
  };
}

/**
 * Creates a CardDefinitionRegistry from SimCard[], plus ability lookup maps.
 */
export function createRegistry(cards: readonly SimCard[]): RegistryWithAbilities {
  const cardMap = new Map<number, CardDefinition>();
  const heroMap = new Map<number, HeroDefinition>();
  const abilityMap = new Map<number, readonly AbilityDSL[]>();
  const heroAbilityMap = new Map<number, readonly AbilityDSL[]>();

  for (const card of cards) {
    // Extract DSL abilities from the card data
    const dslAbilities = card.abilities
      .map(a => a.dsl as AbilityDSL | null)
      .filter((dsl): dsl is AbilityDSL => dsl !== null);

    if (card.cardType === 'H') {
      // Hero cards: LP comes from stats.hp
      const lp = card.stats?.hp ?? 25;
      heroMap.set(card.id, {
        id: card.id,
        name: card.name,
        lp,
        alignment: card.alignment,
      });
      heroAbilityMap.set(card.id, dslAbilities);
    } else {
      // All other card types
      cardMap.set(card.id, {
        id: card.id,
        name: card.name,
        cardType: card.cardType,
        cost: toResourceCost(card.cost),
        stats: card.stats ?? undefined,
        traits: card.traits,
        tags: card.traits, // tags mapped from traits
        alignment: card.alignment,
      });
      abilityMap.set(card.id, dslAbilities);
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
  };
}
