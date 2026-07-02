/**
 * Two default-OFF knobs added for the §12 spread-cause decomposition:
 *   - rampPilot (bot policy): early-game deploy bonus for `ramp` signals — the
 *     in-game analogue of computeDeckValue's `acceleration` term, closing the
 *     cost-free per-card score's structural blindness to the ramp archetype.
 *   - disableDiscardForEnergy (rule-ablation probe): removes the discard_for_energy
 *     action so its balance contribution is measurable (the grant matches the
 *     pitched card's resource type — a universal tempo valve, per Rulebook 11).
 * Both follow the established contract: absent/false ⇒ byte-identical no-op.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { computeAvailableActions } from '../../src/actions/available-actions.js';
import { rampDeployBonus } from '../../src/bot/value-pilot.js';
import { ACCEL_RAMP_TEMPO } from '../../src/balance/index.js';
import type { AbilityDSL } from '../../src/types/ability.js';
import type { GameConfig } from '../../src/types/game-state.js';
import {
  mockCard,
  mockGameState,
  mockPlayerState,
  resetInstanceCounter,
} from '../helpers/card-factory.js';

// Real shape from the pool (Ancient Treant): +2 Energy on deploy → ramp weight 2.
const RAMP_DSL: AbilityDSL = {
  type: 'triggered',
  effects: [{ type: 'gain_resource', amount: 2, resourceType: 'energy' }],
  trigger: { type: 'on_deploy' },
} as AbilityDSL;

describe('rampPilot deploy bonus (bot policy)', () => {
  beforeEach(() => resetInstanceCounter());

  it('should value a ramp card by weight × tempo × early-game phase', () => {
    const card = mockCard({ cardDefId: 90001, abilities: [RAMP_DSL] });
    // turn 1: phase (16-1)/16; ramp weight 2
    expect(rampDeployBonus(card, 1)).toBeCloseTo(2 * ACCEL_RAMP_TEMPO * (15 / 16), 10);
  });

  it('should fade to zero at the resource-deck horizon', () => {
    const card = mockCard({ cardDefId: 90002, abilities: [RAMP_DSL] });
    expect(rampDeployBonus(card, 16)).toBe(0);
    expect(rampDeployBonus(card, 30)).toBe(0);
  });

  it('should give zero bonus to a card with no ramp signal', () => {
    const vanilla = mockCard({ cardDefId: 90003 });
    expect(rampDeployBonus(vanilla, 1)).toBe(0);
  });
});

describe('disableDiscardForEnergy knob (rule-ablation probe)', () => {
  beforeEach(() => resetInstanceCounter());

  function stateWith(config: GameConfig | undefined) {
    const p0 = mockPlayerState(0, { hand: [mockCard({ owner: 0 })] });
    return mockGameState({
      players: [p0, mockPlayerState(1)],
      phase: 'strategy',
      ...(config ? { config } : {}),
    });
  }

  it('should offer discard_for_energy by default (hand card, strategy phase)', () => {
    expect(computeAvailableActions(stateWith(undefined)).canDiscardForEnergy).toBe(true);
  });

  it('should not offer it when the probe is on', () => {
    expect(
      computeAvailableActions(stateWith({ disableDiscardForEnergy: true })).canDiscardForEnergy,
    ).toBe(false);
  });

  it('should be a no-op when explicitly false', () => {
    expect(
      computeAvailableActions(stateWith({ disableDiscardForEnergy: false })).canDiscardForEnergy,
    ).toBe(true);
  });
});
