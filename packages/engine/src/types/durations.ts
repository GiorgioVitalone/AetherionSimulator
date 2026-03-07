/**
 * Duration — how long an effect persists.
 * Standalone file — no imports.
 */

export type Duration =
  | InstantDuration
  | UntilEndOfTurn
  | UntilNextUpkeep
  | PermanentDuration
  | ForCombat
  | WhileInPlay;

export interface InstantDuration {
  readonly type: 'instant';
}
export interface UntilEndOfTurn {
  readonly type: 'until_end_of_turn';
}
export interface UntilNextUpkeep {
  readonly type: 'until_next_upkeep';
}
export interface PermanentDuration {
  readonly type: 'permanent';
}
export interface ForCombat {
  readonly type: 'for_combat';
}
export interface WhileInPlay {
  readonly type: 'while_in_play';
}
