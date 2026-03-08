// @aetherion-sim/ui — Shared UI components for the Aetherion simulator

// Types
export type {
  CardDisplayProps,
  CardDisplayMode,
  CostDisplay,
  StatsDisplay,
  AbilityDisplay,
  HeroDisplayProps,
  ResourceCardDisplay,
} from './types.js';

// Components
export { CardDisplay } from './components/card-display/CardDisplay.js';
export { BattlefieldMode } from './components/card-display/BattlefieldMode.js';
export { HandMode } from './components/card-display/HandMode.js';
export { DetailMode } from './components/card-display/DetailMode.js';
export { StatBadge } from './components/StatBadge.js';
export type { StatType } from './components/StatBadge.js';
export { CostBadge } from './components/CostBadge.js';
export { LpBar } from './components/LpBar.js';
export { CardBack } from './components/CardBack.js';
export { FactionBorder } from './components/FactionBorder.js';

// Utils
export { getFaction, FACTION_COLORS, FACTION_NAMES } from './utils/faction.js';
export type { FactionName } from './utils/faction.js';
