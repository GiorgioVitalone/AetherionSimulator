/** Tiny builders for valuation tests (not a *.test.ts file — not collected). */
import type { AbilityDSL } from '../../src/types/ability.js';
import type { Effect } from '../../src/types/effects.js';
import type { Trigger } from '../../src/types/triggers.js';
import type { StaticCard } from '../../src/balance/types.js';

export function card(o: Partial<StaticCard> & { id: number; name: string }): StaticCard {
  return {
    cardType: 'C',
    cost: { mana: 1, energy: 0, flexible: 0 },
    stats: null,
    traits: [],
    tags: [],
    abilities: [],
    alignment: [],
    ...o,
  };
}

export function body(
  id: number,
  name: string,
  atk: number,
  hp: number,
  arm = 0,
  extra: Partial<StaticCard> = {},
): StaticCard {
  return card({ id, name, cardType: 'C', stats: { atk, hp, arm }, ...extra });
}

export function triggered(
  trigger: Trigger,
  effects: readonly Effect[],
  extra: Partial<AbilityDSL> = {},
): AbilityDSL {
  return { type: 'triggered', trigger, effects, ...extra } as AbilityDSL;
}

export function aura(effects: readonly Effect[]): AbilityDSL {
  return { type: 'aura', effects };
}

export const enemyCharacter = { type: 'target_character', side: 'enemy' } as const;
export const alliedCharacter = { type: 'target_character', side: 'allied' } as const;
export const selfTarget = { type: 'self' } as const;
export const enemyHero = { type: 'hero', side: 'enemy' } as const;
export const allAllied = { type: 'all_characters', side: 'allied' } as const;

export function fixed(value: number): { readonly type: 'fixed'; readonly value: number } {
  return { type: 'fixed', value };
}
