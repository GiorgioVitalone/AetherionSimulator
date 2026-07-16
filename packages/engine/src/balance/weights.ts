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
// spell-eval bodyValue at NEUTRAL = atk + hp, so each is the 1.0 anchor. ARM is
// priced in that SAME flat, un-recurrence-scaled unit — statBase never applies a
// turns multiplier to any stat (see valuation-profile.ts).
// §S2 (v1 rule, sim-data/ruleset-v1.json `armFirstInstanceOnly`, locked — the
// shield's `shieldFirstInstanceOnly` is NOT in the v1 manifest; see the
// round-5 correction above): ARM absorbs only the FIRST combat-damage
// instance a body takes each turn, not every instance — the repealed premise
// this constant used to carry ("mitigates >=1 damage per instance and
// persists") described the engine-DEFAULT per-instance rule, not the ratified
// one. Under the single-instance cap, one ARM point can mitigate at most ONE
// point of damage per opportunity — identical in kind to what one HP point
// absorbs once. The "recharges every turn" property is real (see
// VALUATION_PROFILE_V1.expectedActiveTurns) but is consumed by the SEPARATE
// ability-wrapped shield-replacement path (effect-value.ts 'replacement' ->
// card-power.ts's abilityContribution -> recurrence()), which DOES get
// turn-recurrence-scaled; it does not also enter this flat per-point weight,
// for the same reason HP/ATK's weights don't either (double-counting the
// turns multiplier would make ARM's unit inconsistent with HP/ATK's). Net:
// parity with HP, not a premium.
export const W_ATK = 1.0;
export const W_HP = 1.0;
export const W_ARM = 1.0;

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
export const CARD_VALUE = 1.2; // spell-eval return/copy/tutor/mill anchor (NOT draw — see W_DRAW)
// Empirically recalibrated draw anchor (2026-07-14). A same-seed r8 full-vision trial
// (+2 cost on all 29 draw_cards cards, certification pool 34cf3a28, discard rule intact)
// moved Sapphire 70.7%→51.0% and the spread 42.7pp→16.0pp — i.e. the pool's draw effects
// were collectively underpriced by ≈2 resources each. Implied value of one drawn card
// ≈ old 1.2 power + 2 resources × 1.1 spells/equip slope ≈ 3.3 power (≈3 resources).
// Coherence check: Discard for Energy guarantees every card in hand a FLOOR of 1
// resource; the old 1.2 (≈1.1 resources) priced draw at that floor and ignored the
// play-the-card option value entirely. Single-dose calibration under the r8-d3
// full-vision pilot — revisit when the far-sighted (depth-0) or neural instrument
// re-measures. Scope: static pricer + value-pilot deploy scoring; the heuristic
// spell-eval keeps its own local anchor; rollout verdict tier unaffected.
export const W_DRAW = 3.3; // draw_cards per-card anchor (empirical, ledger 2026-07-14)
// §S1: the shared primitive for "one card enters your hand" — floor (Discard
// for Energy guarantees >=1 resource) + play-option value. Anchored to W_DRAW
// (the empirical draw anchor above); draw_cards, search_deck, copy_card,
// return_from_discard, recycle, and to-hand scry all route through this ONE
// constant so a hand-picked card can never be priced below a blind draw.
export const CARD_TO_HAND = W_DRAW;
// §S1: bounded multiplier for a CHOSEN card (tutor/copy/return of a specific,
// known card beats a blind draw of an unknown one). Conservative premium —
// monotonicity (chosen >= blind) is the requirement this repairs; the exact
// magnitude is provisional pending measurement.
export const SELECTION_PREMIUM = 1.25;
// §S3: CONDITIONAL_P is now documented as the MIDPOINT policy — the scalar
// `power` still uses this weighted blend, while the interval (powerLow/High)
// spans the full [ifFalse-only, ifTrue-only] range around it.
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
// §S1: superseded by CARD_TO_HAND × SELECTION_PREMIUM (copy_card/search_deck now
// route through the shared acquisition primitive above). Kept, unused, to avoid
// ripples elsewhere; do not wire these back in.
export const SELECTION_MULT_DISCARD = 1.5; // choose-from-known-pile beats a blind draw (copy_card)
export const SELECTION_MULT_DECK = 2.0; // tutor the best card of the whole deck (search_deck → hand)

// ── §S3: power interval sources (conservative; additive to the scalar path) ──
// A dynamic amount (x_cost / count / event_value) is assumed at its EXPECTED
// point for the scalar, but plausibly spans 0..cap: capped counts use their
// own max, uncapped amounts get EXPECTED ± 100% (i.e. 0..DYNAMIC_AMOUNT_SPREAD
// × EXPECTED). Widens deal_damage/heal/draw_cards/modify_stats intervals only
// — see effect-value.ts's amountValDetailed/dynamicBonusDetailed.
export const DYNAMIC_AMOUNT_SPREAD = 2;
// A CHOSEN card (tutor/copy/return/scry-to-hand) is worth AT LEAST a blind
// draw (low = CARD_TO_HAND × 1.0) and, wide by design, AT MOST the selection
// premium squared (a card selection compounds — you also chose WHEN to find
// it). The scalar keeps the single SELECTION_PREMIUM midpoint.
export const SELECTION_PREMIUM_LOW = 1.0;
export const SELECTION_PREMIUM_HIGH = SELECTION_PREMIUM * SELECTION_PREMIUM;

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

// §S2 round-5 correction: ruleset-v1.json's `rules` object carries ONLY
// `armFirstInstanceOnly` (see sim-data/ruleset-v1.json + the EXPECTED_RULES
// literal in tests/sim/ruleset-v1-lock.test.ts) — there is no
// `shieldFirstInstanceOnly` entry, locked or otherwise. Under v1, the EC-003
// −1 "would take damage" shield therefore runs the engine's UNCONFIGURED
// default: it reduces EVERY combat instance a body takes in a turn, not just
// the first (see combat-resolver.ts: `shieldFirstInstanceOnly =
// state.config?.shieldFirstInstanceOnly === true`, false unless a config
// explicitly sets it). Rulebook.md line ~377's own worked ARM example — a body
// hit by two attacks (plus an ARM-immune spell) in one turn — is the game's
// own canonical illustration of how many combat instances a body plausibly
// absorbs in a turn; reused here (not invented) as the per-instance shield's
// expected instance count. Consumed by effect-value.ts's 'replacement' case.
export const SHIELD_INSTANCES_PER_TURN = 2; // Rulebook.md ARM worked example: 2 attacks land on one body in a turn

// ── Trigger recurrence ───────────────────────────────────────────────────────
// Exported for reuse by valuation-profile.ts (§S2's expectedActiveTurns
// anchor) — do NOT introduce a second "expected active turns" constant.
export const AURA_REC = 2.6; // continuous board effect, active every turn in play
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
