/**
 * Ability Hydration — injects DSL abilities into card instances after createGame().
 *
 * The engine's createCardInstance and createHeroState both hardcode `abilities: []`
 * because CardDefinition doesn't carry AbilityDSL. This post-processing step
 * walks every card location in the GameState and fills abilities from the registry.
 */
import type {
  GameState,
  PlayerState,
  CardInstance,
  HeroState,
  AbilityDSL,
} from '@aetherion-sim/engine';

type AbilityLookup = (cardDefId: number) => readonly AbilityDSL[];

/**
 * Walk all card locations and inject abilities from registry lookups.
 * Returns a new GameState — does not mutate the input.
 */
export function hydrateAbilities(
  state: GameState,
  getAbilities: AbilityLookup,
  getHeroAbilities: AbilityLookup,
): GameState {
  return {
    ...state,
    players: [
      hydratePlayer(state.players[0], getAbilities, getHeroAbilities),
      hydratePlayer(state.players[1], getAbilities, getHeroAbilities),
    ] as const,
  };
}

function hydratePlayer(
  player: PlayerState,
  getAbilities: AbilityLookup,
  getHeroAbilities: AbilityLookup,
): PlayerState {
  return {
    ...player,
    hero: hydrateHero(player.hero, getHeroAbilities),
    hand: player.hand.map(c => hydrateCard(c, getAbilities)),
    mainDeck: player.mainDeck.map(c => hydrateCard(c, getAbilities)),
    discardPile: player.discardPile.map(c => hydrateCard(c, getAbilities)),
    zones: {
      reserve: player.zones.reserve.map(c => c ? hydrateCard(c, getAbilities) : null),
      frontline: player.zones.frontline.map(c => c ? hydrateCard(c, getAbilities) : null),
      highGround: player.zones.highGround.map(c => c ? hydrateCard(c, getAbilities) : null),
    },
  };
}

function hydrateCard(card: CardInstance, getAbilities: AbilityLookup): CardInstance {
  const abilities = getAbilities(card.cardDefId);
  if (abilities.length === 0) return card;
  return { ...card, abilities };
}

function hydrateHero(hero: HeroState, getHeroAbilities: AbilityLookup): HeroState {
  const abilities = getHeroAbilities(hero.cardDefId);
  if (abilities.length === 0) return hero;
  return { ...hero, abilities };
}
