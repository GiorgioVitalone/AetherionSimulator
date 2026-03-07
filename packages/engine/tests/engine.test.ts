import { describe, it, expect } from 'vitest';
import type { Effect, AbilityDSL } from '../src/index.js';

describe('Engine types', () => {
  it('should create a valid DealDamageEffect with AmountExpr', () => {
    const effect: Effect = {
      type: 'deal_damage',
      amount: { type: 'fixed', value: 3 },
      target: { type: 'target_character', side: 'enemy' },
    };

    expect(effect.type).toBe('deal_damage');
    if (effect.type === 'deal_damage') {
      expect(effect.amount).toEqual({ type: 'fixed', value: 3 });
    }
  });

  it('should create a valid TriggeredAbilityDSL (Deploy: Deal 2 damage)', () => {
    const ability: AbilityDSL = {
      type: 'triggered',
      trigger: { type: 'on_deploy' },
      effects: [
        {
          type: 'deal_damage',
          amount: { type: 'fixed', value: 2 },
          target: { type: 'target_character', side: 'enemy' },
        },
      ],
    };

    expect(ability.type).toBe('triggered');
    if (ability.type === 'triggered') {
      expect(ability.trigger.type).toBe('on_deploy');
      expect(ability.effects).toHaveLength(1);
    }
  });

  it('should create a valid AuraAbilityDSL with conditional stat buff', () => {
    const ability: AbilityDSL = {
      type: 'aura',
      effects: [
        {
          type: 'modify_stats',
          modifier: { atk: 1, hp: 1 },
          target: { type: 'all_characters', side: 'allied' },
          duration: { type: 'while_in_play' },
        },
      ],
      condition: {
        type: 'card_count',
        zone: 'hand',
        comparison: 'greater_equal',
        value: 5,
      },
    };

    expect(ability.type).toBe('aura');
    if (ability.type === 'aura') {
      expect(ability.condition?.type).toBe('card_count');
    }
  });

  it('should create a valid StatGrantDSL (equipment)', () => {
    const ability: AbilityDSL = {
      type: 'stat_grant',
      modifier: { atk: 2, arm: 1 },
    };

    expect(ability.type).toBe('stat_grant');
    if (ability.type === 'stat_grant') {
      expect(ability.modifier.atk).toBe(2);
      expect(ability.modifier.arm).toBe(1);
    }
  });

  it('should create a Last Breath heal-hero ability', () => {
    const ability: AbilityDSL = {
      type: 'triggered',
      trigger: { type: 'on_destroy' },
      effects: [
        {
          type: 'heal',
          amount: { type: 'fixed', value: 3 },
          target: { type: 'owner_hero' },
        },
      ],
    };

    expect(ability.type).toBe('triggered');
    if (ability.type === 'triggered') {
      expect(ability.trigger.type).toBe('on_destroy');
      expect(ability.effects[0].type).toBe('heal');
    }
  });
});
