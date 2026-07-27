/**
 * Available Actions — computes all legal actions for the active player.
 * Called each time the UI needs to know what the player can do.
 */
import type { GameState, PlayerState, CardInstance } from '../types/game-state.js';
import type { ResourceCost, ResourceType, ZoneType } from '../types/common.js';
import type { AbilityDSL } from '../types/ability.js';
import { hasOpenSlot, getAllCards, getCardsInZone } from '../zones/zone-manager.js';
import { getValidAttackTargets, type AttackTarget } from '../zones/targeting.js';
import { canAfford, effectiveCost } from './cost-checker.js';
import { isFlashSpell } from './reactive-actions.js';
import { meetsEquipRequirement } from './equip-eligibility.js';
import { isReserveTapEligible } from './reserve-tap.js';
import { evaluateCondition } from '../effects/condition-evaluator.js';
import { effectiveTraits, hasEffectiveTrait } from '../selectors/card-semantics.js';

// ── Result Types ──────────────────────────────────────────────────────────────

export interface AvailableActions {
  readonly canDeploy: readonly DeployOption[];
  readonly canCastSpell: readonly CastSpellOption[];
  readonly canAttachEquipment: readonly EquipOption[];
  readonly canRemoveEquipment: readonly RemoveEquipmentOption[];
  readonly canTransferEquipment: readonly TransferEquipmentOption[];
  readonly canMove: readonly MoveOption[];
  readonly canActivateAbility: readonly ActivateOption[];
  readonly canAttack: readonly AttackOption[];
  readonly canDiscardForEnergy: boolean;
  readonly canTransform: boolean;
  readonly canEndPhase: boolean;
  /** Instance ids of ready Reserve characters the active player MAY exhaust for
   * +1 temporary resource (Rulebook 8 step 4). Non-empty only under
   * `config.reserveTapChoice`; empty array otherwise (legacy automatic mode). */
  readonly canTapReserve: readonly string[];
}

export interface DeployOption {
  readonly cardInstanceId: string;
  readonly validSlots: readonly DeploySlotGroup[];
  readonly cost: ResourceCost;
  readonly xValues?: readonly number[];
}

/** A deployable zone with its open slot indices and any cost surcharge (Elite pays
 * +2 to deploy directly to High Ground — Rulebook 16). `surcharge` is 0 normally. */
export interface DeploySlotGroup {
  readonly zone: ZoneType;
  readonly slots: readonly number[];
  readonly surcharge: number;
}

export interface CastSpellOption {
  readonly cardInstanceId: string;
  readonly cost: ResourceCost;
  readonly xValues?: readonly number[];
}

export interface EquipOption {
  readonly cardInstanceId: string;
  readonly validTargets: readonly string[];
  readonly cost: ResourceCost;
  readonly xValues?: readonly number[];
}

export interface RemoveEquipmentOption {
  readonly equipmentInstanceId: string;
  readonly holderInstanceId: string;
}

export interface TransferEquipmentOption {
  readonly equipmentInstanceId: string;
  readonly holderInstanceId: string;
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
  readonly xValues?: readonly number[];
}

export interface AttackOption {
  readonly attackerInstanceId: string;
  readonly validTargets: readonly AttackTarget[];
}

// ── Main Computation ──────────────────────────────────────────────────────────

export function computeAvailableActions(state: GameState): AvailableActions {
  const player = state.players[state.activePlayerIndex];
  const opponentIndex = state.activePlayerIndex === 0 ? 1 : 0;
  const opponent = state.players[opponentIndex];
  const isStrategy = state.phase === 'strategy';
  const isAction = state.phase === 'action';
  const isReserveEnergyWindow =
    state.phase === 'upkeep' &&
    state.config?.reserveTapChoice === true &&
    state.config.authoritativeTransitions === true &&
    state.turnState.upkeepActionWindow === 'reserve_energy';
  // RULES-ACCURACY FIX (config.transformAtStartOfTurn): the engine machine
  // pauses in a start-of-turn transform window (phase still 'upkeep') only
  // when this flag is ON — see game-machine.ts's startOfTurnTransform state.
  // Absent/false ⇒ semantically invariant no-op (this is always false, since the
  // engine never pauses there when the flag is off).
  const isStartOfTurnWindow =
    state.phase === 'upkeep' &&
    state.config?.transformAtStartOfTurn === true &&
    state.turnState.upkeepActionWindow === 'transform';
  // FLASH-AT-WILL (config.flashAtWill — engine ticket Tier 3, part 1): Flash is
  // usable "at any time" per the Rulebook, not just proactively in Strategy.
  // Widens the ACTIVE player's proactive cast surface to the Flash-tagged
  // subset of hand spells during the Action Phase too (non-Flash spells stay
  // Strategy-only). See game-state.ts's GameConfig.flashAtWill for the known
  // opponent's-turn limitation. Absent/false ⇒ semantically invariant no-op.
  const flashAtWillInAction = isAction && state.config?.flashAtWill === true;

  return {
    canDeploy: isStrategy ? computeDeployOptions(player, state) : [],
    canCastSpell: isStrategy
      ? computeSpellOptions(player, state)
      : flashAtWillInAction
        ? computeSpellOptions(player, state, true)
        : [],
    canAttachEquipment: isStrategy ? computeEquipOptions(player, state) : [],
    canRemoveEquipment: isStrategy ? computeRemoveEquipmentOptions(player) : [],
    canTransferEquipment: isStrategy ? computeTransferEquipmentOptions(player, state) : [],
    // Rulebook §§8–9: ordinary movement and Trigger/Ultimate activation are
    // Strategy actions. Counter/Flash reactions use computeReactiveActions
    // during priority windows; proactive Flash spells remain available in the
    // Action phase through canCastSpell above.
    canMove: isStrategy ? computeMoveOptions(player) : [],
    canActivateAbility: isStrategy ? computeActivateOptions(player, state) : [],
    canAttack: isAction ? computeAttackOptions(player, opponent, state) : [],
    canDiscardForEnergy: isStrategy && computeCanDiscardForEnergy(player, state),
    // Current rules replace the historical Strategy timing with the exclusive
    // start-of-turn window. Profiles without the timing flag retain the legacy
    // Strategy surface for replay compatibility.
    canTransform:
      (state.config?.transformAtStartOfTurn === true
        ? isStartOfTurnWindow
        : isStrategy) && canTransform(state),
    canEndPhase:
      isStrategy || isAction || isReserveEnergyWindow || isStartOfTurnWindow,
    canTapReserve:
      (state.config?.authoritativeTransitions === true
        ? isReserveEnergyWindow
        : isStrategy) && state.config?.reserveTapChoice === true
        ? player.zones.reserve
            .filter(
              (c): c is NonNullable<typeof c> =>
                c !== null && isReserveTapEligible(c, state.config),
            )
            .map((c) => c.instanceId)
        : [],
  };
}

function computeRemoveEquipmentOptions(
  player: PlayerState,
): readonly RemoveEquipmentOption[] {
  return getAllCards(player.zones)
    .filter((card) => card.equipment !== null)
    .map((card) => ({
      equipmentInstanceId: card.equipment!.instanceId,
      holderInstanceId: card.instanceId,
    }));
}

function computeTransferEquipmentOptions(
  player: PlayerState,
  state: GameState,
): readonly TransferEquipmentOption[] {
  const board = getAllCards(player.zones).filter((card) => card.cardType === 'C');
  const options: TransferEquipmentOption[] = [];
  for (const holder of board) {
    const equipment = holder.equipment;
    if (equipment === null || equipment.transferredThisTurn === true) continue;
    const cost = effectiveCost(player, equipment, state.config);
    if (!canAfford(player, cost)) continue;
    const validTargets = board
      .filter(
        (candidate) =>
          candidate.instanceId !== holder.instanceId &&
          candidate.equipment === null &&
          meetsEquipRequirement(equipment, candidate),
      )
      .map((candidate) => candidate.instanceId);
    if (validTargets.length > 0) {
      options.push({
        equipmentInstanceId: equipment.instanceId,
        holderInstanceId: holder.instanceId,
        validTargets,
        cost,
      });
    }
  }
  return options;
}

// ── Deploy ────────────────────────────────────────────────────────────────────

/** Elite characters may deploy directly to High Ground for +2 resources (Rulebook 16). */
export const ELITE_HIGH_GROUND_SURCHARGE = 2;

function computeDeployOptions(player: PlayerState, state: GameState): readonly DeployOption[] {
  const options: DeployOption[] = [];

  for (const card of player.hand) {
    if (card.cardType !== 'C') continue;
    const baseCost = effectiveCost(player, card, state.config);
    if (!canAfford(player, baseCost)) continue;

    // Only offer a slot group the player can actually pay for (the High-Ground
    // group carries the Elite +2 surcharge and may be unaffordable).
    const validSlots = getValidDeploySlots(player, card, state).filter((g) =>
      canAfford(player, withSurcharge(baseCost, g.surcharge)),
    );
    if (validSlots.length > 0) {
      options.push({
        cardInstanceId: card.instanceId,
        validSlots,
        cost: card.cost,
        ...(card.xCostResource !== undefined
          ? { xValues: legalXValues(player, baseCost, card.xCostResource) }
          : {}),
      });
    }
  }

  return options;
}

function withSurcharge(cost: ResourceCost, surcharge: number): ResourceCost {
  return surcharge > 0 ? { ...cost, flexible: cost.flexible + surcharge } : cost;
}

function getValidDeploySlots(
  player: PlayerState,
  card: CardInstance,
  state: GameState,
): readonly DeploySlotGroup[] {
  const result: DeploySlotGroup[] = [];

  // Characters deploy to Frontline or Reserve at no surcharge.
  const deployZones: readonly ZoneType[] = ['frontline', 'reserve'];
  for (const zone of deployZones) {
    const slots = getOpenSlotIndices(player, zone);
    if (slots.length > 0) {
      result.push({ zone, slots, surcharge: 0 });
    }
  }

  // High-Ground deploy. Default: only Elite, for +2 (Rulebook 16) — other characters
  // must move there from the Frontline. DESIGN-SWEEP (config.directHighGroundDeploy):
  // ANY character may deploy directly to High Ground at NO surcharge.
  const directHg = state.config?.directHighGroundDeploy === true;
  if (hasElite(card) || directHg) {
    const hgSlots = getOpenSlotIndices(player, 'high_ground');
    if (hgSlots.length > 0) {
      const surcharge = directHg ? 0 : ELITE_HIGH_GROUND_SURCHARGE;
      result.push({ zone: 'high_ground', slots: hgSlots, surcharge });
    }
  }

  return result;
}

function hasElite(card: CardInstance): boolean {
  return hasEffectiveTrait(card, 'elite');
}

function getOpenSlotIndices(player: PlayerState, zone: ZoneType): readonly number[] {
  const arr =
    zone === 'reserve'
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
  player: PlayerState,
  state: GameState,
  flashOnly = false,
): readonly CastSpellOption[] {
  const options: CastSpellOption[] = [];

  for (const card of player.hand) {
    if (card.cardType !== 'S') continue;
    if (flashOnly && !isFlashSpell(card)) continue;
    if (!canAfford(player, effectiveCost(player, card, state.config))) continue;
    options.push({
      cardInstanceId: card.instanceId,
      cost: card.cost,
      ...(card.xCostResource !== undefined
        ? {
            xValues: legalXValues(
              player,
              effectiveCost(player, card, state.config),
              card.xCostResource,
            ),
          }
        : {}),
    });
  }

  return options;
}

// ── Equipment ─────────────────────────────────────────────────────────────────

function computeEquipOptions(player: PlayerState, state: GameState): readonly EquipOption[] {
  const options: EquipOption[] = [];
  const boardCharacters = getAllCards(player.zones).filter((c) => c.cardType === 'C');

  for (const card of player.hand) {
    if (card.cardType !== 'E') continue;
    if (!canAfford(player, effectiveCost(player, card, state.config))) continue;

    // Equipment may attach to any eligible character (Rulebook 13). A character that
    // already holds equipment is still a legal target — the old piece is destroyed
    // before the new one attaches (handled at execution). Eligibility honors the
    // equipment's alignment/Tag requirement.
    const targets = boardCharacters
      .filter((c) => meetsEquipRequirement(card, c))
      .map((c) => c.instanceId);

    if (targets.length > 0) {
      options.push({
        cardInstanceId: card.instanceId,
        validTargets: targets,
        cost: card.cost,
        ...(card.xCostResource !== undefined
          ? {
              xValues: legalXValues(
                player,
                effectiveCost(player, card, state.config),
                card.xCostResource,
              ),
            }
          : {}),
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
      // Swift / Rush X grants free moves that ignore the exhaust / once-per-turn
      // gates (Rulebook 16). A character with free moves left may always move.
      const hasFreeMove = (card.freeMovesRemaining ?? 0) > 0;
      if (!hasFreeMove && (card.exhausted || card.movedThisTurn)) continue;

      const adjacentZones = ADJACENT.get(zone) ?? [];
      const validDests = adjacentZones.filter((z) => hasOpenSlot(player.zones, z));

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

function computeActivateOptions(player: PlayerState, state: GameState): readonly ActivateOption[] {
  const options: ActivateOption[] = [];
  // Battlefield cards plus the Hero — Hero (Trigger/Ultimate) abilities are
  // activatable in the Strategy Phase and addressed via a `hero_<cardDefId>` id.
  // The Hero is never summoning-sick/exhausted; characters are gated below.
  const sources: readonly {
    id: string;
    abilities: readonly AbilityDSL[];
    card?: CardInstance;
  }[] = [
    { id: heroInstanceId(player), abilities: player.hero.abilities },
    ...getAllCards(player.zones).map((c) => ({
      id: c.instanceId,
      abilities: c.abilities,
      card: c,
    })),
  ];

  for (const src of sources) {
    // Summoning sickness gates activated abilities just like attacks (Rulebook 3):
    // a sick or exhausted character cannot use an activated ability. A character
    // exhausted for Reserve Energy has all abilities disabled (Rulebook 8 step 4).
    if (src.card !== undefined && !canActivateFrom(src.card)) continue;
    for (let i = 0; i < src.abilities.length; i++) {
      const ability = src.abilities[i]!;
      if (ability.type !== 'triggered') continue;

      const triggered = ability;
      if (triggered.trigger.type !== 'activated') continue;

      const activatedTrigger = triggered.trigger;
      if (
        triggered.abilityKind === 'ultimate' &&
        player.hero.transformedThisTurn
      ) {
        continue;
      }

      // Once-per-game: a single prior activation (anywhere in the log) locks it out
      // for the rest of the game (e.g. transformed-Hero Ultimates ids 3/41/103).
      if (activatedTrigger.oncePerGame === true && activatedAnyTime(state, src.id, i)) {
        continue;
      }

      // Once-per-turn — honored both at the trigger level (Activated.oncePerTurn) and
      // at the DSL top level (TriggeredAbilityDSL.oncePerTurn, e.g. Sapphire Lens id 100).
      if (
        (activatedTrigger.oncePerTurn === true || triggered.oncePerTurn === true) &&
        activatedThisTurn(state, src.id, i)
      ) {
        continue;
      }

      // Check cooldown — after activating, the ability is unusable for N of this
      // player's turns (Rulebook: "Cooldown N … N of your turns after the turn
      // you activated it"). It becomes available once N of this player's
      // TURN_STARTs have elapsed since the last activation.
      if (onCooldown(state, src.id, i, activatedTrigger.cooldown)) continue;

      // RULES-ACCURACY FIX (config.heroAbilitiesOncePerTurn): every Hero
      // activated ability (Trigger/Counter/Flash/Ultimate) may be used only
      // once per turn, regardless of any per-ability DSL oncePerTurn flag.
      // Applies ONLY to the Hero (src.card is undefined for the Hero
      // pseudo-source above); character activated abilities are unaffected.
      // Absent/false ⇒ semantically invariant no-op.
      if (
        state.config?.heroAbilitiesOncePerTurn === true &&
        src.card === undefined &&
        activatedThisTurn(state, src.id, i)
      ) {
        continue;
      }

      if (!canAfford(player, activatedTrigger.cost)) continue;

      options.push({
        cardInstanceId: src.id,
        abilityIndex: i,
        cost: activatedTrigger.cost,
        ...(triggered.xCostResource !== undefined
          ? {
              xValues: legalXValues(
                player,
                activatedTrigger.cost,
                triggered.xCostResource,
              ),
            }
          : {}),
      });
    }
  }

  return options;
}

export function legalXValues(
  player: PlayerState,
  baseCost: ResourceCost,
  resource: ResourceType,
): readonly number[] {
  const available = player.resourceBank.filter(
    (card) => !card.exhausted && card.resourceType === resource,
  ).length;
  const values: number[] = [];
  for (let x = 0; x <= available; x++) {
    const cost = {
      ...baseCost,
      [resource]: baseCost[resource] + x,
    };
    if (canAfford(player, cost)) values.push(x);
  }
  return values;
}

/** Whether a battlefield character may use an activated ability right now: not
 * summoning-sick, not exhausted, and not exhausted for Reserve Energy (Rulebook 3/8).
 * Non-character permanents (Equipment auras live on their host) are unrestricted. */
function canActivateFrom(card: CardInstance): boolean {
  if (card.cardType !== 'C') return true;
  return !card.summoningSick && !card.exhausted && card.reserveEnergyExhausted !== true;
}

/** True if `sourceId`'s ability `abilityIndex` was activated anywhere in the log. */
function activatedAnyTime(state: GameState, sourceId: string, abilityIndex: number): boolean {
  return state.log.some(
    (e) =>
      e.type === 'ABILITY_ACTIVATED' &&
      e.cardInstanceId === sourceId &&
      e.abilityIndex === abilityIndex,
  );
}

/** True if `sourceId`'s ability `abilityIndex` was activated since the most recent
 * TURN_START — i.e. during the current turn (once-per-turn reads only this turn). */
function activatedThisTurn(state: GameState, sourceId: string, abilityIndex: number): boolean {
  let turnStart = 0;
  for (let i = state.log.length - 1; i >= 0; i--) {
    if (state.log[i]!.type === 'TURN_START') {
      turnStart = i;
      break;
    }
  }
  for (let i = turnStart; i < state.log.length; i++) {
    const e = state.log[i]!;
    if (
      e.type === 'ABILITY_ACTIVATED' &&
      e.cardInstanceId === sourceId &&
      e.abilityIndex === abilityIndex
    ) {
      return true;
    }
  }
  return false;
}

/**
 * True if the ability at `abilityIndex` on `sourceId` is still on cooldown for the
 * active player. Cooldown N means: after the last activation, the ability stays
 * unusable until N of this player's turns have elapsed. We count the active
 * player's TURN_START events logged after the most recent activation; the ability
 * is available again once that count reaches the authored cooldown. cooldown 0 /
 * undefined imposes no restriction. Transformation naturally resets cooldowns: the
 * transformed Hero has a new `hero_<cardDefId>` id, so no prior activations match.
 */
function onCooldown(
  state: GameState,
  sourceId: string,
  abilityIndex: number,
  cooldown: number | undefined,
): boolean {
  if (cooldown === undefined || cooldown <= 0) return false;

  let lastActivationIdx = -1;
  for (let idx = state.log.length - 1; idx >= 0; idx--) {
    const e = state.log[idx]!;
    if (
      e.type === 'ABILITY_ACTIVATED' &&
      e.cardInstanceId === sourceId &&
      e.abilityIndex === abilityIndex
    ) {
      lastActivationIdx = idx;
      break;
    }
  }
  if (lastActivationIdx === -1) return false;

  let ownTurnsElapsed = 0;
  for (let idx = lastActivationIdx + 1; idx < state.log.length; idx++) {
    const e = state.log[idx]!;
    if (e.type === 'TURN_START' && e.playerId === state.activePlayerIndex) {
      ownTurnsElapsed++;
    }
  }
  return ownTurnsElapsed < cooldown;
}

/** Stable pseudo-instance id for a player's Hero (used to address Hero abilities). */
export function heroInstanceId(player: PlayerState): string {
  return `hero_${String(player.hero.cardDefId)}`;
}

// ── Attack ────────────────────────────────────────────────────────────────────

function computeAttackOptions(
  player: PlayerState,
  opponent: PlayerState,
  state: GameState,
): readonly AttackOption[] {
  // The first player cannot declare attacks on their first turn (Rulebook 7).
  if (state.turnState.firstPlayerFirstTurn) return [];

  const options: AttackOption[] = [];
  const zones: readonly ZoneType[] = ['reserve', 'frontline', 'high_ground'];

  for (const zone of zones) {
    const cards = getCardsInZone(player.zones, zone);
    for (const card of cards) {
      if (card.exhausted || card.summoningSick) continue;

      const traits = effectiveTraits(card);
      // Haste bypasses summoning sickness (already handled by not being summoningSick)

      const targets = getValidAttackTargets(
        zone,
        traits,
        opponent.zones,
        state.config,
        state.activePlayerIndex,
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

function computeCanDiscardForEnergy(player: PlayerState, state: GameState): boolean {
  // Rule-ablation probe (diagnostic): measures the rule's balance contribution.
  // The grant matches the pitched card's resource type (see executeDiscardForEnergy),
  // so the valve is universal — measured as a reach/aggro subsidy, not faction-bound.
  if (state.config?.disableDiscardForEnergy === true) return false;
  return player.hand.length > 0 && !state.turnState.discardedForEnergy;
}

// ── Transform ─────────────────────────────────────────────────────────────────

export function canTransform(state: GameState): boolean {
  const player = state.players[state.activePlayerIndex];
  const opponent = state.players[state.activePlayerIndex === 0 ? 1 : 0];
  const hero = player.hero;

  if (
    hero.transformData === undefined ||
    hero.transformed ||
    !hero.canTransformThisGame ||
    hero.transformedThisTurn
  ) {
    return false;
  }

  // Standard transform condition: LP ≤ 10
  if (hero.currentLp <= 10) return true;

  // OR: ≥5 fewer resource cards than opponent AND no characters on board.
  const myResources = player.resourceBank.length;
  const oppResources = opponent.resourceBank.length;
  const noCharacters = getAllCards(player.zones).filter((c) => c.cardType === 'C').length === 0;
  if (noCharacters && oppResources - myResources >= 5) return true;

  // OR (termination knob): once this player's Resource Deck is empty at the START of
  // their turn (recorded at Upkeep BEFORE the draw — see TurnState.resourceDeckEmptyAtUpkeep),
  // transform becomes available unconditionally — a comeback enabler that ends stalls.
  if (
    state.config?.terminationMode === 'resource_deck_empty_transform' &&
    state.turnState.resourceDeckEmptyAtUpkeep === true
  ) {
    return true;
  }

  // OR: a Hero's own PRINTED Transformation Trigger condition (kept rare).
  return matchesPrintedTransformTrigger(state, hero);
}

function matchesPrintedTransformTrigger(state: GameState, hero: PlayerState['hero']): boolean {
  if (hero.transformTrigger === undefined) return false;
  return evaluateCondition(state, hero.transformTrigger, {
    sourceInstanceId: `hero_${String(hero.cardDefId)}`,
    controllerId: state.activePlayerIndex,
    triggerDepth: 0,
  });
}
