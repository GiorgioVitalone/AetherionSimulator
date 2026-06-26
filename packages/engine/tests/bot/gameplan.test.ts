/**
 * Gameplan module — per-faction strategic weights for the heuristic pilot.
 *
 * The load-bearing guarantee is DETERMINISM: the NEUTRAL gameplan must equal the
 * heuristic's current hardcoded constants (FACE_WEIGHT=1.5, destroy mult=1,
 * modify_stats buff weight=0.6, neutral gang/close scalars=1), so a consumer that
 * defaults to NEUTRAL is a byte-identical no-op. These tests pin the neutral
 * values and the shape of every faction gameplan.
 */
import { describe, it, expect } from 'vitest';
import { gameplanFor } from '../../src/bot/gameplan.js';
import type { Faction, Gameplan } from '../../src/bot/gameplan.js';

const FACTIONS: readonly Faction[] = ['Neutral', 'Onyx', 'Radiant', 'Sapphire', 'Verdant'];

function isFiniteWeight(n: number): boolean {
  return Number.isFinite(n) && n >= 0;
}

describe('gameplanFor', () => {
  it('NEUTRAL weights equal the current hardcoded heuristic constants', () => {
    // These EXACT values reproduce today's behavior; changing them re-anchors v10.
    expect(gameplanFor('Neutral')).toEqual<Gameplan>({
      faceWeight: 1.5,
      removalWeight: 1,
      tempoWeight: 0.6,
      gangAggression: 1,
      closeBias: 1,
    });
  });

  it('returns a complete, finite, non-negative gameplan for every faction', () => {
    for (const f of FACTIONS) {
      const g = gameplanFor(f);
      expect(isFiniteWeight(g.faceWeight)).toBe(true);
      expect(isFiniteWeight(g.removalWeight)).toBe(true);
      expect(isFiniteWeight(g.tempoWeight)).toBe(true);
      expect(isFiniteWeight(g.gangAggression)).toBe(true);
      expect(isFiniteWeight(g.closeBias)).toBe(true);
    }
  });

  it('is a pure function — same input yields an equal gameplan', () => {
    for (const f of FACTIONS) {
      expect(gameplanFor(f)).toEqual(gameplanFor(f));
    }
  });

  it('gives each of the 4 factions a gameplan distinct from NEUTRAL', () => {
    const neutral = gameplanFor('Neutral');
    for (const f of ['Onyx', 'Radiant', 'Sapphire', 'Verdant'] as const) {
      expect(gameplanFor(f)).not.toEqual(neutral);
    }
  });

  it('reflects each faction archetype in its relative weights', () => {
    const neutral = gameplanFor('Neutral');
    const onyx = gameplanFor('Onyx');
    const radiant = gameplanFor('Radiant');
    const sapphire = gameplanFor('Sapphire');
    const verdant = gameplanFor('Verdant');

    // Onyx control/recursion — prizes removal over the neutral baseline.
    expect(onyx.removalWeight).toBeGreaterThan(neutral.removalWeight);
    // Sapphire control/counter — also removal-leaning, least eager to gang.
    expect(sapphire.removalWeight).toBeGreaterThan(neutral.removalWeight);
    expect(sapphire.gangAggression).toBeLessThan(neutral.gangAggression);
    // Radiant go-wide/grind — most tempo development and most willing to gang.
    expect(radiant.tempoWeight).toBeGreaterThan(neutral.tempoWeight);
    expect(radiant.gangAggression).toBeGreaterThan(neutral.gangAggression);
    // Verdant ramp — develops bigger bodies (tempo) above the baseline.
    expect(verdant.tempoWeight).toBeGreaterThan(neutral.tempoWeight);
  });
});
