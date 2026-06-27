/**
 * Spell evaluation — expected-value scoring for the heuristic bot's cast_spell
 * path. Pure functions over GameState; no hidden state, no Math.random.
 *
 * The engine auto-resolves spell targets from the FRONT of the offered option
 * list (reserve → frontline → high_ground zone order; see actions.ts
 * pickAutoTargets + target-resolver). So scoring estimates value against the
 * card the engine will actually hit, keeping the bot's expectation consistent
 * with resolution rather than overclaiming a "best target" it cannot aim at.
 */
import type { PlayerState, CardInstance } from '../types/game-state.js';
import type { Effect } from '../types/effects.js';
import type { AmountExpr, Side } from '../types/common.js';
import type { TargetExpr } from '../types/targets.js';
import type { AbilityDSL } from '../types/ability.js';
import { getAllCards } from '../zones/zone-manager.js';
import { gameplanFor, type Gameplan } from './gameplan.js';

// The NEUTRAL gameplan, used as the default so an un-piloted caller reproduces the
// current scores byte-for-byte (the v10 hash). Every weight below is consumed such
// that, at these values, the math collapses to the previous hardcoded constants.
const NEUTRAL: Gameplan = gameplanFor('Neutral');

export interface SpellScore {
  /** Expected value: higher is better. Combat-relevant / threat-neutralizing
   * effects dominate; value/tempo effects contribute smaller positive amounts. */
  readonly value: number;
  /** True when this spell removes/neutralizes an enemy body (proactive removal),
   * so the bot can sequence it ahead of tempo plays when a real threat exists. */
  readonly isRemoval: boolean;
}

/** Score a spell card by summing the expected value of its one-shot effects.
 * The active seat's `gameplan` scales the face / removal / tempo and body-valuation
 * levers (A6/A7); it defaults to NEUTRAL, which reproduces the prior scores exactly. */
export function scoreSpell(
  caster: PlayerState,
  opponent: PlayerState,
  card: CardInstance,
  xPaid: number,
  gameplan: Gameplan = NEUTRAL,
  valueMode: boolean = false,
): SpellScore {
  return sumEffects(caster, opponent, spellEffects(card.abilities), xPaid, gameplan, valueMode);
}

/** Sum the expected value of a list of effects (the shared recursion point used by
 * scoreSpell and the wrapper-effect cases). isRemoval propagates if ANY sub-effect
 * neutralizes an enemy body. */
function sumEffects(
  caster: PlayerState,
  opponent: PlayerState,
  effects: readonly Effect[],
  xPaid: number,
  gameplan: Gameplan,
  valueMode: boolean,
): SpellScore {
  let value = 0;
  let isRemoval = false;
  for (const effect of effects) {
    const part = scoreEffect(caster, opponent, effect, xPaid, gameplan, valueMode);
    value += part.value;
    if (part.isRemoval) isRemoval = true;
  }
  return { value, isRemoval };
}

/** One-shot effects of a spell: deploy-time/triggered + aura effect lists. */
function spellEffects(abilities: readonly AbilityDSL[]): readonly Effect[] {
  const out: Effect[] = [];
  for (const ab of abilities) {
    if (ab.type === 'triggered' || ab.type === 'aura') out.push(...ab.effects);
  }
  return out;
}

function scoreEffect(
  caster: PlayerState,
  opponent: PlayerState,
  effect: Effect,
  xPaid: number,
  gameplan: Gameplan,
  valueMode: boolean,
): SpellScore {
  switch (effect.type) {
    case 'destroy':
    case 'sacrifice':
    case 'bounce': {
      if (!isEnemyTarget(effect.target)) {
        // Allied destroy/sacrifice/bounce is a COST, not removal: Verdant's ramp/
        // upgrade engines (Regrowth = sacrifice→draw, Rampant Evolution =
        // destroy→deploy a bigger body) pay a small body to gain. Model that
        // sunk cost so the rest of the spell's effects net positive — but only
        // if an eligible ally exists (noAlly guard); never cast into an empty board.
        if (!isAlliedCharacterTarget(effect.target)) return ZERO;
        const chump = weakestAlly(caster, effect.target);
        if (chump === null) return { value: NO_ALLY, isRemoval: false };
        // Feeding the WEAKEST body to a draw/upgrade engine costs little — model
        // the lost chump at a low rate so the engine's payoff nets positive. This
        // is a sunk COST in raw stats (not a win-race gain), so it stays on `power`.
        return { value: -power(chump) * SAC_COST, isRemoval: false };
      }
      // Neutralizing a body is worth its win-race contribution (A7), scaled by how
      // much this seat's plan prizes removal (A6 `removalWeight`); bounce is a tempo
      // discount (mult 0.7). NEUTRAL ⇒ bodyValue=atk+hp, removalWeight=1 (no-op).
      const mult = effect.type === 'bounce' ? 0.7 : 1;
      const victims = enemyTargets(opponent, effect.target);
      if (victims.length === 0) return ZERO;
      const value = victims.reduce(
        (sum, v) => sum + bodyValue(v, gameplan) * mult * gameplan.removalWeight,
        0,
      );
      return { value, isRemoval: true };
    }
    case 'deal_damage': {
      if (!isEnemyTarget(effect.target)) {
        // Face damage (enemy hero) is steady value toward the win, weighted by how
        // hard this seat races the Hero (A6 `faceWeight`; NEUTRAL = 1.5 ⇒ no-op).
        return isEnemyHero(effect.target)
          ? { value: amount(effect.amount, xPaid) * gameplan.faceWeight, isRemoval: false }
          : ZERO;
      }
      const victims = enemyTargets(opponent, effect.target);
      if (victims.length === 0) return ZERO;
      const dmg = amount(effect.amount, xPaid);
      // Sum value across every affected body: a KILL is worth the body's win-race
      // contribution (A7 `bodyValue`) scaled by the seat's removal appetite (A6
      // `removalWeight`); a non-lethal hit is just the chip damage dealt. AoE
      // (all_characters) thus scores its full board impact, not one target.
      const value = victims.reduce(
        (sum, v) =>
          sum +
          (dmg >= spellTargetHp(v)
            ? bodyValue(v, gameplan) * gameplan.removalWeight
            : Math.min(dmg, spellTargetHp(v))),
        0,
      );
      return { value, isRemoval: victims.some((v) => dmg >= spellTargetHp(v)) };
    }
    case 'modify_stats': {
      if (isEnemyTarget(effect.target)) return ZERO; // debuffs handled as chip via dmg path
      const gain =
        (effect.modifier.atk ?? 0) + (effect.modifier.hp ?? 0) + (effect.modifier.arm ?? 0);
      const bodies = countAlliedBodies(caster, effect.target);
      // Allied buffs are proactive board development; weight by the seat's tempo
      // appetite (A6 `tempoWeight`; NEUTRAL = 0.6 ⇒ no-op).
      return {
        value: Math.max(0, gain) * Math.max(1, bodies) * gameplan.tempoWeight,
        isRemoval: false,
      };
    }
    case 'draw_cards':
      return effect.player === 'enemy'
        ? ZERO
        : { value: amount(effect.count, xPaid) * 1.2, isRemoval: false };
    case 'heal': {
      // Healing matters more when our Hero is low; only count allied heals.
      if (isEnemyTarget(effect.target)) return ZERO;
      const urgency = caster.hero.currentLp <= 12 ? 1 : 0.4;
      return { value: amount(effect.amount, xPaid) * urgency, isRemoval: false };
    }
    case 'gain_resource': {
      // Permanent resource ramp compounds over the game (Verdant snowball); a
      // temporary resource is one-shot tempo. Legacy (!valueMode) ⇒ flat 0.5 rate.
      const rate = !valueMode ? 0.5 : effect.temporary === true ? 0.5 : 1.0;
      return { value: effect.amount * rate, isRemoval: false };
    }
    case 'deploy_token': {
      const n = effect.inEachEmpty === true ? 2 : effect.count;
      const stats = effect.token.atk + effect.token.hp + (effect.token.arm ?? 0);
      return { value: stats * n * 0.5, isRemoval: false };
    }
    case 'counter_spell':
      // Reactive; on our own turn there is rarely an enemy spell to hit.
      return { value: 0.5, isRemoval: false };
    case 'deploy_from_deck':
      // Pulls a body straight from deck onto the board — Rampant Evolution's
      // payoff (the bigger upgraded creature). Worth a solid mid-body of tempo.
      return { value: 4, isRemoval: false };
    // ── Value / recursion / wrapper effects ──────────────────────────────────
    // Legacy (!valueMode): all flat-1 (unmodeled), byte-identical to before. Under
    // valueMode the bot SEES these, so control/value/recursion decks get piloted
    // instead of played as chaff.
    case 'composite':
      if (!valueMode) return FLAT_ONE;
      return sumEffects(caster, opponent, effect.effects, xPaid, gameplan, valueMode);
    case 'conditional': {
      if (!valueMode) return FLAT_ONE;
      // The Condition needs full board context to evaluate; approximate by scoring
      // the ifTrue branch at a probability discount (riders usually pay off) plus
      // the rarer ifFalse branch. Propagate the wrapped removal flag (KEYSTONE: a
      // card like "deal 2; if it dies, draw" finally registers as removal).
      const t = sumEffects(caster, opponent, effect.ifTrue, xPaid, gameplan, valueMode);
      const f = effect.ifFalse
        ? sumEffects(caster, opponent, effect.ifFalse, xPaid, gameplan, valueMode)
        : ZERO;
      return {
        value: CONDITIONAL_P * t.value + (1 - CONDITIONAL_P) * f.value,
        isRemoval: t.isRemoval,
      };
    }
    case 'choose_one': {
      if (!valueMode) return FLAT_ONE;
      // The chooser takes the best mode; approximate by the max-value option.
      let best = ZERO;
      for (const opt of effect.options) {
        const s = sumEffects(caster, opponent, opt.effects, xPaid, gameplan, valueMode);
        if (s.value > best.value) best = s;
      }
      return best;
    }
    case 'return_from_discard':
      // Onyx recursion (Necrotic Revival): a body back ≈ a draw; to the battlefield
      // is stronger (it skips the replay cost).
      if (!valueMode) return FLAT_ONE;
      return {
        value: effect.destination === 'battlefield' ? CARD_VALUE * 1.5 : CARD_VALUE,
        isRemoval: false,
      };
    case 'search_deck':
      // Tutor: a chosen card ≈ a draw, a touch above; battlefield ≈ a deploy.
      if (!valueMode) return FLAT_ONE;
      return {
        value: effect.destination === 'battlefield' ? 4 : CARD_VALUE * 1.2,
        isRemoval: false,
      };
    case 'copy_card':
      // Sapphire value (Arcane Echoes): a copy of a known-good card ≈ a draw.
      if (!valueMode) return FLAT_ONE;
      return { value: CARD_VALUE, isRemoval: false };
    case 'scry':
      // Card selection/quality: smaller than a draw, scaled by cards filtered.
      if (!valueMode) return FLAT_ONE;
      return { value: Math.min(effect.lookCount, 3) * 0.3, isRemoval: false };
    case 'discard':
      // Enemy discard is disruption (a card-advantage swing); allied/self discard is
      // a cost offset by its paired draw (scored separately).
      if (!valueMode) return FLAT_ONE;
      return {
        value: isEnemyTarget(effect.target) ? effect.count * CARD_VALUE * 0.8 : 0,
        isRemoval: false,
      };
    // Genuinely hard-to-value effects: flat-1 in BOTH modes (out of scope — the goal
    // is "stop scoring strategies as chaff", not perfect valuation).
    case 'cost_reduction':
    case 'grant_trait':
    case 'grant_ability':
    case 'move':
    case 'apply_status':
    case 'cleanse':
    case 'shuffle_into_deck':
    case 'attach_as_equipment':
    case 'replacement':
    case 'scheduled':
      return FLAT_ONE;
    default:
      return assertNever(effect);
  }
}

function assertNever(x: never): never {
  throw new Error(`Unhandled effect: ${JSON.stringify(x)}`);
}

// ── Target helpers ─────────────────────────────────────────────────────────

/** Enemy bodies an effect hits: AoE specs hit all; single-target hits the biggest
 * threat (the body the target-aware bot now aims at), not front-of-zone. */
function enemyTargets(opponent: PlayerState, target: TargetExpr): readonly CardInstance[] {
  if (!isEnemyTarget(target)) return [];
  const enemies = getAllCards(opponent.zones).filter((c) => c.cardType === 'C');
  if (enemies.length === 0) return [];
  if (target.type === 'all_characters' || target.type === 'all_characters_in_zone') {
    return enemies;
  }
  const biggest = [...enemies].sort(
    (a, b) => power(b) - power(a) || a.instanceId.localeCompare(b.instanceId),
  )[0]!;
  return [biggest];
}

function isEnemyTarget(target: TargetExpr): boolean {
  return 'side' in target && (target as { side?: Side }).side === 'enemy';
}

/** A single-allied-character target (the body an ally destroy/sacrifice consumes). */
function isAlliedCharacterTarget(target: TargetExpr): boolean {
  const side = 'side' in target ? (target as { side?: Side }).side : undefined;
  return side === 'allied' && target.type !== 'hero';
}

/** Weakest allied character the spell could sacrifice (the cheapest chump), or
 * null when the caster has NO eligible body — the noAlly guard. */
function weakestAlly(caster: PlayerState, target: TargetExpr): CardInstance | null {
  const allies = getAllCards(caster.zones).filter((c) => c.cardType === 'C');
  if (allies.length === 0) return null;
  if (target.type === 'all_characters' || target.type === 'all_characters_in_zone') {
    return allies.sort((a, b) => power(a) - power(b))[0]!;
  }
  return [...allies].sort(
    (a, b) => power(a) - power(b) || a.instanceId.localeCompare(b.instanceId),
  )[0]!;
}

function isEnemyHero(target: TargetExpr): boolean {
  return target.type === 'hero' && target.side === 'enemy';
}

function countAlliedBodies(caster: PlayerState, target: TargetExpr): number {
  if (target.type === 'all_characters' || target.type === 'all_characters_in_zone') {
    return getAllCards(caster.zones).filter((c) => c.cardType === 'C').length;
  }
  return 1;
}

// ── Numeric helpers ────────────────────────────────────────────────────────

function amount(expr: AmountExpr, xPaid: number): number {
  switch (expr.type) {
    case 'fixed':
      return expr.value;
    case 'x_cost':
      return xPaid;
    case 'dice':
      return expr.count * ((expr.sides + 1) / 2);
    case 'count':
    case 'event_value':
      return 2; // unknown at decision time: assume a modest payoff
    default:
      return assertNever(expr);
  }
}

function power(card: CardInstance): number {
  return card.currentAtk + card.currentHp;
}

/**
 * A7 — win-race body valuation. Instead of raw power (atk+hp), value a body by its
 * CONTRIBUTION TO THE WIN RACE, so removing it is worth what it does to the race:
 *   - its ATK is the incoming face-damage stream that removing it STOPS — prized
 *     in proportion to how this seat values the face race (`faceWeight`);
 *   - its HP is the wall that BLOCKS our face damage / soaks our attacks — prized
 *     in proportion to how hard this seat is trying to close (`closeBias`).
 * Each channel is normalized by the NEUTRAL weight so that at the NEUTRAL gameplan
 * this returns exactly atk + hp = power(card): a byte-identical no-op (v10 hash).
 */
function bodyValue(card: CardInstance, gameplan: Gameplan): number {
  const offense = card.currentAtk * (gameplan.faceWeight / NEUTRAL.faceWeight);
  const wall = card.currentHp * (gameplan.closeBias / NEUTRAL.closeBias);
  return offense + wall;
}

// HP a direct-damage spell must overcome. Spell `deal_damage` applies straight to
// HP and does NOT subtract ARM — ARM mitigates COMBAT damage only (see
// combat-resolver). Counting ARM here made the bot treat armored bodies as far
// tankier than they are versus burn, so it scored genuine lethal removal as mere
// chip (isRemoval=false) and declined it.
function spellTargetHp(card: CardInstance): number {
  return card.currentHp;
}

const ZERO: SpellScore = { value: 0, isRemoval: false };
// Flat small-positive for effects the bot does not model: a free/cheap spell with a
// real effect still beats doing nothing, without overvaluing it. (Legacy flat-1.)
const FLAT_ONE: SpellScore = { value: 1, isRemoval: false };

// A card put into hand (drawn/returned/tutored/copied) ≈ the draw scale (1.2/card).
const CARD_VALUE = 1.2; // anchored to the draw_cards weight in scoreEffect

// Probability weight on a conditional rider's ifTrue branch when its Condition cannot
// be cheaply evaluated at decision time. Defensible mid value (riders usually pay
// off, e.g. "if it dies, draw"); not finely tuned.
const CONDITIONAL_P = 0.6;

// Strong negative so an ally-sacrifice/destroy spell with NO eligible body on
// board nets below SPELL_THRESHOLD and is never cast into thin air (noAlly guard).
const NO_ALLY = -100;

// Rate at which sacrificing the weakest chump body deducts from a ramp/upgrade
// spell's value — low, since you choose the least-valuable body to feed.
const SAC_COST = 0.2;
