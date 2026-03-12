/**
 * Formats GameEvent objects into human-readable log strings.
 */
import type { GameEvent } from '@aetherion-sim/engine';

export interface FormattedEvent {
  readonly text: string;
  readonly color: string;
}

export function formatGameEvent(event: GameEvent): FormattedEvent {
  switch (event.type) {
    case 'TURN_START':
      return { text: `Turn ${event.turnNumber} — Player ${event.playerId + 1}`, color: 'var(--color-accent-light)' };
    case 'TURN_END':
      return { text: `Turn ${event.turnNumber} ended`, color: 'var(--color-text-faint)' };
    case 'PHASE_CHANGED':
      return { text: `Phase: ${event.phase}`, color: 'var(--color-accent)' };
    case 'CARD_DEPLOYED':
      return { text: `Deployed to ${event.zone}`, color: 'var(--color-success)' };
    case 'CARD_DESTROYED':
      return { text: `Card destroyed (${event.cause})`, color: 'var(--color-error)' };
    case 'DAMAGE_DEALT':
      return { text: `${event.amount} damage dealt`, color: '#ff6b6b' };
    case 'HERO_DAMAGED':
      return { text: `Hero took ${event.amount} damage (P${event.playerId + 1})`, color: '#ff6b6b' };
    case 'HERO_HEALED':
      return { text: `Hero healed ${event.amount} (P${event.playerId + 1})`, color: '#95d5b2' };
    case 'CHARACTER_HEALED':
      return { text: `Character healed ${event.amount}`, color: '#95d5b2' };
    case 'SPELL_CAST':
      return { text: `Spell cast (P${event.playerId + 1})`, color: '#7ec8e3' };
    case 'ABILITY_ACTIVATED':
      return { text: `Ability activated`, color: '#d4b5f0' };
    case 'CHARACTER_ATTACKED':
      return { text: `Attack declared`, color: '#ff6b6b' };
    case 'CARD_DRAWN':
      return { text: `Drew ${event.count} card${event.count > 1 ? 's' : ''} (P${event.playerId + 1})`, color: 'var(--color-text-secondary)' };
    case 'CARD_DISCARDED':
      return { text: `Card discarded (P${event.playerId + 1})`, color: 'var(--color-text-faint)' };
    case 'RESOURCE_GAINED':
      return { text: `Gained ${event.amount} ${event.resourceType} (P${event.playerId + 1})`, color: event.resourceType === 'mana' ? '#5a9acf' : '#d5ad52' };
    case 'EQUIPMENT_ATTACHED':
      return { text: `Equipment attached`, color: 'var(--color-accent-light)' };
    case 'CARD_MOVED':
      return { text: `Moved ${event.fromZone} → ${event.toZone}`, color: 'var(--color-text-secondary)' };
    case 'CARD_BOUNCED':
      return { text: `Card bounced to hand`, color: '#7ec8e3' };
    case 'CARD_EXILED':
      return { text: `Card exiled`, color: 'var(--color-text-faint)' };
    case 'CARD_SACRIFICED':
      return { text: `Card sacrificed`, color: '#adb5bd' };
    case 'STAT_MODIFIED':
      return { text: `Stats modified`, color: 'var(--color-text-muted)' };
    case 'LETHAL_DAMAGE_DEALT':
      return { text: `Lethal damage`, color: '#e05050' };
    case 'CHARACTER_OVERHEALED':
      return { text: `Overhealed (+${event.excess} shield)`, color: '#95d5b2' };
    default:
      return { text: String((event as GameEvent).type), color: 'var(--color-text-faint)' };
  }
}
