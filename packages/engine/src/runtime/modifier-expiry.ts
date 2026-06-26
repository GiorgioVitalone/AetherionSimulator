/**
 * Modifier Expiry — strip timed stat modifiers at their boundary.
 *
 * Timed `modify_stats` effects (until_end_of_turn / until_next_upkeep) record an
 * ActiveModifier so they can be removed when their boundary is reached. Mirrors
 * the aura strip pattern: subtract each expiring modifier's stat contribution
 * from the card's current stats, then drop the modifier. Pure.
 */
import type { GameState, CardInstance } from '../types/game-state.js';
import type { GrantedDuration } from '../types/game-state.js';

type TimedBoundary = Extract<GrantedDuration['type'], 'until_end_of_turn' | 'until_next_upkeep'>;

function stripCardModifiers(card: CardInstance, boundary: TimedBoundary): CardInstance {
  const hasMod = card.modifiers.some(m => m.duration.type === boundary);
  // Timed granted traits (grant_trait until_end_of_turn / until_next_upkeep) expire
  // at the same boundary as timed stat modifiers (Rulebook 16).
  const hasTrait = card.grantedTraits.some(g => g.duration.type === boundary);
  if (!hasMod && !hasTrait) return card;
  let atk = card.currentAtk;
  let hp = card.currentHp;
  let arm = card.currentArm;
  for (const m of card.modifiers) {
    if (m.duration.type !== boundary) continue;
    atk -= m.modifier.atk ?? 0;
    hp -= m.modifier.hp ?? 0;
    arm -= m.modifier.arm ?? 0;
  }
  return {
    ...card,
    currentAtk: atk,
    currentHp: hp,
    currentArm: arm,
    modifiers: card.modifiers.filter(m => m.duration.type !== boundary),
    grantedTraits: card.grantedTraits.filter(g => g.duration.type !== boundary),
  };
}

/** Expire all timed modifiers reaching `boundary` on the given player's cards. */
export function expireModifiers(
  state: GameState,
  playerIndex: 0 | 1,
  boundary: TimedBoundary,
): GameState {
  const player = state.players[playerIndex];
  const strip = (c: CardInstance | null): CardInstance | null =>
    c === null ? null : stripCardModifiers(c, boundary);
  const newPlayers = [...state.players] as [GameState['players'][0], GameState['players'][1]];
  newPlayers[playerIndex] = {
    ...player,
    zones: {
      reserve: player.zones.reserve.map(strip),
      frontline: player.zones.frontline.map(strip),
      highGround: player.zones.highGround.map(strip),
    },
  };
  return { ...state, players: newPlayers };
}
