import type {
  CardInstance,
  EffectResolutionWorkItem,
  GameEvent,
  GameState,
  PlayerState,
  StackItem,
} from '../types/game-state.js';
import { resolveCombat } from '../combat/combat-resolver.js';
import { resolveEffectWorkItem, resolveTriggeredEvents } from '../events/index.js';
import { findCard, moveCard } from '../zones/zone-manager.js';
import { normalizeGameState } from '../state/index.js';

interface StackItemResolution {
  readonly state: GameState;
  readonly events: readonly GameEvent[];
  readonly effectWorkItem?: EffectResolutionWorkItem;
}

export function pushToStack(state: GameState, item: StackItem): GameState {
  return {
    ...state,
    stack: [...state.stack, item],
  };
}

export function counterStackItem(
  state: GameState,
  targetItemId: string,
): GameState {
  return {
    ...state,
    stack: state.stack.map(item =>
      item.id === targetItemId
        ? { ...item, countered: true }
        : item,
    ),
  };
}

export function resolveStack(
  state: GameState,
): { readonly state: GameState; readonly events: readonly GameEvent[] } {
  if (state.stack.length === 0) return { state, events: [] };

  const allEvents: GameEvent[] = [];
  let currentState = state;
  const remainingStack = [...state.stack];

  while (remainingStack.length > 0) {
    const item = remainingStack.pop();
    if (item === undefined) break;
    if (item.countered === true) {
      currentState = { ...currentState, stack: [...remainingStack] };
      continue;
    }

    const itemResult = resolveStackItem(
      { ...currentState, stack: [...remainingStack] },
      item,
    );
    const normalized = normalizeGameState(itemResult.state);
    const allItemEvents = [...itemResult.events, ...normalized.events];
    const resolved = itemResult.effectWorkItem !== undefined
      ? resolveEffectWorkItem(normalized.state, itemResult.effectWorkItem, allItemEvents)
      : resolveTriggeredEvents(normalized.state, allItemEvents);

    currentState = {
      ...resolved.state,
      stack: [...remainingStack],
    };
    allEvents.push(...resolved.events);

    if (currentState.pendingChoice !== null || currentState.pendingResolution !== null) {
      return { state: currentState, events: allEvents };
    }
  }

  if (currentState.stack.length === 0 && currentState.deferredTriggerQueue.length > 0) {
    const deferredResolved = resolveTriggeredEvents(currentState, []);
    currentState = deferredResolved.state;
    allEvents.push(...deferredResolved.events);
  }

  return {
    state: {
      ...currentState,
      stack: [],
    },
    events: allEvents,
  };
}

function resolveStackItem(
  state: GameState,
  item: StackItem,
): StackItemResolution {
  switch (item.type) {
    case 'spell':
    case 'counter':
    case 'flash':
      return resolveSpellLikeItem(state, item);
    case 'ability':
      return resolveCardAbilityItem(state, item);
    case 'hero_ability':
      return resolveHeroAbilityItem(state, item);
    case 'attack':
      return resolveAttackItem(state, item);
    case 'equipment':
      return resolveEquipmentItem(state, item);
    case 'move':
      return resolveMoveItem(state, item);
  }
}

function resolveSpellLikeItem(
  state: GameState,
  item: StackItem,
): StackItemResolution {
  let nextState = state;
  if (item.type === 'spell' && item.cardSnapshot !== undefined && hasAuraAbility(item.cardSnapshot)) {
    nextState = moveResolvedSpellToAuraZone(state, item.controllerId, item.cardSnapshot);
  }

  const events: GameEvent[] = item.cardSnapshot?.cardType === 'S'
    ? [{
        type: 'SPELL_CAST',
        cardInstanceId: item.sourceInstanceId,
        playerId: item.controllerId,
      }]
    : [];

  if (item.effects.length === 0) {
    return { state: nextState, events };
  }

  return {
    state: nextState,
    events,
    effectWorkItem: {
      kind: 'effect',
      sourceInstanceId: item.sourceInstanceId,
      controllerId: item.controllerId,
      effects: item.effects,
      triggerDepth: 0,
      selectedTargets: item.targets.length > 0 ? item.targets : undefined,
    },
  };
}

function resolveCardAbilityItem(
  state: GameState,
  item: StackItem,
): StackItemResolution {
  const events: GameEvent[] = item.abilityIndex === undefined
    ? []
    : [{
        type: 'ABILITY_ACTIVATED',
        cardInstanceId: item.sourceInstanceId,
        abilityIndex: item.abilityIndex,
        turnNumber: state.turnNumber,
      }];

  if (item.effects.length === 0) {
    return { state, events };
  }

  return {
    state,
    events,
    effectWorkItem: {
      kind: 'effect',
      sourceInstanceId: item.sourceInstanceId,
      controllerId: item.controllerId,
      effects: item.effects,
      triggerDepth: 0,
      selectedTargets: item.targets.length > 0 ? item.targets : undefined,
    },
  };
}

function resolveHeroAbilityItem(
  state: GameState,
  item: StackItem,
): StackItemResolution {
  const events: GameEvent[] = item.abilityIndex === undefined
    ? []
    : [{
        type: 'HERO_ABILITY_ACTIVATED',
        playerId: item.controllerId,
        abilityIndex: item.abilityIndex,
        turnNumber: state.turnNumber,
      }];

  if (item.effects.length === 0) {
    return { state, events };
  }

  return {
    state,
    events,
    effectWorkItem: {
      kind: 'effect',
      sourceInstanceId: item.sourceInstanceId,
      controllerId: item.controllerId,
      effects: item.effects,
      triggerDepth: 0,
      selectedTargets: item.targets.length > 0 ? item.targets : undefined,
    },
  };
}

function resolveAttackItem(
  state: GameState,
  item: StackItem,
): StackItemResolution {
  const targetId = item.targets[0];
  if (targetId === undefined) {
    return { state, events: [] };
  }

  try {
    const combatResult = resolveCombat(
      { ...state, activePlayerIndex: item.controllerId },
      item.sourceInstanceId,
      targetId === 'hero' ? 'hero' : targetId,
    );
    return {
      state: {
        ...combatResult.newState,
        activePlayerIndex: state.activePlayerIndex,
      },
      events: combatResult.events,
    };
  } catch {
    return { state, events: [] };
  }
}

function resolveEquipmentItem(
  state: GameState,
  item: StackItem,
): StackItemResolution {
  const equipment = item.cardSnapshot;
  const targetId = item.targets[0];
  if (equipment === undefined || targetId === undefined) {
    return { state, events: [] };
  }

  const player = state.players[item.controllerId]!;
  const targetLocation = findCard(player.zones, targetId);
  if (targetLocation === null || !canAttachEquipmentToTarget(equipment, targetLocation.card)) {
    return { state, events: [] };
  }

  const newBonuses = getEquipmentStatBonuses(equipment);
  const replacedEquipment = targetLocation.card.equipment;

  const attachToCard = (card: CardInstance | null): CardInstance | null => {
    if (card === null || card.instanceId !== targetId) return card;
    const oldBonuses = card.equipment === null
      ? zeroStatBonuses()
      : getEquipmentStatBonuses(card.equipment);
    return {
      ...card,
      equipment,
      baseAtk: card.baseAtk - oldBonuses.atk + newBonuses.atk,
      baseHp: card.baseHp - oldBonuses.hp + newBonuses.hp,
      baseArm: card.baseArm - oldBonuses.arm + newBonuses.arm,
      currentAtk: card.currentAtk - oldBonuses.atk + newBonuses.atk,
      currentHp: card.currentHp - oldBonuses.hp + newBonuses.hp,
      currentArm: card.currentArm - oldBonuses.arm + newBonuses.arm,
    };
  };

  const newPlayer: PlayerState = {
    ...player,
    zones: {
      reserve: player.zones.reserve.map(attachToCard),
      frontline: player.zones.frontline.map(attachToCard),
      highGround: player.zones.highGround.map(attachToCard),
    },
    discardPile: player.discardPile
      .filter(card => card.instanceId !== equipment.instanceId)
      .concat(replacedEquipment === null ? [] : [replacedEquipment]),
  };
  const replacedEvents: GameEvent[] = [];
  const removedEquipment = replacedEquipment;
  if (removedEquipment !== null) {
    replacedEvents.push({
      type: 'CARD_DESTROYED',
      cardInstanceId: removedEquipment.instanceId,
      cause: 'effect',
      playerId: item.controllerId,
      destroyedCard: { ...removedEquipment, equipment: null },
    });
    replacedEvents.push({
      type: 'CARD_LEFT_BATTLEFIELD',
      cardInstanceId: removedEquipment.instanceId,
      destination: 'discard',
      playerId: item.controllerId,
    });
  }

  return {
    state: setPlayer(state, item.controllerId, newPlayer),
    events: [
      ...replacedEvents,
      {
        type: 'EQUIPMENT_ATTACHED',
        equipmentId: equipment.instanceId,
        targetId,
      },
    ],
  };
}

function resolveMoveItem(
  state: GameState,
  item: StackItem,
): StackItemResolution {
  const toZone = item.zone;
  const slotIndex = item.slotIndex;
  if (toZone === undefined || slotIndex === undefined) {
    return { state, events: [] };
  }

  const player = state.players[item.controllerId]!;
  const fromLocation = findCard(player.zones, item.sourceInstanceId);
  if (fromLocation === null) {
    return { state, events: [] };
  }

  try {
    const newZones = moveCard(player.zones, item.sourceInstanceId, toZone, slotIndex, state.turnNumber);
    return {
      state: setPlayer(state, item.controllerId, {
        ...player,
        zones: newZones,
      }),
      events: [{
        type: 'CARD_MOVED',
        cardInstanceId: item.sourceInstanceId,
        fromZone: fromLocation.zone,
        toZone,
      }],
    };
  } catch {
    return { state, events: [] };
  }
}

function moveResolvedSpellToAuraZone(
  state: GameState,
  playerId: 0 | 1,
  card: CardInstance,
): GameState {
  const player = state.players[playerId]!;
  const discardPile = player.discardPile.filter(entry => entry.instanceId !== card.instanceId);
  return setPlayer(state, playerId, {
    ...player,
    discardPile,
    auraZone: [...player.auraZone, card],
  });
}

function hasAuraAbility(card: CardInstance): boolean {
  return card.abilities.some(ability => ability.type === 'aura');
}

function zeroStatBonuses(): { atk: number; hp: number; arm: number } {
  return { atk: 0, hp: 0, arm: 0 };
}

function getEquipmentStatBonuses(equipment: CardInstance): { atk: number; hp: number; arm: number } {
  let atk = 0;
  let hp = 0;
  let arm = 0;

  for (const ability of equipment.abilities) {
    if (ability.type !== 'stat_grant') continue;
    atk += ability.modifier.atk ?? 0;
    hp += ability.modifier.hp ?? 0;
    arm += ability.modifier.arm ?? 0;
  }

  return { atk, hp, arm };
}

function canAttachEquipmentToTarget(
  equipment: CardInstance,
  target: CardInstance,
): boolean {
  if (
    equipment.alignment.length > 0 &&
    !equipment.alignment.some(alignment => target.alignment.includes(alignment))
  ) {
    return false;
  }
  if (
    equipment.resourceTypes.length > 0 &&
    !equipment.resourceTypes.some(resourceType => target.resourceTypes.includes(resourceType))
  ) {
    return false;
  }
  return true;
}

function setPlayer(
  state: GameState,
  index: 0 | 1,
  player: PlayerState,
): GameState {
  const players = [...state.players] as [PlayerState, PlayerState];
  players[index] = player;
  return {
    ...state,
    players,
  };
}
