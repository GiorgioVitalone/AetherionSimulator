/**
 * §X1 (round-9): STRUCTURAL guard against a Condition-bearing DSL node
 * shipping unscored.
 *
 * Three certification rounds in a row (7, 8, 9) each found ANOTHER field of
 * type `Condition` that static valuation silently ignored — ability-level
 * `condition` (round 7), `GrantedAbilityRef.condition` (round 8),
 * `ScheduledEffect.condition` (round 9). This file PINS AND DOCUMENTS the
 * class — it does not mechanically detect new sites (a future 7th field fails
 * no test until a fixture is added; the instruction below is the guard's
 * enforcement mechanism, plus the shared abilityOwnCondition() helper that
 * centralizes ability/while lookup). Scope: the 4 DSL type files
 * (types/effects.ts, ability.ts, triggers.ts, conditions.ts) — the VALUATION
 * input surface. game-state.ts additionally holds runtime mirrors of sites
 * #1/#5 and `transformTrigger` (a printed Condition under another name) which
 * is OUTSIDE the valuation surface today (not in StaticCard/HeroInput); if
 * hero transforms ever enter computeCardPower's inputs, it becomes site #7.
 * One fixture per site, asserting the SAME policy —
 * the 'conditional' flag is present and the interval is strictly widened
 * (never a falsely-precise powerLow === powerHigh on a card whose effect may
 * not fire).
 *
 * >>> DSL AUTHORS: if you add a new field of type `Condition` (or
 * `Condition | undefined`) anywhere in the DSL, add a fixture here. A
 * Condition-bearing node with no entry in this file is, by definition,
 * unverified — the exact failure mode every round above reproduced. <<<
 *
 * Current exhaustive inventory (verified by grep across the 4 type files):
 *   1. TriggeredAbilityDSL.condition      (ability.ts)   — handled round 7
 *   2. AuraAbilityDSL.condition           (ability.ts)   — handled round 7
 *   3. ConditionalEffect.condition        (effects.ts)   — handled §S3 (original)
 *   4. GrantedAbilityRef.condition        (effects.ts)   — handled round 8 (§W1)
 *   5. ScheduledEffect.condition          (effects.ts)   — handled round 9 (§X1)
 *   6. WhileCondition.condition           (triggers.ts)  — handled round 9 (§X1)
 * `AndCondition`/`OrCondition`/`NotCondition` (conditions.ts) are Condition
 * COMBINATORS, not new bearing sites — they recurse into the same `Condition`
 * type already covered by whichever field holds them.
 */
import { describe, expect, it } from 'vitest';
import { computeCardPower } from '../../src/balance/card-power.js';
import { card, enemyCharacter, fixed, triggered } from './factory.js';

const IS_ALIVE = { type: 'is_alive' as const };

describe('§X1 structural guard: every Condition-bearing DSL node is scored (flag + widened interval)', () => {
  it('1. TriggeredAbilityDSL.condition', () => {
    const ability = triggered(
      { type: 'on_deploy' },
      [{ type: 'deal_damage', amount: fixed(2), target: enemyCharacter }],
      { condition: IS_ALIVE },
    );
    const p = computeCardPower(card({ id: 900, name: 'Inv1', abilities: [ability] }));
    expect(p.flags).toContain('conditional');
    expect(p.powerLow).toBeLessThan(p.power);
    expect(p.powerHigh).toBeGreaterThan(p.power);
  });

  it('2. AuraAbilityDSL.condition', () => {
    const ability = {
      type: 'aura' as const,
      condition: IS_ALIVE,
      effects: [
        {
          type: 'grant_trait' as const,
          trait: 'flying' as const,
          target: enemyCharacter,
          duration: { type: 'permanent' as const },
        },
      ],
    };
    const p = computeCardPower(card({ id: 901, name: 'Inv2', abilities: [ability] }));
    expect(p.flags).toContain('conditional');
    expect(p.powerLow).toBeLessThan(p.power);
    expect(p.powerHigh).toBeGreaterThan(p.power);
  });

  it('3. ConditionalEffect.condition', () => {
    const ability = triggered({ type: 'on_deploy' }, [
      {
        type: 'conditional',
        condition: IS_ALIVE,
        ifTrue: [{ type: 'destroy', target: enemyCharacter }],
      },
    ]);
    const p = computeCardPower(card({ id: 902, name: 'Inv3', abilities: [ability] }));
    expect(p.flags).toContain('conditional');
    expect(p.powerLow).toBeLessThan(p.power);
    expect(p.powerHigh).toBeGreaterThan(p.power);
  });

  it('4. GrantedAbilityRef.condition', () => {
    const ability = triggered({ type: 'on_deploy' }, [
      {
        type: 'grant_ability',
        target: enemyCharacter,
        duration: { type: 'permanent' },
        ability: {
          trigger: { type: 'on_deploy' },
          effects: [{ type: 'destroy', target: enemyCharacter }],
          condition: IS_ALIVE,
        },
      },
    ]);
    const p = computeCardPower(card({ id: 903, name: 'Inv4', abilities: [ability] }));
    expect(p.flags).toContain('conditional');
    expect(p.powerLow).toBeLessThan(p.power);
    expect(p.powerHigh).toBeGreaterThan(p.power);
  });

  it('5. ScheduledEffect.condition (Mana Tide shape)', () => {
    const ability = triggered({ type: 'on_deploy' }, [
      {
        type: 'scheduled',
        timing: { type: 'next_turn_start' },
        effects: [{ type: 'gain_resource', amount: 1 }],
        condition: IS_ALIVE,
      },
    ]);
    const p = computeCardPower(card({ id: 904, name: 'Inv5', abilities: [ability] }));
    expect(p.flags).toContain('conditional');
    expect(p.powerLow).toBeLessThan(p.power);
    expect(p.powerHigh).toBeGreaterThan(p.power);
  });

  it('6. WhileCondition.condition (conditional-aura-via-trigger shape)', () => {
    const ability = triggered({ type: 'while', condition: IS_ALIVE }, [
      { type: 'deal_damage', amount: fixed(2), target: enemyCharacter },
    ]);
    const p = computeCardPower(card({ id: 905, name: 'Inv6', abilities: [ability] }));
    expect(p.flags).toContain('conditional');
    expect(p.powerLow).toBeLessThan(p.power);
    expect(p.powerHigh).toBeGreaterThan(p.power);
  });
});
