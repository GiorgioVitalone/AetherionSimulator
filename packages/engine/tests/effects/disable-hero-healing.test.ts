/**
 * EC-005 — `disableHeroHealing` rule-variant semantics.
 *
 * When the toggle is ON, every `heal` whose realized target is a HERO (`hero_<id>`)
 * is nullified at resolution (the hero gains 0 LP and no HERO_HEALED event fires).
 * CHARACTER healing (any non-`hero_` target) is left fully intact. Isolates the
 * hero-longevity lever (Seraphina transform heal, Angelic Strike, etc.).
 *
 * Default OFF = engine-default healing (hero heals land), byte-identical no-op.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { executeEffect } from '../../src/effects/interpreter.js';
import { deployToZone } from '../../src/zones/zone-manager.js';
import type { Effect } from '../../src/types/effects.js';
import type { EffectContext, GameConfig } from '../../src/types/game-state.js';
import {
  mockCard,
  mockGameState,
  mockPlayerState,
  mockHero,
  resetInstanceCounter,
  emptyZones,
} from '../helpers/card-factory.js';

const ON: GameConfig = { terminationMode: 'turn_cap', disableHeroHealing: true };
const OFF: GameConfig = { terminationMode: 'turn_cap' };

function ctx(sourceId: string, controllerId: 0 | 1 = 0): EffectContext {
  return { sourceInstanceId: sourceId, controllerId, triggerDepth: 0 };
}

const healHero: Effect = {
  type: 'heal',
  amount: { type: 'fixed', value: 5 },
  target: { type: 'hero', side: 'ally' },
};
const healCharacter: Effect = {
  type: 'heal',
  amount: { type: 'fixed', value: 5 },
  target: { type: 'self' },
};

function stateWith(config: GameConfig, heroLp: number) {
  const src = mockCard({ owner: 0, currentHp: 1, baseHp: 10 });
  const p0 = deployToZone(emptyZones(), src, 'frontline');
  const state = mockGameState({
    players: [
      mockPlayerState(0, { zones: p0, hero: mockHero({ currentLp: heroLp, maxLp: 30 }) }),
      mockPlayerState(1),
    ],
    config,
  });
  return { state, src: src.instanceId };
}

describe('EC-005 disableHeroHealing — ON (toggle on)', () => {
  beforeEach(() => {
    resetInstanceCounter();
  });

  it('a HERO heal is nullified (hero gains 0 LP, no HERO_HEALED event)', () => {
    const { state, src } = stateWith(ON, 20);
    const res = executeEffect(state, healHero, ctx(src, 0));
    expect(res.newState.players[0]!.hero.currentLp).toBe(20); // unchanged
    expect(res.events.some(e => e.type === 'HERO_HEALED')).toBe(false);
  });

  it('a CHARACTER heal still LANDS while hero healing is disabled', () => {
    const { state, src } = stateWith(ON, 20);
    const res = executeEffect(state, healCharacter, ctx(src, 0));
    const c = res.newState.players[0]!.zones.frontline.find(x => x?.instanceId === src);
    expect(c!.currentHp).toBe(6); // 1 + 5 (character heal unaffected)
    expect(res.events.some(e => e.type === 'CHARACTER_HEALED')).toBe(true);
  });
});

describe('EC-005 disableHeroHealing — OFF (default, healing unchanged)', () => {
  beforeEach(() => {
    resetInstanceCounter();
  });

  it('a HERO heal lands normally when the toggle is absent', () => {
    const { state, src } = stateWith(OFF, 20);
    const res = executeEffect(state, healHero, ctx(src, 0));
    expect(res.newState.players[0]!.hero.currentLp).toBe(25); // 20 + 5
    expect(res.events.some(e => e.type === 'HERO_HEALED')).toBe(true);
  });

  it('a hero heal is still capped at maxLp (no overheal) — default behavior intact', () => {
    const { state, src } = stateWith(OFF, 28);
    const res = executeEffect(state, healHero, ctx(src, 0));
    expect(res.newState.players[0]!.hero.currentLp).toBe(30); // capped at maxLp
  });
});
