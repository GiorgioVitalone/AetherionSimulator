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
import { scoreSpell } from './spell-eval.js';
import { chooseSpellTargets } from './target-select.js';
import { planGangAttack } from './combat-plan.js';
import { simulateCombatExchange, asSimBody } from './combat-sim.js';
import { gameplanFor, type Gameplan } from './gameplan.js';

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
 * Counter the newest enemy spell on the stack when it scores high enough from the
 * responder's perspective; among held counters pick the cheapest (tie-break by
 * instanceId). Flash is held in the cast window (its value is in attack/move
 * windows, deferred). Default is to pass — reactive cards are scarce.
 */
export function chooseReactiveAction(state: GameState): PlayerAction | null {
  const pp = state.pendingPriority;
  if (pp == null || state.winner !== null) return null;
  const responderId = pp.toRespondPlayerId;
  const enemyId = responderId === 0 ? 1 : 0;

  const fair = isFairPilot(state.config);
  const enemySpell = fair
    ? highestThreatEnemySpell(state, enemyId, responderId)
    : newestEnemySpell(state, enemyId);
  if (enemySpell === null) return null;
  const threshold = fair ? COUNTER_THRESHOLD_FAIR : COUNTER_THRESHOLD;
  if (spellThreat(state, enemySpell, responderId, fair) < threshold) return null;

  const counters = computeReactiveActions(state, responderId)
    .filter((o) => o.kind === 'counter')
    .sort(
      (a, b) =>
        costTotal(a.cost) - costTotal(b.cost) || a.cardInstanceId.localeCompare(b.cardInstanceId),
    );
  const pick = counters[0];
  if (pick === undefined) return null;
  return {
    type: 'cast_spell',
    cardInstanceId: pick.cardInstanceId,
    selectedTargetIds: [enemySpell.id],
  };
}

function newestEnemySpell(state: GameState, enemyId: 0 | 1): GameState['stack'][number] | null {
  for (let i = state.stack.length - 1; i >= 0; i--) {
    const item = state.stack[i]!;
    if (item.type === 'spell' && item.controllerId === enemyId) return item;
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
  const ids = pc.options.map((o) => o.instanceId ?? o.id);
  return ids.slice(0, Math.max(pc.minSelections, 0));
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

  // 2. Proactive removal first: clear the opponent's biggest live threat before
  //    committing our own tempo (control sequencing on our priority window).
  if (best !== null && best.score.isRemoval && biggestEnemyThreat(opponent) >= REMOVAL_THREAT) {
    return best.action;
  }

  // 3. Activate beneficial hero/character abilities (free or cheap value).
  const activate = chooseActivate(state, acts);
  if (activate !== null) return activate;

  // 4. Deploy the strongest affordable creature to the best zone.
  const deploy = chooseDeploy(
    player,
    acts,
    state.config?.valuePilot === true,
    state.config?.rampPilot === true,
    state.turnNumber,
  );
  if (deploy !== null) return deploy;

  // 5. Equip the best creature on board.
  const equip = chooseEquip(player, acts);
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
      const xValue = chooseXValue(player, card);
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
  // Prefer the cheapest activatable ability; xValue 0 (no X paid) keeps it safe.
  const sorted = [...acts.canActivateAbility]
    .filter((a) => !usedThisTurn(a.cardInstanceId, a.abilityIndex))
    .sort((a, b) => costTotal(a.cost) - costTotal(b.cost));
  const best = sorted[0];
  if (best === undefined) return null;
  return {
    type: 'activate_ability',
    cardInstanceId: best.cardInstanceId,
    abilityIndex: best.abilityIndex,
  };
}

function chooseDeploy(
  player: PlayerState,
  acts: ReturnType<typeof computeAvailableActions>,
  valuePilot: boolean,
  rampPilot: boolean,
  turnNumber: number,
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
  const xValue = chooseXValue(player, choice.card);
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
  acts: ReturnType<typeof computeAvailableActions>,
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
  const xValue = equipCard !== null ? chooseXValue(player, equipCard) : 0;
  return {
    type: 'attach_equipment',
    cardInstanceId: opt.cardInstanceId,
    targetInstanceId: target.instanceId,
    ...(xValue > 0 ? { xValue } : {}),
  };
}

function cardHasTrait(card: CardInstance, trait: string): boolean {
  return (
    card.traits.includes(trait as never) ||
    card.grantedTraits.some((g) => g.trait === (trait as never))
  );
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
      scoreSpell(player, opponent, card, chooseXValue(player, card), gameplan, fair).value,
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
// supplied on the config. Absent botGameplan ⇒ NEUTRAL ⇒ byte-identical no-op
// (preserves the v10 runHash), since NEUTRAL's weights equal the hardcoded constants.
// True when the per-game fair-pilot mode is enabled (control/value-aware scoring +
// reactive/mulligan policy + rollout fairness). Absent ⇒ false ⇒ legacy behavior.
function isFairPilot(config: GameConfig | undefined): boolean {
  return config?.fairPilot === true;
}

function gameplanForSeat(config: GameConfig | undefined, seat: 0 | 1): Gameplan {
  return config?.botGameplan?.[seat] ?? gameplanFor('Neutral');
}

// Face damage value per point of LP removed: the active seat's gameplan faceWeight,
// falling back to the NEUTRAL gameplan (1.5) when no per-seat gameplan is supplied.
// Absent botGameplan ⇒ NEUTRAL ⇒ byte-identical no-op (preserves the v10 runHash).
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

// Spend leftover resources on X-cost cards (those declaring xMana/xEnergy via
// cost) — here we only pay X when the card's printed cost is fully covered and we
// still have spare; capped small to keep tempo. Detection: a card whose base cost
// is 0 across the board is treated as a potential X sink.
function chooseXValue(player: PlayerState, card: CardInstance): number {
  const isXCard = card.tags.includes('x_cost') || card.name.toLowerCase().includes(' x');
  if (!isXCard) return 0;
  const avail = getAvailableResources(player);
  const base = card.cost.mana + card.cost.energy + card.cost.flexible;
  const spare = avail.mana + avail.energy - base;
  return Math.max(0, Math.min(3, spare));
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
