/**
 * Trigger Matcher — maps DSL Trigger types to runtime GameEvent types.
 * Determines whether a registered trigger should fire for a given event.
 */
import type { GameEvent, RegisteredTrigger } from '../types/game-state.js';
import type { Trigger, TriggerFilter } from '../types/triggers.js';
import type { CardTypeCode, Trait } from '../types/common.js';
import { hasEffectiveTag, hasEffectiveTrait } from '../selectors/card-semantics.js';

interface CardInfo {
  readonly instanceId: string;
  readonly cardType: CardTypeCode;
  readonly traits: readonly Trait[];
  readonly tags: readonly string[];
}

function matchesFilter(
  filter: TriggerFilter | undefined,
  card: CardInfo | null,
): boolean {
  if (filter === undefined) return true;
  if (card === null) return false;
  if (filter.cardType !== undefined && card.cardType !== filter.cardType) return false;
  if (filter.trait !== undefined && !hasEffectiveTrait(card, filter.trait)) return false;
  if (filter.tag !== undefined && !hasEffectiveTag(card, filter.tag)) return false;
  return true;
}

/**
 * Check if a DSL Trigger matches a runtime GameEvent.
 * Returns true if the trigger should fire for this event.
 */
export function triggerMatchesEvent(
  trigger: Trigger,
  event: GameEvent,
  sourceInstanceId: string,
  ownerPlayerId: 0 | 1,
  getCardInfo?: (instanceId: string) => CardInfo | null,
): boolean {
  switch (trigger.type) {
    case 'on_deploy':
      return event.type === 'CARD_DEPLOYED' && event.cardInstanceId === sourceInstanceId;

    case 'on_destroy':
      return event.type === 'CARD_DESTROYED' && event.cardInstanceId === sourceInstanceId;

    case 'on_dies':
      // Combat-only kill (Rulebook 16 tier 1): CARD_DESTROYED with cause 'combat'.
      return (
        event.type === 'CARD_DESTROYED' &&
        event.cardInstanceId === sourceInstanceId &&
        event.cause === 'combat'
      );

    case 'on_leaves_battlefield':
      // Broadest (tier 3): destroyed, exiled, or bounced. A combat/effect kill emits
      // CARD_DESTROYED (and possibly CARD_EXILED) — matching the former suffices.
      return (
        (event.type === 'CARD_DESTROYED' ||
          event.type === 'CARD_EXILED' ||
          event.type === 'CARD_BOUNCED') &&
        event.cardInstanceId === sourceInstanceId
      );

    case 'on_turn_start':
      return event.type === 'TURN_START' && event.playerId === ownerPlayerId;

    case 'on_turn_end':
      return event.type === 'TURN_END' && event.playerId === ownerPlayerId;

    case 'on_attack':
      return event.type === 'CHARACTER_ATTACKED' && event.attackerId === sourceInstanceId;

    case 'on_take_damage':
      return event.type === 'DAMAGE_DEALT' && event.targetId === sourceInstanceId;

    case 'on_deal_lethal_damage':
      return event.type === 'LETHAL_DAMAGE_DEALT' && event.attackerId === sourceInstanceId;

    case 'on_ally_deployed':
      if (event.type !== 'CARD_DEPLOYED') return false;
      if (event.playerId !== ownerPlayerId) return false;
      if (event.cardInstanceId === sourceInstanceId) return false;
      return matchesFilter(
        trigger.filter,
        getCardInfo?.(event.cardInstanceId) ?? null,
      );

    case 'on_ally_destroyed':
      if (event.type !== 'CARD_DESTROYED') return false;
      if (event.cardInstanceId === sourceInstanceId) return false;
      if (event.playerId !== ownerPlayerId) return false;
      return matchesFilter(
        trigger.filter,
        getCardInfo?.(event.cardInstanceId) ?? null,
      );

    case 'on_ally_dies':
      // Tier 1 ally scope: a friendly character killed by combat damage.
      if (event.type !== 'CARD_DESTROYED' || event.cause !== 'combat') return false;
      if (event.cardInstanceId === sourceInstanceId) return false;
      if (event.playerId !== ownerPlayerId) return false;
      return matchesFilter(trigger.filter, getCardInfo?.(event.cardInstanceId) ?? null);

    case 'on_ally_leaves_battlefield': {
      // Tier 3 ally scope: a friendly character destroyed, exiled, or bounced.
      if (
        event.type !== 'CARD_DESTROYED' &&
        event.type !== 'CARD_EXILED' &&
        event.type !== 'CARD_BOUNCED'
      ) {
        return false;
      }
      if (event.cardInstanceId === sourceInstanceId) return false;
      if (event.playerId !== ownerPlayerId) return false;
      return matchesFilter(trigger.filter, getCardInfo?.(event.cardInstanceId) ?? null);
    }

    case 'on_spell_cast': {
      if (event.type !== 'SPELL_CAST') return false;
      const sideFilter = trigger.side;
      if (sideFilter === 'allied' && event.playerId !== ownerPlayerId) return false;
      if (sideFilter === 'enemy' && event.playerId === ownerPlayerId) return false;
      return matchesFilter(
        trigger.filter,
        getCardInfo?.(event.cardInstanceId) ?? null,
      );
    }

    case 'on_sacrifice':
      return event.type === 'CARD_SACRIFICED' && event.cardInstanceId === sourceInstanceId;

    case 'on_healed':
      return event.type === 'CHARACTER_HEALED' && event.cardInstanceId === sourceInstanceId;

    case 'on_equipment_attached':
      return event.type === 'EQUIPMENT_ATTACHED' && event.targetId === sourceInstanceId;

    case 'on_overheal':
      return event.type === 'CHARACTER_OVERHEALED' && event.cardInstanceId === sourceInstanceId;

    case 'on_deal_damage':
      return event.type === 'DAMAGE_DEALT' && event.sourceId === sourceInstanceId;

    case 'on_block':
      return event.type === 'CHARACTER_BLOCKED' && event.blockerId === sourceInstanceId;

    case 'on_gain_resource':
      if (event.type !== 'RESOURCE_GAINED') return false;
      if (event.playerId !== ownerPlayerId) return false;
      if (trigger.resourceType !== undefined && event.resourceType !== trigger.resourceType) return false;
      return true;

    case 'on_stat_modified': {
      if (event.type !== 'STAT_MODIFIED') return false;
      // Honor the side filter when the event carries the modified card's owner.
      // (Biotech Engineer side=allied draws only on FRIENDLY buffs.) When the owner
      // is absent the filter cannot be applied and we accept permissively.
      const side = trigger.side;
      if (side === undefined || event.playerId === undefined) return true;
      if (side === 'allied') return event.playerId === ownerPlayerId;
      if (side === 'enemy') return event.playerId !== ownerPlayerId;
      return true;
    }

    // These are not event-reactive — they're checked differently
    case 'while':
    case 'activated':
    case 'on_cast':
    case 'on_counter':
    case 'on_flash':
      return false;
  }
}

/**
 * Find all registered triggers that match an event, in APNAP order.
 * Active Player's triggers first, then Non-Active Player's.
 */
export function findMatchingTriggers(
  triggers: readonly RegisteredTrigger[],
  event: GameEvent,
  activePlayerId: 0 | 1,
  getCardInfo?: (instanceId: string) => CardInfo | null,
): readonly RegisteredTrigger[] {
  const matching = triggers.filter(rt =>
    triggerMatchesEvent(
      rt.trigger,
      event,
      rt.sourceInstanceId,
      rt.ownerPlayerId,
      getCardInfo,
    ),
  );

  // APNAP ordering: active player first
  const apTriggers = matching.filter(t => t.ownerPlayerId === activePlayerId);
  const napTriggers = matching.filter(t => t.ownerPlayerId !== activePlayerId);

  return [...apTriggers, ...napTriggers];
}
