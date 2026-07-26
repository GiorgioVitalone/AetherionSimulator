/**
 * Attach-as-equipment effect — turns the source character card into equipment on
 * a target allied character (e.g. Symbiotic Crawler).
 *
 * The source is removed from its zone (not discarded) and set as the target's
 * `equipment`. With `retainAbilities` false, the source's granted abilities are
 * dropped on attach; otherwise it keeps its enchantments. Pure: state in → state out.
 */
import type { Effect } from '../types/effects.js';
import type {
  GameState,
  GameEvent,
  EffectContext,
  EffectResult,
  CardInstance,
} from '../types/game-state.js';
import { resolveTargets } from './target-resolver.js';
import { findCardInState, updateCardInState } from './state-helpers.js';
import { removeFromZone } from '../zones/zone-manager.js';

export function executeAttachAsEquipment(
  state: GameState,
  effect: Extract<Effect, { type: 'attach_as_equipment' }>,
  context: EffectContext,
): EffectResult {
  const resolved = resolveTargets(state, effect.target, context);
  if (!resolved.resolved) {
    return { newState: state, events: [], pendingChoice: resolved.pendingChoice };
  }

  const targetId = resolved.targetIds[0];
  if (targetId === undefined || targetId === context.sourceInstanceId) {
    return { newState: state, events: [] };
  }

  const source = findCardInState(state, context.sourceInstanceId);
  if (source === null) return { newState: state, events: [] };

  const equipment = toEquipment(source, targetId, effect.retainAbilities ?? false);
  const withoutSource = removeSourceFromZone(state, context.sourceInstanceId);
  const attached = updateCardInState(withoutSource, targetId, (card) => ({
    ...card,
    equipment,
  }));

  const events: GameEvent[] = [
    {
      type: 'EQUIPMENT_ATTACHED',
      equipmentId: equipment.instanceId,
      targetId,
      cardDefId: equipment.cardDefId,
      playerId: equipment.owner,
    },
  ];
  return { newState: attached, events };
}

function toEquipment(
  source: CardInstance,
  holderInstanceId: string,
  retainAbilities: boolean,
): CardInstance {
  return {
    ...source,
    cardType: 'E',
    equipment: null,
    holderInstanceId,
    abilities: retainAbilities ? source.abilities : [],
    registeredTriggers: retainAbilities ? source.registeredTriggers : [],
  };
}

function removeSourceFromZone(state: GameState, sourceId: string): GameState {
  const newPlayers = state.players.map((player) => {
    const { zones, removed } = removeFromZone(player.zones, sourceId);
    return removed === null ? player : { ...player, zones };
  }) as unknown as readonly [GameState['players'][0], GameState['players'][1]];
  return { ...state, players: newPlayers };
}
