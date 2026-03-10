/**
 * Available Actions — computes all legal actions for the active player.
 * Called each time the UI needs to know what the player can do.
 */
import type {
  GameState,
  PlayerState,
  CardInstance,
} from '../types/game-state.js';
import type { ResourceCost, ZoneType } from '../types/common.js';
import type { TriggeredAbilityDSL } from '../types/ability.js';
import { getAllCards, getCardsInZone } from '../zones/zone-manager.js';
import { getValidAttackTargets, type AttackTarget } from '../zones/targeting.js';
import { canAfford, computeMaxX, getReducedCardCost } from './cost-checker.js';
import { computeSpellTargeting } from './spell-targeting.js';
import {
  cardHasActiveTrait,
  cardHasStatus,
  getMaxMovesPerTurn,
  getRuntimeCardAbilities,
  getRuntimeCardTraits,
} from '../state/runtime-card-helpers.js';

// ── Result Types ──────────────────────────────────────────────────────────────

export interface AvailableActions {
  readonly canDeploy: readonly DeployOption[];
  readonly canCastSpell: readonly CastSpellOption[];
  readonly canAttachEquipment: readonly EquipOption[];
  readonly canRemoveEquipment: readonly RemoveEquipmentOption[];
  readonly canTransferEquipment: readonly TransferEquipmentOption[];
  readonly canMove: readonly MoveOption[];
  readonly canActivateAbility: readonly ActivateOption[];
  readonly canActivateHeroAbility: readonly HeroActivateOption[];
  readonly canAttack: readonly AttackOption[];
  readonly canDiscardForEnergy: boolean;
  readonly canTransform: boolean;
  readonly canEndPhase: boolean;
}

export interface DeployOption {
  readonly cardInstanceId: string;
  readonly validSlots: readonly { readonly zone: ZoneType; readonly slots: readonly number[] }[];
  readonly cost: ResourceCost;
  readonly isXCost: boolean;
  readonly maxX: number;
}

export interface CastSpellOption {
  readonly cardInstanceId: string;
  readonly cost: ResourceCost;
  readonly needsTarget: boolean;
  readonly validTargets: readonly string[];
}

export interface EquipOption {
  readonly cardInstanceId: string;
  readonly validTargets: readonly string[];
  readonly cost: ResourceCost;
}

export interface RemoveEquipmentOption {
  readonly cardInstanceId: string;
  readonly equipmentInstanceId: string;
}

export interface TransferEquipmentOption {
  readonly cardInstanceId: string;
  readonly equipmentInstanceId: string;
  readonly validTargets: readonly string[];
  readonly cost: ResourceCost;
}

export interface MoveOption {
  readonly cardInstanceId: string;
  readonly fromZone: ZoneType;
  readonly validSlots: readonly { readonly zone: ZoneType; readonly slotIndex: number }[];
}

export interface ActivateOption {
  readonly cardInstanceId: string;
  readonly abilityIndex: number;
  readonly cost: ResourceCost;
}

export interface HeroActivateOption {
  readonly abilityIndex: number;
  readonly cost: ResourceCost;
  readonly needsTarget: boolean;
  readonly validTargets: readonly string[];
}

export interface AttackOption {
  readonly attackerInstanceId: string;
  readonly validTargets: readonly AttackTarget[];
}

// ── Main Computation ──────────────────────────────────────────────────────────

export function computeAvailableActions(state: GameState): AvailableActions {
  if (state.pendingChoice !== null) {
    return {
      canDeploy: [],
      canCastSpell: [],
      canAttachEquipment: [],
      canRemoveEquipment: [],
      canTransferEquipment: [],
      canMove: [],
      canActivateAbility: [],
      canActivateHeroAbility: [],
      canAttack: [],
      canDiscardForEnergy: false,
      canTransform: false,
      canEndPhase: false,
    };
  }

  const player = state.players[state.activePlayerIndex]!;
  const opponentIndex = state.activePlayerIndex === 0 ? 1 : 0;
  const opponent = state.players[opponentIndex]!;
  const isTransform = state.phase === 'transform';
  const isStrategy = state.phase === 'strategy';
  const isAction = state.phase === 'action';
  const firstPlayerAttackLock =
    state.turnState.firstPlayerFirstTurn &&
    state.firstPlayerId === state.activePlayerIndex;

  return {
    canDeploy: isStrategy ? computeDeployOptions(player) : [],
    canCastSpell: isStrategy ? computeSpellOptions(state, player) : [],
    canAttachEquipment: isStrategy ? computeEquipOptions(player) : [],
    canRemoveEquipment: isStrategy ? computeRemoveEquipmentOptions(player) : [],
    canTransferEquipment: isStrategy ? computeTransferEquipmentOptions(player) : [],
    canMove: isStrategy ? computeMoveOptions(player, state.turnNumber) : [],
    canActivateAbility: isStrategy ? computeActivateOptions(player, state) : [],
    canActivateHeroAbility: isStrategy ? computeHeroActivateOptions(player, state) : [],
    canAttack: isAction && !firstPlayerAttackLock ? computeAttackOptions(player, opponent) : [],
    canDiscardForEnergy: isStrategy && computeCanDiscardForEnergy(player, state),
    canTransform: isTransform && computeCanTransform(state, player),
    canEndPhase: isTransform || isStrategy || isAction,
  };
}

// ── Deploy ────────────────────────────────────────────────────────────────────

function computeDeployOptions(player: PlayerState): readonly DeployOption[] {
  const options: DeployOption[] = [];

  for (const card of player.hand) {
    if (card.cardType !== 'C') continue;
    const reducedCost = getReducedCardCost(player, card);
    if (!canAfford(player, reducedCost)) continue;

    const validSlots = [...getValidDeploySlots(player)];
    if (cardHasActiveTrait(card, 'elite')) {
      const highGroundSlots = getOpenSlotIndices(player, 'high_ground');
      if (highGroundSlots.length > 0 && canAfford(player, addFlexibleCost(reducedCost, 2))) {
        validSlots.push({ zone: 'high_ground', slots: highGroundSlots });
      }
    }
    if (validSlots.length > 0) {
      const isXCost = card.cost.xMana === true || card.cost.xEnergy === true;
      options.push({
        cardInstanceId: card.instanceId,
        validSlots,
        cost: reducedCost,
        isXCost,
        maxX: isXCost ? computeMaxX(player, reducedCost) : 0,
      });
    }
  }

  return options;
}

function getValidDeploySlots(
  player: PlayerState,
): readonly { readonly zone: ZoneType; readonly slots: readonly number[] }[] {
  const result: { readonly zone: ZoneType; readonly slots: readonly number[] }[] = [];

  // Characters deploy to Frontline or Reserve
  const deployZones: readonly ZoneType[] = ['frontline', 'reserve'];
  for (const zone of deployZones) {
    const slots = getOpenSlotIndices(player, zone);
    if (slots.length > 0) {
      result.push({ zone, slots });
    }
  }

  return result;
}

function getOpenSlotIndices(
  player: PlayerState,
  zone: ZoneType,
): readonly number[] {
  const arr = zone === 'reserve'
    ? player.zones.reserve
    : zone === 'frontline'
      ? player.zones.frontline
      : player.zones.highGround;

  const indices: number[] = [];
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] === null) indices.push(i);
  }
  return indices;
}

// ── Spells ────────────────────────────────────────────────────────────────────

function computeSpellOptions(
  state: GameState,
  player: PlayerState,
): readonly CastSpellOption[] {
  const options: CastSpellOption[] = [];
  const controllerId = state.activePlayerIndex;

  for (const card of player.hand) {
    if (card.cardType !== 'S') continue;
    const reducedCost = getReducedCardCost(player, card);
    if (!canAfford(player, reducedCost)) continue;

    const { needsTarget, validTargets } = computeSpellTargeting(
      state,
      controllerId,
      card,
    );

    options.push({
      cardInstanceId: card.instanceId,
      cost: reducedCost,
      needsTarget,
      validTargets,
    });
  }

  return options;
}

// ── Equipment ─────────────────────────────────────────────────────────────────

function computeEquipOptions(player: PlayerState): readonly EquipOption[] {
  const options: EquipOption[] = [];
  const boardCharacters = getAllCards(player.zones).filter(c => c.cardType === 'C');

  for (const card of player.hand) {
    if (card.cardType !== 'E') continue;
    const reducedCost = getReducedCardCost(player, card);
    if (!canAfford(player, reducedCost)) continue;

    const targets = boardCharacters
      .filter(c => canAttachEquipmentToTarget(card, c))
      .map(c => c.instanceId);

    if (targets.length > 0) {
      options.push({
        cardInstanceId: card.instanceId,
        validTargets: targets,
        cost: reducedCost,
      });
    }
  }

  return options;
}

function computeRemoveEquipmentOptions(player: PlayerState): readonly RemoveEquipmentOption[] {
  return getAllCards(player.zones)
    .filter(card => card.equipment !== null)
    .map(card => ({
      cardInstanceId: card.instanceId,
      equipmentInstanceId: card.equipment!.instanceId,
    }));
}

function computeTransferEquipmentOptions(player: PlayerState): readonly TransferEquipmentOption[] {
  const boardCharacters = getAllCards(player.zones).filter(c => c.cardType === 'C');
  const options: TransferEquipmentOption[] = [];

  for (const card of boardCharacters) {
    const equipment = card.equipment;
    if (equipment === null || equipment.transferredThisTurn) {
      continue;
    }

    const transferCost = getReducedCardCost(player, equipment);
    if (!canAfford(player, transferCost)) {
      continue;
    }

    const validTargets = boardCharacters
      .filter(target => target.instanceId !== card.instanceId && canAttachEquipmentToTarget(equipment, target))
      .map(target => target.instanceId);
    if (validTargets.length === 0) {
      continue;
    }

    options.push({
      cardInstanceId: card.instanceId,
      equipmentInstanceId: equipment.instanceId,
      validTargets,
      cost: transferCost,
    });
  }

  return options;
}

// ── Movement ──────────────────────────────────────────────────────────────────

const ADJACENT: ReadonlyMap<ZoneType, readonly ZoneType[]> = new Map([
  ['reserve', ['frontline']],
  ['frontline', ['reserve', 'high_ground']],
  ['high_ground', ['frontline']],
]);

function computeMoveOptions(
  player: PlayerState,
  turnNumber: number,
): readonly MoveOption[] {
  const options: MoveOption[] = [];
  const zones: readonly ZoneType[] = ['reserve', 'frontline', 'high_ground'];

  for (const zone of zones) {
    const cards = getCardsInZone(player.zones, zone);
    for (const card of cards) {
      const maxMoves = getMaxMovesPerTurn(card, turnNumber);
      if (
        card.exhausted ||
        card.summoningSick ||
        card.movesThisTurn >= maxMoves ||
        cardHasStatus(card, 'slowed')
      ) continue;

      const adjacentZones = ADJACENT.get(zone) ?? [];
      const validSlots = adjacentZones.flatMap(destination =>
        getOpenSlotIndices(player, destination).map(slotIndex => ({
          zone: destination,
          slotIndex,
        })),
      );

      if (validSlots.length > 0) {
        options.push({
          cardInstanceId: card.instanceId,
          fromZone: zone,
          validSlots,
        });
      }
    }
  }

  return options;
}

// ── Ability Activation ────────────────────────────────────────────────────────

function computeActivateOptions(
  player: PlayerState,
  state: GameState,
): readonly ActivateOption[] {
  const options: ActivateOption[] = [];
  const allCards = getAllCards(player.zones);

  for (const card of allCards) {
    const abilities = getRuntimeCardAbilities(card);
    for (let i = 0; i < abilities.length; i++) {
      const ability = abilities[i]!;
      if (ability.type !== 'triggered') continue;

      const triggered = ability as TriggeredAbilityDSL;
      if (triggered.trigger.type !== 'activated') continue;

      const activatedTrigger = triggered.trigger;
      if (card.exhausted || card.summoningSick || card.abilitiesSuppressed) continue;

      const cooldown = card.abilityCooldowns.get(i);
      if (cooldown !== undefined && cooldown > 0) continue;

      if (card.activatedAbilityTurns.get(i) === state.turnNumber) continue;

      if (!canAfford(player, activatedTrigger.cost)) continue;

      options.push({
        cardInstanceId: card.instanceId,
        abilityIndex: i,
        cost: activatedTrigger.cost,
      });
    }
  }

  return options;
}

// ── Hero Ability Activation ──────────────────────────────────────────────────

function computeHeroActivateOptions(
  player: PlayerState,
  state: GameState,
): readonly HeroActivateOption[] {
  const options: HeroActivateOption[] = [];
  const hero = player.hero;

  for (let i = 0; i < hero.abilities.length; i++) {
    const ability = hero.abilities[i]!;
    if (ability.type !== 'triggered') continue;

    const triggered = ability as TriggeredAbilityDSL;
    if (triggered.trigger.type !== 'activated') continue;

    const activatedTrigger = triggered.trigger;

    // Check cooldown
    const cooldown = hero.cooldowns.get(i);
    if (cooldown !== undefined && cooldown > 0) continue;

    // Check once-per-game
    if (activatedTrigger.oncePerGame === true) {
      if (hero.usedUltimateAbilityIndices.includes(i)) continue;
    }

    if (hero.activatedAbilityTurns.get(i) === state.turnNumber) continue;

    // Can't activate on the turn hero transforms
    if (hero.transformedThisTurn && activatedTrigger.oncePerGame === true) continue;

    if (!canAfford(player, activatedTrigger.cost)) continue;

    options.push({
      abilityIndex: i,
      cost: activatedTrigger.cost,
      needsTarget: false,
      validTargets: [],
    });
  }

  return options;
}

// ── Attack ────────────────────────────────────────────────────────────────────

function computeAttackOptions(
  player: PlayerState,
  opponent: PlayerState,
): readonly AttackOption[] {
  const options: AttackOption[] = [];
  const zones: readonly ZoneType[] = ['reserve', 'frontline', 'high_ground'];

  for (const zone of zones) {
    const cards = getCardsInZone(player.zones, zone);
    for (const card of cards) {
      if (card.exhausted || card.summoningSick) continue;

      const traits = getRuntimeCardTraits(card);
      // Haste bypasses summoning sickness (already handled by not being summoningSick)

      const targets = getValidAttackTargets(
        zone,
        traits,
        opponent.zones,
      );

      if (targets.length > 0) {
        options.push({
          attackerInstanceId: card.instanceId,
          validTargets: targets,
        });
      }
    }
  }

  return options;
}


// ── Discard for Energy ────────────────────────────────────────────────────────

function computeCanDiscardForEnergy(
  player: PlayerState,
  state: GameState,
): boolean {
  return player.hand.length > 0 && !state.turnState.discardedForEnergy;
}

// ── Transform ─────────────────────────────────────────────────────────────────

function computeCanTransform(state: GameState, player: PlayerState): boolean {
  const hero = player.hero;

  if (
    hero.transformed ||
    !hero.canTransformThisGame ||
    hero.transformedThisTurn ||
    hero.transformedCardDefId === null
  ) {
    return false;
  }

  // Standard transform condition: LP ≤ 10
  // OR: has ≥5 fewer resources than opponent AND no characters on board
  // Simplified to LP check for now — full check requires opponent state
  if (hero.currentLp <= 10) {
    return true;
  }

  const opponentIndex = state.activePlayerIndex === 0 ? 1 : 0;
  const opponent = state.players[opponentIndex]!;
  const resourceGap = opponent.resourceBank.length - player.resourceBank.length;
  return resourceGap >= 5 && getAllCards(player.zones).length === 0;
}

function addFlexibleCost(cost: ResourceCost, amount: number): ResourceCost {
  return {
    ...cost,
    flexible: cost.flexible + amount,
  };
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
