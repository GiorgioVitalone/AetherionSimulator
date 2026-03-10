import type { AuraAbilityDSL } from '../types/ability.js';
import type { Effect, ModifyStatsEffect } from '../types/effects.js';
import type { TargetExpr } from '../types/targets.js';
import type {
  ActiveModifier,
  CardInstance,
  GameEvent,
  GameState,
  GrantedDuration,
  PlayerState,
} from '../types/game-state.js';
import { evaluateCondition } from '../effects/condition-evaluator.js';
import { resolveTargets } from '../effects/target-resolver.js';
import { rebuildRegisteredTriggers } from '../events/trigger-registry.js';
import { destroyCard, findCardInState, updateCardInState } from './card-state-helpers.js';

interface ContinuousSource {
  readonly sourceInstanceId: string;
  readonly controllerId: 0 | 1;
  readonly abilities: readonly AuraAbilityDSL[];
  readonly abilitiesSuppressed: boolean;
}

interface DeferredDynamicModifier {
  readonly effect: ModifyStatsEffect;
  readonly sourceInstanceId: string;
  readonly controllerId: 0 | 1;
  readonly abilityIndex: number;
  readonly effectIndex: number;
}

interface ContinuousResult {
  readonly state: GameState;
  readonly events: readonly GameEvent[];
}

const MAX_CONTINUOUS_PASSES = 4;

export function normalizeGameState(state: GameState): ContinuousResult {
  let currentState = rebuildContinuousState(state);
  const events: GameEvent[] = [];

  for (let pass = 0; pass < MAX_CONTINUOUS_PASSES; pass++) {
    const deadCards = getDeadBattlefieldCards(currentState);
    if (deadCards.length === 0) {
      return { state: currentState, events };
    }

    for (const card of deadCards) {
      const refreshedCard = findCardInState(currentState, card.instanceId);
      if (refreshedCard === null || refreshedCard.currentHp > 0) {
        continue;
      }
      const destruction = destroyCard(currentState, card.instanceId, 'effect');
      currentState = destruction.state;
      events.push(...destruction.events);
    }

    currentState = rebuildContinuousState(currentState);
  }

  return { state: currentState, events };
}

function rebuildContinuousState(state: GameState): GameState {
  let currentState = stripContinuousState(state);
  const deferredDynamicModifiers: DeferredDynamicModifier[] = [];

  for (const source of getContinuousSources(currentState)) {
    if (source.abilitiesSuppressed) {
      continue;
    }

    for (let abilityIndex = 0; abilityIndex < source.abilities.length; abilityIndex++) {
      const ability = source.abilities[abilityIndex];
      if (ability === undefined) {
        continue;
      }

      const context = {
        sourceInstanceId: source.sourceInstanceId,
        controllerId: source.controllerId,
        triggerDepth: 0,
      } as const;

      if (ability.condition !== undefined && !evaluateCondition(currentState, ability.condition, context)) {
        continue;
      }

      for (let effectIndex = 0; effectIndex < ability.effects.length; effectIndex++) {
        const effect = ability.effects[effectIndex];
        if (effect === undefined) {
          continue;
        }

        if (effect.type === 'modify_stats' && effect.dynamicModifier !== undefined) {
          deferredDynamicModifiers.push({
            effect,
            sourceInstanceId: source.sourceInstanceId,
            controllerId: source.controllerId,
            abilityIndex,
            effectIndex,
          });
          continue;
        }

        currentState = applyContinuousEffect(
          currentState,
          effect,
          source.sourceInstanceId,
          source.controllerId,
          abilityIndex,
          effectIndex,
        );
      }
    }
  }

  for (const deferred of deferredDynamicModifiers) {
    currentState = applyContinuousEffect(
      currentState,
      deferred.effect,
      deferred.sourceInstanceId,
      deferred.controllerId,
      deferred.abilityIndex,
      deferred.effectIndex,
    );
  }

  return rebuildRegisteredTriggers(currentState);
}

function stripContinuousState(state: GameState): GameState {
  const players = (
    state.players.map(player => stripContinuousPlayerState(player))
  ) as unknown as [PlayerState, PlayerState];
  return { ...state, players };
}

function stripContinuousPlayerState(player: PlayerState): PlayerState {
  return {
    ...player,
    hero: {
      ...player.hero,
      registeredTriggers: [],
    },
    auraZone: player.auraZone.map(stripContinuousCardState),
    activeCostReductions: player.activeCostReductions.filter(
      reduction => reduction.duration.type !== 'while_in_play',
    ),
    zones: {
      reserve: player.zones.reserve.map(card => card === null ? null : stripContinuousCardState(card)),
      frontline: player.zones.frontline.map(card => card === null ? null : stripContinuousCardState(card)),
      highGround: player.zones.highGround.map(card => card === null ? null : stripContinuousCardState(card)),
    },
  };
}

function stripContinuousCardState(card: CardInstance): CardInstance {
  const remainingModifiers: ActiveModifier[] = [];
  let currentHp = card.currentHp;
  let currentAtk = card.currentAtk;
  let currentArm = card.currentArm;

  for (const modifier of card.modifiers) {
    if (modifier.duration.type === 'while_in_play') {
      currentHp -= modifier.modifier.hp ?? 0;
      currentAtk -= modifier.modifier.atk ?? 0;
      currentArm -= modifier.modifier.arm ?? 0;
      continue;
    }
    remainingModifiers.push(modifier);
  }

  return {
    ...card,
    currentHp,
    currentAtk,
    currentArm,
    grantedTraits: card.grantedTraits.filter(entry => entry.duration.type !== 'while_in_play'),
    grantedAbilities: card.grantedAbilities.filter(entry => entry.duration.type !== 'while_in_play'),
    registeredTriggers: [],
    modifiers: remainingModifiers,
    statusEffects: card.statusEffects.filter(status => status.duration?.type !== 'while_in_play'),
    replacementEffects: card.replacementEffects.filter(entry => entry.duration.type !== 'while_in_play'),
    equipment: card.equipment === null ? null : stripContinuousCardState(card.equipment),
  };
}

function getContinuousSources(state: GameState): readonly ContinuousSource[] {
  const sources: ContinuousSource[] = [];

  for (let playerId = 0; playerId < state.players.length; playerId++) {
    const player = state.players[playerId]!;

    sources.push({
      sourceInstanceId: `hero_${String(playerId)}`,
      controllerId: playerId as 0 | 1,
      abilities: player.hero.abilities.filter((ability): ability is AuraAbilityDSL => ability.type === 'aura'),
      abilitiesSuppressed: false,
    });

    for (const auraCard of player.auraZone) {
      sources.push({
        sourceInstanceId: auraCard.instanceId,
        controllerId: playerId as 0 | 1,
        abilities: auraCard.abilities.filter((ability): ability is AuraAbilityDSL => ability.type === 'aura'),
        abilitiesSuppressed: auraCard.abilitiesSuppressed,
      });
    }

    for (const card of [
      ...player.zones.reserve,
      ...player.zones.frontline,
      ...player.zones.highGround,
    ]) {
      if (card === null) {
        continue;
      }

      sources.push({
        sourceInstanceId: card.instanceId,
        controllerId: playerId as 0 | 1,
        abilities: card.abilities.filter((ability): ability is AuraAbilityDSL => ability.type === 'aura'),
        abilitiesSuppressed: card.abilitiesSuppressed,
      });

      if (card.equipment !== null) {
        sources.push({
          sourceInstanceId: card.equipment.instanceId,
          controllerId: playerId as 0 | 1,
          abilities: card.equipment.abilities.filter((ability): ability is AuraAbilityDSL => ability.type === 'aura'),
          abilitiesSuppressed: false,
        });
      }
    }
  }

  return sources;
}

function applyContinuousEffect(
  state: GameState,
  effect: Effect,
  sourceInstanceId: string,
  controllerId: 0 | 1,
  abilityIndex: number,
  effectIndex: number,
): GameState {
  const context = {
    sourceInstanceId,
    controllerId,
    triggerDepth: 0,
  } as const;

  switch (effect.type) {
    case 'modify_stats':
      return applyContinuousModifier(state, effect, context, abilityIndex, effectIndex);
    case 'grant_trait':
      if (effect.duration.type !== 'while_in_play') return state;
      return updateContinuousTargets(state, effect.target, context, (currentState, targetId) =>
        updateCardInState(currentState, targetId, card => ({
          ...card,
          grantedTraits: [
            ...card.grantedTraits,
            {
              trait: effect.trait,
              sourceInstanceId,
              duration: toWhileInPlayDuration(sourceInstanceId),
            },
          ],
        })),
      );
    case 'grant_ability':
      if (effect.duration.type !== 'while_in_play') return state;
      return updateContinuousTargets(state, effect.target, context, (currentState, targetId) =>
        updateCardInState(currentState, targetId, card => ({
          ...card,
          grantedAbilities: [
            ...card.grantedAbilities,
            {
              sourceInstanceId,
              ability: { type: 'triggered', ...effect.ability },
              duration: toWhileInPlayDuration(sourceInstanceId),
              resolveAfterChain: true,
            },
          ],
        })),
      );
    case 'apply_status':
      return updateContinuousTargets(state, effect.target, context, (currentState, targetId) =>
        updateCardInState(currentState, targetId, card => ({
          ...card,
          statusEffects: mergeStatusEffect(
            card.statusEffects,
            {
              statusType: effect.status,
              value: effect.value ?? 1,
              remainingTurns: effect.durationTurns ?? null,
              sourceInstanceId,
              duration: toWhileInPlayDuration(sourceInstanceId),
            },
          ),
        })),
      );
    case 'cost_reduction': {
      if (effect.duration.type !== 'while_in_play') {
        return state;
      }
      return setPlayer(state, controllerId, {
        ...state.players[controllerId]!,
        activeCostReductions: [
          ...state.players[controllerId]!.activeCostReductions,
          {
            id: buildContinuousEffectId(sourceInstanceId, abilityIndex, effectIndex, effect.type),
            sourceInstanceId,
            reduction: effect.reduction,
            appliesTo: effect.appliesTo,
            duration: toWhileInPlayDuration(sourceInstanceId),
          },
        ],
      });
    }
    case 'replacement': {
      const targetIds = resolveReplacementTargets(state, sourceInstanceId);
      let currentState = state;
      for (const targetId of targetIds) {
        currentState = updateCardInState(currentState, targetId, card => ({
          ...card,
          replacementEffects: [
            ...card.replacementEffects,
            {
              id: buildContinuousEffectId(sourceInstanceId, abilityIndex, effectIndex, effect.type),
              sourceInstanceId,
              controllerId,
              effect,
              duration: toWhileInPlayDuration(sourceInstanceId),
            },
          ],
        }));
      }
      return currentState;
    }
    default:
      return state;
  }
}

function applyContinuousModifier(
  state: GameState,
  effect: ModifyStatsEffect,
  context: {
    readonly sourceInstanceId: string;
    readonly controllerId: 0 | 1;
    readonly triggerDepth: number;
  },
  abilityIndex: number,
  effectIndex: number,
): GameState {
  if (effect.duration.type !== 'while_in_play') {
    return state;
  }

  return updateContinuousTargets(state, effect.target, context, (currentState, targetId) => {
    const target = findCardInState(currentState, targetId);
    if (target === null) {
      return currentState;
    }

    const modifier = effect.dynamicModifier === undefined
      ? effect.modifier
      : resolveDynamicModifier(currentState, effect, target, context.sourceInstanceId);
    if (
      (modifier.atk ?? 0) === 0 &&
      (modifier.hp ?? 0) === 0 &&
      (modifier.arm ?? 0) === 0
    ) {
      return currentState;
    }

    return updateCardInState(currentState, targetId, card => ({
      ...card,
      currentAtk: card.currentAtk + (modifier.atk ?? 0),
      currentHp: card.currentHp + (modifier.hp ?? 0),
      currentArm: card.currentArm + (modifier.arm ?? 0),
      modifiers: [
        ...card.modifiers,
        {
          id: buildContinuousEffectId(context.sourceInstanceId, abilityIndex, effectIndex, effect.type, targetId),
          sourceInstanceId: context.sourceInstanceId,
          modifier,
          duration: toWhileInPlayDuration(context.sourceInstanceId),
        },
      ],
    }));
  });
}

function updateContinuousTargets(
  state: GameState,
  target: TargetExpr,
  context: {
    readonly sourceInstanceId: string;
    readonly controllerId: 0 | 1;
    readonly triggerDepth: number;
    readonly selectedTargets?: readonly string[];
  },
  updater: (state: GameState, targetId: string) => GameState,
): GameState {
  const resolved = resolveTargets(state, target, context);
  if (!resolved.resolved) {
    return state;
  }

  let currentState = state;
  for (const targetId of resolved.targetIds) {
    currentState = updater(currentState, targetId);
  }
  return currentState;
}

function resolveDynamicModifier(
  state: GameState,
  effect: ModifyStatsEffect,
  target: CardInstance,
  sourceInstanceId: string,
): ModifyStatsEffect['modifier'] {
  if (effect.dynamicModifier === undefined) {
    return effect.modifier;
  }

  switch (effect.dynamicModifier.type) {
    case 'equals_stat': {
      const statValue = effect.dynamicModifier.sourceRef === 'atk'
        ? target.currentAtk
        : effect.dynamicModifier.sourceRef === 'hp'
          ? target.currentHp
          : target.currentArm;
      return {
        ...effect.modifier,
        [effect.dynamicModifier.stat]: statValue,
      };
    }
    case 'x_cost':
      {
        const sourceCard = sourceInstanceId.startsWith('hero_')
          ? null
          : findCardInState(state, sourceInstanceId);
      return {
        ...effect.modifier,
        [effect.dynamicModifier.stat]: sourceCard?.xValue ?? 0,
      };
      }
    default:
      return effect.modifier;
  }
}

function resolveReplacementTargets(
  state: GameState,
  sourceInstanceId: string,
): readonly string[] {
  const equippedCharacter = resolveTargets(state, { type: 'equipped_character' }, {
    sourceInstanceId,
    controllerId: 0,
    triggerDepth: 0,
  });
  if (equippedCharacter.resolved && equippedCharacter.targetIds.length > 0) {
    return equippedCharacter.targetIds;
  }

  return sourceInstanceId.startsWith('hero_') ? [] : [sourceInstanceId];
}

function buildContinuousEffectId(
  sourceInstanceId: string,
  abilityIndex: number,
  effectIndex: number,
  effectType: Effect['type'],
  targetId?: string,
): string {
  return [
    'continuous',
    effectType,
    sourceInstanceId,
    String(abilityIndex),
    String(effectIndex),
    targetId ?? '',
  ].join(':');
}

function toWhileInPlayDuration(sourceId: string): GrantedDuration {
  return { type: 'while_in_play', sourceId };
}

function mergeStatusEffect(
  statuses: readonly CardInstance['statusEffects'][number][],
  nextStatus: CardInstance['statusEffects'][number],
): readonly CardInstance['statusEffects'][number][] {
  const existing = statuses.find(status => status.statusType === nextStatus.statusType);
  if (existing === undefined) {
    return [...statuses, nextStatus];
  }

  if (nextStatus.statusType === 'persistent' || nextStatus.statusType === 'regeneration') {
    if (nextStatus.value <= existing.value) {
      return statuses;
    }
  }

  return [
    ...statuses.filter(status => status.statusType !== nextStatus.statusType),
    {
      ...existing,
      ...nextStatus,
      remainingTurns: existing.remainingTurns === null
        ? nextStatus.remainingTurns
        : Math.max(existing.remainingTurns, nextStatus.remainingTurns ?? 0),
    },
  ];
}

function getDeadBattlefieldCards(state: GameState): readonly CardInstance[] {
  const cards: CardInstance[] = [];
  for (const player of state.players) {
    for (const card of [
      ...player.zones.reserve,
      ...player.zones.frontline,
      ...player.zones.highGround,
    ]) {
      if (card !== null && card.currentHp <= 0) {
        cards.push(card);
      }
    }
  }
  return cards;
}

function setPlayer(
  state: GameState,
  playerId: 0 | 1,
  player: PlayerState,
): GameState {
  const players = [...state.players] as [PlayerState, PlayerState];
  players[playerId] = player;
  return { ...state, players };
}
