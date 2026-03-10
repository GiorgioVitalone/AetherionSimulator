/**
 * Response Window — determines whether the non-active player can respond
 * with Counter or Flash cards, and creates the appropriate PendingChoice.
 */
import type {
  GameState,
  PendingChoice,
  ChoiceOption,
  EffectResult,
} from '../types/game-state.js';
import { canAfford } from '../actions/cost-checker.js';

/**
 * Open a response window for the non-active player.
 * If no Counter/Flash cards are available, auto-passes.
 */
export function openResponseWindow(
  state: GameState,
  stackItemId: string,
): EffectResult {
  const respondingPlayerId = state.activePlayerIndex === 0 ? 1 : 0;
  const responses = computeAvailableResponses(state, respondingPlayerId as 0 | 1);

  // Auto-pass: no responses available
  if (responses.length === 0) {
    return { newState: state, events: [] };
  }

  const choice: PendingChoice = {
    type: 'response_window',
    playerId: respondingPlayerId as 0 | 1,
    options: [
      ...responses,
      { id: 'pass', label: 'Pass (no response)' },
    ],
    minSelections: 1,
    maxSelections: 1,
    context: 'You may respond with a Counter or Flash card.',
    responseContext: {
      respondingPlayerId: respondingPlayerId as 0 | 1,
      stackItemId,
    },
  };

  return {
    newState: { ...state, pendingChoice: choice },
    events: [],
    pendingChoice: choice,
  };
}

/**
 * Compute available Counter/Flash responses for a player.
 */
export function computeAvailableResponses(
  state: GameState,
  playerId: 0 | 1,
): readonly ChoiceOption[] {
  const player = state.players[playerId]!;
  const options: ChoiceOption[] = [];

  for (const card of player.hand) {
    if (card.cardType !== 'S') continue;
    if (!canAfford(player, card.cost)) continue;

    // Check for Counter or Flash trigger types
    const hasCounter = card.abilities.some(
      a => a.type === 'triggered' && a.trigger.type === 'on_counter',
    );
    const hasFlash = card.abilities.some(
      a => a.type === 'triggered' && a.trigger.type === 'on_flash',
    );

    if (hasCounter || hasFlash) {
      options.push({
        id: card.instanceId,
        label: `${card.name} (${hasCounter ? 'Counter' : 'Flash'})`,
        instanceId: card.instanceId,
      });
    }
  }

  return options;
}
