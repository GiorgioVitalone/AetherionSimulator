import { describe, it, expect } from 'vitest';
import type { Effect } from '../src/index.js';

describe('Engine types', () => {
  it('should create a valid DealDamageEffect', () => {
    const effect: Effect = {
      type: 'deal_damage',
      amount: 3,
      target: { type: 'target_character' },
    };

    expect(effect.type).toBe('deal_damage');
    expect(effect.amount).toBe(3);
  });
});
