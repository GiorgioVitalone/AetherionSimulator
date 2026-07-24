/**
 * Reach-discard policy (GameConfig.reachDiscard) — the bot pitches a card for
 * energy ONLY to fund a play that is short by exactly one resource, and only when
 * that play out-values the pitched card. Covers the pure resource math plus the
 * heuristic decision (reaches / declines an over-priced pitch / respects the flag).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { canAffordPool, reachAffordTypes } from '../../src/bot/reach-discard.js';
import { chooseAction } from '../../src/bot/heuristic.js';
import {
  mockCard,
  mockHero,
  mockGameState,
  mockPlayerState,
  resetInstanceCounter,
} from '../helpers/card-factory.js';
import type { ResourceCard, GameConfig } from '../../src/types/game-state.js';

function manaBank(n: number): ResourceCard[] {
  return Array.from({ length: n }, (_, i) => ({
    instanceId: `res_${String(i)}`,
    resourceType: 'mana' as const,
    exhausted: false,
  }));
}

const reachConfig: GameConfig = { terminationMode: 'turn_cap', reachDiscard: true };

describe('reach-discard resource math', () => {
  it('reports no reach when the cost is already affordable', () => {
    expect(reachAffordTypes({ mana: 3, energy: 0 }, { mana: 2, energy: 0, flexible: 0 })).toEqual(
      [],
    );
  });

  it('reports the short type when exactly one resource is missing', () => {
    expect(reachAffordTypes({ mana: 2, energy: 0 }, { mana: 3, energy: 0, flexible: 0 })).toEqual([
      'mana',
    ]);
    expect(reachAffordTypes({ mana: 0, energy: 1 }, { mana: 0, energy: 2, flexible: 0 })).toEqual([
      'energy',
    ]);
  });

  it('reports no reach when two or more resources are missing', () => {
    expect(reachAffordTypes({ mana: 1, energy: 0 }, { mana: 3, energy: 0, flexible: 0 })).toEqual(
      [],
    );
  });

  it('reports both types for a one-short flexible cost (either funds it)', () => {
    const types = reachAffordTypes({ mana: 1, energy: 1 }, { mana: 0, energy: 0, flexible: 3 });
    expect([...types].sort()).toEqual(['energy', 'mana']);
  });

  it('canAffordPool pays flexible from whichever specific type remains', () => {
    expect(canAffordPool({ mana: 1, energy: 1 }, { mana: 1, energy: 0, flexible: 1 })).toBe(true);
    expect(canAffordPool({ mana: 1, energy: 0 }, { mana: 1, energy: 0, flexible: 1 })).toBe(false);
  });
});

describe('heuristic — reach-discard decision', () => {
  beforeEach(() => resetInstanceCounter());

  it('discards a low-value card to fund a strong play that is one resource short', () => {
    // Bank = 2 mana. Bomb (5/5, cost 3 mana) is one short ⇒ reachable; the cheap 1/1
    // (cost 4 mana, unplayable now) is the pitch. Pitching power-2 to land power-10 is
    // a clear win, so the bot discards the 1/1 to fund the bomb next pass.
    const bomb = mockCard({
      instanceId: 'BOMB',
      currentAtk: 5,
      currentHp: 5,
      cost: { mana: 3, energy: 0, flexible: 0 },
    });
    const chaff = mockCard({
      instanceId: 'CHAFF',
      currentAtk: 1,
      currentHp: 1,
      cost: { mana: 4, energy: 0, flexible: 0 },
    });
    const p0 = mockPlayerState(0, { hand: [bomb, chaff], resourceBank: manaBank(2) });
    const state = mockGameState({
      phase: 'strategy',
      players: [p0, mockPlayerState(1)],
      config: reachConfig,
    });

    const action = chooseAction(state);
    expect(action).not.toBeNull();
    expect(action!.type).toBe('discard_for_energy');
    expect((action as { cardInstanceId: string }).cardInstanceId).toBe('CHAFF');
  });

  it('declines to reach when the only fundable pitch is worth more than the play', () => {
    // Reach target is a modest 3/3 (power 6); the only matching pitch is a 5/5 (power
    // 10). Pitching 10 to land 6 is a loss, so the bot declines and ends the phase.
    const target = mockCard({
      instanceId: 'TARGET',
      currentAtk: 3,
      currentHp: 3,
      cost: { mana: 3, energy: 0, flexible: 0 },
    });
    const gem = mockCard({
      instanceId: 'GEM',
      currentAtk: 5,
      currentHp: 5,
      cost: { mana: 4, energy: 0, flexible: 0 },
    });
    const p0 = mockPlayerState(0, { hand: [target, gem], resourceBank: manaBank(2) });
    const state = mockGameState({
      phase: 'strategy',
      players: [p0, mockPlayerState(1)],
      config: reachConfig,
    });

    expect(chooseAction(state)).toBeNull();
  });

  it('does not discard when nothing is within one resource of affordable', () => {
    // Both cards are 2+ short ⇒ no reach exists, so no discard (and nothing else to do).
    const a = mockCard({ instanceId: 'A', cost: { mana: 4, energy: 0, flexible: 0 } });
    const b = mockCard({ instanceId: 'B', cost: { mana: 5, energy: 0, flexible: 0 } });
    const p0 = mockPlayerState(0, { hand: [a, b], resourceBank: manaBank(2) });
    const state = mockGameState({
      phase: 'strategy',
      players: [p0, mockPlayerState(1)],
      config: reachConfig,
    });

    expect(chooseAction(state)).toBeNull();
  });

  it('falls back to the legacy blind discard when the flag is off', () => {
    // Same one-short setup, but reachDiscard absent ⇒ the old step-8 pitch still fires
    // (hand > 1 with nothing playable), discarding the lowest-value card.
    const bomb = mockCard({ instanceId: 'BOMB', cost: { mana: 3, energy: 0, flexible: 0 } });
    const chaff = mockCard({
      instanceId: 'CHAFF',
      currentAtk: 1,
      currentHp: 1,
      cost: { mana: 4, energy: 0, flexible: 0 },
    });
    const p0 = mockPlayerState(0, {
      hero: mockHero({ currentLp: 25 }),
      hand: [bomb, chaff],
      resourceBank: manaBank(2),
    });
    const state = mockGameState({ phase: 'strategy', players: [p0, mockPlayerState(1)] });

    const action = chooseAction(state);
    expect(action).not.toBeNull();
    expect(action!.type).toBe('discard_for_energy');
  });
});
