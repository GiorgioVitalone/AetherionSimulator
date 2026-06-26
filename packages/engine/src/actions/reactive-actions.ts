/**
 * Reactive Actions — the legal Counter/Flash casts a responder may make during an
 * open priority window (Rulebook Section 14). on_flash / on_counter are NOT
 * post-event triggers; they are castability gates consumed here (exactly as
 * `activated` is consumed by computeActivateOptions), not by the event matcher.
 */
import type { GameState, CardInstance } from '../types/game-state.js';
import type { ResourceCost } from '../types/common.js';
import type { AbilityDSL } from '../types/ability.js';
import { canAfford, effectiveCost } from './cost-checker.js';

export interface ReactiveOption {
  readonly cardInstanceId: string;
  readonly kind: 'counter' | 'flash';
  readonly cost: ResourceCost;
}

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
  return ability.effects.some(e => e.type === 'counter_spell');
}

/**
 * Reactive casts legal for `responderId` against the current stack. Counters
 * require a counterable enemy spell on the stack; Flash needs only an open window.
 */
export function computeReactiveActions(
  state: GameState,
  responderId: 0 | 1,
): readonly ReactiveOption[] {
  const player = state.players[responderId];
  const enemyId = responderId === 0 ? 1 : 0;
  const hasEnemySpell = state.stack.some(
    i => i.type === 'spell' && i.controllerId === enemyId,
  );
  const options: ReactiveOption[] = [];
  for (const card of player.hand) {
    if (card.cardType !== 'S') continue;
    const kind = reactiveKind(card);
    if (kind === null) continue;
    if (kind === 'counter' && !hasEnemySpell) continue;
    if (!canAfford(player, effectiveCost(player, card))) continue;
    options.push({ cardInstanceId: card.instanceId, kind, cost: card.cost });
  }
  return options;
}
