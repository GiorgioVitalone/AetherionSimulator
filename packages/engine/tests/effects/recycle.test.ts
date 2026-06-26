import { describe, it, expect, beforeEach } from 'vitest';
import { executeEffect } from '../../src/effects/interpreter.js';
import {
  mockCard,
  mockGameState,
  mockPlayerState,
  resetInstanceCounter,
} from '../helpers/card-factory.js';
import type { Effect } from '../../src/types/effects.js';
import type { EffectContext } from '../../src/types/game-state.js';

// A forced (`random`) discard reaches discardSpecificCards directly with the card
// already chosen by the RNG pre-pass (passed as selectedTargets), so these tests
// exercise the same discard-from-hand path the engine uses in real games.
const CTX: EffectContext = { sourceInstanceId: 'src', controllerId: 0, triggerDepth: 0 };

function discardEffect(): Extract<Effect, { type: 'discard' }> {
  return { type: 'discard', count: 1, target: { type: 'random' } };
}

describe('Recycle X — draw X when discarded from hand (Rulebook 16)', () => {
  beforeEach(() => {
    resetInstanceCounter();
  });

  it('draws X cards for the owner when a Recycle X card is discarded from hand', () => {
    const recycler = mockCard({ owner: 0, traits: ['recycle'], recycleValue: 2 });
    const deck = [mockCard({ owner: 0 }), mockCard({ owner: 0 }), mockCard({ owner: 0 })];
    const state = mockGameState({
      players: [
        mockPlayerState(0, { hand: [recycler], mainDeck: deck }),
        mockPlayerState(1),
      ],
    });

    const result = executeEffect(
      state,
      discardEffect(),
      { ...CTX, selectedTargets: [recycler.instanceId] },
    );

    const p0 = result.newState.players[0];
    expect(p0.discardPile.map(c => c.instanceId)).toContain(recycler.instanceId);
    expect(p0.hand).toHaveLength(2); // drew 2 fresh cards
    expect(p0.mainDeck).toHaveLength(1); // 3 - 2 drawn
    const drawEvents = result.events.filter(e => e.type === 'CARD_DRAWN');
    expect(drawEvents).toEqual([{ type: 'CARD_DRAWN', playerId: 0, count: 2 }]);
  });

  it('defaults a bare recycle trait (no value) to drawing 1', () => {
    const recycler = mockCard({ owner: 0, traits: ['recycle'] }); // recycleValue absent
    const state = mockGameState({
      players: [
        mockPlayerState(0, { hand: [recycler], mainDeck: [mockCard({ owner: 0 })] }),
        mockPlayerState(1),
      ],
    });

    const result = executeEffect(
      state,
      discardEffect(),
      { ...CTX, selectedTargets: [recycler.instanceId] },
    );

    expect(result.newState.players[0].hand).toHaveLength(1);
    expect(
      result.events.filter(e => e.type === 'CARD_DRAWN'),
    ).toEqual([{ type: 'CARD_DRAWN', playerId: 0, count: 1 }]);
  });

  it('caps the draw at the remaining deck size and emits no event on an empty deck', () => {
    const recycler = mockCard({ owner: 0, traits: ['recycle'], recycleValue: 3 });
    const state = mockGameState({
      players: [
        mockPlayerState(0, { hand: [recycler], mainDeck: [] }),
        mockPlayerState(1),
      ],
    });

    const result = executeEffect(
      state,
      discardEffect(),
      { ...CTX, selectedTargets: [recycler.instanceId] },
    );

    expect(result.newState.players[0].hand).toHaveLength(0);
    expect(result.events.filter(e => e.type === 'CARD_DRAWN')).toHaveLength(0);
  });

  it('draws for the discarding card OWNER, even when the opponent forced the discard', () => {
    const recycler = mockCard({ owner: 1, traits: ['recycle'], recycleValue: 1 });
    const state = mockGameState({
      players: [
        mockPlayerState(0),
        mockPlayerState(1, { hand: [recycler], mainDeck: [mockCard({ owner: 1 })] }),
      ],
    });

    const result = executeEffect(
      state,
      discardEffect(),
      { ...CTX, selectedTargets: [recycler.instanceId] },
    );

    expect(result.newState.players[1].hand).toHaveLength(1);
    expect(
      result.events.filter(e => e.type === 'CARD_DRAWN'),
    ).toEqual([{ type: 'CARD_DRAWN', playerId: 1, count: 1 }]);
  });

  it('is INERT for a plain card with no recycle trait — discard draws nothing', () => {
    const plain = mockCard({ owner: 0 });
    const state = mockGameState({
      players: [
        mockPlayerState(0, { hand: [plain], mainDeck: [mockCard({ owner: 0 }), mockCard({ owner: 0 })] }),
        mockPlayerState(1),
      ],
    });

    const result = executeEffect(
      state,
      discardEffect(),
      { ...CTX, selectedTargets: [plain.instanceId] },
    );

    expect(result.newState.players[0].hand).toHaveLength(0);
    expect(result.newState.players[0].mainDeck).toHaveLength(2); // untouched
    expect(result.events.filter(e => e.type === 'CARD_DRAWN')).toHaveLength(0);
  });
});
