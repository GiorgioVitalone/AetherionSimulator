import { describe, expect, it } from 'vitest';
import { effectStaticValue, sumEffects } from '../../src/balance/effect-value.js';
import type { Effect } from '../../src/types/effects.js';
import { allAllied, alliedCharacter, enemyCharacter, enemyHero, fixed } from './factory.js';

describe('effectStaticValue — mirrors spell-eval coefficients, context-free', () => {
  it('scores destroy enemy as full removal (AVG_ENEMY_BODY)', () => {
    const r = effectStaticValue({ type: 'destroy', target: enemyCharacter });
    expect(r.value).toBeCloseTo(5.5);
    expect(r.isRemoval).toBe(true);
  });

  it('scores 3 damage to an enemy body as a kill, 2 damage as chip', () => {
    const kill = effectStaticValue({
      type: 'deal_damage',
      amount: fixed(3),
      target: enemyCharacter,
    });
    const chip = effectStaticValue({
      type: 'deal_damage',
      amount: fixed(2),
      target: enemyCharacter,
    });
    expect(kill.value).toBeCloseTo(5.5);
    expect(kill.isRemoval).toBe(true);
    expect(chip.value).toBeCloseTo(2);
    expect(chip.isRemoval).toBe(false);
  });

  it('scores face damage by FACE_WEIGHT (1.5)', () => {
    const r = effectStaticValue({ type: 'deal_damage', amount: fixed(3), target: enemyHero });
    expect(r.value).toBeCloseTo(4.5);
  });

  it('scores draw by CARD_VALUE (1.2/card)', () => {
    expect(
      effectStaticValue({ type: 'draw_cards', count: fixed(2), player: 'allied' }).value,
    ).toBeCloseTo(2.4);
  });

  it('scores an allied anthem by board-width x tempo weight', () => {
    const r = effectStaticValue({
      type: 'modify_stats',
      modifier: { atk: 1, hp: 1 },
      target: allAllied,
      duration: { type: 'permanent' },
    });
    expect(r.value).toBeCloseTo(3.0); // 2 gain * 2.5 width * 0.6
  });

  it('values permanent ramp above temporary ramp', () => {
    expect(
      effectStaticValue({ type: 'gain_resource', resourceType: 'energy', amount: 3 }).value,
    ).toBeCloseTo(3.0);
    expect(
      effectStaticValue({
        type: 'gain_resource',
        resourceType: 'energy',
        amount: 3,
        temporary: true,
      }).value,
    ).toBeCloseTo(1.5);
  });

  it('propagates removal out of a conditional rider at the probability discount', () => {
    const r = effectStaticValue({
      type: 'conditional',
      condition: { type: 'is_alive' },
      ifTrue: [{ type: 'deal_damage', amount: fixed(3), target: enemyCharacter }],
    });
    expect(r.value).toBeCloseTo(0.6 * 5.5);
    expect(r.isRemoval).toBe(true);
  });

  it('sums composite sub-effects and ORs the removal flag', () => {
    const r = sumEffects([
      { type: 'destroy', target: enemyCharacter },
      { type: 'draw_cards', count: fixed(1), player: 'allied' },
    ]);
    expect(r.value).toBeCloseTo(5.5 + 1.2);
    expect(r.isRemoval).toBe(true);
  });

  it('handles every Effect variant without throwing (runtime exhaustiveness)', () => {
    const samples: Effect[] = [
      { type: 'deal_damage', amount: fixed(1), target: enemyCharacter },
      { type: 'heal', amount: fixed(2), target: alliedCharacter },
      {
        type: 'modify_stats',
        modifier: { atk: 1 },
        target: alliedCharacter,
        duration: { type: 'permanent' },
      },
      { type: 'draw_cards', count: fixed(1), player: 'allied' },
      { type: 'scry', lookCount: 2, action: { type: 'rearrange' } },
      { type: 'deploy_token', token: { name: 'T', atk: 1, hp: 1 }, count: 1 },
      { type: 'destroy', target: enemyCharacter },
      { type: 'sacrifice', target: alliedCharacter },
      { type: 'bounce', target: enemyCharacter },
      { type: 'discard', count: 1, target: { type: 'player', side: 'enemy' } },
      {
        type: 'return_from_discard',
        target: { type: 'target_card_in_discard', side: 'allied' },
        destination: 'hand',
      },
      { type: 'counter_spell', target: { type: 'target_spell' } },
      { type: 'gain_resource', resourceType: 'mana', amount: 1 },
      {
        type: 'cost_reduction',
        reduction: 1,
        appliesTo: { cardType: 'E' },
        duration: { type: 'permanent' },
      },
      {
        type: 'grant_trait',
        trait: 'haste',
        target: alliedCharacter,
        duration: { type: 'permanent' },
      },
      {
        type: 'grant_ability',
        ability: { trigger: { type: 'on_deploy' }, effects: [] },
        target: alliedCharacter,
        duration: { type: 'permanent' },
      },
      { type: 'move', target: alliedCharacter, destination: 'frontline' },
      { type: 'apply_status', status: 'stunned', target: enemyCharacter },
      { type: 'cleanse', target: alliedCharacter },
      { type: 'search_deck', filter: {}, destination: 'hand' },
      { type: 'shuffle_into_deck', source: 'discard' },
      { type: 'copy_card', source: 'discard', destination: 'hand' },
      { type: 'deploy_from_deck', filter: {} },
      { type: 'attach_as_equipment', target: alliedCharacter },
      { type: 'choose_one', options: [{ label: 'a', effects: [] }] },
      { type: 'conditional', condition: { type: 'is_alive' }, ifTrue: [] },
      { type: 'composite', effects: [] },
      { type: 'replacement', replaces: { type: 'on_would_be_destroyed' }, instead: [] },
      { type: 'scheduled', timing: { type: 'end_of_turn' }, effects: [] },
    ];
    for (const e of samples) expect(() => effectStaticValue(e)).not.toThrow();
    expect(samples.length).toBe(29);
  });
});
