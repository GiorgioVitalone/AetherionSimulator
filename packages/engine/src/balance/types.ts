/**
 * Public types for the first-principles card-power / deck-value valuation system.
 *
 * This is balance/design TOOLING — a pure, deterministic analysis layer over the
 * card DSL. It mirrors the engine's own valuation worldview (src/bot/spell-eval.ts)
 * so static scores stay consistent with how the bot already values effects, but it
 * is context-free (no GameState / CardInstance) and NEVER reads card cost (the card
 * score is raw power). See docs/balance-valuation.md.
 */
import type { AbilityDSL } from '../types/ability.js';
import type { CardTypeCode, ResourceCost, Trait } from '../types/common.js';

export interface CardStats {
  readonly hp: number;
  readonly atk: number;
  readonly arm: number;
}

/**
 * Context-free card view the valuation consumes. The harness adapts the raw
 * SimCard JSON into this — running `normalizeTraits` for engine traits and casting
 * each `ability.dsl` (typed JSON) to AbilityDSL at the trust boundary, exactly as
 * sim-runner.mjs does. The core never narrows `unknown` and never reads `cost`.
 */
export interface StaticCard {
  readonly id: number;
  readonly name: string;
  readonly cardType: CardTypeCode;
  readonly cost: ResourceCost;
  readonly stats: CardStats | null;
  readonly traits: readonly Trait[];
  readonly rushValue?: number;
  readonly recycleValue?: number;
  readonly regenValue?: number;
  readonly tags: readonly string[];
  readonly abilities: readonly AbilityDSL[];
  readonly alignment: readonly string[];
}

export type CardIndex = ReadonlyMap<number, StaticCard>;

/** A hero for deck valuation: its abilities are the deck's payoff engine. */
export interface HeroInput {
  readonly id: number;
  readonly name: string;
  readonly lp: number;
  readonly abilities: readonly AbilityDSL[];
  readonly transform?: HeroTransform;
  readonly alignment: readonly string[];
}
export interface HeroTransform {
  readonly lpDelta: number;
  readonly abilities: readonly AbilityDSL[];
}

/** Static analog of spell-eval's SpellScore. */
export interface EffectValue {
  readonly value: number;
  readonly isRemoval: boolean;
}

// ── Signal taxonomy ──────────────────────────────────────────────────────────
// A Signal is something a card OFFERS; a Demand is something it WANTS. Synergy
// fires when one card's Signal.kind matches another's Demand.kind through the
// interaction matrix (tag-keyed wants additionally require tag equality).
export type ProvideKind =
  | 'wall' // a Defender / high-HP+ARM blocker that gates the board
  | 'body' // any non-trivial creature body
  | 'wide_bodies' // produces MULTIPLE bodies (tokens / go-wide)
  | 'sustain' // healing / regeneration / damage reduction
  | 'removal' // kills/neutralizes enemy bodies (zero-row provider: see matrix)
  | 'reach' // direct damage to face/anything (zero-row provider)
  | 'card_flow' // draw / tutor / recursion / copy
  | 'ramp' // permanent resource acceleration
  | 'buff' // grants stats/traits to allies
  | 'spell_cast' // is a spell / casts spells (fuels spell-count payoffs)
  | 'equipment' // is equipment / attaches equipment
  | 'death_trigger' // emits an allied-death event (dies/sac to a payoff)
  | 'tag'; // carries a tribal tag (payload: the tag string)

export type WantKind =
  | 'wall_to_sustain' // a wall wants healing/reduction (Defender + self-heal)
  | 'bodies_to_buff' // an anthem wants many bodies to amplify
  | 'wide_to_sacrifice' // a sac engine wants expendable bodies
  | 'spell_density' // a payoff wants many spells cast
  | 'large_hand' // a payoff wants a big hand
  | 'equipment_count' // a payoff wants equipment played
  | 'death_of_tag' // a payoff wants allied <tag> to die (payload: tag)
  | 'tag_tribal' // a payoff wants more allies of <tag> (payload: tag)
  | 'frontline_arm' // a payoff wants frontline bodies to carry ARM
  | 'temp_resource' // a payoff wants temp-resource generation
  | 'attach_target'; // equipment wants a good body to ride

export interface Signal {
  readonly kind: ProvideKind;
  readonly weight: number;
  readonly tag?: string;
  /** Provenance within the card (`trait:x` / `ability:i`) — intra-card synergy
   * requires the provide and demand to come from DIFFERENT sources. */
  readonly source: string;
}
export interface Demand {
  readonly kind: WantKind;
  readonly weight: number;
  readonly tag?: string;
  readonly source: string;
}

/** W[provide][want] in [0,1]; sparse (most cells 0). */
export type InteractionMatrix = Readonly<Record<ProvideKind, Readonly<Record<WantKind, number>>>>;

// ── Card power ───────────────────────────────────────────────────────────────
export interface CardPowerBreakdown {
  readonly cardId: number;
  readonly name: string;
  readonly power: number; // final scalar = base * synergyMultiplier
  readonly statBase: number; // atk*Wa + hp*Wh + arm*Warm (0 for non-characters)
  readonly traitValue: number; // sum of trait stat-scaling contributions
  readonly abilityValue: number; // sum of (effect static values * recurrence)
  readonly intraSynergy: number; // raw cross-source self provides<->wants
  readonly synergyMultiplier: number; // the bounded multiplier actually applied (>=1)
  readonly provides: readonly Signal[];
  readonly demands: readonly Demand[];
}

// ── Deck value ───────────────────────────────────────────────────────────────
export interface SynergyPair {
  readonly a: string;
  readonly b: string;
  readonly value: number;
}
export interface SynergyBreakdown {
  readonly raw: number; // uncapped pairwise sum
  readonly capped: number; // after per-pair + global caps (this is what counts)
  readonly topPairs: readonly SynergyPair[];
}
export interface DeckValueBreakdown {
  readonly faction: string;
  readonly value: number; // final scalar
  readonly cardPowerSum: number; // sum over slots with copy diminishing-returns
  readonly consistency: number; // curve + color adjustment (additive, can be +/-)
  readonly interSynergy: SynergyBreakdown;
  readonly heroSynergy: number; // hero demands x deck provides + LP baseline + transform
  readonly heroLpBaseline: number; // hero LP contribution (broken out)
  readonly perCard: readonly CardPowerBreakdown[]; // distinct cards, for reporting
}
