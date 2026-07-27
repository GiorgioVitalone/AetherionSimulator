import type { CardInstance, GameState } from '../types/game-state.js';

/** Remove every while-source-active grant whose source is no longer in play. */
export function expireInactiveSourceDurations(state: GameState): GameState {
  const active = new Set<string>();
  for (const player of state.players) {
    active.add(`hero_${String(player.hero.cardDefId)}`);
    for (const card of [
      ...player.zones.reserve,
      ...player.zones.frontline,
      ...player.zones.highGround,
    ]) {
      if (card === null) continue;
      active.add(card.instanceId);
      if (card.equipment !== null) active.add(card.equipment.instanceId);
    }
  }
  const strip = (card: CardInstance | null): CardInstance | null => {
    if (card === null) return null;
    const expired = card.modifiers.filter(
      (modifier) =>
        modifier.duration.type === 'while_in_play' &&
        !active.has(modifier.duration.sourceId),
    );
    const traitsChanged = card.grantedTraits.some(
      (grant) =>
        grant.duration.type === 'while_in_play' &&
        !active.has(grant.duration.sourceId),
    );
    if (expired.length === 0 && !traitsChanged) return card;
    return {
      ...card,
      currentAtk:
        card.currentAtk -
        expired.reduce((sum, modifier) => sum + (modifier.modifier.atk ?? 0), 0),
      currentHp:
        card.currentHp -
        expired.reduce((sum, modifier) => sum + (modifier.modifier.hp ?? 0), 0),
      currentArm:
        card.currentArm -
        expired.reduce((sum, modifier) => sum + (modifier.modifier.arm ?? 0), 0),
      modifiers: card.modifiers.filter(
        (modifier) =>
          modifier.duration.type !== 'while_in_play' ||
          active.has(modifier.duration.sourceId),
      ),
      grantedTraits: card.grantedTraits.filter(
        (grant) =>
          grant.duration.type !== 'while_in_play' ||
          active.has(grant.duration.sourceId),
      ),
    };
  };
  return {
    ...state,
    players: state.players.map((player) => ({
      ...player,
      zones: {
        reserve: player.zones.reserve.map(strip),
        frontline: player.zones.frontline.map(strip),
        highGround: player.zones.highGround.map(strip),
      },
    })) as unknown as GameState['players'],
  };
}
