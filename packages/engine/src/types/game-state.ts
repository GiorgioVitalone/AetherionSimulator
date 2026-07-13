/**
 * Runtime game state types — the in-memory representation of a game in progress.
 * Distinct from the DSL types (which define card *definitions*, not runtime *instances*).
 *
 * Every field is readonly — the engine produces new state objects, never mutates.
 */
import type {
  AbilityDSL,
  CardTypeCode,
  ResourceCost,
  ResourceType,
  StatModifier,
  Trait,
  ZoneType,
} from './index.js';
import type { Condition } from './conditions.js';
import type { Effect, ReplacedEvent, CostReductionFilter, ScheduledTiming } from './effects.js';
import type { Trigger } from './triggers.js';
import type { Gameplan } from '../bot/gameplan.js';

// ── Top-level Game State ─────────────────────────────────────────────────────

export interface GameState {
  readonly players: readonly [PlayerState, PlayerState];
  readonly activePlayerIndex: 0 | 1;
  readonly turnNumber: number;
  readonly phase: GamePhase;
  readonly stack: readonly StackItem[];
  readonly pendingChoice: PendingChoice | null;
  /** Open reactive priority window: the non-active player may add a Counter/Flash
   * link to the chain on the stack, or pass. Null means no window is open.
   * Optional so existing state literals remain valid (absent ≡ null). */
  readonly pendingPriority?: PendingPriority | null;
  readonly log: readonly GameEvent[];
  readonly winner: 0 | 1 | 'draw' | null;
  readonly rng: RngState;
  readonly turnState: TurnState;
  /** Effects queued to fire at a future phase boundary (e.g. end_of_turn,
   * next_turn_start, next_upkeep). Processed by the turn machine at the matching
   * boundary. Optional: absent means none scheduled. */
  readonly scheduledEffects?: readonly ScheduledEntry[];
  /** Optional rules-variant configuration. Absent means engine defaults
   * (terminationMode === 'turn_cap'). */
  readonly config?: GameConfig;
}

/** How a game is expected to be brought to a close. Selectable per game so
 * sims can A/B the proposed comeback transform against the turn-cap baseline. */
export type TerminationMode = 'turn_cap' | 'resource_deck_empty_transform';

/** Per-game rules-variant configuration carried on GameState so the rule is
 * visible to every state-derived path (available actions, transform gate, bot). */
export interface GameConfig {
  readonly terminationMode: TerminationMode;
  /** DIAGNOSTIC ABLATION ONLY. Effect `type` strings to no-op at resolution
   * (e.g. ["return_from_discard"]) so value-loop / recursion mechanics can be
   * neutralized generically and by-data. Absent/empty means no effects are
   * disabled (engine default behavior). */
  readonly disableEffectTypes?: readonly string[];
  /** DIAGNOSTIC ABLATION ONLY. Multiplier applied to every `heal` amount at
   * resolution to test a heal-stall regime. Absent means 1 (engine default). */
  readonly healScale?: number;
  /** DESIGN-SWEEP KNOB (default absent/1 ⇒ engine-default damage). Multiplier
   * applied to COMBAT damage dealt — both the character-vs-character instances and
   * the character-vs-hero face damage — AFTER ARM and "would take damage"
   * replacements have already reduced the raw amount, just before HP/LP is
   * consulted. Tests the "increase damage / faster kills" hypothesis. Rounded with
   * Math.round (engine's standard rounding, matching lpScale). SCOPE: combat damage
   * only; direct/effect `deal_damage` (non-combat) is NOT scaled. Absent/1 ⇒ a
   * byte-identical no-op (the scale path is skipped entirely when 1). */
  readonly damageScale?: number;
  /** DESIGN-SWEEP KNOB (default absent ⇒ engine-default 3 Frontline slots).
   * Number of Frontline slots per player. Tests "add a Frontline zone" (4) and
   * tighter boards (2). Capacity is carried by the physical zone-array length; the
   * sim-runner resizes the arrays to match. Absent ⇒ 3 (byte-identical no-op). */
  readonly frontlineSlots?: number;
  /** DESIGN-SWEEP KNOB (default absent ⇒ engine-default 2 High Ground slots).
   * Number of High Ground slots per player. Tests "add a High Ground zone" (3).
   * See frontlineSlots. Absent ⇒ 2 (byte-identical no-op). */
  readonly highGroundSlots?: number;
  /** DIAGNOSTIC ABLATION ONLY (default absent ⇒ no-op). When true, the combat
   * pipeline ignores every `on_would_take_damage` reduction replacement (the -1
   * "would take damage" shield), so its causal contribution can be measured. */
  readonly ablateShield?: boolean;
  /** DIAGNOSTIC ABLATION ONLY (default absent ⇒ no-op). When true, attack
   * targeting treats the Flying trait as absent (no Defender bypass, no extra
   * reach) so the evasive-clock contribution can be measured. */
  readonly ablateFlying?: boolean;
  /** DIAGNOSTIC ABLATION ONLY (default absent ⇒ no-op). When true, Defender
   * priority no longer forces attacks onto Frontline Defenders. */
  readonly ablateDefenderForcing?: boolean;
  /** DIAGNOSTIC ABLATION ONLY (default absent ⇒ no-op). When true, every
   * `until_next_upkeep` arm modifier (Seraphina's "Protector's Bulwark" +1
   * frontline ARM) is zeroed at apply time. */
  readonly ablateBulwark?: boolean;
  /** RULE VARIANT — EC-001 (default absent/false ⇒ engine-default additive ARM).
   * When true, a body's active ARM BUFFS combine by `max` instead of `sum`:
   * effective ARM = baseArm + max(active positive ARM buffs) (0 if none). Spans
   * BOTH timed `modify_stats` modifiers and continuous aura ARM bonuses (all of
   * which are tracked in `card.modifiers` by the time aura recompute completes).
   * ATK and HP are UNAFFECTED. ARM debuffs (negative contributions) are left
   * as-is. Normalization runs at the tail of every aura recompute — the single
   * chokepoint invoked after every action — so the running `currentArm` scalar
   * reflects the max-combined value at every consumption point. */
  readonly armBuffsTakeMax?: boolean;
  /** RULE VARIANT — EC-002 (default absent/false ⇒ engine-default per-instance
   * ARM). When true, a body's ARM reduces only the FIRST combat-damage instance
   * it receives in a given turn; subsequent instances that turn are unreduced
   * (ARM = 0 against them). The charge "recharges" at the turn boundary (reset for
   * BOTH players' bodies and heroes at the start of each turn via passTurn). Aimed
   * at the gang-a-Defender case: when multiple attackers hit one defender in a
   * turn, only the first is blunted by ARM. Applies per defending body and per
   * attacking body (counter-damage) independently — each consumes its own charge.
   * ARM is consulted ONLY in the combat path (damage-calculator), so this gate
   * lives there; non-combat `deal_damage` ignores ARM entirely and is unaffected.
   * The per-body charge is tracked via `CardInstance.armMitigatedThisTurn` /
   * `HeroState.armMitigatedThisTurn`. ATK/HP unaffected. Stacks cleanly with
   * EC-001 (which determines the magnitude of that single first-instance ARM). */
  readonly armFirstInstanceOnly?: boolean;
  /** RULE VARIANT — EC-003 (default absent/false ⇒ engine-default per-instance
   * shield). When true, a body's −1 "would take damage" shield (the
   * on_would_take_damage damage-reduction replacement in `activeReplacements` —
   * Shieldbearer Paladin id48, Radiant Shield id66) reduces only the FIRST
   * combat-damage instance the body receives in a given turn; subsequent instances
   * that turn are unreduced (the shield does not fire). The charge "recharges" at
   * the turn boundary (reset for BOTH players' bodies and heroes at the start of
   * each turn via passTurn). Aimed at the gang-a-shielded-Defender case: when
   * multiple attackers hit one shielded body in a turn, only the first is blunted
   * by the shield. Applies per defending body and per attacking body
   * (counter-damage) independently — each consumes its own charge. The shield is
   * consulted ONLY in the character-vs-character combat path
   * (combat-resolver.reduceShield), so this gate lives there; the engine never
   * applies an on_would_take_damage replacement to a Hero (calculateHeroDamage is
   * ARM-only), so heroes are unaffected. The per-body charge is tracked via
   * `CardInstance.shieldMitigatedThisTurn`, INDEPENDENT of the recompute-volatile
   * `ActiveReplacement.usedThisTurn`. Mirrors
   * EC-002's `armFirstInstanceOnly` pattern but for the shield reduction; stacks
   * cleanly with EC-001/EC-002. */
  readonly shieldFirstInstanceOnly?: boolean;
  /** RULE VARIANT — EC-005 (default absent/false ⇒ engine-default healing). When
   * true, every `heal` whose realized target is a HERO (`hero_<id>`) is nullified
   * at resolution: the hero gains 0 LP and no HERO_HEALED event fires. CHARACTER
   * healing (any non-`hero_` target) is left fully intact. Isolates the
   * hero-longevity lever (Seraphina's transform heal, Angelic Strike, etc.).
   * Resolution path only; ATK/HP/ARM and all non-heal effects unaffected. Gated so
   * the default (toggle OFF) path is byte-identical to the v10 baseline. */
  readonly disableHeroHealing?: boolean;
  /** RULE VARIANT — EC-004 (default absent/unlimited ⇒ engine-default forcing).
   * A numeric cap on how many attackers a single Frontline Defender can FORCE onto
   * itself per turn. Currently a Defender forces ALL enemy attacks (within reach,
   * Flying/Sniper aside) to target it. With a finite cap N, once N attacks have been
   * forced onto a given Defender this turn it stops forcing — additional attackers
   * may attack freely (flow AROUND the wall) per the targeting matrix. Per-Defender
   * counter (`CardInstance.forcedAttacksThisTurn`), reset at the turn boundary
   * (passTurn). A non-forcing (capped-out) Defender remains a LEGAL freely-chosen
   * target — the cap only removes its forcing pressure, not its targetability.
   * Absent / <= 0 ⇒ unlimited (current behavior, byte-identical no-op). Flying
   * bypass, Sniper, zone matrix, and Empty Board rules are unchanged. */
  readonly defenderForceCap?: number;
  /** RULE VARIANT — EC-007 (default absent/false ⇒ engine-default Frontline
   * forcing). When true, the Defender trait forces/redirects attacks ONLY while
   * the Defender is in the HIGH GROUND zone — a Frontline Defender no longer
   * forces, and a Defender moved to High Ground forces every eligible attacker
   * onto itself per the targeting matrix. Inverts the Rulebook's current
   * "Defenders only function in the Frontline". Walling now costs a scarce
   * High-Ground slot (2 per player), the same slot reach/Flying attackers want,
   * creating a wall-vs-reach tradeoff. Flying bypass, Sniper, the zone reach
   * matrix, EC-004's per-Defender force cap, and the Empty Board rule are
   * unchanged — only the zone a forcing Defender must occupy flips. Absent/false
   * ⇒ byte-identical to the v10 Frontline-forcing baseline. */
  readonly defenderHighGroundOnly?: boolean;
  /** RULE VARIANT — TEST A (default absent/false ⇒ engine-default per-instance ARM).
   * When true, ARM reduces only the FIRST combat-damage instance a body EVER takes
   * across the WHOLE game (absolute, once per body), by its current ARM value
   * (raw − arm, min 0). After that first instance, ARM gives NO reduction ever again
   * for that body — it does NOT refresh or recover at the turn boundary. Net feel:
   * ARM is a one-time "unhealable max-HP" buffer. The per-body charge is tracked via
   * `CardInstance.armConsumed` / `HeroState.armConsumed`, a flag that NEVER resets
   * (passTurn leaves it untouched). ARM is consulted ONLY in the combat path
   * (damage-calculator), so this gate lives there; non-combat `deal_damage` ignores
   * ARM and is unaffected. ATK/HP unaffected. MUTUALLY EXCLUSIVE with
   * `armChargeAbsorb` (both replace the normal applyArm; if both somehow set,
   * armChargeAbsorb takes precedence). Engine-default (toggle OFF) never reads or
   * writes `armConsumed` ⇒ byte-identical no-op. */
  readonly armOneTimeAbsolute?: boolean;
  /** RULE VARIANT — TEST B (default absent/false ⇒ engine-default per-instance ARM).
   * When true, ARM is a CHARGE counter. Each time a body takes a combat-damage
   * instance while it has charges remaining, the ENTIRE instance is fully negated
   * (0 damage) AND its charge count decrements by 1. When charges reach 0, damage
   * flows normally (ARM gives no reduction). Charges do NOT recover at the turn
   * boundary; only a fresh ARM buff (which raises `currentArm`) adds charges. The
   * remaining charge count is tracked via `CardInstance.armCharges` /
   * `HeroState.armCharges`; it is initialized lazily from `currentArm` the first time
   * a charged body takes an instance, and re-topped-up whenever `currentArm` exceeds
   * the tracked remaining charges (a fresh buff). passTurn leaves it untouched.
   * Example: 2 ARM → first hit fully absorbed (charges→1), second hit fully absorbed
   * (charges→0), third hit deals full damage. ARM is consulted ONLY in the combat
   * path; non-combat `deal_damage` is unaffected. ATK/HP unaffected. MUTUALLY
   * EXCLUSIVE with `armOneTimeAbsolute` (takes precedence if both set).
   * Engine-default (toggle OFF) never reads or writes `armCharges` ⇒ byte-identical
   * no-op. */
  readonly armChargeAbsorb?: boolean;
  /** DIAGNOSTIC ABLATION ONLY — "hero reach" isolation (default absent ⇒ no-op).
   * A per-SEAT flag pair (indexed by the ATTACKING/SOURCE player seat). When
   * `disableHeroReachBySeat[seat]` is true, that seat can never reduce the ENEMY
   * Hero's LP: (a) attack targeting never offers the enemy Hero as a target (so
   * Flying / High-Ground / Sniper hero attacks are blocked), (b) the combat hero
   * branch no-ops if somehow reached, and (c) any direct `deal_damage` effect that
   * seat sources against the enemy Hero deals 0 and fires no HERO_DAMAGED. The seat
   * can still kill enemy CHARACTERS — it just can never lower the enemy Hero's LP,
   * so with this ON the seat can only win by deckout/tiebreak, never by lethal.
   * Self-/own-hero LP changes are unaffected. Resolved from the public sim-runner
   * spec `disableFactionHeroReach: { faction }` (faction → seat). Absent / both
   * false ⇒ byte-identical to the v10 baseline. */
  readonly disableHeroReachBySeat?: readonly [boolean, boolean];
  /** DESIGN-SWEEP KNOB (default absent/false ⇒ engine-default healing). When true,
   * healing may not push a character above its max (the CHARACTER_OVERHEALED event
   * is suppressed so `on_overheal` triggers never fire) — overheal yields no payoff.
   * The HP/LP cap itself already holds in the engine default (heal is clamped to
   * headroom), so the only behavioral change is removing the overheal signal. Absent/
   * false ⇒ byte-identical no-op (the suppression branch is never entered). */
  readonly noOverheal?: boolean;
  /** DESIGN-SWEEP KNOB (default absent/0 ⇒ engine-default ramp of 1 resource/turn).
   * Each Upkeep, the active player draws N EXTRA Resource cards into the Resource Bank
   * (on top of the standard 1), modeling a faster ramp. Reads off the live Resource
   * Deck — never draws past it. Absent / <= 0 ⇒ exactly 1 draw (byte-identical no-op). */
  readonly resourceRampBonus?: number;
  /** DESIGN-SWEEP KNOB (default absent/false ⇒ engine-default deploy zones). When
   * true, ANY character may deploy directly to High Ground at NO surcharge (bypassing
   * the move-from-Frontline requirement), not just Elite. Only the OFFERED deploy
   * slots change (available-actions); the deploy executor already accepts a
   * high_ground target. Absent/false ⇒ only Elite is offered High Ground (with its +2
   * surcharge) ⇒ byte-identical no-op. */
  readonly directHighGroundDeploy?: boolean;
  /** DIAGNOSTIC INSTRUMENTATION ONLY (default absent ⇒ no-op). A mutable
   * side-channel accumulator the combat/replacement pipeline writes measured
   * tallies into when present. NOT part of the hashed run identity. Touched only
   * when present, so an absent `diag` leaves resolution byte-identical. */
  readonly diag?: DiagCounters;
  /** WS-A T-A5 PILOT DE-BIAS KNOB (default absent ⇒ engine-default heuristic
   * constants). Per-seat strategic gameplans the heuristic pilot reads to bias its
   * scoring toward each faction's archetype (see src/bot/gameplan.ts). Indexed by
   * SEAT (0/1). Absent ⇒ the pilot uses its hardcoded constants (equivalently the
   * NEUTRAL gameplan), a byte-identical no-op; the engine's resolution path never
   * consults this field, so it cannot affect any runHash. */
  readonly botGameplan?: Record<0 | 1, Gameplan>;
  /** FAIR-PILOT KNOB (default absent/false ⇒ engine-default heuristic constants &
   * rollout policy). When true, the heuristic value model recurses into wrapper
   * effects (conditional/composite/choose_one) and values recursion/tutor/copy/ramp
   * effects, the reactive + mulligan policy is card-advantage / curve aware, and the
   * rollout pilot rolls to game end and counters high-threat spells. Read ONLY by the
   * bot (src/bot/*) and the rollout pilot; the engine's resolution path never consults
   * it, so it cannot affect any runHash on its own. Absent/false ⇒ byte-identical
   * no-op (the v-current hash). */
  readonly fairPilot?: boolean;
  /** BOT-POLICY KNOB (default absent/false ⇒ engine-default blind last-resort
   * discard). When true, the heuristic pilot's `discard_for_energy` stops being a
   * reflexive pitch: it fires ONLY to fund a specific play that is short by exactly
   * one resource, pitches a single matching-type card to pay for it, and only when
   * the play's value exceeds the pitched card's value plus a tempo margin. Read ONLY
   * by the bot (src/bot/*); the engine's resolution path never consults it, so it
   * cannot affect any runHash on its own. Absent/false ⇒ byte-identical no-op. */
  readonly reachDiscard?: boolean;
  /** RULE VARIANT (default absent/false ⇒ engine-default: discarded card goes to the
   * discard pile). When true, a card spent via `discard_for_energy` is EXILED (removed
   * from the game) instead of binned, so the resource mechanic no longer doubles as
   * graveyard fuel for reanimation (Onyx's Grave Digger / Morgath / Necrotic Revival /
   * Kaelthar). The +1 temporary resource and the CARD_DISCARDED event are unchanged —
   * only the card's destination differs. Read by the discard executor only. Absent/
   * false ⇒ byte-identical no-op. */
  readonly exileDiscardForEnergy?: boolean;
  /** BOT-POLICY KNOB (default absent/false ⇒ engine-default atk+hp valuation). When
   * true, the heuristic pilot consults the first-principles card-power / synergy
   * engine (src/balance) ON TOP of its existing heuristics: deploy and keep/pitch
   * decisions rank by `computeCardPower` (stats + keywords + abilities + intra-card
   * synergy, on the same scale as atk+hp) plus a bounded board/hero inter-card synergy
   * bonus, so it plays the cards that actually combo with its board and hero. Read
   * ONLY by the bot (src/bot/*); the engine's resolution path never consults it, so it
   * cannot affect any runHash on its own. Absent/false ⇒ byte-identical no-op. */
  readonly valuePilot?: boolean;
  /** BOT-POLICY KNOB (default absent/false ⇒ no change; only meaningful on top of
   * `valuePilot`). The per-card power score is cost-free, so ramp enablers score ~0
   * and the value pilot structurally under-deploys the ramp archetype (the same
   * blindness computeDeckValue's `acceleration` term fixes at the DECK level). When
   * true, the deploy ranking adds an early-game tempo bonus for `ramp` signals
   * (weight × ACCEL_RAMP_TEMPO, fading linearly to 0 by the resource-deck horizon),
   * so the pilot actually starts the ramp plan it was dealt. Read ONLY by the bot
   * (src/bot/*); the engine's resolution path never consults it, so it cannot affect
   * any runHash on its own. Absent/false ⇒ byte-identical no-op. */
  readonly rampPilot?: boolean;
  /** RULE GUARD (default absent/false ⇒ engine-default: cost reductions floor at
   * zero). When true, stacked cost reductions can never take a card below an
   * effective TOTAL cost of 1 unless its printed cost is already 0 — the
   * engine-wide "(minimum 1)" Lyria's Supreme Intellect already prints, applied
   * to every discount. Exists because an unfloored discount × a cheap self-copy
   * spell produced a 0-cost infinite loop (§12c: budget-cut Arcane Echoes ×
   * Wizard's Robe — 7,990 casts in one game, step-cap abort). Read by
   * effectiveCost only. Absent/false ⇒ byte-identical no-op. */
  readonly costFloor?: boolean;
  /** RULES-ACCURACY FIX (default absent/false ⇒ legacy engine behavior: Reserve
   * Energy Generation happens AUTOMATICALLY at Upkeep for every eligible ready
   * Reserve character). Rulebook 8 step 4 says the active player MAY exhaust
   * them — it is a choice. When true, the automatic upkeep generation is off and
   * a `tap_reserve` player action (Strategy phase, per character) replaces it:
   * same eligibility, same +1 temporary resource of the card's type, same
   * all-abilities-disabled exhaustion until next Upkeep. Absent/false ⇒
   * byte-identical no-op. */
  readonly reserveTapChoice?: boolean;
  /** RULES CHANGE UNDER MEASUREMENT (§13m; default absent/false ⇒ tapping is
   * free). When true, generating Reserve Energy STRAINS the character: it takes
   * 1 direct damage (no ARM mitigation, no damage triggers — wear, not an
   * attack), and a character with 1 HP left is too weak to generate at all.
   * Exists because the free tap annuity is the measured source of Verdant's
   * structural income surplus (§13l): this converts free income into income
   * paid for in board material. Applies to both the automatic path and the
   * `tap_reserve` action. Absent/false ⇒ byte-identical no-op. */
  readonly reserveTapStrain?: boolean;
  /** RULES CHANGE UNDER MEASUREMENT (§13o; default absent ⇒ deck-construction
   * default: the full 15-card Resource Deck). When set, each player's Resource
   * Deck is truncated to this many cards AFTER the setup shuffle (preserving the
   * deck's resource-type mix in expectation). Smaller decks cap total permanent
   * income and empty sooner — under `terminationMode:
   * resource_deck_empty_transform` that opens the transform gate earlier.
   * Read at game setup only. Absent ⇒ byte-identical no-op. */
  readonly resourceDeckSize?: number;
  /** RULE ABLATION PROBE (default absent/false ⇒ engine-default: any player may,
   * once per turn, discard a hand card for +1 temporary resource MATCHING the
   * card's type — Mana if Magic-aligned, Energy if Tech-aligned, per Rulebook 11;
   * the action's name understates it). When true, the `discard_for_energy` action
   * is never offered. Exists to MEASURE the rule's contribution to faction
   * balance. Measured (§12a, 20k games/arm): a universal surprise-tempo valve —
   * props reach/aggro finishers (Onyx +2.9 pp, Radiant +1.3), suppresses the
   * long-game counter deck (Sapphire −4.0), null on Verdant (−0.3). Diagnostic,
   * not a proposed rules change. Absent/false ⇒ byte-identical no-op. */
  readonly disableDiscardForEnergy?: boolean;
  /** RULES-ACCURACY FIX — §13q (default absent/false ⇒ legacy engine behavior:
   * side:'any' target resolution returns players in SEAT order [0, 1] regardless
   * of who is active). When true, side:'any' returns [activePlayer, nonActivePlayer]
   * instead, matching the Rulebook's APNAP intent ("Active Player's triggers
   * first" — see trigger-matcher.ts) already enforced downstream for per-event
   * trigger ordering. Without this, a symmetric AoE effect (side:'any') emits its
   * CARD_DESTROYED/DAMAGE_DEALT events seat-0-first no matter which player is
   * active, and the downstream per-event trigger sort can't undo cross-card
   * emission order — measured to shift a matchup's win rate ~5pp purely from
   * which deck sits in seat 0. Only the player ORDER changes (same two players,
   * same cards); no other resolution behavior is affected. Absent/false ⇒
   * byte-identical no-op. */
  readonly apnapAnyOrderFix?: boolean;
  /** CANDIDATE RULE VARIANT UNDER EVALUATION (§13r; default absent/false ⇒ no
   * change: the locked `firstPlayerCompensation: 'card'` rule stands). Alternative
   * to that rule: when true, the FIRST PLAYER does not draw a Resource Card
   * during their FIRST Upkeep (the game's very first turn only) — everything
   * else about that Upkeep is unchanged. Under `resourceDeckSize` +
   * `terminationMode: 'resource_deck_empty_transform'` this also delays that
   * player's Resource Deck emptying by one turn (intended, not special-cased).
   * Mutually exclusive with `firstPlayerCompensation` at the harness level —
   * they are competing compensation levers under measurement, not stackable.
   * Absent/false ⇒ byte-identical no-op. */
  readonly firstPlayerSkipsFirstResource?: boolean;
  /** CANDIDATE RULE VARIANT UNDER EVALUATION (§13r; default absent/false ⇒ no
   * change: the engine-default first-player-first-turn Main Deck draw skip
   * stays in force). When true, DISABLES ONLY that draw skip — the first
   * player draws a card on their first turn like any other turn. The
   * companion "first player cannot declare attacks on turn 1" restriction
   * (available-actions.ts, combat-resolver.ts) is untouched and still applies;
   * this flag narrows `turnState.firstPlayerFirstTurn`'s effect to that
   * restriction alone. Absent/false ⇒ byte-identical no-op. */
  readonly firstPlayerDrawsNormally?: boolean;
}

/** Mutable diagnostic accumulator (see GameConfig.diag). Written by the engine
 * only when a `diag` object is supplied on the config — read-only diagnostics. */
export interface DiagCounters {
  /** Times an `on_would_take_damage` reduction fired, by defending player. */
  shieldFires: [number, number];
  /** Total damage points the -1 shield negated, by defending player. */
  shieldPrevented: [number, number];
  /** Combat damage absorbed by ARM (raw − post-ARM), by the ARMORED side. */
  armAbsorbedBase: [number, number];
  /** Of armAbsorbed, the portion attributable to Bulwark's +1 ARM, by side. */
  armAbsorbedBulwark: [number, number];
  /** EC-001 CO-OCCURRENCE INSTRUMENTATION (read-only, optional). At each aura
   * recompute, counts bodies that currently carry 2+ active positive ARM buffs
   * (the only situation where max≠sum). Incremented per such body per recompute,
   * by the body's controlling side. A coarse "how often does ARM actually stack"
   * signal; absent ⇒ not measured (default). NOT consulted by resolution. */
  armBuffsStackedEvents?: [number, number];
  /** Of armBuffsStackedEvents, the summed (sum − max) ARM points that EC-001
   * would have shaved off, by side — the magnitude of the rule's bite. */
  armBuffsStackedShaved?: [number, number];
  /** EC-002 INSTRUMENTATION (read-only, optional). ARM points that EC-002 would
   * STRIP relative to per-instance ARM, by the ARMORED side: for every combat
   * instance after a body's first-this-turn, the ARM that would have been
   * absorbed under per-instance rules but is NOT under first-instance-only. This
   * is measured against the LIVE config (so on the combined run it reflects the
   * EC-001-reduced ARM value). Absent ⇒ not measured (default); NOT hashed. */
  armFirstInstanceStripped?: [number, number];
  /** Of the body-turns observed in combat, the count of "subsequent" instances
   * (a body taking a 2nd+ combat instance in a turn) where ARM was withheld, by
   * side — the frequency signal for EC-002's bite (gang events). */
  armFirstInstanceGangHits?: [number, number];
  /** EC-003 INSTRUMENTATION (read-only, optional). Shield damage-points that EC-003
   * WITHHELD relative to per-instance shield, by the SHIELDED side: for every combat
   * instance after a body's first-this-turn, the −1 the shield would have prevented
   * under per-instance rules but does NOT under first-instance-only. Absent ⇒ not
   * measured (default); NOT hashed. */
  shieldFirstInstanceStripped?: [number, number];
  /** Of the body-turns observed in combat, the count of "subsequent" instances
   * (a body taking a 2nd+ shielded combat instance in a turn) where the shield was
   * withheld, by side — the frequency signal for EC-003's bite (gang events). */
  shieldFirstInstanceGangHits?: [number, number];
  /** EC-004 INSTRUMENTATION (read-only, optional). Attacks that reached an enemy
   * HERO face, by the ATTACKING side — measures how often the wall is bypassed
   * onto the hero. Absent ⇒ not measured (default); NOT hashed. */
  heroFaceAttacks?: [number, number];
  /** EC-004 INSTRUMENTATION (read-only, optional). Attacks that flowed AROUND a
   * capped-out Defender this turn (the attacker chose a non-forcing target while a
   * Frontline Defender existed but had hit its force cap), by the ATTACKING side.
   * Absent ⇒ not measured (default); NOT hashed. */
  defendersBypassed?: [number, number];
  /** EC-005 INSTRUMENTATION (read-only, optional). Hero-heal LP points NULLIFIED by
   * EC-005, by the side whose hero would have been healed — measured against live
   * LP headroom (the realized heal that the rule removed). Absent ⇒ not measured
   * (default); NOT hashed. */
  heroHealRemoved?: [number, number];
}

/** A `scheduled` effect waiting for its timing. Captures the controller/source so
 * the queued effects run with the right EffectContext when the boundary arrives. */
export interface ScheduledEntry {
  readonly id: string;
  readonly timing: ScheduledTiming;
  readonly effects: readonly Effect[];
  readonly condition?: Condition;
  readonly sourceInstanceId: string;
  readonly controllerId: 0 | 1;
}

export type GamePhase =
  | 'setup'
  | 'mulligan'
  | 'upkeep'
  | 'strategy'
  | 'action'
  | 'end'
  | 'game_over';

// ── Player State ─────────────────────────────────────────────────────────────

export interface PlayerState {
  readonly hero: HeroState;
  readonly zones: ZoneState;
  readonly hand: readonly CardInstance[];
  readonly mainDeck: readonly CardInstance[];
  readonly resourceDeck: readonly ResourceCard[];
  readonly resourceBank: readonly ResourceCard[];
  readonly discardPile: readonly CardInstance[];
  readonly temporaryResources: readonly TemporaryResource[];
  readonly turnCounters: TurnCounters;
  /** Active cost discounts for matching plays this turn, registered by a
   * `cost_reduction` effect and consulted by the cost system. Cleared at end of
   * turn (like temporaryResources). Optional: absent means none. */
  readonly costReductions?: readonly ActiveCostReduction[];
}

/** A cost discount currently active for a player. `usedThisTurn` enforces
 * `firstPerTurn` (a reduction that applies to only the first matching play). */
export interface ActiveCostReduction {
  readonly id: string;
  readonly reduction: number;
  readonly appliesTo: CostReductionFilter;
  readonly usedThisTurn: boolean;
}

export interface ZoneState {
  readonly reserve: readonly (CardInstance | null)[];
  readonly frontline: readonly (CardInstance | null)[];
  readonly highGround: readonly (CardInstance | null)[];
}

export interface TurnCounters {
  readonly spellsCast: number;
  readonly equipmentPlayed: number;
  readonly charactersDeployed: number;
  readonly abilitiesActivated: number;
}

export interface TemporaryResource {
  readonly resourceType: ResourceType;
  readonly amount: number;
}

// ── Card Instance ────────────────────────────────────────────────────────────

export interface CardInstance {
  readonly instanceId: string;
  readonly cardDefId: number;
  readonly name: string;
  readonly cardType: CardTypeCode;
  readonly currentHp: number;
  readonly currentAtk: number;
  readonly currentArm: number;
  readonly baseHp: number;
  readonly baseAtk: number;
  readonly baseArm: number;
  readonly exhausted: boolean;
  readonly summoningSick: boolean;
  readonly movedThisTurn: boolean;
  readonly attackedThisTurn: boolean;
  /** Whether this character has acted (attacked or used an activated ability) since
   * entering play. Lifts the Stealth trait's untargetability (Rulebook 16: Stealth
   * "cannot be targeted … until it attacks or uses an activated ability"). Absent ≡
   * false (has not yet acted). */
  readonly hasActed?: boolean;
  /** Free zone-moves remaining this turn that do NOT exhaust the mover (Swift grants
   * 1 per turn; Rush X grants X on the deploy turn — Rulebook 16). Each such move
   * also bypasses the once-per-turn movement gate. Absent ≡ 0. */
  readonly freeMovesRemaining?: number;
  /** Authored Rush X value (extra deploy-turn moves) parsed from the "Rush N" trait
   * label. Read when the card is deployed to seed freeMovesRemaining. Absent ≡ 0. */
  readonly rushValue?: number;
  /** Authored Recycle X value parsed from the "Recycle N" trait label: cards this
   * card's owner draws when it is discarded from hand (Rulebook 16). Read by the
   * forced-discard path. No current card carries it, so the behavior is inert today.
   * Absent ≡ 0 (no draw). */
  readonly recycleValue?: number;
  /** Set when this Reserve character was exhausted for Reserve Energy Generation
   * (Rulebook 8, Upkeep step 4). While set, ALL of its abilities are disabled
   * (passive Auras, activated effects, triggers) until its controller's next
   * Upkeep, when the refresh step clears it. Absent ≡ false. */
  readonly reserveEnergyExhausted?: boolean;
  readonly traits: readonly Trait[];
  readonly grantedTraits: readonly GrantedTrait[];
  readonly abilities: readonly AbilityDSL[];
  readonly registeredTriggers: readonly RegisteredTrigger[];
  readonly modifiers: readonly ActiveModifier[];
  readonly statusEffects: readonly ActiveStatus[];
  /** Active replacement effects registered on this card (e.g. damage reduction,
   * "would be destroyed → instead exile"). Consulted by the damage/destruction
   * pipeline before HP is reduced / the card is destroyed. Optional: absent means
   * no active replacements. */
  readonly activeReplacements?: readonly ActiveReplacement[];
  readonly equipment: CardInstance | null;
  /** Attach-eligibility constraint authored on an Equipment card (Rulebook 13): the
   * equipment may only attach to a character matching the given resource type
   * (Magic/Tech) and/or carrying the given Tag. Absent ≡ no restriction. */
  readonly equipRequirement?: EquipRequirement;
  /** Set on an Equipment instance after it is transferred this turn. An equipment
   * may be transferred only once per turn (Rulebook 13); cleared at its holder's
   * Upkeep refresh. Absent ≡ not yet transferred this turn. */
  readonly transferredThisTurn?: boolean;
  /** EC-002 (config.armFirstInstanceOnly): set once this body has had its ARM
   * applied to a combat-damage instance this turn. While set, further combat
   * instances this turn bypass its ARM (it has spent its first-instance charge).
   * Reset for ALL bodies at the turn boundary (passTurn). Absent ≡ charge intact.
   * Engine-default (toggle OFF) never reads or writes it ⇒ byte-identical no-op. */
  readonly armMitigatedThisTurn?: boolean;
  /** EC-003 (config.shieldFirstInstanceOnly): set once this body's −1 "would take
   * damage" shield (an on_would_take_damage reduction replacement) has blunted a
   * combat-damage instance this turn. While set, further combat instances this turn
   * bypass the shield (charge spent). Reset for ALL bodies at the turn boundary
   * (passTurn), surviving aura recompute (which re-registers the replacement but
   * never touches this flag). Absent ≡ charge intact. Engine-default (toggle OFF)
   * never reads or writes it ⇒ byte-identical no-op. Independent of the
   * recompute-volatile `ActiveReplacement.usedThisTurn`/`oncePerTurn`. */
  readonly shieldMitigatedThisTurn?: boolean;
  /** EC-004 (config.defenderForceCap): count of attacks FORCED onto this Defender
   * this turn (incremented in combat resolution when an attack lands on a body that
   * was forcing at declaration time). Once it reaches the cap the Defender stops
   * forcing for the rest of the turn (attackers flow around). Reset for ALL bodies
   * at the turn boundary (passTurn). Absent ≡ 0 (no attacks forced yet).
   * Engine-default (cap unset/<=0) never reads or writes it ⇒ byte-identical no-op. */
  readonly forcedAttacksThisTurn?: number;
  /** TEST A (config.armOneTimeAbsolute): set once this body's ARM has reduced the
   * FIRST combat instance it ever takes. While set, ARM gives no reduction ever
   * again for this body. NEVER reset (passTurn leaves it untouched). Absent ≡ charge
   * intact. Engine-default never reads or writes it ⇒ byte-identical no-op. */
  readonly armConsumed?: boolean;
  /** TEST B (config.armChargeAbsorb): remaining ARM charges. Each absorbed combat
   * instance fully negates damage and decrements this by 1. Initialized lazily from
   * `currentArm` and topped up when a fresh ARM buff raises `currentArm` above it.
   * NEVER reset at the turn boundary. Absent ≡ not yet initialized (use currentArm).
   * Engine-default never reads or writes it ⇒ byte-identical no-op. */
  readonly armCharges?: number;
  /** TEST B (config.armChargeAbsorb): the `currentArm` value at the last charge
   * sync. A fresh ARM buff is detected as `currentArm` rising above this; the delta
   * is added to the remaining charges. Without it, consuming a charge (which leaves
   * currentArm unchanged) would falsely re-charge every instance. Engine-default
   * never reads or writes it. */
  readonly armChargeSyncedArm?: number;
  readonly isToken: boolean;
  readonly tags: readonly string[];
  readonly cost: ResourceCost;
  readonly alignment: readonly string[];
  readonly owner: 0 | 1;
  /** Variable cost (X) paid when this card was played — e.g. the Energy spent on
   * an X-cost equipment. Read by the aura recompute so continuous `x_cost` stat
   * grants (Steel-Root Armor: +0/+X HP) scale by the X actually paid. Absent = 0. */
  readonly xPaid?: number;
}

/** Attach constraint on an Equipment card (Rulebook 13: "matching resource type
 * (Magic or Tech) or a specific Tag"). All present fields must be satisfied by the
 * candidate character. */
export interface EquipRequirement {
  readonly resourceType?: 'mana' | 'energy';
  readonly tag?: string;
}

export interface GrantedTrait {
  readonly trait: Trait;
  readonly sourceInstanceId: string;
  readonly duration: GrantedDuration;
}

export type GrantedDuration =
  | { readonly type: 'permanent' }
  | { readonly type: 'until_end_of_turn' }
  | { readonly type: 'until_next_upkeep' }
  | { readonly type: 'while_in_play'; readonly sourceId: string };

export interface ActiveModifier {
  readonly id: string;
  readonly sourceInstanceId: string;
  readonly modifier: StatModifier;
  readonly duration: GrantedDuration;
}

export interface ActiveStatus {
  readonly statusType: StatusEffectType;
  readonly value: number;
  readonly remainingTurns: number | null;
  /** Set when this status is granted by a continuous aura. Aura recompute strips
   * and rebuilds these every pass; absent means the status is durational/permanent
   * (e.g. an applied debuff) and is NOT touched by recompute. */
  readonly sourceAuraId?: string;
}

export type StatusEffectType =
  | 'persistent'
  | 'regeneration'
  | 'slowed'
  | 'stunned'
  | 'hexproof'
  | 'anti_redirect';

/** A replacement effect currently active on a card. Registered by a `replacement`
 * effect; consulted by the damage/destruction pipeline. `usedThisTurn` enforces
 * `oncePerTurn`. */
export interface ActiveReplacement {
  readonly id: string;
  readonly sourceInstanceId: string;
  readonly replaces: ReplacedEvent;
  readonly instead: readonly Effect[];
  readonly oncePerTurn: boolean;
  readonly usedThisTurn: boolean;
}

// ── Hero State ───────────────────────────────────────────────────────────────

export interface HeroState {
  readonly cardDefId: number;
  readonly name: string;
  /** Static damage reduction applied to each incoming damage instance (min 0),
   * mirroring character ARM. Heroes have no printed ARM (base 0); an effect may
   * grant it. Combat reads this so granted hero ARM mitigates attacks. */
  readonly currentArm: number;
  /** EC-002 (config.armFirstInstanceOnly): mirrors CardInstance.armMitigatedThisTurn
   * for the hero. Set once the hero's ARM has blunted a combat instance this turn;
   * further instances that turn bypass hero ARM. Reset at the turn boundary.
   * Absent ≡ charge intact. Engine-default never reads/writes it. */
  readonly armMitigatedThisTurn?: boolean;
  /** TEST A (config.armOneTimeAbsolute): mirrors CardInstance.armConsumed for the
   * hero. Set once the hero's ARM has reduced its first ever combat instance; never
   * reset. Absent ≡ intact. Engine-default never reads/writes it. */
  readonly armConsumed?: boolean;
  /** TEST B (config.armChargeAbsorb): mirrors CardInstance.armCharges for the hero.
   * Remaining ARM charges; each absorbed instance decrements by 1; never reset.
   * Absent ≡ not yet initialized (use currentArm). Engine-default never reads/writes it. */
  readonly armCharges?: number;
  /** TEST B (config.armChargeAbsorb): mirrors CardInstance.armChargeSyncedArm —
   * the currentArm at last charge sync, used to detect fresh buffs. */
  readonly armChargeSyncedArm?: number;
  readonly currentLp: number;
  readonly maxLp: number;
  readonly transformed: boolean;
  readonly canTransformThisGame: boolean;
  readonly transformedThisTurn: boolean;
  readonly abilities: readonly AbilityDSL[];
  readonly registeredTriggers: readonly RegisteredTrigger[];
  /** The transformed side of this Hero (cardType 'T'), if it has one. Carries the
   * name, stats override (LP delta), and abilities to swap in when the player
   * declares transformation. Absent means the Hero cannot transform. */
  readonly transformData?: HeroTransformData;
  /** Optional PRINTED Transformation Trigger: a Hero-specific condition that,
   * when satisfied, makes transformation available in addition to the Rulebook's
   * standard gate. Kept rare — absent means only the standard gate applies. */
  readonly transformTrigger?: Condition;
}

/** The transformed ('T') side of a Hero — the data flipped in by declare_transform. */
export interface HeroTransformData {
  readonly cardDefId: number;
  readonly name: string;
  /** Change to maxLp on transform (transformed side's HP minus base HP). LP/damage
   * are preserved per the Rulebook; only the max can shift. Often 0. */
  readonly lpDelta: number;
  readonly abilities: readonly AbilityDSL[];
}

// ── Resource Card ────────────────────────────────────────────────────────────

export interface ResourceCard {
  readonly instanceId: string;
  readonly resourceType: ResourceType;
  readonly exhausted: boolean;
}

// ── Triggers (runtime registration) ──────────────────────────────────────────

export interface RegisteredTrigger {
  readonly id: string;
  readonly sourceInstanceId: string;
  readonly ownerPlayerId: 0 | 1;
  readonly trigger: Trigger;
  readonly effects: readonly Effect[];
  readonly condition?: Condition;
  readonly abilityIndex: number;
  /** Wrapper rate-limit: this triggered ability may fire at most once per turn
   * (e.g. Sapphire Arcanist Lyria, Verdant Biotech Engineer). Enforced by dispatch
   * across the whole turn, not just one event batch. Absent ≡ no per-turn limit. */
  readonly oncePerTurn?: boolean;
  /** Wrapper rate-limit: after firing, this triggered ability is unusable for N of
   * the owner's turns (Rulebook: Cooldown N). Enforced by dispatch via the trigger's
   * fire-markers in the log. Absent / 0 ≡ no cooldown. */
  readonly cooldown?: number;
}

// ── PendingChoice (engine pauses for player input) ───────────────────────────

export interface PendingChoice {
  readonly type: PendingChoiceType;
  readonly playerId: 0 | 1;
  readonly options: readonly ChoiceOption[];
  readonly minSelections: number;
  readonly maxSelections: number;
  readonly context: string;
}

export type PendingChoiceType =
  | 'mulligan'
  | 'select_targets'
  | 'reserve_exhaust'
  | 'discard_to_hand_limit'
  | 'choose_one'
  | 'choose_zone_slot'
  | 'choose_discard';

export interface ChoiceOption {
  readonly id: string;
  readonly label: string;
  readonly instanceId?: string;
}

// ── Player Response (answer to PendingChoice) ────────────────────────────────

export interface PlayerResponse {
  readonly selectedOptionIds: readonly string[];
}

// ── Stack (response chain for Counter/Flash) ─────────────────────────────────

export interface StackItem {
  readonly id: string;
  readonly type: 'spell' | 'ability' | 'attack';
  readonly sourceInstanceId: string;
  /** DIAGNOSTIC: the source's card def id, carried through to the SPELL_CAST
   * event emitted on resolution. See CardDeployedEvent.cardDefId. Optional
   * for non-spell stack items, which never emit SPELL_CAST. */
  readonly sourceCardDefId?: number;
  readonly controllerId: 0 | 1;
  readonly effects: readonly Effect[];
  readonly targets: readonly string[];
  /** Variable cost (X) paid when this item was put on the stack — threaded to its
   * effects as `context.xPaid` when the item resolves. Absent means none. */
  readonly xPaid?: number;
}

// ── PendingPriority (open reactive response window) ───────────────────────────
// Rulebook Section 14: a windowable action opens a response window in which the
// non-active player (then the active player) may add Counter/Flash links to the
// chain, resolving LIFO once both pass. Minimal-faithful slice: spell casts only.

export interface PendingPriority {
  readonly type: 'priority';
  /** Who may add a link (or pass) right now. */
  readonly toRespondPlayerId: 0 | 1;
  /** The kind of base action that opened the window. */
  readonly window: 'cast';
  /** Stack id of the base action that opened this window. */
  readonly baseStackItemId: string;
  /** Number of consecutive passes so far — two closes the window (LIFO resolve). */
  readonly passes: number;
}

// ── Game Events (emitted during state transitions) ───────────────────────────

export type GameEvent =
  | CardDeployedEvent
  | CardDestroyedEvent
  | CardBouncedEvent
  | CardExiledEvent
  | CardSacrificedEvent
  | DamageDealtEvent
  | HeroDamagedEvent
  | HeroHealedEvent
  | SpellCastEvent
  | SpellCounteredEvent
  | AbilityActivatedEvent
  | CharacterAttackedEvent
  | CardDrawnEvent
  | CardDiscardedEvent
  | ResourceGainedEvent
  | EquipmentAttachedEvent
  | TurnStartEvent
  | TurnEndEvent
  | PhaseChangedEvent
  | StatModifiedEvent
  | LethalDamageDealtEvent
  | CharacterHealedEvent
  | CharacterOverhealedEvent
  | CardMovedEvent
  | CharacterBlockedEvent
  | TriggerFiredEvent;

export interface CardDeployedEvent {
  readonly type: 'CARD_DEPLOYED';
  readonly cardInstanceId: string;
  /** DIAGNOSTIC: the definition id the instance was minted from. Lets Layer-2
   * balance tooling (balance-deck-panel.mjs) attribute this event to a card
   * without reconstructing identity from end-of-game zone state (which loses
   * instances that left every zone, e.g. exiled). Not read by any trigger. */
  readonly cardDefId: number;
  readonly zone: ZoneType;
  readonly playerId: 0 | 1;
}
export interface CardDestroyedEvent {
  readonly type: 'CARD_DESTROYED';
  readonly cardInstanceId: string;
  /** DIAGNOSTIC: see CardDeployedEvent.cardDefId. */
  readonly cardDefId: number;
  readonly cause: 'combat' | 'effect' | 'sacrifice';
  readonly playerId: 0 | 1;
}
export interface CardBouncedEvent {
  readonly type: 'CARD_BOUNCED';
  readonly cardInstanceId: string;
  /** DIAGNOSTIC: see CardDeployedEvent.cardDefId. */
  readonly cardDefId: number;
  /** Owner of the bounced card. Lets `on_leaves_battlefield` / ally variants apply
   * their side filter. Optional so existing literals stay valid. */
  readonly playerId?: 0 | 1;
}
export interface CardExiledEvent {
  readonly type: 'CARD_EXILED';
  readonly cardInstanceId: string;
  /** DIAGNOSTIC: see CardDeployedEvent.cardDefId. */
  readonly cardDefId: number;
  /** Owner of the exiled card. See CardBouncedEvent.playerId. */
  readonly playerId?: 0 | 1;
}
export interface CardSacrificedEvent {
  readonly type: 'CARD_SACRIFICED';
  readonly cardInstanceId: string;
  /** DIAGNOSTIC: see CardDeployedEvent.cardDefId. */
  readonly cardDefId: number;
}
export interface DamageDealtEvent {
  readonly type: 'DAMAGE_DEALT';
  readonly sourceId: string;
  readonly targetId: string;
  readonly amount: number;
}
export interface HeroDamagedEvent {
  readonly type: 'HERO_DAMAGED';
  readonly playerId: 0 | 1;
  readonly amount: number;
  readonly sourceId: string;
}
export interface HeroHealedEvent {
  readonly type: 'HERO_HEALED';
  readonly playerId: 0 | 1;
  readonly amount: number;
  /** DIAGNOSTIC: the heal source instance id (`hero_<defId>` for hero abilities,
   * else the card instance id). Optional so existing event literals stay valid;
   * no trigger matches on it. */
  readonly sourceId?: string;
}
export interface SpellCastEvent {
  readonly type: 'SPELL_CAST';
  readonly cardInstanceId: string;
  /** DIAGNOSTIC: see CardDeployedEvent.cardDefId. Optional here (unlike the
   * other DIAGNOSTIC cardDefId fields) because a StackItem's sourceCardDefId
   * can be absent (see stack-resolver.ts); omitted rather than faked as 0 so
   * consumers can distinguish "unknown" from a real def id of 0. */
  readonly cardDefId?: number;
  readonly playerId: 0 | 1;
}
export interface SpellCounteredEvent {
  readonly type: 'SPELL_COUNTERED';
  readonly cardInstanceId: string;
  readonly playerId: 0 | 1;
}
export interface AbilityActivatedEvent {
  readonly type: 'ABILITY_ACTIVATED';
  readonly cardInstanceId: string;
  readonly abilityIndex: number;
}
export interface CharacterAttackedEvent {
  readonly type: 'CHARACTER_ATTACKED';
  readonly attackerId: string;
  readonly targetId: string;
}
export interface CardDrawnEvent {
  readonly type: 'CARD_DRAWN';
  readonly playerId: 0 | 1;
  readonly count: number;
}
export interface CardDiscardedEvent {
  readonly type: 'CARD_DISCARDED';
  readonly cardInstanceId: string;
  /** DIAGNOSTIC: see CardDeployedEvent.cardDefId. */
  readonly cardDefId: number;
  readonly playerId: 0 | 1;
}
export interface ResourceGainedEvent {
  readonly type: 'RESOURCE_GAINED';
  readonly playerId: 0 | 1;
  readonly resourceType: ResourceType;
  readonly amount: number;
}
export interface EquipmentAttachedEvent {
  readonly type: 'EQUIPMENT_ATTACHED';
  readonly equipmentId: string;
  readonly targetId: string;
}
export interface TurnStartEvent {
  readonly type: 'TURN_START';
  readonly playerId: 0 | 1;
  readonly turnNumber: number;
}
export interface TurnEndEvent {
  readonly type: 'TURN_END';
  readonly playerId: 0 | 1;
  readonly turnNumber: number;
}
export interface PhaseChangedEvent {
  readonly type: 'PHASE_CHANGED';
  readonly phase: GamePhase;
  readonly playerId: 0 | 1;
}
export interface StatModifiedEvent {
  readonly type: 'STAT_MODIFIED';
  readonly cardInstanceId: string;
  readonly modifier: StatModifier;
  /** Owner of the modified character. Lets `on_stat_modified` honor its `side`
   * filter (allied/enemy). Optional so existing literals stay valid (absent ≡ the
   * side filter cannot be applied and is treated permissively). */
  readonly playerId?: 0 | 1;
}
export interface LethalDamageDealtEvent {
  readonly type: 'LETHAL_DAMAGE_DEALT';
  readonly attackerId: string;
  readonly targetId: string;
}
export interface CharacterHealedEvent {
  readonly type: 'CHARACTER_HEALED';
  readonly cardInstanceId: string;
  readonly amount: number;
  /** DIAGNOSTIC: the heal source instance id (see HeroHealedEvent.sourceId). */
  readonly sourceId?: string;
}
export interface CharacterOverhealedEvent {
  readonly type: 'CHARACTER_OVERHEALED';
  readonly cardInstanceId: string;
  readonly excess: number;
}
export interface CardMovedEvent {
  readonly type: 'CARD_MOVED';
  readonly cardInstanceId: string;
  readonly fromZone: ZoneType;
  readonly toZone: ZoneType;
}
/** A character blocked an attack (defended against an attacker in combat). Drives
 * the `on_block` trigger (Rulebook 16 / Sunlit Guardian). */
export interface CharacterBlockedEvent {
  readonly type: 'CHARACTER_BLOCKED';
  readonly blockerId: string;
  readonly attackerId: string;
}
/** A registered triggered ability with a wrapper oncePerTurn/cooldown fired. Logged
 * (not surfaced to watchers — no trigger matches it) so dispatch can enforce those
 * rate-limits across turns. Keyed by the trigger's registration id. */
export interface TriggerFiredEvent {
  readonly type: 'TRIGGER_FIRED';
  readonly triggerId: string;
}

// ── Turn State (per-turn tracking) ───────────────────────────────────────────

export interface TurnState {
  readonly discardedForEnergy: boolean;
  readonly firstPlayerFirstTurn: boolean;
  /** Precise gate for `resource_deck_empty_transform`: set at the active player's
   * Upkeep, BEFORE the resource draw, to whether their Resource Deck was already
   * empty (nothing to draw). Recorded ONLY under that termination mode; absent ≡
   * false. `computeCanTransform` reads this so transform unlocks on the first turn
   * that STARTS empty (not the turn the last card is drawn). */
  readonly resourceDeckEmptyAtUpkeep?: boolean;
  /** Per-player flag: did this player gain a Temporary Resource this turn? Set by
   * the `gain_resource` effect (temporary) and read by the `event_context`
   * Condition `gained_temporary_resource_this_turn` (RIA-09 Biotech Harvest).
   * Reset at the start of each turn. Indexed by playerId; absent ≡ neither. */
  readonly gainedTemporaryResource?: readonly [boolean, boolean];
  /** Transient: set true for the duration of dispatching the events of a deploy that
   * paid with a Temporary Resource, so the `event_context` Condition
   * `used_temporary_resource` (RIA-09 Symbiotic Expansion) can read it via the
   * triggering CARD_DEPLOYED event. Absent ≡ false. */
  readonly usedTemporaryResource?: boolean;
}

// ── RNG State (seeded PRNG for determinism) ──────────────────────────────────

export interface RngState {
  readonly seed: number;
  readonly counter: number;
}

// ── Effect Context (passed through effect execution) ─────────────────────────

export interface EffectContext {
  readonly sourceInstanceId: string;
  readonly controllerId: 0 | 1;
  readonly triggerDepth: number;
  readonly selectedTargets?: readonly string[];
  /** Amount of the variable cost (X) paid for the effect's source — e.g. the
   * Energy spent to play an X-cost equipment. Consumed by `x_cost` amount/stat
   * expressions. Absent means no X was paid (evaluates to 0). */
  readonly xPaid?: number;
  /** Numeric value carried by the triggering event (e.g. the damage amount of the
   * DAMAGE_DEALT event that fired an `on_take_damage` ability). Consumed by the
   * `event_value` AmountExpr (Pendant of Mercy heal-equal-to-damage). Absent ≡ 0. */
  readonly eventValue?: number;
  /** Total cost of the card whose event triggered this ability (e.g. the spell that
   * fired an `on_spell_cast` ability). Consumed by the `triggering_card_cost`
   * Condition. Absent means the triggering card is unknown. */
  readonly triggeringCardCost?: number;
  /** True when the action that produced the triggering event consumed a Temporary
   * Resource (e.g. a character deployed paying with temp Energy). Consumed by the
   * `event_context` Condition `used_temporary_resource`. Absent ≡ false. */
  readonly usedTemporaryResource?: boolean;
  /** Result of rolling this effect's `dice` AmountExpr, performed once via the seeded
   * RNG in the executeEffect pre-pass so the RNG counter persists deterministically.
   * Read by the `dice` AmountExpr. Absent ≡ unrolled (falls back to the minimum). */
  readonly rolledDice?: number;
}

// ── Effect Result (returned by all engine operations) ────────────────────────

export interface EffectResult {
  readonly newState: GameState;
  readonly events: readonly GameEvent[];
  readonly pendingChoice?: PendingChoice;
}

// ── Zone Slot Counts (constants) ─────────────────────────────────────────────

export const ZONE_SLOTS = {
  reserve: 2,
  frontline: 3,
  high_ground: 2,
} as const;

export const MAX_HAND_SIZE = 8;
export const RESOURCE_DECK_SIZE = 15;
export const INITIAL_HAND_SIZE = 5;
export const MULLIGAN_HAND_SIZE = 4;
export const MAX_TRIGGER_DEPTH = 10;
