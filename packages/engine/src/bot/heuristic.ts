/**
 * Heuristic Bot Policy — pure functions that choose actions for the active player
 * given a GameState. Used to drive skilled self-play so the simulator exercises the
 * full ability layer (transforms, equipment, cost-reduction, X-cost, combat value).
 *
 * No internal/hidden state: every decision is a pure function of GameState. The
 * caller drives the loop (compute action → send to machine → repeat until null).
 */
import type { GameState, PlayerState, CardInstance, GameConfig } from '../types/game-state.js';
import type { PlayerAction } from '../state-machine/types.js';
import type { ZoneType } from '../types/common.js';
import type { Effect } from '../types/effects.js';
import { computeAvailableActions } from '../actions/available-actions.js';
import { computeReactiveActions } from '../actions/reactive-actions.js';
import { getAllCards, hasOpenSlot } from '../zones/zone-manager.js';
import { getAvailableResources, effectiveCost } from '../actions/cost-checker.js';
import { cardResourceType } from '../actions/card-resource.js';
import { reachAffordTypes } from './reach-discard.js';
import { deployValue, intrinsicValue, rampDeployBonus } from './value-pilot.js';
import { calculateHeroDamage } from '../combat/damage-calculator.js';
import { scoreEffects, scoreSpell } from './spell-eval.js';
import { chooseSpellTargets } from './target-select.js';
import { planGangAttack } from './combat-plan.js';
import { simulateCombatExchange, asSimBody } from './combat-sim.js';
import { gameplanFor, type Gameplan } from './gameplan.js';
import { hasEffectiveTrait } from '../selectors/card-semantics.js';
import { resumeAbilityEffects } from '../effects/effect-runner.js';

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Choose the single best action for the active player in the current phase, or
 * `null` to end the phase. Call repeatedly; the caller ends the phase on `null`.
 */
export function chooseAction(state: GameState): PlayerAction | null {
  if (state.winner !== null) return null;
  const acts = computeAvailableActions(state);
  const player = state.players[state.activePlayerIndex];

  if (state.phase === 'strategy') {
    return chooseStrategyAction(state, player, acts);
  }
  if (state.phase === 'action') {
    return chooseCombatAction(state, player, acts);
  }
  return null;
}

// Minimum opponent-perspective spell value worth spending a Counter on (burn a
// scarce reactive card only on real removal/burst, not chaff).
const COUNTER_THRESHOLD = 3;
// Under fair pilot, a lower bar so the bot answers a mid removal / value engine the
// legacy gate let resolve (control mirror: card advantage matters).
const COUNTER_THRESHOLD_FAIR = 2;
// Per-card weight for the fair card-advantage threat term (an enemy draw is a real
// threat to a control responder even with no removal/face on the spell).
const CARD_ADV_THREAT = 0.5;

/**
 * Reactive policy during an open priority window (Rulebook 14). Returns a
 * cast_spell action for the responder, or null to pass. Pure / deterministic.
 *
 * Under legacy rules, counter the newest enemy spell on the stack when it scores
 * high enough. Under the current all-actions response rules, rank every enemy
 * declaration (spell/ability/attack/equip/transfer/move) by projected impact.
 * Among held counters pick the cheapest (tie-break by instanceId). Default is to
 * pass — reactive cards are scarce.
 */
export function chooseReactiveAction(state: GameState): PlayerAction | null {
  const pp = state.pendingPriority;
  if (pp == null || state.winner !== null) return null;
  const responderId = pp.toRespondPlayerId;
  const enemyId = responderId === 0 ? 1 : 0;

  const fair = isFairPilot(state.config);
  const allActions = state.config?.responseWindowsOnAllActions === true;
  const enemyItem = allActions
    ? highestThreatEnemyItem(state, enemyId, responderId, fair)
    : fair
      ? highestThreatEnemySpell(state, enemyId, responderId)
      : newestEnemySpell(state, enemyId);
  if (enemyItem === null) return null;
  const threshold = fair ? COUNTER_THRESHOLD_FAIR : COUNTER_THRESHOLD;
  const threat = allActions
    ? stackItemThreat(state, enemyItem, responderId, fair)
    : spellThreat(state, enemyItem, responderId, fair);
  if (threat < threshold) return null;

  const counters = computeReactiveActions(state, responderId)
    .filter((o) => o.kind === 'counter')
    .sort(
      (a, b) =>
        costTotal(a.cost) - costTotal(b.cost) || a.cardInstanceId.localeCompare(b.cardInstanceId),
    );
  const pick = counters[0];
  if (pick === undefined) return null;
  const xValue = pick.xValues?.at(-1);
  if (pick.source === 'board') {
    // Board reactions carry no selectedTargetIds in PlayerAction; the engine
    // therefore binds them to the newest enemy item. Evaluate that exact item,
    // not an older high-threat item this activation cannot actually name.
    const boardTarget = newestEnemyItem(state, enemyId);
    if (
      boardTarget === null ||
      (allActions
        ? stackItemThreat(state, boardTarget, responderId, fair)
        : spellThreat(state, boardTarget, responderId, fair)) < threshold
    ) {
      return null;
    }
    return {
        type: 'activate_ability',
        cardInstanceId: pick.cardInstanceId,
        abilityIndex: pick.abilityIndex!,
        ...(xValue !== undefined && xValue > 0 ? { xValue } : {}),
      };
  }
  return {
    type: 'cast_spell',
    cardInstanceId: pick.cardInstanceId,
    selectedTargetIds: [enemyItem.id],
    ...(xValue !== undefined && xValue > 0 ? { xValue } : {}),
  };
}

function newestEnemySpell(state: GameState, enemyId: 0 | 1): GameState['stack'][number] | null {
  for (let i = state.stack.length - 1; i >= 0; i--) {
    const item = state.stack[i]!;
    if (item.type === 'spell' && item.controllerId === enemyId) return item;
  }
  return null;
}

function newestEnemyItem(state: GameState, enemyId: 0 | 1): GameState['stack'][number] | null {
  for (let index = state.stack.length - 1; index >= 0; index--) {
    const item = state.stack[index]!;
    if (item.controllerId === enemyId) return item;
  }
  return null;
}

// Threat of an enemy spell to the responder: how much it removes our bodies or
// burns our Hero. scoreSpell underweights face burn (its enemy-hero path is gated
// by a non-enemy target), so add a direct face-damage term over the item's effects.
function spellThreat(
  state: GameState,
  item: GameState['stack'][number],
  responderId: 0 | 1,
  fair: boolean,
): number {
  const enemyId = responderId === 0 ? 1 : 0;
  const caster = state.players[enemyId];
  const responder = state.players[responderId];
  const card =
    caster.discardPile.find((c) => c.instanceId === item.sourceInstanceId) ??
    handCard(caster, item.sourceInstanceId);
  // Threat is scored on the NEUTRAL baseline: scoreSpell conflates the caster's
  // removal/face preference with the responder's valuation of the bodies at risk,
  // so neither seat's gameplan is a clean weight for a counter decision. Keep this
  // reactive estimate unpiloted (original behavior) rather than bake in a murky model.
  const base =
    card !== null
      ? scoreSpell(caster, responder, card, item.xPaid ?? 0, gameplanFor('Neutral'), fair).value
      : 0;
  let face = 0;
  for (const eff of item.effects) {
    if (
      eff.type === 'deal_damage' &&
      eff.target.type === 'hero' &&
      eff.target.side === 'enemy' &&
      eff.amount.type === 'fixed'
    ) {
      face += eff.amount.value;
    }
  }
  // Under fair pilot, add the card-advantage the spell generates — a value engine is
  // a real threat to answer even with no removal/face (Sapphire/Onyx). OFF ⇒ 0.
  const advantage = fair ? cardAdvantageThreat(item.effects) : 0;
  return base + face + advantage;
}

// Sum the card-advantage an enemy spell generates for its caster (its own draw) — the
// value-engine threat the legacy removal/face model is blind to. Fair pilot only.
function cardAdvantageThreat(effects: readonly Effect[]): number {
  let v = 0;
  for (const eff of effects) {
    if (eff.type === 'draw_cards' && eff.player !== 'enemy' && eff.count.type === 'fixed') {
      v += eff.count.value * CARD_ADV_THREAT;
    }
  }
  return v;
}

// Under fair pilot, answer the single highest-threat enemy spell on the stack (not
// merely the newest), so a control responder spends its scarce counter on the real
// threat. Deterministic tie-break by stack id.
function highestThreatEnemySpell(
  state: GameState,
  enemyId: 0 | 1,
  responderId: 0 | 1,
): GameState['stack'][number] | null {
  let best: GameState['stack'][number] | null = null;
  let bestThreat = -Infinity;
  for (const item of state.stack) {
    if (item.type !== 'spell' || item.controllerId !== enemyId) continue;
    const t = spellThreat(state, item, responderId, true);
    if (
      t > bestThreat ||
      (t === bestThreat && best !== null && item.id.localeCompare(best.id) < 0)
    ) {
      bestThreat = t;
      best = item;
    }
  }
  return best;
}

/** Current-rules threat model for every declaration that can open a response
 * window. It deliberately scores declared consequences, not the window kind, so
 * harmless movement is passed while lethal combat or a large attachment is
 * answerable. */
function stackItemThreat(
  state: GameState,
  item: GameState['stack'][number],
  responderId: 0 | 1,
  fair: boolean,
): number {
  if (item.type === 'spell') return spellThreat(state, item, responderId, fair);

  const caster = state.players[item.controllerId];
  const responder = state.players[responderId];
  const effectValue = scoreEffects(
    caster,
    responder,
    item.effects,
    item.xPaid ?? 0,
    gameplanFor('Neutral'),
    true,
  ).value + faceDamageThreat(item.effects, item.xPaid ?? 0);

  switch (item.type) {
    case 'ability':
      return effectValue;
    case 'attack':
      return attackThreat(state, item, responderId);
    case 'equip': {
      const equipment =
        item.declaredCard ??
        findOwnedCard(state, item.controllerId, item.sourceInstanceId);
      return effectValue + (equipment === null ? 0 : intrinsicValue(equipment) * 0.35);
    }
    case 'transfer':
      return transferThreat(state, item);
    case 'move':
      return moveThreat(state, item);
  }
}

function faceDamageThreat(effects: readonly Effect[], xPaid: number): number {
  let total = 0;
  for (const effect of effects) {
    if (
      effect.type === 'deal_damage' &&
      effect.target.type === 'hero' &&
      effect.target.side === 'enemy'
    ) {
      switch (effect.amount.type) {
        case 'fixed':
          total += effect.amount.value;
          break;
        case 'x_cost':
          total += xPaid;
          break;
        case 'dice':
          total += effect.amount.count * ((effect.amount.sides + 1) / 2);
          break;
        case 'count':
          total += Math.min(effect.amount.max ?? 2, 2);
          break;
        case 'event_value':
          total += 2;
          break;
      }
    } else if (effect.type === 'composite') {
      total += faceDamageThreat(effect.effects, xPaid);
    } else if (effect.type === 'conditional') {
      total += Math.max(
        faceDamageThreat(effect.ifTrue, xPaid),
        faceDamageThreat(effect.ifFalse ?? [], xPaid),
      );
    } else if (effect.type === 'choose_one') {
      total += Math.max(
        0,
        ...effect.options.map((option) => faceDamageThreat(option.effects, xPaid)),
      );
    }
  }
  return total;
}

function highestThreatEnemyItem(
  state: GameState,
  enemyId: 0 | 1,
  responderId: 0 | 1,
  fair: boolean,
): GameState['stack'][number] | null {
  let best: GameState['stack'][number] | null = null;
  let bestThreat = -Infinity;
  for (const item of state.stack) {
    if (item.controllerId !== enemyId) continue;
    const threat = stackItemThreat(state, item, responderId, fair);
    if (
      threat > bestThreat ||
      (threat === bestThreat && best !== null && item.id.localeCompare(best.id) < 0)
    ) {
      best = item;
      bestThreat = threat;
    }
  }
  return best;
}

function attackThreat(
  state: GameState,
  item: GameState['stack'][number],
  responderId: 0 | 1,
): number {
  const attacker = findOwnedBattlefieldCard(state, item.controllerId, item.sourceInstanceId);
  if (attacker === null) return 0;
  const targetId = item.targets[0];
  if (targetId === undefined) return 0;

  if (targetId === 'hero' || targetId.startsWith('hero_')) {
    const hero = state.players[responderId].hero;
    const damage = calculateHeroDamage(
      attacker.currentAtk,
      hero.currentArm,
      state.config?.damageScale ?? 1,
    );
    return damage >= hero.currentLp ? 1_000 + damage : damage * 1.5;
  }

  const target = findOwnedBattlefieldCard(state, responderId, targetId);
  if (target === null) return 0;
  const damage = Math.max(0, attacker.currentAtk - target.currentArm);
  return damage >= target.currentHp
    ? intrinsicValue(target)
    : Math.min(damage, target.currentHp);
}

function transferThreat(state: GameState, item: GameState['stack'][number]): number {
  const equipment = findOwnedEquipment(state, item.controllerId, item.sourceInstanceId);
  const from = item.targets[0] === undefined
    ? null
    : findOwnedBattlefieldCard(state, item.controllerId, item.targets[0]);
  const to = item.targets[1] === undefined
    ? null
    : findOwnedBattlefieldCard(state, item.controllerId, item.targets[1]);
  if (equipment === null || to === null) return 0;
  const tacticalUpgrade = Math.max(0, to.currentAtk - (from?.currentAtk ?? 0)) * 0.5;
  return intrinsicValue(equipment) * 0.25 + tacticalUpgrade;
}

function moveThreat(state: GameState, item: GameState['stack'][number]): number {
  const mover = findOwnedBattlefieldCard(state, item.controllerId, item.sourceInstanceId);
  const destination = item.targets[0];
  if (mover === null || destination === undefined) return 0;
  if (destination === 'high_ground') return Math.max(0.5, mover.currentAtk * 0.5);
  if (destination === 'frontline' && hasEffectiveTrait(mover, 'defender')) {
    return 1 + Math.max(0, mover.currentHp + mover.currentArm) * 0.25;
  }
  return 0.5;
}

function findOwnedBattlefieldCard(
  state: GameState,
  owner: 0 | 1,
  instanceId: string,
): CardInstance | null {
  return getAllCards(state.players[owner].zones).find(
    (card) => card.instanceId === instanceId,
  ) ?? null;
}

function findOwnedEquipment(
  state: GameState,
  owner: 0 | 1,
  instanceId: string,
): CardInstance | null {
  for (const card of getAllCards(state.players[owner].zones)) {
    if (card.equipment?.instanceId === instanceId) return card.equipment;
  }
  return null;
}

function findOwnedCard(
  state: GameState,
  owner: 0 | 1,
  instanceId: string,
): CardInstance | null {
  const player = state.players[owner];
  return (
    findOwnedBattlefieldCard(state, owner, instanceId) ??
    player.hand.find((card) => card.instanceId === instanceId) ??
    player.discardPile.find((card) => card.instanceId === instanceId) ??
    null
  );
}

/**
 * Pick option ids in response to a PendingChoice. For mulligan, the caller should
 * use `shouldKeepHand`. For everything else, take the minimum required, preferring
 * the lowest-value cards when discarding.
 */
export function chooseChoiceResponse(state: GameState): readonly string[] {
  const pc = state.pendingChoice;
  if (pc === null) return [];
  const player = state.players[pc.playerId];
  if (pc.type === 'discard_to_hand_limit' || pc.type === 'choose_discard') {
    return lowestValueHandIds(
      player,
      pc.options.map((o) => o.id),
      pc.minSelections,
    );
  }
  if (pc.type === 'choose_trigger_order') {
    return pc.options
      .map((option) => option.id)
      .sort((a, b) => a.localeCompare(b));
  }
  if (pc.continuation !== undefined) {
    const candidates = enumerateChoiceCandidates(pc);
    let best: { ids: readonly string[]; value: number; key: string } | null = null;
    for (const ids of candidates) {
      const projected = resumeAbilityEffects(state, pc, ids).state;
      const value = choiceStateValue(projected, pc.playerId);
      const key = ids.join('\u0000');
      if (
        best === null ||
        value > best.value ||
        (value === best.value && key.localeCompare(best.key) < 0)
      ) {
        best = { ids, value, key };
      }
    }
    if (best !== null) return best.ids;
  }
  // Responses always submit the authoritative option ID. `instanceId` is
  // display metadata and may intentionally differ (trigger-order options use
  // trigger IDs while displaying their source card).
  const ids = pc.options.map((o) => o.id).sort((a, b) => a.localeCompare(b));
  return ids.slice(0, Math.max(pc.minSelections, 0));
}

function enumerateChoiceCandidates(
  choice: NonNullable<GameState['pendingChoice']>,
): readonly (readonly string[])[] {
  const ids = choice.options
    .map((option) => option.id)
    .sort((a, b) => a.localeCompare(b));
  const min = Math.max(0, choice.minSelections);
  const max = Math.min(ids.length, choice.maxSelections);
  const candidates: string[][] = [];
  const build = (start: number, remaining: number, selected: string[]): void => {
    if (remaining === 0) {
      candidates.push([...selected]);
      return;
    }
    for (let index = start; index <= ids.length - remaining; index++) {
      selected.push(ids[index]!);
      build(index + 1, remaining - 1, selected);
      selected.pop();
    }
  };
  for (let count = min; count <= max; count++) build(0, count, []);
  return candidates;
}

function choiceStateValue(state: GameState, playerId: 0 | 1): number {
  if (state.winner === playerId) return 1_000_000;
  if (state.winner !== null && state.winner !== 'draw') return -1_000_000;
  const opponentId: 0 | 1 = playerId === 0 ? 1 : 0;
  const score = (id: 0 | 1): number => {
    const player = state.players[id];
    const board = getAllCards(player.zones).reduce(
      (sum, card) =>
        sum +
        Math.max(0, card.currentAtk) +
        Math.max(0, card.currentHp) +
        0.5 * Math.max(0, card.currentArm),
      0,
    );
    const readyResources = player.resourceBank.filter(
      (resource) => !resource.exhausted,
    ).length;
    return (
      5 * player.hero.currentLp +
      board +
      0.75 * player.hand.length +
      0.25 * readyResources
    );
  };
  return score(playerId) - score(opponentId);
}

/** Mulligan policy: keep a hand that has at least one affordable early play. */
export function shouldKeepHand(state: GameState, playerId: 0 | 1): boolean {
  const player = state.players[playerId];
  const plays = player.hand.filter((c) => c.cardType === 'C' || c.cardType === 'S');
  if (!isFairPilot(state.config)) {
    return plays.length >= 2; // legacy: any 2 action cards
  }
  // Fair: require >=2 action cards AND a low-curve play so the hand can act early
  // (control hands keep on cheap interaction, not raw body count).
  const hasEarly = plays.some((c) => costTotal(c.cost) <= 2);
  return plays.length >= 2 && hasEarly;
}

// ── Strategy Phase ───────────────────────────────────────────────────────────

function chooseStrategyAction(
  state: GameState,
  player: PlayerState,
  acts: ReturnType<typeof computeAvailableActions>,
): PlayerAction | null {
  const opponent = state.players[state.activePlayerIndex === 0 ? 1 : 0];
  const best = bestSpell(
    player,
    opponent,
    acts,
    gameplanForSeat(state.config, state.activePlayerIndex),
    isFairPilot(state.config),
  );

  // 1. Transform when eligible and beneficial (gains new abilities / Ultimate).
  if (acts.canTransform && player.hero.transformData !== undefined) {
    return { type: 'declare_transform' };
  }

  // 1b. Reserve Energy Generation as a CHOICE (config.reserveTapChoice): tap
  //     vanilla Reserve bodies before planning spends so the banked resources
  //     widen every option below. Bodies with abilities or attached equipment
  //     are spared — tapping disables ALL their abilities (and their
  //     equipment's auras) until next Upkeep, which is the rule's real price.
  const tap = chooseTapReserve(player, acts);
  if (tap !== null) return tap;

  // 1c. Remove harmful equipment or transfer a useful piece from a weak holder
  //     to a materially stronger legal holder. These are ordinary Strategy
  //     actions in current rules and must be reachable by the policy.
  const equipmentMaintenance = chooseEquipmentMaintenance(
    player,
    opponent,
    acts,
    gameplanForSeat(state.config, state.activePlayerIndex),
    isFairPilot(state.config),
  );
  if (equipmentMaintenance !== null) return equipmentMaintenance;

  // 2. Proactive removal first: clear the opponent's biggest live threat before
  //    committing our own tempo (control sequencing on our priority window).
  if (best !== null && best.score.isRemoval && biggestEnemyThreat(opponent) >= REMOVAL_THREAT) {
    return best.action;
  }

  // 3. Activate beneficial hero/character abilities (free or cheap value).
  const activate = chooseActivate(state, acts);
  if (activate !== null) return activate;
  // (see chooseActivate: under config.activateAfterDeploy a PAID ability is
  //  deferred while an affordable deploy is still on the table.)

  // 4. Deploy the strongest affordable creature to the best zone.
  const deploy = chooseDeploy(
    player,
    opponent,
    acts,
    state.config?.valuePilot === true,
    state.config?.rampPilot === true,
    state.turnNumber,
    gameplanForSeat(state.config, state.activePlayerIndex),
    isFairPilot(state.config),
  );
  if (deploy !== null) return deploy;

  // 5. Equip the best creature on board.
  const equip = chooseEquip(
    player,
    opponent,
    acts,
    gameplanForSeat(state.config, state.activePlayerIndex),
    isFairPilot(state.config),
  );
  if (equip !== null) return equip;

  // 6. Cast a value/tempo spell (or removal vs a smaller threat) when worthwhile.
  if (best !== null && best.score.value >= SPELL_THRESHOLD) return best.action;

  // 7. Move a creature toward High Ground so it can hit the enemy Hero — or, under
  //    EC-007, move a Defender up to wall (forcing only works from High Ground).
  const move = chooseMove(state, player, opponent, acts);
  if (move !== null) return move;

  // 8. Discard for energy. Under reachDiscard, only to fund a specific reach-by-one
  //    play worth more than the pitched card; otherwise the legacy blind last resort.
  const discard =
    state.config?.reachDiscard === true
      ? chooseReachDiscard(state, player, opponent, acts)
      : chooseDiscardForEnergy(player, acts);
  if (discard !== null) return discard;

  return null;
}

// Minimum scored value for a non-removal spell to be worth a card+resources.
const SPELL_THRESHOLD = 1;

// Only fire proactive removal when the opponent fields a body of real size.
const REMOVAL_THREAT = 4;

interface ScoredSpell {
  readonly action: PlayerAction;
  readonly score: ReturnType<typeof scoreSpell>;
}

/** Score every castable spell and return the highest-value one (deterministic
 * tie-break: higher value, then lower cost, then instanceId). Each spell is
 * scored with the same expected-value framework the rest of the bot uses. */
function bestSpell(
  player: PlayerState,
  opponent: PlayerState,
  acts: ReturnType<typeof computeAvailableActions>,
  gameplan: Gameplan,
  valueMode: boolean,
): ScoredSpell | null {
  const ranked = acts.canCastSpell
    .map((opt) => {
      const card = handCard(player, opt.cardInstanceId);
      if (card === null) return null;
      const xValue = chooseXValue(
        card,
        opt.xValues,
        player,
        opponent,
        gameplan,
        valueMode,
      );
      const score = scoreSpell(player, opponent, card, xValue, gameplan, valueMode);
      const selectedTargetIds = chooseSpellTargets(player, opponent, card);
      const action: PlayerAction = {
        type: 'cast_spell',
        cardInstanceId: opt.cardInstanceId,
        ...(xValue > 0 ? { xValue } : {}),
        ...(selectedTargetIds !== undefined ? { selectedTargetIds } : {}),
      };
      return { action, score, cost: costTotal(opt.cost), id: opt.cardInstanceId };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => b.score.value - a.score.value || a.cost - b.cost || a.id.localeCompare(b.id));
  const top = ranked[0];
  return top === undefined ? null : { action: top.action, score: top.score };
}

function biggestEnemyThreat(opponent: PlayerState): number {
  return getAllCards(opponent.zones)
    .filter((c) => c.cardType === 'C')
    .reduce((m, c) => Math.max(m, c.currentAtk + c.currentHp), 0);
}

function chooseTapReserve(
  player: PlayerState,
  acts: ReturnType<typeof computeAvailableActions>,
): PlayerAction | null {
  for (const id of acts.canTapReserve) {
    const card = player.zones.reserve.find((c) => c !== null && c.instanceId === id);
    if (card == null) continue;
    if (card.abilities.length > 0 || card.equipment !== null) continue;
    return { type: 'tap_reserve', cardInstanceId: id };
  }
  return null;
}

function cardEffects(card: CardInstance): readonly Effect[] {
  return card.abilities.flatMap((ability) =>
    ability.type === 'triggered' || ability.type === 'aura'
      ? ability.effects
      : [],
  );
}

function harmfulEquipmentPenalty(effects: readonly Effect[]): number {
  let penalty = 0;
  for (const effect of effects) {
    if (effect.type === 'modify_stats') {
      penalty += Math.min(
        0,
        (effect.modifier.atk ?? 0) +
          (effect.modifier.hp ?? 0) +
          (effect.modifier.arm ?? 0),
      );
    } else if (effect.type === 'deal_damage' && effect.target.type === 'equipped_character') {
      penalty -= effect.amount.type === 'fixed' ? effect.amount.value : 1;
    } else if (effect.type === 'composite' || effect.type === 'scheduled') {
      penalty += harmfulEquipmentPenalty(effect.effects);
    } else if (effect.type === 'conditional') {
      penalty += Math.min(
        harmfulEquipmentPenalty(effect.ifTrue),
        harmfulEquipmentPenalty(effect.ifFalse ?? []),
      );
    }
  }
  return penalty;
}

function chooseEquipmentMaintenance(
  player: PlayerState,
  opponent: PlayerState,
  acts: ReturnType<typeof computeAvailableActions>,
  gameplan: Gameplan,
  valueMode: boolean,
): PlayerAction | null {
  const removals = acts.canRemoveEquipment
    .map((option) => {
      const holder = findOwnCard(player, option.holderInstanceId);
      const equipment = holder?.equipment ?? null;
      if (equipment === null) return null;
      const value = scoreEffects(
        player,
        opponent,
        cardEffects(equipment),
        equipment.xPaid ?? 0,
        gameplan,
        valueMode,
      ).value + harmfulEquipmentPenalty(cardEffects(equipment));
      return { option, value };
    })
    .filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== null)
    .filter((candidate) => candidate.value < 0)
    .sort(
      (a, b) =>
        a.value - b.value ||
        a.option.equipmentInstanceId.localeCompare(b.option.equipmentInstanceId),
    );
  const harmful = removals[0];
  if (harmful !== undefined) {
    return {
      type: 'remove_equipment',
      equipmentInstanceId: harmful.option.equipmentInstanceId,
    };
  }

  const transfers = acts.canTransferEquipment.flatMap((option) => {
    const holder = findOwnCard(player, option.holderInstanceId);
    if (holder === null || holder.equipment === null) return [];
    return option.validTargets.map((targetId) => {
      const target = findOwnCard(player, targetId);
      if (target === null) return null;
      const tacticalGain = power(target) - power(holder) - costTotal(option.cost);
      return { option, target, tacticalGain };
    }).filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== null);
  }).filter((candidate) => candidate.tacticalGain > 0)
    .sort(
      (a, b) =>
        b.tacticalGain - a.tacticalGain ||
        a.option.equipmentInstanceId.localeCompare(b.option.equipmentInstanceId) ||
        a.target.instanceId.localeCompare(b.target.instanceId),
    );
  const transfer = transfers[0];
  return transfer === undefined
    ? null
    : {
        type: 'transfer_equipment',
        equipmentInstanceId: transfer.option.equipmentInstanceId,
        targetInstanceId: transfer.target.instanceId,
      };
}

function chooseActivate(
  state: GameState,
  acts: ReturnType<typeof computeAvailableActions>,
): PlayerAction | null {
  // Each ability is used at most once per turn by the bot (guards against
  // re-picking a free, no-cooldown ability forever within a Strategy Phase).
  // Scope to events since this turn started.
  let turnStart = 0;
  for (let i = state.log.length - 1; i >= 0; i--) {
    if (state.log[i]!.type === 'TURN_START') {
      turnStart = i;
      break;
    }
  }
  const thisTurn = state.log.slice(turnStart);
  const usedThisTurn = (id: string, idx: number): boolean =>
    thisTurn.some(
      (e) => e.type === 'ABILITY_ACTIVATED' && e.cardInstanceId === id && e.abilityIndex === idx,
    );
  const player = state.players[state.activePlayerIndex];
  const opponent = state.players[state.activePlayerIndex === 0 ? 1 : 0];
  const gameplan = gameplanForSeat(state.config, state.activePlayerIndex);
  const valueMode = isFairPilot(state.config);
  const abilityFor = (
    cardInstanceId: string,
    abilityIndex: number,
  ) => {
    const card = findOwnCard(player, cardInstanceId);
    const abilities =
      card ??
      (cardInstanceId === `hero_${String(player.hero.cardDefId)}`
        ? player.hero
        : null);
    return abilities?.abilities[abilityIndex];
  };
  const sorted = [...acts.canActivateAbility]
    .filter((a) => !usedThisTurn(a.cardInstanceId, a.abilityIndex))
    .map((option) => {
      const ability = abilityFor(option.cardInstanceId, option.abilityIndex);
      const effects =
        ability !== undefined &&
        (ability.type === 'triggered' || ability.type === 'aura')
          ? ability.effects
          : [];
      const xValue = chooseBestXValue(
        option.xValues,
        (x) =>
          scoreEffects(
            player,
            opponent,
            effects,
            x,
            gameplan,
            valueMode,
          ).value,
      );
      return {
        option,
        xValue,
        utility:
          scoreEffects(
            player,
            opponent,
            effects,
            xValue,
            gameplan,
            valueMode,
          ).value -
          costTotal(option.cost) * 0.25 -
          xValue * X_RESOURCE_OPPORTUNITY_COST,
      };
    })
    .sort(
      (a, b) =>
        b.utility - a.utility ||
        costTotal(a.option.cost) - costTotal(b.option.cost) ||
        a.option.cardInstanceId.localeCompare(b.option.cardInstanceId) ||
        a.option.abilityIndex - b.option.abilityIndex,
    );
  const best = sorted[0];
  if (best === undefined) return null;
  // TEMPO FIX (config.activateAfterDeploy): this step runs BEFORE chooseDeploy, and
  // picks the cheapest ability with no assessment of what the mana could buy instead.
  // A cheap, short-cooldown ability (e.g. a 2-mana scry available almost every turn)
  // therefore drains the mana that would have developed the board, and games stall to
  // the turn cap. Free abilities are pure value and stay unconditional; a PAID ability
  // now waits until no affordable deploy remains. acts.canDeploy only ever contains
  // affordable deploys, so this is a direct "is the mana better spent on board?" test.
  // Absent/false ⇒ semantically invariant no-op.
  if (
    state.config?.activateAfterDeploy === true &&
    costTotal(best.option.cost) > 0
  ) {
    if (acts.canDeploy.length > 0) return null;
  }
  return {
    type: 'activate_ability',
    cardInstanceId: best.option.cardInstanceId,
    abilityIndex: best.option.abilityIndex,
    ...(best.xValue > 0 ? { xValue: best.xValue } : {}),
  };
}

function chooseDeploy(
  player: PlayerState,
  opponent: PlayerState,
  acts: ReturnType<typeof computeAvailableActions>,
  valuePilot: boolean,
  rampPilot: boolean,
  turnNumber: number,
  gameplan: Gameplan,
  valueMode: boolean,
): PlayerAction | null {
  // Strongest first. Default: highest (atk + hp). Under valuePilot: first-principles
  // card power + board/hero synergy; under rampPilot additionally an early-game ramp
  // tempo bonus (the cost-free score's ramp blind spot). Tie-break: cheaper first so
  // we curve out.
  const rank = valuePilot
    ? (card: CardInstance): number =>
        deployValue(card, player) + (rampPilot ? rampDeployBonus(card, turnNumber) : 0)
    : (card: CardInstance): number => power(card);
  const ranked = [...acts.canDeploy]
    .map((opt) => ({ opt, card: handCard(player, opt.cardInstanceId) }))
    .filter((x): x is { opt: typeof x.opt; card: CardInstance } => x.card !== null)
    .sort((a, b) => rank(b.card) - rank(a.card) || costTotal(a.opt.cost) - costTotal(b.opt.cost));

  const choice = ranked[0];
  if (choice === undefined) return null;

  const { zone, slotIndex } = pickDeploySlot(choice.opt.validSlots, choice.card);
  const xValue = chooseXValue(
    choice.card,
    choice.opt.xValues,
    player,
    opponent,
    gameplan,
    valueMode,
  );
  return {
    type: 'deploy',
    cardInstanceId: choice.opt.cardInstanceId,
    zone,
    slotIndex,
    ...(xValue > 0 ? { xValue } : {}),
  };
}

// Elite creatures want High Ground (so they can reach the Hero); but Characters
// can only be DEPLOYED to Frontline/Reserve — so deploy Elites to Frontline and
// the move step promotes them. Defenders stay Frontline. Prefer Frontline.
function pickDeploySlot(
  validSlots: readonly { readonly zone: ZoneType; readonly slots: readonly number[] }[],
  _card: CardInstance,
): { zone: ZoneType; slotIndex: number } {
  const frontline = validSlots.find((s) => s.zone === 'frontline' && s.slots.length > 0);
  const pick = frontline ?? validSlots.find((s) => s.slots.length > 0)!;
  return { zone: pick.zone, slotIndex: pick.slots[0]! };
}

function chooseEquip(
  player: PlayerState,
  opponent: PlayerState,
  acts: ReturnType<typeof computeAvailableActions>,
  gameplan: Gameplan,
  valueMode: boolean,
): PlayerAction | null {
  const opt = acts.canAttachEquipment[0];
  if (opt === undefined) return null;
  // Attach to the strongest valid target (best body to buff / keep alive).
  const target = [...opt.validTargets]
    .map((id) => findOwnCard(player, id))
    .filter((c): c is CardInstance => c !== null)
    .sort((a, b) => power(b) - power(a))[0];
  if (target === undefined) return null;
  const equipCard = handCard(player, opt.cardInstanceId);
  const xValue =
    equipCard !== null
      ? chooseXValue(
          equipCard,
          opt.xValues,
          player,
          opponent,
          gameplan,
          valueMode,
        )
      : 0;
  return {
    type: 'attach_equipment',
    cardInstanceId: opt.cardInstanceId,
    targetInstanceId: target.instanceId,
    ...(xValue > 0 ? { xValue } : {}),
  };
}

function cardHasTrait(card: CardInstance, trait: string): boolean {
  return hasEffectiveTrait(card, trait as never);
}

// How many open High Ground slots the player has (HG holds 2). Used by the EC-007
// wall logic to know whether a Defender can still be promoted to wall.
function openHighGroundSlots(player: PlayerState): number {
  return player.zones.highGround.filter((s) => s === null).length;
}

// EC-007 wall valuation: under the toggle a Defender forces ONLY from High Ground,
// so a Frontline Defender is dead weight as a wall. When the opponent fields an
// attacking body (a real threat to our hero/board) and we have an open High Ground
// slot, promoting a Defender up to wall is worth the scarce slot. Returns the
// Defender to move, or null. Picks the toughest Defender (most HP) so the wall
// survives the most attacks; deterministic tie-break by instanceId.
function chooseDefenderWall(
  player: PlayerState,
  opponent: PlayerState,
  acts: ReturnType<typeof computeAvailableActions>,
): PlayerAction | null {
  if (openHighGroundSlots(player) <= 0) return null;
  const enemyHasAttacker = getAllCards(opponent.zones).some(
    (c) => c.cardType === 'C' && c.currentAtk > 0,
  );
  if (!enemyHasAttacker) return null;
  const candidates = acts.canMove
    .filter((m) => m.fromZone === 'frontline' && m.validDestinations.includes('high_ground'))
    .map((m) => findOwnCard(player, m.cardInstanceId))
    .filter(
      (c): c is CardInstance => c !== null && c.cardType === 'C' && cardHasTrait(c, 'defender'),
    )
    .sort((a, b) => b.currentHp - a.currentHp || a.instanceId.localeCompare(b.instanceId));
  const wall = candidates[0];
  if (wall === undefined) return null;
  return { type: 'move', cardInstanceId: wall.instanceId, toZone: 'high_ground' };
}

// Promote a non-summoning-sick attacker from Frontline to High Ground so it can
// attack the enemy Hero next combat (the only way to deal face damage).
function chooseMove(
  state: GameState,
  player: PlayerState,
  opponent: PlayerState,
  acts: ReturnType<typeof computeAvailableActions>,
): PlayerAction | null {
  // EC-007: wall first — a Defender only forces from High Ground under the toggle,
  // so claim a High Ground slot to wall before spending it on a reach attacker.
  if (state.config?.defenderHighGroundOnly === true) {
    const wall = chooseDefenderWall(player, opponent, acts);
    if (wall !== null) return wall;
  }
  for (const m of acts.canMove) {
    if (m.fromZone !== 'frontline') continue;
    if (!m.validDestinations.includes('high_ground')) continue;
    const card = findOwnCard(player, m.cardInstanceId);
    if (card === null || card.cardType !== 'C' || card.currentAtk <= 0) continue;
    if (card.summoningSick) continue; // would waste the turn; keep it useful
    return { type: 'move', cardInstanceId: m.cardInstanceId, toZone: 'high_ground' };
  }
  return null;
}

function chooseDiscardForEnergy(
  player: PlayerState,
  acts: ReturnType<typeof computeAvailableActions>,
): PlayerAction | null {
  if (!acts.canDiscardForEnergy) return null;
  // Only when nothing was deployable/castable this pass and we have spare cards.
  if (player.hand.length <= 1) return null;
  const ids = lowestValueHandIds(
    player,
    player.hand.map((c) => c.instanceId),
    1,
  );
  const id = ids[0];
  if (id === undefined) return null;
  return { type: 'discard_for_energy', cardInstanceId: id };
}

// ── Reach-discard (config.reachDiscard) ──────────────────────────────────────
// Discard is no longer a blind pitch: it fires ONLY to fund a play that is short
// by exactly one resource, pitching one matching-type card, and only when the
// play out-values the pitched card by a tempo margin. The +1 temporary resource
// makes the play affordable on the very next pass, where the normal deploy/cast
// step makes it — so every such discard is, by construction, productive.
const REACH_MARGIN = 1.5; // tempo / temp-only friction the play must clear
const MIN_REACH_PLAY = 2; // never pitch a card to rush out a trivial play
const EQUIP_VALUE = 3; // static stand-in value for an equipment in hand

interface ReachPlay {
  readonly playId: string;
  readonly value: number;
  readonly types: readonly ('mana' | 'energy')[];
}

function chooseReachDiscard(
  state: GameState,
  player: PlayerState,
  opponent: PlayerState,
  acts: ReturnType<typeof computeAvailableActions>,
): PlayerAction | null {
  if (!acts.canDiscardForEnergy || player.hand.length <= 1) return null;
  const pool = getAvailableResources(player);
  const gameplan = gameplanForSeat(state.config, state.activePlayerIndex);
  const fair = isFairPilot(state.config);
  const valuePilot = state.config?.valuePilot === true;

  let best: { pitchId: string; net: number } | null = null;
  for (const play of reachPlays(player, opponent, pool, gameplan, fair, valuePilot)) {
    if (play.value < MIN_REACH_PLAY) continue;
    const pitch = bestPitch(player, opponent, play.playId, play.types, gameplan, fair, valuePilot);
    if (pitch === null) continue;
    const net = play.value - pitch.value - REACH_MARGIN;
    if (net > 0 && (best === null || net > best.net)) best = { pitchId: pitch.id, net };
  }
  if (best === null) return null;
  return { type: 'discard_for_energy', cardInstanceId: best.pitchId };
}

/** Hand plays (creature/spell) that a single +1 resource would make affordable. */
function reachPlays(
  player: PlayerState,
  opponent: PlayerState,
  pool: ReturnType<typeof getAvailableResources>,
  gameplan: Gameplan,
  fair: boolean,
  valuePilot: boolean,
): readonly ReachPlay[] {
  const plays: ReachPlay[] = [];
  for (const card of player.hand) {
    if (card.cardType !== 'C' && card.cardType !== 'S') continue;
    const types = reachAffordTypes(pool, effectiveCost(player, card));
    if (types.length === 0) continue;
    if (card.cardType === 'C' && !canDeployBody(player)) continue; // no slot ⇒ unplayable
    plays.push({
      playId: card.instanceId,
      value: cardValue(player, opponent, card, gameplan, fair, valuePilot),
      types,
    });
  }
  return plays;
}

/** Lowest-value hand card (≠ the play) whose resource type can fund the reach. */
function bestPitch(
  player: PlayerState,
  opponent: PlayerState,
  excludeId: string,
  types: readonly ('mana' | 'energy')[],
  gameplan: Gameplan,
  fair: boolean,
  valuePilot: boolean,
): { id: string; value: number } | null {
  const wanted = new Set(types);
  let best: { id: string; value: number } | null = null;
  for (const card of player.hand) {
    if (card.instanceId === excludeId || !wanted.has(cardResourceType(card))) continue;
    const value = cardValue(player, opponent, card, gameplan, fair, valuePilot);
    if (best === null || value < best.value) best = { id: card.instanceId, value };
  }
  return best;
}

/** A hand card's value on one scale (atk+hp units) for the reach/pitch gauge. Under
 * valuePilot a creature is valued by first-principles card power, not raw atk+hp. */
function cardValue(
  player: PlayerState,
  opponent: PlayerState,
  card: CardInstance,
  gameplan: Gameplan,
  fair: boolean,
  valuePilot: boolean,
): number {
  if (card.cardType === 'C' || card.cardType === 'T') {
    return valuePilot ? intrinsicValue(card) : power(card);
  }
  if (card.cardType === 'S') {
    return Math.max(
      0,
      scoreSpell(player, opponent, card, chooseXValue(card), gameplan, fair).value,
    );
  }
  return card.cardType === 'E' ? EQUIP_VALUE : 1;
}

function canDeployBody(player: PlayerState): boolean {
  return hasOpenSlot(player.zones, 'frontline') || hasOpenSlot(player.zones, 'reserve');
}

// ── Action (Combat) Phase ────────────────────────────────────────────────────

function chooseCombatAction(
  state: GameState,
  player: PlayerState,
  acts: ReturnType<typeof computeAvailableActions>,
): PlayerAction | null {
  const opponent = state.players[state.activePlayerIndex === 0 ? 1 : 0];
  const faceWeight = faceWeightFor(state.config, state.activePlayerIndex);
  const flash = bestSpell(
    player,
    opponent,
    acts,
    gameplanForSeat(state.config, state.activePlayerIndex),
    isFairPilot(state.config),
  );

  // Flash spells are legal proactively in the Action phase. Use worthwhile
  // removal before combat changes its targets, and use other positive-value
  // Flash effects before choosing an attack.
  if (
    flash !== null &&
    ((flash.score.isRemoval && biggestEnemyThreat(opponent) >= REMOVAL_THREAT) ||
      flash.score.value >= SPELL_THRESHOLD)
  ) {
    return flash.action;
  }

  // Score every legal attack across all ready bodies, then take the single
  // best net-positive one. No target is forced: a body that can only make a
  // net-negative attack (dies for nothing, or 0 damage through ARM/shield)
  // declines and holds. Hero face damage is preferred when it lands.
  const ready: { card: CardInstance; option: (typeof acts.canAttack)[number] }[] = [];
  let best: { action: PlayerAction; value: number } | null = null;
  for (const atk of acts.canAttack) {
    const attacker = findOwnCard(player, atk.attackerInstanceId);
    if (attacker === null || attacker.currentAtk <= 0) continue;
    ready.push({ card: attacker, option: atk });

    const face = bestHeroAttack(attacker, atk.validTargets, opponent, faceWeight);
    if (face !== null && (best === null || face.value > best.value)) {
      best = { action: face.action(atk.attackerInstanceId), value: face.value };
    }
    const trade = pickCombatTarget(attacker, atk.validTargets, opponent, state.config);
    if (trade !== null && (best === null || trade.value > best.value)) {
      best = {
        action: {
          type: 'declare_attack',
          attackerInstanceId: atk.attackerInstanceId,
          targetId: trade.id,
        },
        value: trade.value,
      };
    }
  }

  // PURPOSEFUL SACRIFICE: the greedy gate above declines every net-negative
  // attack, so it never gangs a key body (a board-gating Defender or recurring
  // threat). Plan the turn's attacks as a SET — if committing several attackers
  // KILLS a key body (ARM/shield/return-damage/regen aware) and the removal is
  // worth the bodies spent, take the next swing of that gang even though it is an
  // individual down-trade. Compared on the same power-point scale as the greedy
  // best, so face lethal and clean trades still win when they are bigger.
  const gang = planGangAttack(
    ready,
    opponent,
    state.config,
    gameplanForSeat(state.config, state.activePlayerIndex).gangAggression,
  );
  if (gang !== null && (best === null || gang.value > best.value)) {
    best = { action: gang.action, value: gang.value };
  }
  return best?.action ?? null;
}

// Face damage is preferred (closing speed), but only counts if it lands through
// the enemy Hero's ARM — otherwise the attack is wasted and we hold.
function bestHeroAttack(
  attacker: CardInstance,
  targets: ReturnType<typeof computeAvailableActions>['canAttack'][number]['validTargets'],
  opponent: PlayerState,
  faceWeight: number,
): { value: number; action: (id: string) => PlayerAction } | null {
  if (!targets.some((t) => t.type === 'hero')) return null;
  const dmg = calculateHeroDamage(attacker.currentAtk, opponent.hero.currentArm);
  if (dmg <= 0) return null;
  // Weight face damage above equivalent chip — it advances the win directly.
  return {
    value: dmg * faceWeight,
    action: (id) => ({ type: 'declare_attack', attackerInstanceId: id, targetId: 'hero' }),
  };
}

// The active seat's gameplan, falling back to NEUTRAL when no per-seat gameplan is
// supplied on the config. Absent botGameplan ⇒ NEUTRAL ⇒ semantically invariant no-op
// (preserves the v10 runHash), since NEUTRAL's weights equal the hardcoded constants.
// True when the per-game fair-pilot mode is enabled (control/value-aware scoring +
// reactive/mulligan policy + rollout fairness). Absent ⇒ false ⇒ default behavior.
function isFairPilot(config: GameConfig | undefined): boolean {
  return config?.fairPilot === true;
}

function gameplanForSeat(config: GameConfig | undefined, seat: 0 | 1): Gameplan {
  const base = config?.botGameplan?.[seat] ?? gameplanFor('Neutral');
  // Single injection point for config.dynamicDrawValue: every scoreSpell call threads
  // its gameplan from here, so scoreEffect's draw_cards case can scale by hand glut /
  // dead-hand desperation without changing any signature. Absent/false returns `base`
  // unchanged ⇒ semantically invariant.
  return config?.dynamicDrawValue === true ? { ...base, dynamicDraw: true } : base;
}

// Face damage value per point of LP removed: the active seat's gameplan faceWeight,
// falling back to the NEUTRAL gameplan (1.5) when no per-seat gameplan is supplied.
// Absent botGameplan ⇒ NEUTRAL ⇒ semantically invariant no-op (preserves the v10 runHash).
function faceWeightFor(config: GameConfig | undefined, seat: 0 | 1): number {
  return config?.botGameplan?.[seat].faceWeight ?? gameplanFor('Neutral').faceWeight;
}

/** Choose the best net-positive creature target for an attacker, ARM/shield/lethal
 * aware, or null to decline. Value = (defender we kill, full power) or (chip dealt)
 * minus (our body's power if it dies back). We never declare a strictly losing
 * exchange (0 damage through ARM+shield, or suiciding for less than we destroy). */
function pickCombatTarget(
  attacker: CardInstance,
  targets: ReturnType<typeof computeAvailableActions>['canAttack'][number]['validTargets'],
  opponent: PlayerState,
  config: GameConfig | undefined,
): { id: string; value: number } | null {
  const candidates = targets
    .filter((t) => t.type === 'character' && t.instanceId !== null)
    .map((t) => ({ id: t.instanceId!, card: findOwnCard(opponent, t.instanceId!) }))
    .filter((x): x is { id: string; card: CardInstance } => x.card !== null);

  let best: { id: string; value: number } | null = null;
  for (const c of candidates) {
    const value = tradeValue(attacker, c.card, config);
    if (value > 0 && (best === null || value > best.value)) {
      best = { id: c.id, value };
    }
  }
  return best;
}

/** Net value of attacking `defender` with `attacker`, accounting for ARM, the -1
 * damage shield (activeReplacements / on_would_take_damage), First Strike and
 * lethal-back. Rule-aware: reuses the engine's real combat model
 * (`simulateCombatExchange`) so it correctly sees a defender whose ARM/shield
 * first-instance charge is already spent this turn (EC-002/EC-003), matching how a
 * follow-up swing actually resolves. Returns <= 0 for declines (no real damage, or a
 * bad suicide). */
function tradeValue(
  attacker: CardInstance,
  defender: CardInstance,
  config: GameConfig | undefined,
): number {
  const result = simulateCombatExchange(
    asSimBody(attacker),
    asSimBody(defender),
    defender.currentHp,
    config,
  );
  if (result.damageToTarget <= 0 && !result.targetDestroyed) return 0; // wasted swing
  const gain = result.targetDestroyed ? power(defender) : result.damageToTarget;
  const loss = result.attackerDestroyed ? power(attacker) : 0;
  return gain - loss;
}

// ── Heuristics / Helpers ─────────────────────────────────────────────────────

function power(card: CardInstance): number {
  return card.currentAtk + card.currentHp;
}

function costTotal(cost: { mana: number; energy: number; flexible: number }): number {
  return cost.mana + cost.energy + cost.flexible;
}

const X_RESOURCE_OPPORTUNITY_COST = 0.75;

function chooseBestXValue(
  legalValues: readonly number[] | undefined,
  grossUtility: (xValue: number) => number,
): number {
  const values = legalValues ?? [0];
  let best = values[0] ?? 0;
  let bestUtility =
    grossUtility(best) - best * X_RESOURCE_OPPORTUNITY_COST;
  for (const value of values.slice(1)) {
    const utility =
      grossUtility(value) - value * X_RESOURCE_OPPORTUNITY_COST;
    if (utility > bestUtility || (utility === bestUtility && value < best)) {
      best = value;
      bestUtility = utility;
    }
  }
  return best;
}

// Choose among every legal X value by the card's authored effect utility minus
// the opportunity cost of consuming another typed resource. Non-scaling cards
// therefore choose X=0; meaningful X effects can justify the full legal spend.
function chooseXValue(
  card: CardInstance,
  legalValues?: readonly number[],
  player?: PlayerState,
  opponent?: PlayerState,
  gameplan: Gameplan = gameplanFor('Neutral'),
  valueMode: boolean = false,
): number {
  if (card.xCostResource === undefined || legalValues === undefined) return 0;
  if (player === undefined || opponent === undefined) return legalValues[0] ?? 0;
  const effects = cardEffects(card);
  return chooseBestXValue(
    legalValues,
    (xValue) =>
      scoreEffects(
        player,
        opponent,
        effects,
        xValue,
        gameplan,
        valueMode,
      ).value,
  );
}

function lowestValueHandIds(
  player: PlayerState,
  candidateIds: readonly string[],
  count: number,
): readonly string[] {
  const cards = candidateIds
    .map((id) => player.hand.find((c) => c.instanceId === id))
    .filter((c): c is CardInstance => c !== undefined)
    // Discard non-creatures / weakest bodies first.
    .sort((a, b) => discardScore(a) - discardScore(b));
  return cards.slice(0, Math.max(0, count)).map((c) => c.instanceId);
}

function discardScore(card: CardInstance): number {
  // Higher = keep. Creatures with stats are most valuable; cheap stuff goes first.
  // Ramp/upgrade engines (gain_resource / deploy_from_deck — Verdant's Tech Bloom
  // & Rampant Evolution) rank with creatures so they aren't pitched as "chaff".
  const stats = card.cardType === 'C' ? power(card) : 0;
  const base = card.cardType === 'C' ? 5 : isRampEngine(card) ? 5 : card.cardType === 'E' ? 2 : 1;
  return stats + base;
}

/** A spell whose effects ramp resources or deploy a body from deck — the engine
 * cards Verdant snowballs on. Detected from effect data, not card names. */
function isRampEngine(card: CardInstance): boolean {
  if (card.cardType !== 'S') return false;
  for (const ab of card.abilities) {
    if (ab.type !== 'triggered' && ab.type !== 'aura') continue;
    for (const eff of ab.effects) {
      if (eff.type === 'gain_resource' || eff.type === 'deploy_from_deck') return true;
    }
  }
  return false;
}

function handCard(player: PlayerState, instanceId: string): CardInstance | null {
  return player.hand.find((c) => c.instanceId === instanceId) ?? null;
}

function findOwnCard(player: PlayerState, instanceId: string): CardInstance | null {
  return getAllCards(player.zones).find((c) => c.instanceId === instanceId) ?? null;
}
