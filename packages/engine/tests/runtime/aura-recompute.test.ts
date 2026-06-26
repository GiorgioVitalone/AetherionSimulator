import { describe, it, expect, beforeEach } from 'vitest';
import { recomputeAuras } from '../../src/runtime/aura-recompute.js';
import { updateCardInState, findCardInState } from '../../src/effects/state-helpers.js';
import {
  mockCard,
  mockGameState,
  mockPlayerState,
  zonesWithCards,
  resetInstanceCounter,
} from '../helpers/card-factory.js';
import type { AbilityDSL } from '../../src/types/ability.js';

const atkFromArm: AbilityDSL = {
  type: 'aura',
  effects: [
    {
      type: 'modify_stats',
      target: { type: 'all_characters', side: 'allied' },
      duration: { type: 'while_in_play' },
      modifier: { atk: 0 },
      dynamicModifier: { type: 'equals_stat', stat: 'atk', sourceRef: 'arm' },
    },
  ],
};

describe('recomputeAuras — ATK equals ARM aura', () => {
  beforeEach(() => {
    resetInstanceCounter();
  });

  it('grants ATK equal to ARM for allied characters', () => {
    const source = mockCard({ owner: 0, name: 'Valkyrie', abilities: [atkFromArm], currentArm: 0, baseArm: 0 });
    const ally = mockCard({ owner: 0, name: 'Knight', currentAtk: 2, baseAtk: 2, currentArm: 3, baseArm: 3 });
    const state = mockGameState({
      players: [
        mockPlayerState(0, { zones: zonesWithCards({ frontline: [source, ally, null] }) }),
        mockPlayerState(1),
      ],
    });

    const result = recomputeAuras(state);
    const buffed = findCardInState(result, ally.instanceId)!;
    expect(buffed.currentAtk).toBe(5); // base 2 + arm 3
    expect(buffed.modifiers.some(m => m.id.startsWith('aura_'))).toBe(true);
  });

  it('updates the ATK bonus when ARM changes, without stacking', () => {
    const source = mockCard({ owner: 0, name: 'Valkyrie', abilities: [atkFromArm], currentArm: 0, baseArm: 0 });
    const ally = mockCard({ owner: 0, name: 'Knight', currentAtk: 2, baseAtk: 2, currentArm: 3, baseArm: 3 });
    const state = mockGameState({
      players: [
        mockPlayerState(0, { zones: zonesWithCards({ frontline: [source, ally, null] }) }),
        mockPlayerState(1),
      ],
    });

    const first = recomputeAuras(state);
    expect(findCardInState(first, ally.instanceId)!.currentAtk).toBe(5);

    // ARM increases by 1 -> ATK bonus should follow, not stack on top of the old bonus.
    const armBuffed = updateCardInState(first, ally.instanceId, c => ({ ...c, currentArm: c.currentArm + 1 }));
    const second = recomputeAuras(armBuffed);
    const after = findCardInState(second, ally.instanceId)!;
    expect(after.currentArm).toBe(4);
    expect(after.currentAtk).toBe(6); // base 2 + arm 4 (not 5 + 4)
    expect(after.modifiers.filter(m => m.id.startsWith('aura_'))).toHaveLength(1);
  });

  it('removes the aura bonus when the aura source leaves play', () => {
    const source = mockCard({ owner: 0, name: 'Valkyrie', abilities: [atkFromArm] });
    const ally = mockCard({ owner: 0, name: 'Knight', currentAtk: 2, baseAtk: 2, currentArm: 3, baseArm: 3 });
    const state = mockGameState({
      players: [
        mockPlayerState(0, { zones: zonesWithCards({ frontline: [source, ally, null] }) }),
        mockPlayerState(1),
      ],
    });
    const withAura = recomputeAuras(state);
    expect(findCardInState(withAura, ally.instanceId)!.currentAtk).toBe(5);

    // Remove the aura source from the board, then recompute.
    const noSource = mockGameState({
      players: [
        mockPlayerState(0, {
          zones: zonesWithCards({ frontline: [null, findCardInState(withAura, ally.instanceId)!, null] }),
        }),
        mockPlayerState(1),
      ],
    });
    const recomputed = recomputeAuras(noSource);
    const cleaned = findCardInState(recomputed, ally.instanceId)!;
    expect(cleaned.currentAtk).toBe(2); // back to base
    expect(cleaned.modifiers.filter(m => m.id.startsWith('aura_'))).toHaveLength(0);
  });

  it('is deterministic', () => {
    const build = (): ReturnType<typeof mockGameState> => {
      resetInstanceCounter();
      const source = mockCard({ owner: 0, name: 'Valkyrie', abilities: [atkFromArm] });
      const ally = mockCard({ owner: 0, name: 'Knight', currentAtk: 2, baseAtk: 2, currentArm: 3, baseArm: 3 });
      return mockGameState({
        players: [
          mockPlayerState(0, { zones: zonesWithCards({ frontline: [source, ally, null] }) }),
          mockPlayerState(1),
        ],
      });
    };
    const r1 = recomputeAuras(build());
    const r2 = recomputeAuras(build());
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
  });
});
