import { describe, it, expect, beforeEach } from 'vitest';
import { recomputeAuras } from '../../src/runtime/aura-recompute.js';
import { canAfford, effectiveCost } from '../../src/actions/cost-checker.js';
import {
  mockCard,
  mockGameState,
  mockPlayerState,
  zonesWithCards,
  resetInstanceCounter,
} from '../helpers/card-factory.js';
import type { AbilityDSL } from '../../src/types/ability.js';
import type { ResourceCard } from '../../src/types/game-state.js';

let rc = 0;
function mana(): ResourceCard {
  rc++;
  return { instanceId: `mana_${String(rc)}`, resourceType: 'mana', exhausted: false };
}

// Wizard's Robe: while in play, Arcane spells cost 1 less.
const arcaneSpellDiscount: AbilityDSL = {
  type: 'aura',
  effects: [
    {
      type: 'cost_reduction',
      duration: { type: 'while_in_play' },
      appliesTo: { tag: 'Arcane', cardType: 'S' },
      reduction: 1,
    },
  ],
};

// Shieldbearer Seraphina: first Equipment each turn costs 1 less.
const firstEquipDiscount: AbilityDSL = {
  type: 'aura',
  effects: [
    {
      type: 'cost_reduction',
      duration: { type: 'while_in_play' },
      appliesTo: { cardType: 'E', firstPerTurn: true },
      reduction: 1,
    },
  ],
};

describe('recomputeAuras — cost-reduction auras (live wiring)', () => {
  beforeEach(() => {
    resetInstanceCounter();
    rc = 0;
  });

  it('registers an aura cost reduction onto the controlling player', () => {
    const robe = mockCard({ owner: 0, name: "Wizard's Robe", cardType: 'E', abilities: [arcaneSpellDiscount] });
    const state = mockGameState({
      players: [
        mockPlayerState(0, { zones: zonesWithCards({ frontline: [robe, null, null] }) }),
        mockPlayerState(1),
      ],
    });

    const recomputed = recomputeAuras(state);
    const reductions = recomputed.players[0].costReductions ?? [];
    expect(reductions).toHaveLength(1);
    expect(reductions[0]!.reduction).toBe(1);
    expect(reductions[0]!.id.startsWith('aura_')).toBe(true);
  });

  it('makes an otherwise-unaffordable Arcane spell affordable in a live state', () => {
    const robe = mockCard({ owner: 0, name: "Wizard's Robe", cardType: 'E', abilities: [arcaneSpellDiscount] });
    const arcaneSpell = mockCard({
      owner: 0,
      name: 'Fireball',
      cardType: 'S',
      tags: ['Arcane'],
      cost: { mana: 2, energy: 0, flexible: 0 },
    });
    // Player has only 1 mana — cannot afford the 2-cost spell without the aura.
    const base = mockPlayerState(0, {
      zones: zonesWithCards({ frontline: [robe, null, null] }),
      resourceBank: [mana()],
    });
    const state = mockGameState({ players: [base, mockPlayerState(1)] });

    // Sanity: without recompute, no reduction is registered, spell is unaffordable.
    expect(canAfford(base, effectiveCost(base, arcaneSpell))).toBe(false);

    const recomputed = recomputeAuras(state);
    const player = recomputed.players[0];
    const cost = effectiveCost(player, arcaneSpell);
    expect(cost.mana).toBe(1); // discounted from 2 to 1
    expect(canAfford(player, cost)).toBe(true);
  });

  it('removes the aura cost reduction when the source leaves play', () => {
    const robe = mockCard({ owner: 0, name: "Wizard's Robe", cardType: 'E', abilities: [arcaneSpellDiscount] });
    const withAura = recomputeAuras(
      mockGameState({
        players: [
          mockPlayerState(0, { zones: zonesWithCards({ frontline: [robe, null, null] }) }),
          mockPlayerState(1),
        ],
      }),
    );
    expect(withAura.players[0].costReductions ?? []).toHaveLength(1);

    // Source gone — recompute should clear the aura-sourced reduction.
    const noSource = recomputeAuras({
      ...withAura,
      players: [
        { ...withAura.players[0], zones: zonesWithCards({ frontline: [null, null, null] }) },
        withAura.players[1],
      ],
    });
    expect(noSource.players[0].costReductions ?? []).toHaveLength(0);
  });

  it('preserves firstPerTurn usedThisTurn across a re-recompute', () => {
    const seraphina = mockCard({ owner: 0, name: 'Seraphina', abilities: [firstEquipDiscount] });
    const first = recomputeAuras(
      mockGameState({
        players: [
          mockPlayerState(0, { zones: zonesWithCards({ frontline: [seraphina, null, null] }) }),
          mockPlayerState(1),
        ],
      }),
    );
    const id = first.players[0].costReductions![0]!.id;

    // Simulate the cost system consuming the first-per-turn discount.
    const consumed = {
      ...first,
      players: [
        {
          ...first.players[0],
          costReductions: [{ ...first.players[0].costReductions![0]!, usedThisTurn: true }],
        },
        first.players[1],
      ] as typeof first.players,
    };

    const second = recomputeAuras(consumed);
    const after = second.players[0].costReductions![0]!;
    expect(after.id).toBe(id);
    expect(after.usedThisTurn).toBe(true); // not reset by recompute
  });

  it('does not strip one-shot (effect-registered) cost reductions', () => {
    const robe = mockCard({ owner: 0, name: "Wizard's Robe", cardType: 'E', abilities: [arcaneSpellDiscount] });
    const player = mockPlayerState(0, {
      zones: zonesWithCards({ frontline: [robe, null, null] }),
      costReductions: [
        { id: 'cost_reduction_spell_0', reduction: 1, appliesTo: { cardType: 'S' }, usedThisTurn: false },
      ],
    });
    const recomputed = recomputeAuras(mockGameState({ players: [player, mockPlayerState(1)] }));
    const ids = (recomputed.players[0].costReductions ?? []).map(r => r.id);
    expect(ids).toContain('cost_reduction_spell_0'); // one-shot survives
    expect(ids.some(i => i.startsWith('aura_'))).toBe(true); // aura added
  });

  it('is deterministic', () => {
    const build = (): ReturnType<typeof recomputeAuras> => {
      resetInstanceCounter();
      const robe = mockCard({ owner: 0, name: "Wizard's Robe", cardType: 'E', abilities: [arcaneSpellDiscount] });
      return recomputeAuras(
        mockGameState({
          players: [
            mockPlayerState(0, { zones: zonesWithCards({ frontline: [robe, null, null] }) }),
            mockPlayerState(1),
          ],
        }),
      );
    };
    expect(JSON.stringify(build())).toBe(JSON.stringify(build()));
  });
});
