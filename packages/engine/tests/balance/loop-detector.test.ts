/**
 * Static loop detector — flags repeatable net-positive engines (infinite-combo
 * shapes) from the card DSL, with the throttle capping the risk. Anchored to real
 * pool shapes: the +1 resource cards (activated, oncePerTurn) are SAFE; an
 * unthrottled net-positive activator is a flag; Necrotic Squire's unthrottled
 * death-trigger with only a temporary self-buff is none.
 */
import { describe, expect, it } from 'vitest';
import {
  abilityThrottle,
  detectAbilityLoop,
  detectCardLoops,
  isRepeatableTrigger,
} from '../../src/balance/loop-detector.js';
import type { Effect } from '../../src/types/effects.js';
import type { Trigger } from '../../src/types/triggers.js';
import type { Condition } from '../../src/types/conditions.js';
import { aura, card, selfTarget, alliedCharacter, triggered } from './factory.js';

type ActExtra = { cooldown?: number; oncePerTurn?: boolean; oncePerGame?: boolean };
const activated = (mana = 0, extra: ActExtra = {}): Trigger => ({
  type: 'activated',
  cost: { mana, energy: 0, flexible: 0 },
  ...extra,
});
const gain = (amount: number, temporary = false): Effect => ({
  type: 'gain_resource',
  resourceType: 'mana',
  amount,
  ...(temporary ? { temporary: true } : {}),
});
const recurToHand: Effect = {
  type: 'return_from_discard',
  target: selfTarget,
  destination: 'hand',
};
const tempSelfBuff: Effect = {
  type: 'modify_stats',
  modifier: { atk: 1 },
  target: selfTarget,
  duration: { type: 'until_end_of_turn' },
};
const grantNetPositive: Effect = {
  type: 'grant_ability',
  ability: { trigger: { type: 'on_deploy' }, effects: [gain(1)] },
  target: alliedCharacter,
  duration: { type: 'permanent' },
};
const hpGate: Condition = { type: 'hp_threshold', comparison: 'less_than', value: 5 };

const level = (t: Trigger, effects: readonly Effect[], extra = {}): string =>
  detectAbilityLoop(triggered(t, effects, extra), 0).level;

describe('loop-detector — repeatability & throttle', () => {
  it('treats activated and board-death triggers as loop-shaped, on_deploy not', () => {
    expect(isRepeatableTrigger(activated())).toBe(true);
    expect(isRepeatableTrigger({ type: 'on_ally_destroyed' })).toBe(true);
    expect(isRepeatableTrigger({ type: 'on_deploy' })).toBe(false);
  });

  it('reads the tightest throttle from the activated trigger', () => {
    expect(abilityThrottle(triggered(activated(0, { oncePerGame: true }), []))).toBe('game');
    expect(abilityThrottle(triggered(activated(0, { oncePerTurn: true }), []))).toBe('turn');
    expect(abilityThrottle(triggered(activated(0, { cooldown: 2 }), []))).toBe('cooldown');
    expect(abilityThrottle(triggered(activated(0), []))).toBe('none');
  });
});

describe('loop-detector — verdict ladder', () => {
  it('flags an unthrottled cost-0 +1 permanent-resource engine', () => {
    expect(level(activated(0), [gain(1)])).toBe('flag');
  });

  it('is none when throttled once per turn (the real Energy/Mana resource cards)', () => {
    expect(level(activated(0, { oncePerTurn: true }), [gain(1)])).toBe('none');
  });

  it('downgrades a cost-0 +1 engine on a cooldown to watch', () => {
    expect(level(activated(0, { cooldown: 2 }), [gain(1)])).toBe('watch');
  });

  it('is none when the activation cost exceeds the gain (net negative)', () => {
    expect(level(activated(2), [gain(1)])).toBe('none');
  });

  it('flags unthrottled unconditional recursion (refills the activator)', () => {
    expect(level(activated(0), [recurToHand])).toBe('flag');
  });

  it('excludes temporary resources from the net (no permanent gain)', () => {
    expect(level(activated(0), [gain(3, true)])).toBe('none');
  });

  it('is none for an unthrottled death-trigger with only a temporary self-buff (Necrotic Squire)', () => {
    expect(level({ type: 'on_ally_destroyed' }, [tempSelfBuff])).toBe('none');
  });

  it('flags a grant_ability that spreads a net-positive ability, none when capped per turn', () => {
    expect(level(activated(0), [grantNetPositive])).toBe('flag');
    expect(level(activated(0, { oncePerTurn: true }), [grantNetPositive])).toBe('none');
  });

  it('clamps a conditional-gated net-positive engine to watch', () => {
    expect(level(activated(0), [gain(1)], { condition: hpGate })).toBe('watch');
  });

  it('is none for non-triggered abilities (aura)', () => {
    expect(detectAbilityLoop(aura([gain(1)]), 0).level).toBe('none');
  });
});

describe('loop-detector — card level', () => {
  it('takes the max risk over a card’s abilities and lists the firing ones', () => {
    const sc = card({
      id: 99,
      name: 'Engine',
      abilities: [aura([tempSelfBuff]), triggered(activated(0), [gain(1)])],
    });
    const risk = detectCardLoops(sc);
    expect(risk.level).toBe('flag');
    expect(risk.abilities).toHaveLength(1);
    expect(risk.abilities[0]!.abilityIndex).toBe(1);
  });
});
