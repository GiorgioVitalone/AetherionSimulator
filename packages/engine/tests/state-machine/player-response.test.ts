import { applyPendingChoiceResponse } from '../../src/state-machine/player-response.js';
import {
  emptyZones,
  mockCard,
  mockGameState,
  mockPlayerState,
  resetInstanceCounter,
} from '../helpers/card-factory.js';

describe('player response handling', () => {
  beforeEach(() => {
    resetInstanceCounter();
  });

  it('uses choice option instanceIds for reserve exhaust responses', () => {
    const reserveCard = mockCard({
      owner: 0,
      exhausted: false,
    });

    const state = mockGameState({
      pendingChoice: {
        type: 'reserve_exhaust',
        playerId: 0,
        options: [{
          id: 'option_reserve_1',
          label: reserveCard.name,
          instanceId: reserveCard.instanceId,
        }],
        minSelections: 1,
        maxSelections: 1,
        context: 'Choose a reserve card to exhaust',
      },
      players: [
        mockPlayerState(0, {
          zones: {
            ...emptyZones(),
            reserve: [reserveCard, null],
          },
        }),
        mockPlayerState(1),
      ],
    });

    const resolved = applyPendingChoiceResponse(state, {
      selectedOptionIds: ['option_reserve_1'],
    });

    expect(resolved.pendingChoice).toBeNull();
    expect(resolved.state.players[0]!.zones.reserve[0]!.exhausted).toBe(true);
  });
});
