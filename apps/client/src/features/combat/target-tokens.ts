import type { AttackTarget } from '@aetherion-sim/engine';

export const HERO_ATTACK_TARGET = 'hero';

export function attackTargetsToTokens(
  targets: readonly AttackTarget[],
): readonly string[] {
  return targets.map(target => target.instanceId ?? HERO_ATTACK_TARGET);
}

export function getHeroTargetTokenForPlayer(
  validTargets: readonly string[],
  playerId: 0 | 1,
): string | null {
  const token = `hero_${String(playerId)}`;
  return validTargets.includes(token) ? token : null;
}
