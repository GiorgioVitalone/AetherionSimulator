/**
 * Policy configuration carried by a game state.
 *
 * This is a data contract only. Strategic selection and scoring remain owned by
 * the bot adapter, so authoritative state and transition modules never depend on
 * policy implementation.
 */
export type Faction = 'Neutral' | 'Onyx' | 'Radiant' | 'Sapphire' | 'Verdant';

export interface Gameplan {
  readonly faceWeight: number;
  readonly removalWeight: number;
  readonly tempoWeight: number;
  readonly gangAggression: number;
  readonly closeBias: number;
  readonly dynamicDraw?: boolean;
}
