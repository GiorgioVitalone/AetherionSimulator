import type {
  CardInstance,
  GameState,
} from '../types/game-state.js';
import type { Effect } from '../types/effects.js';
import type { Side, TargetFilter } from '../types/index.js';
import { getAllCards } from '../zones/zone-manager.js';
import { applyFilter } from '../effects/target-resolver.js';
import { isProtectedFromEnemyTargeting } from '../state/runtime-card-helpers.js';

export interface SpellTargeting {
  readonly needsTarget: boolean;
  readonly validTargets: readonly string[];
}

type ExplicitSpellTargetRequirement =
  | {
      readonly type: 'target_character';
      readonly side: Side;
      readonly filter?: TargetFilter;
    }
  | {
      readonly type: 'hero' | 'player';
      readonly side: Side;
    };

export function computeSpellTargeting(
  state: GameState,
  controllerId: 0 | 1,
  card: CardInstance,
): SpellTargeting {
  const requirements = extractSpellTargetRequirements(card.abilities.flatMap(ability => {
    if (ability.type !== 'triggered' || ability.trigger.type !== 'on_cast') {
      return [];
    }
    return ability.effects;
  }));

  if (requirements.length === 0) {
    return {
      needsTarget: false,
      validTargets: [],
    };
  }

  const validTargets = new Set<string>();
  for (const requirement of requirements) {
    for (const targetId of resolveSpellTargetRequirement(state, controllerId, requirement, card.instanceId)) {
      validTargets.add(targetId);
    }
  }

  return {
    needsTarget: true,
    validTargets: [...validTargets],
  };
}

function extractSpellTargetRequirements(
  effects: readonly Effect[],
): readonly ExplicitSpellTargetRequirement[] {
  const requirements: ExplicitSpellTargetRequirement[] = [];

  for (const effect of effects) {
    if ('target' in effect && effect.target !== undefined) {
      const target = effect.target;
      if (
        target.type === 'target_character' ||
        target.type === 'hero' ||
        target.type === 'player'
      ) {
        requirements.push(target);
      }
    }

    if (effect.type === 'composite') {
      requirements.push(...extractSpellTargetRequirements(effect.effects));
      continue;
    }

    if (effect.type === 'conditional') {
      requirements.push(...extractSpellTargetRequirements(effect.ifTrue));
      requirements.push(...extractSpellTargetRequirements(effect.ifFalse ?? []));
      continue;
    }

    if (effect.type === 'choose_one') {
      for (const option of effect.options) {
        requirements.push(...extractSpellTargetRequirements(option.effects));
      }
    }
  }

  return requirements;
}

function resolveSpellTargetRequirement(
  state: GameState,
  controllerId: 0 | 1,
  requirement: ExplicitSpellTargetRequirement,
  sourceInstanceId: string,
): readonly string[] {
  if (requirement.type === 'target_character') {
    const cards = getCardsBySide(state, controllerId, requirement.side);
    return applyFilter(
      cards,
      requirement.filter,
      { sourceInstanceId, controllerId, triggerDepth: 0 },
    )
      .filter(card => card.owner === controllerId || !isProtectedFromEnemyTargeting(card))
      .map(card => card.instanceId);
  }

  return getHeroTargetIds(controllerId, requirement.side);
}

function getCardsBySide(
  state: GameState,
  controllerId: 0 | 1,
  side: Side,
): readonly CardInstance[] {
  switch (side) {
    case 'allied':
      return getAllCards(state.players[controllerId]!.zones);
    case 'enemy':
      return getAllCards(state.players[controllerId === 0 ? 1 : 0]!.zones);
    case 'any':
      return [
        ...getAllCards(state.players[0]!.zones),
        ...getAllCards(state.players[1]!.zones),
      ];
  }
}

function getHeroTargetIds(
  controllerId: 0 | 1,
  side: Side,
): readonly string[] {
  switch (side) {
    case 'allied':
      return [`hero_${String(controllerId)}`];
    case 'enemy':
      return [`hero_${String(controllerId === 0 ? 1 : 0)}`];
    case 'any':
      return ['hero_0', 'hero_1'];
  }
}
