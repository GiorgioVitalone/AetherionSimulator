/**
 * Trigger Registry — register/unregister card triggers in game state.
 * When a card enters play, its triggered abilities are registered.
 * When it leaves play, they are unregistered.
 */
import type { CardInstance, GameState, HeroState, RegisteredTrigger } from '../types/game-state.js';
import type { AbilityDSL, TriggeredAbilityDSL } from '../types/ability.js';

export function resetRegistrationCounter(): void {
  // Compatibility no-op: trigger IDs are derived from semantic identity.
}

/**
 * Build RegisteredTrigger entries for a Hero's printed triggered abilities.
 * Shared by Hero transformation (state-machine/actions.ts) and, when
 * `config.registerPrintedTriggers` is on, base-Hero ability hydration — both
 * draw from this single counter so `hero_trigger_N` ids stay unique across
 * BOTH players' Heroes for a dispatch pass's `firedTriggerIds` dedup
 * (see runtime/dispatch.ts). ownerPlayerId defaults to 0; callers that know
 * the real seat override it on the returned entries.
 */
export function buildHeroTriggers(
  hero: HeroState,
  abilities: readonly AbilityDSL[],
  ownerPlayerId: 0 | 1 = 0,
): readonly RegisteredTrigger[] {
  const triggers: RegisteredTrigger[] = [];
  for (let i = 0; i < abilities.length; i++) {
    const ability = abilities[i]!;
    if (ability.type !== 'triggered') continue;
    triggers.push({
      id: `hero-trigger:${String(ownerPlayerId)}:${String(hero.cardDefId)}:${String(i)}`,
      sourceInstanceId: `hero_${String(hero.cardDefId)}`,
      ownerPlayerId,
      trigger: ability.trigger,
      effects: ability.effects,
      condition: ability.condition,
      abilityIndex: i,
      ...triggerRateLimits(ability),
    });
  }
  return triggers;
}

/**
 * Register a Hero's printed triggered abilities (idempotent on abilityIndex,
 * same contract as registerCardTriggers). Used when
 * `config.registerPrintedTriggers` is on to fix the base Hero's printed
 * abilities never being registered at game setup.
 */
export function registerHeroTriggers(hero: HeroState, ownerPlayerId: 0 | 1): HeroState {
  const alreadyRegistered = new Set(hero.registeredTriggers.map((t) => t.abilityIndex));
  const newTriggers = buildHeroTriggers(hero, hero.abilities, ownerPlayerId)
    .filter((t) => !alreadyRegistered.has(t.abilityIndex))
    .map((t) => ({ ...t, ownerPlayerId }));
  return { ...hero, registeredTriggers: [...hero.registeredTriggers, ...newTriggers] };
}

function extractTriggeredAbilities(
  card: CardInstance,
): readonly { ability: TriggeredAbilityDSL; index: number }[] {
  const result: { ability: TriggeredAbilityDSL; index: number }[] = [];
  for (let i = 0; i < card.abilities.length; i++) {
    const ability = card.abilities[i];
    if (ability !== undefined && ability.type === 'triggered') {
      result.push({ ability, index: i });
    }
  }
  return result;
}

function createRegisteredTrigger(
  card: CardInstance,
  ability: TriggeredAbilityDSL,
  abilityIndex: number,
): RegisteredTrigger {
  return {
    id: `trigger:${card.instanceId}:${String(abilityIndex)}`,
    sourceInstanceId: card.instanceId,
    ownerPlayerId: card.owner,
    trigger: ability.trigger,
    effects: ability.effects,
    condition: ability.condition,
    abilityIndex,
    ...triggerRateLimits(ability),
  };
}

/** Extract the wrapper oncePerTurn / cooldown / react rate-limits onto a
 * RegisteredTrigger. Both the DSL wrapper (TriggeredAbilityDSL) and an Activated
 * trigger may carry oncePerTurn/cooldown; the DSL-level value wins when present.
 * [React] is DSL-only (no [React] Activated abilities). Only set keys that are
 * truthy so plain triggers stay shape-identical (preserves determinism /
 * serialized state). */
export function triggerRateLimits(ability: TriggeredAbilityDSL): {
  oncePerTurn?: true;
  cooldown?: number;
  react?: true;
} {
  const trigger = ability.trigger;
  const oncePerTurn =
    ability.oncePerTurn === true || (trigger.type === 'activated' && trigger.oncePerTurn === true);
  const cooldown =
    ability.cooldown ?? (trigger.type === 'activated' ? trigger.cooldown : undefined);
  return {
    ...(oncePerTurn ? { oncePerTurn: true } : {}),
    ...(cooldown !== undefined && cooldown > 0 ? { cooldown } : {}),
    ...(ability.react === true ? { react: true } : {}),
  };
}

/**
 * Compute the registeredTriggers a card's printed triggered abilities should
 * carry (idempotent on abilityIndex, same contract as registerCardTriggers).
 * Shared by registerCardTriggers (cards in a zone slot) and equipment attach
 * (config.equipmentTriggers — an equipment card isn't in a zone slot of its
 * own, so updateCardTriggers can't look it up by instanceId; the caller
 * applies this directly to the CardInstance it already holds).
 */
export function computeCardTriggers(card: CardInstance): readonly RegisteredTrigger[] {
  // Idempotent: skip abilities already registered (e.g. a granted ability that
  // self-registered). Re-running registration must never double-register a
  // trigger, otherwise a granted "on destroy" effect would fire twice.
  const alreadyRegistered = new Set(card.registeredTriggers.map((t) => t.abilityIndex));
  const newTriggers = extractTriggeredAbilities(card)
    .filter(({ index }) => !alreadyRegistered.has(index))
    .map(({ ability, index }) => createRegisteredTrigger(card, ability, index));
  return [...card.registeredTriggers, ...newTriggers];
}

/**
 * Register all triggered abilities from a card entering play.
 * Adds RegisteredTrigger entries to the card's registeredTriggers array.
 */
export function registerCardTriggers(state: GameState, cardInstanceId: string): GameState {
  return updateCardTriggers(state, cardInstanceId, (card) => ({
    ...card,
    registeredTriggers: computeCardTriggers(card),
  }));
}

/**
 * Unregister all triggers owned by a card (when it leaves play).
 */
export function unregisterCardTriggers(state: GameState, cardInstanceId: string): GameState {
  return updateCardTriggers(state, cardInstanceId, (card) => ({
    ...card,
    registeredTriggers: [],
  }));
}

/**
 * Collect all registered triggers from all cards on the battlefield.
 */
export function getAllRegisteredTriggers(state: GameState): readonly RegisteredTrigger[] {
  const triggers: RegisteredTrigger[] = [];
  // BUG FIX (config.equipmentTriggers): an attached equipment lives at
  // `card.equipment` on its holder, not in a zone slot of its own, so its own
  // registeredTriggers are otherwise never in the pool. See GameConfig
  // .equipmentTriggers. Absent/false ⇒ no-op (equipment.registeredTriggers is
  // never read below).
  const equipmentTriggers = state.config?.equipmentTriggers === true;
  for (const player of state.players) {
    // Hero triggers
    triggers.push(...player.hero.registeredTriggers);
    // Zone card triggers
    for (const zone of [player.zones.reserve, player.zones.frontline, player.zones.highGround]) {
      for (const slot of zone) {
        // A character exhausted for Reserve Energy Generation has ALL abilities,
        // including triggered ones, disabled until next Upkeep (Rulebook 8 step 4).
        // Its attached equipment's triggers are suppressed the same way.
        if (slot !== null && slot.reserveEnergyExhausted !== true) {
          triggers.push(...slot.registeredTriggers);
          if (equipmentTriggers && slot.equipment !== null) {
            triggers.push(...slot.equipment.registeredTriggers);
          }
        }
      }
    }
  }
  return triggers;
}

// ── Internal helper ──────────────────────────────────────────────────────────

function updateCardTriggers(
  state: GameState,
  instanceId: string,
  updater: (card: CardInstance) => CardInstance,
): GameState {
  return {
    ...state,
    players: state.players.map((player) => ({
      ...player,
      zones: {
        reserve: player.zones.reserve.map((c) => (c?.instanceId === instanceId ? updater(c) : c)),
        frontline: player.zones.frontline.map((c) =>
          c?.instanceId === instanceId ? updater(c) : c,
        ),
        highGround: player.zones.highGround.map((c) =>
          c?.instanceId === instanceId ? updater(c) : c,
        ),
      },
    })) as unknown as readonly [(typeof state.players)[0], (typeof state.players)[1]],
  };
}
