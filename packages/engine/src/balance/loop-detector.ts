/**
 * Static combo/loop detector — flags cards that could enable degenerate
 * "net-positive cycles" by inspecting the effect DSL, WITHOUT simulation.
 *
 * This is a HEURISTIC risk-flag with bounded false positives, NOT a proof:
 * arbitrary loop detection is undecidable, so it conservatively prefers 'watch'
 * over 'flag' when uncertain and explains why each flag fires. The throttle on an
 * ability CAPS its risk (unthrottled ⇒ can flag; cooldown ⇒ at most watch; once
 * per turn/game ⇒ none — the canonical bounded engine, e.g. the +1 resource cards).
 * Mirrors the engine's throttle taxonomy (weights.ts) and effect categorization
 * (signal-extract.ts), reusing flattenEffects so buried effects are still seen.
 */
import type { AbilityDSL, TriggeredAbilityDSL } from '../types/ability.js';
import type { Effect } from '../types/effects.js';
import type { Trigger } from '../types/triggers.js';
import type { AmountExpr } from '../types/common.js';
import type { StaticCard } from './types.js';
import { flattenEffects } from './signal-extract.js';

export type LoopLevel = 'none' | 'watch' | 'flag';

export interface LoopRisk {
  readonly level: LoopLevel;
  readonly reasons: readonly string[];
}
export interface AbilityLoopRisk extends LoopRisk {
  readonly abilityIndex: number;
}
export interface CardLoopRisk {
  readonly cardId: number;
  readonly name: string;
  readonly level: LoopLevel;
  readonly abilities: readonly AbilityLoopRisk[];
}

const RANK: Record<LoopLevel, number> = { none: 0, watch: 1, flag: 2 };
const minLevel = (a: LoopLevel, b: LoopLevel): LoopLevel => (RANK[a] <= RANK[b] ? a : b);
const maxLevel = (a: LoopLevel, b: LoopLevel): LoopLevel => (RANK[a] >= RANK[b] ? a : b);

// ── Trigger repeatability + throttle (mirrors weights.ts) ─────────────────────

/** Board-event triggers that can fire many times within a single turn.
 * §H3-1 (batch-C): the SELF death-variants (on_destroy/on_dies/
 * on_leaves_battlefield) were missing here even though their ally-scoped
 * counterparts were present — a card whose own death trigger resurrects/
 * recurs ITSELF (self-death-trigger recursion) scored 'none' at any cost,
 * since isRepeatableTrigger gated on this set. §H3-3: on_take_damage/
 * on_deal_damage/on_attack are self COMBAT triggers that can also recur
 * multiple times within one turn (multi-attack, blocked/blocking chains) —
 * a free self-acquisition gated behind one of these was equally invisible. */
const REPEATABLE_EVENTS: ReadonlySet<Trigger['type']> = new Set([
  'on_destroy',
  'on_dies',
  'on_leaves_battlefield',
  'on_ally_destroyed',
  'on_ally_dies',
  'on_ally_leaves_battlefield',
  'on_sacrifice',
  'on_spell_cast',
  'on_gain_resource',
  'on_take_damage',
  'on_deal_damage',
  'on_attack',
]);

/** Is this trigger TYPE loop-shaped (can fire repeatedly in principle)? Throttle
 * bounding is handled separately by abilityThrottle + the level cap. */
export function isRepeatableTrigger(t: Trigger): boolean {
  return t.type === 'activated' || REPEATABLE_EVENTS.has(t.type);
}

export type Throttle = 'none' | 'turn' | 'cooldown' | 'game';

/** The tightest throttle on an ability — the activated trigger's own caps plus the
 * TriggeredAbilityDSL-level oncePerTurn/cooldown. */
export function abilityThrottle(ab: TriggeredAbilityDSL): Throttle {
  const act = ab.trigger.type === 'activated' ? ab.trigger : undefined;
  if (act?.oncePerGame === true) return 'game';
  if (ab.oncePerTurn === true || act?.oncePerTurn === true) return 'turn';
  const cd = act?.cooldown ?? ab.cooldown;
  if (cd != null && cd > 0) return 'cooldown';
  return 'none';
}

// A throttle CAPS the achievable risk level (bounded cadence ⇒ no within-turn loop).
const THROTTLE_CAP: Record<Throttle, LoopLevel> = {
  none: 'flag',
  cooldown: 'watch',
  turn: 'none',
  game: 'none',
};

/** Mana/energy/flexible cost to FIRE an activated trigger (0 for any other
 * trigger type) — exported so loop-graph.ts's traversal-cost accounting can
 * charge it once per cycle iteration (§H3-4), alongside the acquired card's
 * own cast cost. */
export function activationCostTotal(t: Trigger): number {
  return t.type === 'activated' ? t.cost.mana + t.cost.energy + t.cost.flexible : 0;
}

// ── Effect categorization (over a pre-flattened effect list) ──────────────────

const RECURSION_TYPES: ReadonlySet<Effect['type']> = new Set([
  'return_from_discard',
  'deploy_from_deck',
  'copy_card',
  'shuffle_into_deck',
]);

const isScaling = (a: AmountExpr): boolean => a.type === 'count' || a.type === 'x_cost';

/** Permanent resources the effects net out (temporary grants excluded). */
function permanentResource(flat: readonly Effect[]): number {
  let sum = 0;
  for (const e of flat) if (e.type === 'gain_resource' && e.temporary !== true) sum += e.amount;
  return sum;
}

function hasRecursion(flat: readonly Effect[]): boolean {
  return flat.some((e) => RECURSION_TYPES.has(e.type));
}

function hasDraw(flat: readonly Effect[]): boolean {
  return flat.some(
    (e) =>
      (e.type === 'draw_cards' && e.player !== 'enemy') ||
      e.type === 'scry' ||
      e.type === 'search_deck',
  );
}

function hasScalingAmount(flat: readonly Effect[]): boolean {
  return flat.some(
    (e) =>
      ((e.type === 'deal_damage' || e.type === 'heal') && isScaling(e.amount)) ||
      (e.type === 'draw_cards' && isScaling(e.count)),
  );
}

/** A grant_ability that spreads a net-positive ability (resource/recursion/draw)
 * across targets — a multiplicative engine. */
function spreadsNetPositive(flat: readonly Effect[]): boolean {
  for (const e of flat) {
    if (e.type !== 'grant_ability') continue;
    const inner = flattenEffects(e.ability.effects);
    if (permanentResource(inner) > 0 || hasRecursion(inner) || hasDraw(inner)) return true;
  }
  return false;
}

// ── Verdict ───────────────────────────────────────────────────────────────────

function baseRisk(ab: TriggeredAbilityDSL): LoopRisk {
  const flat = flattenEffects(ab.effects);
  const net = permanentResource(flat) - activationCostTotal(ab.trigger);
  if (net > 0)
    return {
      level: 'flag',
      reasons: [`repeatable engine: +${String(net)} net permanent resource over its cost`],
    };
  if (hasRecursion(flat))
    return {
      level: 'flag',
      reasons: ['repeatable + unconditional recursion refills the activator'],
    };
  if (spreadsNetPositive(flat))
    return { level: 'flag', reasons: ['grant_ability spreads a net-positive ability'] };
  if (hasDraw(flat)) return { level: 'watch', reasons: ['repeatable card-draw engine'] };
  if (hasScalingAmount(flat))
    return {
      level: 'watch',
      reasons: ['scaling amount (count/x_cost) under a repeatable trigger'],
    };
  return { level: 'none', reasons: [] };
}

/** Loop risk for one ability of a card. aura/stat_grant and non-loop-shaped
 * triggers are 'none'; otherwise the throttle caps the base risk. */
export function detectAbilityLoop(ab: AbilityDSL, abilityIndex: number): AbilityLoopRisk {
  if (ab.type !== 'triggered' || !isRepeatableTrigger(ab.trigger)) {
    return { abilityIndex, level: 'none', reasons: [] };
  }
  const base = baseRisk(ab);
  if (base.level === 'none') return { abilityIndex, level: 'none', reasons: [] };

  const throttle = abilityThrottle(ab);
  const reasons = [...base.reasons];
  let level = minLevel(base.level, THROTTLE_CAP[throttle]);
  if (throttle !== 'none' && level !== base.level)
    reasons.push(`throttled (${throttle}) — bounded`);
  if (ab.condition !== undefined && level === 'flag') {
    level = 'watch';
    reasons.push('conditional gate');
  }
  return { abilityIndex, level, reasons };
}

/** Loop risk for a whole card — the max over its abilities, with the firing ones. */
export function detectCardLoops(card: StaticCard): CardLoopRisk {
  const abilities = card.abilities.map((ab, i) => detectAbilityLoop(ab, i));
  const level = abilities.reduce<LoopLevel>((acc, a) => maxLevel(acc, a.level), 'none');
  return {
    cardId: card.id,
    name: card.name,
    level,
    abilities: abilities.filter((a) => a.level !== 'none'),
  };
}
