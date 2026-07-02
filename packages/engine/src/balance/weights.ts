/**
 * First-principles weight constants + the trigger-recurrence model.
 *
 * Every number is anchored to design reasoning or to the engine's OWN existing
 * constants (src/bot/spell-eval.ts, src/bot/combat-plan.ts, gameplan NEUTRAL).
 * NONE are fitted to measured win rates — see docs/balance-valuation.md.
 */
import type { AbilityDSL, TriggeredAbilityDSL } from '../types/ability.js';
import type { Condition } from '../types/conditions.js';
import type { Activated, Trigger } from '../types/triggers.js';

// ── Stat weights ─────────────────────────────────────────────────────────────
// spell-eval bodyValue at NEUTRAL = atk + hp, so each is the 1.0 anchor. ARM
// mitigates >=1 combat damage per instance and persists (the reason Bulwark and
// the EC-ARM knobs exist) — above hp, below a full repeated block.
export const W_ATK = 1.0;
export const W_HP = 1.0;
export const W_ARM = 1.3;

// ── Expected context-free targets (the static analog of a live board) ────────
export const AVG_ENEMY_BODY = 5.5; // expected enemy body value a "destroy enemy" removes
export const AVG_WEAK_BODY = 2.5; // expected weakest ally an allied sacrifice feeds
export const AVG_BODY_HP = 3.0; // expected HP a deal_damage must overcome for a kill
export const AOE_WIDTH = 2.5; // expected bodies an all_characters effect hits
export const EXPECTED_X = 2; // assumed X paid for x_cost amounts
export const EXPECTED_COUNT = 2; // assumed dynamic count (count / event_value)

// ── Per-effect anchors (mirror spell-eval EXACTLY) ───────────────────────────
export const FACE_WEIGHT = 1.5; // gameplan NEUTRAL faceWeight
export const REMOVAL_WEIGHT = 1.0; // gameplan NEUTRAL removalWeight
export const TEMPO_WEIGHT = 0.6; // gameplan NEUTRAL tempoWeight (modify_stats)
export const CARD_VALUE = 1.2; // spell-eval draw/return/copy anchor
export const CONDITIONAL_P = 0.6; // spell-eval CONDITIONAL_P (ifTrue weight)
export const SAC_COST = 0.2; // spell-eval SAC_COST (allied sacrifice as cost)
export const HEAL_URGENCY = 0.7; // spell-eval heal urgency, averaged (1.0 low / 0.4 else)
export const FLAT_ONE = 1.0; // spell-eval flat for hard-to-value effects
export const BOUNCE_MULT = 0.7; // spell-eval bounce discount

// ── Resource & token anchors (§13 mispricing repair — Rulebook-derived, NOT
// fitted to win rates). The §12 buff-arm autopsy showed every engine effect
// class priced at ~0.7–2.0 while the cost line demands 5–15 at those costs;
// these anchor the repaired values to the game's own rules and existing
// constants (ACCEL_RAMP_TEMPO in deck-value.ts, the recurrence table above). ──
export const RESOURCE_VALUE = 1.5; // one banked resource ≈ ACCEL_RAMP_TEMPO stats of tempo per turn earlier
export const RESOURCE_VALUE_TEMP = 0.75; // a this-turn-only resource: half a banked one (must be used NOW)
export const TOKEN_BODY_FACTOR = 0.8; // token stats vs printed-card stats: a real body, but no hand/equip value
export const EMPTY_SLOTS_EXPECTED = 2.5; // in-each-empty Frontline deploys: 3-slot zone, expected ~2.5 open when it lands
// Rulebook 8, Upkeep 4: a ready Reserve character taps for +1 TEMPORARY resource
// each turn. A token parked in Reserve is therefore a small engine, not just
// stats: RESOURCE_VALUE_TEMP × the on_turn_start recurrence (2.4).
export const RESERVE_TAP_VALUE = 1.8;
export const SELECTION_MULT_DISCARD = 1.5; // choose-from-known-pile beats a blind draw (copy_card)
export const SELECTION_MULT_DECK = 2.0; // tutor the best card of the whole deck (search_deck → hand)

// ── Caps ─────────────────────────────────────────────────────────────────────
export const EFFECT_SUM_CAP = 12; // per-ability effect-sum cap before recurrence
export const INTRA_CAP = 0.5; // intra-card synergy lifts a card at most +50%
export const PAIR_CAP = 4; // a single inter-card pair contributes at most this
export const GLOBAL_SYN_FRACTION = 0.4; // total deck synergy <= 0.4 * raw card power
// A card is ONE card on the board: it can realize a FEW combos reliably, but a
// hub wired into many partners (a lone sac outlet fed by ten bodies, one shield
// for the whole board) cannot fire them all at once. Each card gets SATURATION_FREE
// edges at full value, then its k-th extra edge decays by SATURATION_DECAY. This
// distinguishes a redundant wide web (8–10 edges/card) from a coherent package
// (3–4), where a flat per-edge decay would wrongly gut both. Anchored to "a card
// realizes ~2 simultaneous combos," not to win rates; mirrors REDUNDANCY_DECAY.
export const SATURATION_FREE = 2;
export const SATURATION_DECAY = 0.6;

// ── Hero / deck consts ───────────────────────────────────────────────────────
export const LP_VALUE = 0.6; // value per hero LP above/below the 30 baseline
export const LP_BASELINE = 30; // neutral hero LP
export const HERO_FLOOR = 6; // every hero is an engine worth a baseline
export const REDUNDANCY_DECAY = 0.1; // k-th copy worth power * 0.9^(k-1)

// ── Trigger recurrence ───────────────────────────────────────────────────────
const AURA_REC = 2.6; // continuous board effect, active every turn in play
const CONDITION_DISCOUNT = 0.7; // an extra ability-level Condition gate (not always firing)

// Fixed recurrence per non-activated trigger. Typed as a total Record so adding a
// trigger variant is a compile error here (exhaustiveness).
const FIXED_RECURRENCE: Record<Exclude<Trigger['type'], 'activated'>, number> = {
  while: AURA_REC,
  on_turn_start: 2.4,
  on_turn_end: 2.2,
  on_deploy: 1.0,
  on_cast: 1.0,
  on_flash: 0.9,
  on_counter: 0.9,
  on_destroy: 0.9,
  on_dies: 0.9,
  on_leaves_battlefield: 0.9,
  on_attack: 1.4,
  on_block: 0.8,
  on_deal_damage: 1.2,
  on_deal_lethal_damage: 1.2,
  on_take_damage: 1.0,
  on_ally_deployed: 1.6,
  on_ally_destroyed: 1.5,
  on_ally_dies: 1.5,
  on_ally_leaves_battlefield: 1.5,
  on_spell_cast: 1.6,
  on_sacrifice: 1.2,
  on_healed: 0.8,
  on_overheal: 0.8,
  on_equipment_attached: 1.0,
  on_gain_resource: 1.2,
  on_stat_modified: 1.3,
};

function activatedRecurrence(t: Activated): number {
  if (t.oncePerGame === true) return 0.7; // single use ever
  if (t.oncePerTurn === true) return 1.6;
  if (t.cooldown != null && t.cooldown > 0) return 2.0 / (1 + 0.5 * t.cooldown);
  return 2.0; // repeatable each turn if paid
}

function triggerRecurrence(t: Trigger): number {
  return t.type === 'activated' ? activatedRecurrence(t) : FIXED_RECURRENCE[t.type];
}

function wrapperThrottle(base: number, ab: TriggeredAbilityDSL): number {
  let r = base;
  if (ab.oncePerTurn === true) r = Math.min(r, 1.6);
  if (ab.cooldown != null && ab.cooldown > 0) r = r / (1 + 0.5 * ab.cooldown);
  return r;
}

function conditionFactor(condition: Condition | undefined): number {
  return condition === undefined ? 1 : CONDITION_DISCOUNT;
}

/** How many times, in expectation, an ability's effects land over a game — the
 * multiplier on its summed effect value. An aura/turn-start engine compounds; a
 * once-per-game Ultimate is below a one-shot deploy (it costs a turn's action). */
export function recurrence(ability: AbilityDSL): number {
  if (ability.type === 'aura') return AURA_REC * conditionFactor(ability.condition);
  if (ability.type === 'stat_grant') return 1.0; // permanent attached grant, valued once
  const throttled = wrapperThrottle(triggerRecurrence(ability.trigger), ability);
  return throttled * conditionFactor(ability.condition);
}
