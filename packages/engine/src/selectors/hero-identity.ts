import type { GameState } from '../types/game-state.js';

/** Current target namespace is deliberately disjoint from hero ability sources. */
export function heroTargetId(state: GameState, playerId: 0 | 1): string {
  return state.config?.authoritativeTransitions === true
    ? `hero_player_${String(playerId)}`
    : `hero_${String(playerId)}`;
}

/** Parse current hero targets and the archived seat-addressed target format. */
export function parseHeroTargetId(targetId: string): 0 | 1 | null {
  const current = /^hero_player_([01])$/.exec(targetId);
  if (current !== null) return Number(current[1]) as 0 | 1;
  const legacy = /^hero_([01])$/.exec(targetId);
  return legacy === null ? null : (Number(legacy[1]) as 0 | 1);
}

export function isHeroTargetId(targetId: string): boolean {
  return parseHeroTargetId(targetId) !== null;
}
