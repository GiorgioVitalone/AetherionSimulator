import type { AbilityDSL } from '../types/ability.js';
import type {
  CardInstance,
  GameState,
} from '../types/game-state.js';
import { getAllCards } from '../zones/zone-manager.js';

const AURA_PREFIX = 'aura_';

export interface ActiveAuraSourceCard {
  readonly instanceId: string;
  readonly abilities: readonly AbilityDSL[];
  readonly xPaid?: number;
}

export interface ActiveAuraSource {
  readonly card: ActiveAuraSourceCard;
  readonly controllerId: 0 | 1;
}

/**
 * Collect the complete active source set. Reserve-tapped bodies are omitted
 * because their abilities are disabled; attached equipment and enabled Hero
 * auras are first-class sources.
 */
export function collectActiveAuraSources(
  state: GameState,
): readonly ActiveAuraSource[] {
  const out: ActiveAuraSource[] = [];
  for (const controllerId of [0, 1] as const) {
    for (const card of getAllCards(state.players[controllerId].zones)) {
      if (card.reserveEnergyExhausted === true) continue;
      if (card.abilities.some((ability) => ability.type === 'aura')) {
        out.push({ card, controllerId });
      }
      const equipment = card.equipment;
      if (
        equipment !== null &&
        equipment.abilities.some((ability) => ability.type === 'aura')
      ) {
        out.push({ card: equipment, controllerId });
      }
    }
    if (state.config?.heroAuras === true) {
      const hero = state.players[controllerId].hero;
      if (hero.abilities.some((ability) => ability.type === 'aura')) {
        out.push({
          card: {
            instanceId: `hero_${String(hero.cardDefId)}`,
            abilities: hero.abilities,
          },
          controllerId,
        });
      }
    }
  }
  return out;
}

function auraSourceKeys(state: GameState): readonly string[] {
  return collectActiveAuraSources(state)
    .flatMap(({ card, controllerId }) =>
      card.abilities.flatMap((ability, abilityIndex) =>
        ability.type === 'aura'
          ? [`${String(controllerId)}:${card.instanceId}:${String(abilityIndex)}`]
          : [],
      ),
    )
    .sort();
}

function cardContributionKeys(card: CardInstance): readonly string[] {
  return [
    ...card.modifiers.flatMap((modifier) =>
      modifier.id.startsWith(AURA_PREFIX)
        ? [
            `modifier:${card.instanceId}:${modifier.id}:${String(modifier.modifier.atk ?? 0)}:${String(modifier.modifier.hp ?? 0)}:${String(modifier.modifier.arm ?? 0)}`,
          ]
        : [],
    ),
    ...(card.activeReplacements ?? []).flatMap((replacement) =>
      replacement.id.startsWith(AURA_PREFIX)
        ? [`replacement:${card.instanceId}:${replacement.id}`]
        : [],
    ),
    ...card.registeredTriggers.flatMap((trigger) =>
      trigger.id.startsWith(AURA_PREFIX)
        ? [`trigger:${card.instanceId}:${trigger.id}`]
        : [],
    ),
    ...card.statusEffects.flatMap((status) =>
      status.sourceAuraId?.startsWith(AURA_PREFIX) === true
        ? [
            `status:${card.instanceId}:${status.sourceAuraId}:${status.statusType}:${String(status.value)}`,
          ]
        : [],
    ),
    ...card.grantedTraits.flatMap((trait) =>
      trait.sourceInstanceId.startsWith(AURA_PREFIX)
        ? [`trait:${card.instanceId}:${trait.sourceInstanceId}:${trait.trait}`]
        : [],
    ),
  ];
}

function auraContributionKeys(state: GameState): readonly string[] {
  const keys: string[] = [];
  for (const player of state.players) {
    for (const reduction of player.costReductions ?? []) {
      if (reduction.id.startsWith(AURA_PREFIX)) {
        keys.push(
          `cost:${reduction.id}:${reduction.usedThisTurn ? 'used' : 'ready'}`,
        );
      }
    }
    for (const trigger of player.hero.registeredTriggers) {
      if (trigger.id.startsWith(AURA_PREFIX)) {
        keys.push(`hero-trigger:${trigger.sourceInstanceId}:${trigger.id}`);
      }
    }
    for (const card of getAllCards(player.zones)) {
      keys.push(...cardContributionKeys(card));
      if (card.equipment !== null) {
        keys.push(...cardContributionKeys(card.equipment));
      }
    }
  }
  return [...new Set(keys)].sort();
}

export function buildAuraDerivationState(
  state: GameState,
): NonNullable<GameState['auraDerivation']> {
  return {
    sourceKeys: auraSourceKeys(state),
    contributionKeys: auraContributionKeys(state),
  };
}
