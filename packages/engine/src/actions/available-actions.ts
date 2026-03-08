/**
 * Available Actions — computes all legal actions for the active player.
 * Called each time the UI needs to know what the player can do.
 */
import type {
  GameState,
  PlayerState,
  CardInstance,
} from '../types/game-state.js';
import type { ResourceCost, ZoneType, Trait } from '../types/common.js';
import type { TriggeredAbilityDSL } from '../types/ability.js';
import { hasOpenSlot, getAllCards, getCardsInZone } from '../zones/zone-manager.js';
import { getValidAttackTargets, type AttackTarget } from '../zones/targeting.js';
import { canAfford } from './cost-checker.js';

// ── Result Types ──────────────────────────────────────────────────────────────

export interface AvailableActions {
  readonly canDeploy: readonly DeployOption[];
  readonly canCastSpell: readonly CastSpellOption[];
  readonly canAttachEquipment: readonly EquipOption[];
  readonly canMove: readonly MoveOption[];
  readonly canActivateAbility: readonly ActivateOption[];
  readonly canAttack: readonly AttackOption[];
  readonly canDiscardForEnergy: boolean;
  readonly canTransform: boolean;
  readonly canEndPhase: boolean;
}

export interface DeployOption {
  readonly cardInstanceId: string;
  readonly validSlots: readonly { readonly zone: ZoneType; readonly slots: readonly number[] }[];
  readonly cost: ResourceCost;
}

export interface CastSpellOption {
  readonly cardInstanceId: string;
  readonly cost: ResourceCost;
}

export interface EquipOption {
  readonly cardInstanceId: string;
  readonly validTargets: readonly string[];
  readonly cost: ResourceCost;
}

export interface MoveOption {
  readonly cardInstanceId: string;
  readonly fromZone: ZoneType;
  readonly validDestinations: readonly ZoneType[];
}

export interface ActivateOption {
  readonly cardInstanceId: string;
  readonly abilityIndex: number;
  readonly cost: ResourceCost;
}

export interface AttackOption {
  readonly attackerInstanceId: string;
  readonly validTargets: readonly AttackTarget[];
}

// ── Main Computation ──────────────────────────────────────────────────────────

export function computeAvailableActions(state: GameState): AvailableActions {
  const player = state.players[state.activePlayerIndex]!;
  const opponentIndex = state.activePlayerIndex === 0 ? 1 : 0;
  const opponent = state.players[opponentIndex]!;
  const isStrategy = state.phase === 'strategy';
  const isAction = state.phase === 'action';

  return {
    canDeploy: isStrategy ? computeDeployOptions(player) : [],
    canCastSpell: isStrategy ? computeSpellOptions(player) : [],
    canAttachEquipment: isStrategy ? computeEquipOptions(player) : [],
    canMove: isStrategy ? computeMoveOptions(player) : [],
    canActivateAbility: isStrategy ? computeActivateOptions(player, state) : [],
    canAttack: isAction ? computeAttackOptions(player, opponent) : [],
    canDiscardForEnergy: isStrategy && computeCanDiscardForEnergy(player, state),
    canTransform: isStrategy && computeCanTransform(player),
    canEndPhase: isStrategy || isAction,
  };
}

// ── Deploy ────────────────────────────────────────────────────────────────────

function computeDeployOptions(player: PlayerState): readonly DeployOption[] {
  const options: DeployOption[] = [];

  for (const card of player.hand) {
    if (card.cardType !== 'C') continue;
    if (!canAfford(player, card.cost)) continue;

    const validSlots = getValidDeploySlots(player);
    if (validSlots.length > 0) {
      options.push({
        cardInstanceId: card.instanceId,
        validSlots,
        cost: card.cost,
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

function computeSpellOptions(player: PlayerState): readonly CastSpellOption[] {
  const options: CastSpellOption[] = [];

  for (const card of player.hand) {
    if (card.cardType !== 'S') continue;
    if (!canAfford(player, card.cost)) continue;
    options.push({ cardInstanceId: card.instanceId, cost: card.cost });
  }

  return options;
}

// ── Equipment ─────────────────────────────────────────────────────────────────

function computeEquipOptions(player: PlayerState): readonly EquipOption[] {
  const options: EquipOption[] = [];
  const boardCharacters = getAllCards(player.zones).filter(c => c.cardType === 'C');

  for (const card of player.hand) {
    if (card.cardType !== 'E') continue;
    if (!canAfford(player, card.cost)) continue;

    // Equipment can target own characters without existing equipment
    const targets = boardCharacters
      .filter(c => c.equipment === null)
      .map(c => c.instanceId);

    if (targets.length > 0) {
      options.push({
        cardInstanceId: card.instanceId,
        validTargets: targets,
        cost: card.cost,
      });
    }
  }

  return options;
}

// ── Movement ──────────────────────────────────────────────────────────────────

const ADJACENT: ReadonlyMap<ZoneType, readonly ZoneType[]> = new Map([
  ['reserve', ['frontline']],
  ['frontline', ['reserve', 'high_ground']],
  ['high_ground', ['frontline']],
]);

function computeMoveOptions(player: PlayerState): readonly MoveOption[] {
  const options: MoveOption[] = [];
  const zones: readonly ZoneType[] = ['reserve', 'frontline', 'high_ground'];

  for (const zone of zones) {
    const cards = getCardsInZone(player.zones, zone);
    for (const card of cards) {
      if (card.exhausted || card.movedThisTurn) continue;

      const adjacentZones = ADJACENT.get(zone) ?? [];
      const validDests = adjacentZones.filter(z => hasOpenSlot(player.zones, z));

      if (validDests.length > 0) {
        options.push({
          cardInstanceId: card.instanceId,
          fromZone: zone,
          validDestinations: validDests,
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
    for (let i = 0; i < card.abilities.length; i++) {
      const ability = card.abilities[i]!;
      if (ability.type !== 'triggered') continue;

      const triggered = ability as TriggeredAbilityDSL;
      if (triggered.trigger.type !== 'activated') continue;

      const activatedTrigger = triggered.trigger;

      // Check cooldown
      if (activatedTrigger.cooldown !== undefined) {
        // Check hero cooldowns if this is a hero ability
        // For card abilities, cooldowns are tracked per-card
        // Simplified: skip if on cooldown (tracked elsewhere in state machine)
      }

      // Check once-per-turn
      if (activatedTrigger.oncePerTurn === true) {
        const alreadyUsed = state.log.some(
          e =>
            e.type === 'ABILITY_ACTIVATED' &&
            e.cardInstanceId === card.instanceId &&
            e.abilityIndex === i,
        );
        if (alreadyUsed) continue;
      }

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

      const traits = allTraits(card);
      // Haste bypasses summoning sickness (already handled by not being summoningSick)

      const targets = getValidAttackTargets(
        zone,
        traits,
        opponent.zones,
        opponent.hero,
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

function allTraits(card: CardInstance): readonly Trait[] {
  return [
    ...card.traits,
    ...card.grantedTraits.map(g => g.trait),
  ];
}

// ── Discard for Energy ────────────────────────────────────────────────────────

function computeCanDiscardForEnergy(
  player: PlayerState,
  state: GameState,
): boolean {
  return player.hand.length > 0 && !state.turnState.discardedForEnergy;
}

// ── Transform ─────────────────────────────────────────────────────────────────

function computeCanTransform(player: PlayerState): boolean {
  const hero = player.hero;

  if (hero.transformed || !hero.canTransformThisGame || hero.transformedThisTurn) {
    return false;
  }

  // Standard transform condition: LP ≤ 10
  // OR: has ≥5 fewer resources than opponent AND no characters on board
  // Simplified to LP check for now — full check requires opponent state
  return hero.currentLp <= 10;
}
