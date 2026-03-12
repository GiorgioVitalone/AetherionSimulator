import { describe, it, expect, beforeEach } from 'vitest';
import { checkReplacementEffect } from '../../src/effects/replacement-handler.js';
import { mockCard, resetInstanceCounter } from '../helpers/card-factory.js';

beforeEach(() => {
  resetInstanceCounter();
});

describe('checkReplacementEffect', () => {
  it('should find on_would_be_destroyed replacement effect', () => {
    const card = mockCard({
      abilities: [{
        type: 'triggered',
        trigger: { type: 'on_deploy' },
        effects: [{
          type: 'replacement',
          replaces: { type: 'on_would_be_destroyed' },
          instead: [{ type: 'draw_cards', count: { type: 'fixed', value: 1 }, player: 'allied' }],
        }],
      }],
    });

    const result = checkReplacementEffect(card, 'on_would_be_destroyed');
    expect(result).not.toBeNull();
    expect(result!.replaces.type).toBe('on_would_be_destroyed');
  });

  it('should return null when no replacement effect exists', () => {
    const card = mockCard({
      abilities: [{
        type: 'triggered',
        trigger: { type: 'on_deploy' },
        effects: [{ type: 'draw_cards', count: { type: 'fixed', value: 1 }, player: 'allied' }],
      }],
    });

    const result = checkReplacementEffect(card, 'on_would_be_destroyed');
    expect(result).toBeNull();
  });

  it('should not match a different replacement event type', () => {
    const card = mockCard({
      abilities: [{
        type: 'triggered',
        trigger: { type: 'on_deploy' },
        effects: [{
          type: 'replacement',
          replaces: { type: 'on_would_take_damage' },
          instead: [],
        }],
      }],
    });

    const result = checkReplacementEffect(card, 'on_would_be_destroyed');
    expect(result).toBeNull();
  });
});
