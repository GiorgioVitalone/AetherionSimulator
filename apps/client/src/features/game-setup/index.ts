export { createRegistry } from './registry-adapter.js';
export type { RegistryWithAbilities } from './registry-adapter.js';
export { hydrateAbilities } from './hydrate-abilities.js';
export {
  initCardData,
  getAllCards,
  getCardsByFaction,
  getHeroForFaction,
  buildStarterDeck,
} from './deck-loader.js';
export type { GameConfig, PlayerConfig } from './game-config.js';
