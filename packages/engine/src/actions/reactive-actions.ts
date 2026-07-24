/**
 * Reactive Actions — the legal Counter/Flash casts a responder may make during an
 * open priority window (Rulebook Section 14). on_flash / on_counter are NOT
 * post-event triggers; they are castability gates consumed here (exactly as
 * `activated` is consumed by computeActivateOptions), not by the event matcher.
 */
import type { GameState, PlayerState, CardInstance } from '../types/game-state.js';
import type { ResourceCost } from '../types/common.js';
import type { AbilityDSL } from '../types/ability.js';
import { canAfford, effectiveCost } from './cost-checker.js';
import { getAllCards } from '../zones/zone-manager.js';

export interface ReactiveOption {
  readonly cardInstanceId: string;
  readonly kind: 'counter' | 'flash';
  readonly cost: ResourceCost;
  /** BOARD REACTIONS (config.boardReactions): 'board' means this option comes
   * from a battlefield character or the Hero's on_counter/on_flash ability —
   * executed ACTIVATE-style (paid + exhausted, stays on board), not the
   * discard-a-hand-spell path. Absent/'hand' ⇒ legacy hand-spell option. */
  readonly source?: 'hand' | 'board';
  /** Ability index on the board source that carries the on_counter/on_flash
   * trigger. Present only when `source === 'board'`. */
  readonly abilityIndex?: number;
}

const ZERO_COST: ResourceCost = { mana: 0, energy: 0, flexible: 0 };

/**
 * Classify a reactive hand spell by its window-gate trigger. A card is a Counter
 * if it has an on_counter ability or any counter_spell effect (e.g. Mana Leak is
 * on_flash but counters), else a Flash if it has an on_flash ability.
 */
function reactiveKind(card: CardInstance): 'counter' | 'flash' | null {
  let flash = false;
  for (const ab of card.abilities) {
    if (ab.type !== 'triggered') continue;
    if (ab.trigger.type === 'on_counter' || hasCounterEffect(ab)) return 'counter';
    if (ab.trigger.type === 'on_flash') flash = true;
  }
  return flash ? 'flash' : null;
}

function hasCounterEffect(ability: Extract<AbilityDSL, { type: 'triggered' }>): boolean {
  return ability.effects.some((e) => e.type === 'counter_spell');
}

/** FLASH-AT-WILL (config.flashAtWill): true for a hand spell that is legal as a
 * proactive Flash cast (not a Counter — Counters still require a target on the
 * stack). Read only by computeSpellOptions (available-actions.ts). */
export function isFlashSpell(card: CardInstance): boolean {
  return reactiveKind(card) === 'flash';
}

/**
 * Reactive casts legal for `responderId` against the current stack. Counters
 * require a counterable enemy item on the stack (enemy spells only, legacy;
 * under config.responseWindowsOnAllActions ANY enemy stack item is counterable,
 * so a held Counter also opens/answers the new attack/ability/equip/move
 * windows); Flash needs only an open window.
 */
export function computeReactiveActions(
  state: GameState,
  responderId: 0 | 1,
): readonly ReactiveOption[] {
  const player = state.players[responderId];
  const enemyId = responderId === 0 ? 1 : 0;
  const anyKind = state.config?.responseWindowsOnAllActions === true;
  const hasEnemySpell = state.stack.some(
    (i) => i.controllerId === enemyId && (anyKind || i.type === 'spell'),
  );
  const options: ReactiveOption[] = [];
  for (const card of player.hand) {
    if (card.cardType !== 'S') continue;
    const kind = reactiveKind(card);
    if (kind === null) continue;
    if (kind === 'counter' && !hasEnemySpell) continue;
    if (!canAfford(player, effectiveCost(player, card, state.config))) continue;
    options.push({ cardInstanceId: card.instanceId, kind, cost: card.cost });
  }
  // BOARD REACTIONS (config.boardReactions): a battlefield character or the Hero
  // may also carry an on_counter/on_flash ability (Rulebook: Counter/Flash are
  // not restricted to spells). Absent/false ⇒ byte-identical no-op — this scan
  // never runs. See game-state.ts's GameConfig.boardReactions.
  if (state.config?.boardReactions === true) {
    options.push(...computeBoardReactiveOptions(player, hasEnemySpell));
  }
  return options;
}

/** Mirrors available-actions.ts's `heroInstanceId` — kept in sync deliberately
 * (importing available-actions.ts here would create a module cycle, since it
 * imports `isFlashSpell` from this file). */
function heroInstanceId(player: PlayerState): string {
  return `hero_${String(player.hero.cardDefId)}`;
}

/** Mirrors available-actions.ts's `canActivateFrom` — same duplication
 * rationale as `heroInstanceId` above. */
function canReactFrom(card: CardInstance): boolean {
  if (card.cardType !== 'C') return true;
  return !card.summoningSick && !card.exhausted && card.reserveEnergyExhausted !== true;
}

function computeBoardReactiveOptions(
  player: PlayerState,
  hasEnemySpell: boolean,
): readonly ReactiveOption[] {
  const options: ReactiveOption[] = [];
  const sources: readonly { id: string; abilities: readonly AbilityDSL[]; card?: CardInstance }[] =
    [
      { id: heroInstanceId(player), abilities: player.hero.abilities },
      ...getAllCards(player.zones).map((c) => ({
        id: c.instanceId,
        abilities: c.abilities,
        card: c,
      })),
    ];

  for (const src of sources) {
    if (src.card !== undefined && !canReactFrom(src.card)) continue;
    for (let i = 0; i < src.abilities.length; i++) {
      const ability = src.abilities[i]!;
      if (ability.type !== 'triggered') continue;
      const trigger = ability.trigger;
      if (trigger.type !== 'on_counter' && trigger.type !== 'on_flash') continue;
      const kind: 'counter' | 'flash' = trigger.type === 'on_counter' ? 'counter' : 'flash';
      if (kind === 'counter' && !hasEnemySpell) continue;
      const cost = trigger.cost ?? ZERO_COST;
      if (!canAfford(player, cost)) continue;
      options.push({ cardInstanceId: src.id, kind, cost, source: 'board', abilityIndex: i });
    }
  }
  return options;
}
