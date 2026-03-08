/**
 * Game Configuration types — describes how to set up a game.
 */
import type { DeckSelection } from '@aetherion-sim/engine';

export interface GameConfig {
  readonly player1: PlayerConfig;
  readonly player2: PlayerConfig;
  readonly seed?: number;
}

export interface PlayerConfig {
  readonly faction: string;
  readonly deck: DeckSelection;
}
