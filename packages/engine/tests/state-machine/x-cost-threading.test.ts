/**
 * X-cost threading (live play) — verifies that an action's chosen X (xValue) is
 * paid as extra resource AND threaded into EffectContext.xPaid so that x_cost
 * amount / dynamic-stat expressions resolve to the X actually paid when an
 * X-cost card resolves through executePlayerAction (not just executeEffect).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { executePlayerAction } from '../../src/state-machine/actions.js';
import { recomputeAuras } from '../../src/runtime/aura-recompute.js';
import {
  mockCard,
  mockGameState,
  mockPlayerState,
  zonesWithCards,
  resetInstanceCounter,
} from '../helpers/card-factory.js';
import type { GameState, ResourceCard } from '../../src/types/game-state.js';
import type { AbilityDSL } from '../../src/types/ability.js';
import type { CastSpellAction, AttachEquipmentAction } from '../../src/state-machine/types.js';

function manaBank(n: number): ResourceCard[] {
  return Array.from({ length: n }, (_, i) => ({
    instanceId: `res_${String(i)}`,
    resourceType: 'mana' as const,
    exhausted: false,
  }));
}

function findCard(state: GameState, id: string) {
  for (const p of state.players)
    for (const zone of [p.zones.reserve, p.zones.frontline, p.zones.highGround])
      for (const c of zone) if (c && c.instanceId === id) return c;
  return null;
}

describe('xPaid threading through executePlayerAction', () => {
  beforeEach(() => resetInstanceCounter());

  it('cast_spell with xValue=4: "deal X damage" deals 4', () => {
    const dealX: AbilityDSL = {
      type: 'triggered',
      trigger: { type: 'on_deploy' },
      effects: [
        {
          type: 'deal_damage',
          amount: { type: 'x_cost', resource: 'mana' },
          target: { type: 'all_characters', side: 'enemy' },
        },
      ],
    };
    const spell = mockCard({
      instanceId: 'SPELL',
      owner: 0,
      cardType: 'S',
      cost: { mana: 1, energy: 0, flexible: 0 },
      abilities: [dealX],
    });
    const enemy = mockCard({ instanceId: 'ENEMY', owner: 1, currentHp: 10, baseHp: 10 });
    const p0 = mockPlayerState(0, { hand: [spell], resourceBank: manaBank(5) });
    const p1 = mockPlayerState(1, { zones: zonesWithCards({ frontline: [enemy, null, null] }) });
    const state = mockGameState({ players: [p0, p1] });

    const action: CastSpellAction = { type: 'cast_spell', cardInstanceId: 'SPELL', xValue: 4 };
    const result = executePlayerAction(state, action);

    expect(findCard(result.state, 'ENEMY')?.currentHp).toBe(6); // 10 - 4
    // Base cost 1 + X 4 = 5 resources exhausted.
    expect(result.state.players[0].resourceBank.filter(r => !r.exhausted)).toHaveLength(0);
  });

  it('attach_equipment Steel-Root Armor with xValue=3: +0/+X HP aura grants +3 HP', () => {
    // Real card shape: a continuous `aura` x_cost grant (the live path resolves it
    // via recomputeAuras off the equipment's recorded xPaid, not a one-shot effect).
    const steelRoot: AbilityDSL = {
      type: 'aura',
      effects: [
        {
          type: 'modify_stats',
          target: { type: 'equipped_character' },
          duration: { type: 'while_in_play' },
          modifier: { hp: 0 },
          dynamicModifier: { type: 'x_cost', stat: 'hp', resource: 'mana' },
        },
      ],
    };
    const armor = mockCard({
      instanceId: 'ARMOR',
      owner: 0,
      cardType: 'E',
      cost: { mana: 1, energy: 0, flexible: 0 },
      abilities: [steelRoot],
    });
    const host = mockCard({ instanceId: 'HOST', owner: 0, currentHp: 4, baseHp: 4 });
    const p0 = mockPlayerState(0, {
      zones: zonesWithCards({ frontline: [host, null, null] }),
      hand: [armor],
      resourceBank: manaBank(4),
    });
    const state = mockGameState({ players: [p0, mockPlayerState(1)] });

    const action: AttachEquipmentAction = {
      type: 'attach_equipment',
      cardInstanceId: 'ARMOR',
      targetInstanceId: 'HOST',
      xValue: 3,
    };
    const result = executePlayerAction(state, action);

    expect(findCard(result.state, 'HOST')?.currentHp).toBe(7); // 4 + 3
    // Continuous aura: a second recompute must hold (not re-stack) at +X.
    const again = recomputeAuras(result.state);
    expect(findCard(again, 'HOST')?.currentHp).toBe(7);
  });

  it('cast_spell without xValue: x_cost resolves to 0', () => {
    const dealX: AbilityDSL = {
      type: 'triggered',
      trigger: { type: 'on_deploy' },
      effects: [
        {
          type: 'deal_damage',
          amount: { type: 'x_cost', resource: 'mana' },
          target: { type: 'all_characters', side: 'enemy' },
        },
      ],
    };
    const spell = mockCard({
      instanceId: 'SPELL',
      owner: 0,
      cardType: 'S',
      cost: { mana: 1, energy: 0, flexible: 0 },
      abilities: [dealX],
    });
    const enemy = mockCard({ instanceId: 'ENEMY', owner: 1, currentHp: 10, baseHp: 10 });
    const p0 = mockPlayerState(0, { hand: [spell], resourceBank: manaBank(5) });
    const p1 = mockPlayerState(1, { zones: zonesWithCards({ frontline: [enemy, null, null] }) });
    const state = mockGameState({ players: [p0, p1] });

    const action: CastSpellAction = { type: 'cast_spell', cardInstanceId: 'SPELL' };
    const result = executePlayerAction(state, action);

    expect(findCard(result.state, 'ENEMY')?.currentHp).toBe(10); // X = 0
  });

  it('is deterministic across two identical runs', () => {
    const build = (): GameState => {
      resetInstanceCounter();
      const dealX: AbilityDSL = {
        type: 'triggered',
        trigger: { type: 'on_deploy' },
        effects: [
          {
            type: 'deal_damage',
            amount: { type: 'x_cost', resource: 'mana' },
            target: { type: 'all_characters', side: 'enemy' },
          },
        ],
      };
      const spell = mockCard({
        instanceId: 'SPELL', owner: 0, cardType: 'S',
        cost: { mana: 1, energy: 0, flexible: 0 }, abilities: [dealX],
      });
      const enemy = mockCard({ instanceId: 'ENEMY', owner: 1, currentHp: 10, baseHp: 10 });
      return mockGameState({
        players: [
          mockPlayerState(0, { hand: [spell], resourceBank: manaBank(5) }),
          mockPlayerState(1, { zones: zonesWithCards({ frontline: [enemy, null, null] }) }),
        ],
      });
    };
    const action: CastSpellAction = { type: 'cast_spell', cardInstanceId: 'SPELL', xValue: 4 };
    const a = executePlayerAction(build(), action);
    const b = executePlayerAction(build(), action);
    expect(findCard(a.state, 'ENEMY')?.currentHp).toBe(findCard(b.state, 'ENEMY')?.currentHp);
    expect(findCard(a.state, 'ENEMY')?.currentHp).toBe(6);
  });
});
