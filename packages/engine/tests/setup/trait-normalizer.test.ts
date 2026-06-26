import { describe, it, expect } from 'vitest';
import { normalizeTraits } from '../../src/setup/trait-normalizer.js';

describe('normalizeTraits', () => {
  it('maps single-word Title-Case labels to lowercase Trait enum values', () => {
    const { traits } = normalizeTraits([
      'Defender',
      'Flying',
      'Haste',
      'Sniper',
      'Stealth',
    ]);
    expect(traits).toEqual(['defender', 'flying', 'haste', 'sniper', 'stealth']);
  });

  it('maps "First Strike" to first_strike snake_case', () => {
    expect(normalizeTraits(['First Strike']).traits).toEqual(['first_strike']);
  });

  it('splits "Regeneration N" into a regeneration status with value N', () => {
    const { traits, statusEffects } = normalizeTraits(['Regeneration 2']);
    expect(traits).toEqual([]);
    expect(statusEffects).toEqual([
      { statusType: 'regeneration', value: 2, remainingTurns: null },
    ]);
  });

  it('defaults bare "Regeneration" to value 1', () => {
    expect(normalizeTraits(['Regeneration']).statusEffects).toEqual([
      { statusType: 'regeneration', value: 1, remainingTurns: null },
    ]);
  });

  it('keeps traits and regeneration status separate on a mixed card', () => {
    const { traits, statusEffects } = normalizeTraits([
      'Defender',
      'Regeneration 1',
    ]);
    expect(traits).toEqual(['defender']);
    expect(statusEffects).toHaveLength(1);
    expect(statusEffects[0]?.value).toBe(1);
  });

  it('returns empty for undefined and drops unknown labels', () => {
    expect(normalizeTraits(undefined)).toEqual({ traits: [], statusEffects: [] });
    expect(normalizeTraits(['Bogus']).traits).toEqual([]);
  });

  it('splits "Rush N" into a rush trait carrying value N', () => {
    const { traits, rushValue } = normalizeTraits(['Rush 2']);
    expect(traits).toEqual(['rush']);
    expect(rushValue).toBe(2);
  });

  it('defaults bare "Rush" to value 1', () => {
    const { traits, rushValue } = normalizeTraits(['Rush']);
    expect(traits).toEqual(['rush']);
    expect(rushValue).toBe(1);
  });

  it('splits "Recycle N" into a recycle trait carrying value N', () => {
    const { traits, recycleValue } = normalizeTraits(['Recycle 2']);
    expect(traits).toEqual(['recycle']);
    expect(recycleValue).toBe(2);
  });

  it('defaults bare "Recycle" to value 1', () => {
    const { traits, recycleValue } = normalizeTraits(['Recycle']);
    expect(traits).toEqual(['recycle']);
    expect(recycleValue).toBe(1);
  });

  it('omits recycleValue entirely for cards without Recycle', () => {
    expect(normalizeTraits(['Defender'])).not.toHaveProperty('recycleValue');
  });

  it('maps Elite, Swift, and Volatile labels', () => {
    expect(normalizeTraits(['Elite', 'Swift', 'Volatile']).traits).toEqual([
      'elite',
      'swift',
      'volatile',
    ]);
  });
});
