/**
 * Aura non-stat effects — continuous registration of replacement / apply_status /
 * grant_trait / grant_ability effects embedded in an `aura` ability.
 *
 * Like aura stat modifiers, these are stripped and rebuilt on every recompute so
 * they exist exactly while their source is in play. Every aura-registered entry is
 * tagged with the `aura_` id prefix (replacements, granted triggers) or a
 * `sourceAuraId` / `while_in_play` source (statuses, traits) so it can be removed
 * cleanly without disturbing one-shot effect registrations.
 */
import type {
  GameState,
  CardInstance,
  EffectContext,
  ActiveReplacement,
  ActiveStatus,
  HeroState,
  PlayerState,
  RegisteredTrigger,
} from '../types/game-state.js';
import type { Effect } from '../types/effects.js';
import { resolveTargets } from '../effects/target-resolver.js';
import { updateCardInState } from '../effects/state-helpers.js';
import { getAllCards } from '../zones/zone-manager.js';
import { parseHeroTargetId } from '../selectors/hero-identity.js';

const AURA_PREFIX = 'aura_';

/** A non-stat aura effect we register continuously. */
export type AuraNonStatEffect = Extract<
  Effect,
  | { type: 'replacement' }
  | { type: 'apply_status' }
  | { type: 'grant_trait' }
  | { type: 'grant_ability' }
>;

export function isAuraNonStatEffect(effect: Effect): effect is AuraNonStatEffect {
  return (
    effect.type === 'replacement' ||
    effect.type === 'apply_status' ||
    effect.type === 'grant_trait' ||
    effect.type === 'grant_ability'
  );
}

// ── Strip ────────────────────────────────────────────────────────────────────

function stripCard(card: CardInstance): CardInstance {
  const replacements = (card.activeReplacements ?? []).filter((r) => !r.id.startsWith(AURA_PREFIX));
  const triggers = card.registeredTriggers.filter((t) => !t.id.startsWith(AURA_PREFIX));
  const traits = card.grantedTraits.filter((g) => !g.sourceInstanceId.startsWith(AURA_PREFIX));
  const statuses = card.statusEffects.filter((s) => s.sourceAuraId === undefined);
  return {
    ...card,
    ...(replacements.length === (card.activeReplacements ?? []).length
      ? {}
      : { activeReplacements: replacements.length === 0 ? undefined : replacements }),
    registeredTriggers: triggers,
    grantedTraits: traits,
    statusEffects: statuses,
  };
}

/** Strip aura-sourced registered triggers off a Hero (config.heroAuras: a Hero
 * aura's `grant_ability` targeting its own Hero — e.g. Lyria-T's Supreme
 * Intellect draw-on-second-spell). A Hero carries no activeReplacements/
 * grantedTraits/statusEffects (see HeroState) — only registeredTriggers needs
 * stripping. Absent aura-tagged entries ⇒ same array returned, so this is a
 * no-op when config.heroAuras is off (nothing was ever registered). */
function stripHero(hero: HeroState): HeroState {
  const triggers = hero.registeredTriggers.filter((t) => !t.id.startsWith(AURA_PREFIX));
  if (triggers.length === hero.registeredTriggers.length) return hero;
  return { ...hero, registeredTriggers: triggers };
}

/** Remove all aura-sourced non-stat registrations from every in-play card
 * (and each player's Hero — see stripHero). */
export function stripAllAuraNonStat(state: GameState): GameState {
  return {
    ...state,
    players: state.players.map((player) => ({
      ...player,
      hero: stripHero(player.hero),
      zones: {
        reserve: player.zones.reserve.map((c) => (c === null ? null : stripCard(c))),
        frontline: player.zones.frontline.map((c) => (c === null ? null : stripCard(c))),
        highGround: player.zones.highGround.map((c) => (c === null ? null : stripCard(c))),
      },
    })) as unknown as readonly [GameState['players'][0], GameState['players'][1]],
  };
}

// ── Apply ──────────────────────────────────────────────────────────────────-

/** The instanceId an untargeted aura replacement attaches to: the aura source
 * itself, or — when the source is equipment — its host character. */
function replacementHost(state: GameState, sourceInstanceId: string): string {
  for (const player of state.players) {
    for (const card of getAllCards(player.zones)) {
      if (card.equipment?.instanceId === sourceInstanceId) return card.instanceId;
    }
  }
  return sourceInstanceId;
}

function applyReplacement(
  state: GameState,
  effect: Extract<Effect, { type: 'replacement' }>,
  context: EffectContext,
  auraIndex: number,
): GameState {
  const hostId = replacementHost(state, context.sourceInstanceId);
  const registration: ActiveReplacement = {
    id: `${AURA_PREFIX}repl_${context.sourceInstanceId}_${String(auraIndex)}`,
    sourceInstanceId: context.sourceInstanceId,
    replaces: effect.replaces,
    instead: effect.instead,
    oncePerTurn: effect.oncePerTurn ?? false,
    usedThisTurn: false,
  };
  return updateCardInState(state, hostId, (card) => ({
    ...card,
    activeReplacements: [...(card.activeReplacements ?? []), registration],
  }));
}

function applyApplyStatus(
  state: GameState,
  effect: Extract<Effect, { type: 'apply_status' }>,
  context: EffectContext,
  auraIndex: number,
  evaluationState: GameState,
): GameState {
  const resolved = resolveTargets(evaluationState, effect.target, context);
  if (!resolved.resolved) return state;
  const auraId = `${AURA_PREFIX}st_${context.sourceInstanceId}_${String(auraIndex)}`;
  let current = state;
  for (const targetId of resolved.targetIds) {
    const status: ActiveStatus = {
      statusType: effect.status,
      value: effect.value ?? 1,
      remainingTurns: null,
      sourceAuraId: auraId,
    };
    current = updateCardInState(current, targetId, (c) => ({
      ...c,
      statusEffects: [...c.statusEffects, status],
    }));
  }
  return current;
}

function applyGrantTrait(
  state: GameState,
  effect: Extract<Effect, { type: 'grant_trait' }>,
  context: EffectContext,
  evaluationState: GameState,
): GameState {
  const resolved = resolveTargets(evaluationState, effect.target, context);
  if (!resolved.resolved) return state;
  let current = state;
  for (const targetId of resolved.targetIds) {
    current = updateCardInState(current, targetId, (c) => ({
      ...c,
      grantedTraits: [
        ...c.grantedTraits,
        {
          trait: effect.trait,
          sourceInstanceId: `${AURA_PREFIX}${context.sourceInstanceId}`,
          duration: { type: 'while_in_play' as const, sourceId: context.sourceInstanceId },
        },
      ],
    }));
  }
  return current;
}

/** Grant-ability variant for a Hero target (`hero_<seat>`, as produced by
 * `resolveHeroTarget`/`resolvePlayerTarget` for `target: { type: 'hero' }` /
 * `{ type: 'player' }`) — e.g. Lyria-T's Supreme Intellect granting itself the
 * draw-on-second-spell trigger. A Hero has no zone slot, so `updateCardInState`
 * can never find it; the trigger is registered directly onto
 * `player.hero.registeredTriggers` instead, addressed by the Hero's own
 * `hero_<cardDefId>` pseudo-id (same convention as buildHeroTriggers). */
function applyGrantAbilityToHero(
  state: GameState,
  targetId: string,
  effect: Extract<Effect, { type: 'grant_ability' }>,
  context: EffectContext,
  auraIndex: number,
): GameState {
  const playerId = parseHeroTargetId(targetId);
  if (playerId === null) return state;
  const player = state.players[playerId];
  const hero = player.hero;
  const registered: RegisteredTrigger = {
    id: `${AURA_PREFIX}grant_${context.sourceInstanceId}_hero_${String(hero.cardDefId)}_${String(auraIndex)}`,
    sourceInstanceId: `hero_${String(hero.cardDefId)}`,
    ownerPlayerId: playerId,
    trigger: effect.ability.trigger,
    effects: effect.ability.effects,
    ...(effect.ability.condition !== undefined ? { condition: effect.ability.condition } : {}),
    abilityIndex: -1,
    ...(effect.ability.oncePerTurn === true ? { oncePerTurn: true } : {}),
    ...(effect.ability.cooldown !== undefined && effect.ability.cooldown > 0
      ? { cooldown: effect.ability.cooldown }
      : {}),
    ...(effect.ability.react === true ? { react: true } : {}),
  };
  const newPlayers = [...state.players] as [PlayerState, PlayerState];
  newPlayers[playerId] = {
    ...player,
    hero: { ...hero, registeredTriggers: [...hero.registeredTriggers, registered] },
  };
  return { ...state, players: newPlayers };
}

function applyGrantAbility(
  state: GameState,
  effect: Extract<Effect, { type: 'grant_ability' }>,
  context: EffectContext,
  auraIndex: number,
  evaluationState: GameState,
): GameState {
  const resolved = resolveTargets(evaluationState, effect.target, context);
  if (!resolved.resolved) return state;
  let current = state;
  for (const targetId of resolved.targetIds) {
    if (parseHeroTargetId(targetId) !== null) {
      current = applyGrantAbilityToHero(current, targetId, effect, context, auraIndex);
      continue;
    }
    current = updateCardInState(current, targetId, (card) => {
      // Continuous aura grants register only the dispatch trigger (keyed by the
      // deterministic `aura_` id) — NOT appended to `card.abilities`, which would
      // grow unbounded across the strip-and-rebuild recompute. abilityIndex is -1
      // (event-driven, never an activated-ability key).
      const registered: RegisteredTrigger = {
        id: `${AURA_PREFIX}grant_${context.sourceInstanceId}_${card.instanceId}_${String(auraIndex)}`,
        sourceInstanceId: card.instanceId,
        ownerPlayerId: card.owner,
        trigger: effect.ability.trigger,
        effects: effect.ability.effects,
        ...(effect.ability.condition !== undefined ? { condition: effect.ability.condition } : {}),
        abilityIndex: -1,
        ...(effect.ability.oncePerTurn === true ? { oncePerTurn: true } : {}),
        ...(effect.ability.cooldown !== undefined && effect.ability.cooldown > 0
          ? { cooldown: effect.ability.cooldown }
          : {}),
        ...(effect.ability.react === true ? { react: true } : {}),
      };
      return {
        ...card,
        registeredTriggers: [...card.registeredTriggers, registered],
      };
    });
  }
  return current;
}

/** Register one aura non-stat effect onto its resolved target(s). Pure. */
export function applyAuraNonStatEffect(
  state: GameState,
  effect: AuraNonStatEffect,
  context: EffectContext,
  auraIndex: number,
  evaluationState: GameState = state,
): GameState {
  switch (effect.type) {
    case 'replacement':
      return applyReplacement(state, effect, context, auraIndex);
    case 'apply_status':
      return applyApplyStatus(state, effect, context, auraIndex, evaluationState);
    case 'grant_trait':
      return applyGrantTrait(state, effect, context, evaluationState);
    case 'grant_ability':
      return applyGrantAbility(state, effect, context, auraIndex, evaluationState);
  }
}
