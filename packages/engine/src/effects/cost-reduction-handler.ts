/**
 * Cost reduction effects — register and consult player-level cost discounts.
 *
 * A `cost_reduction` effect registers an ActiveCostReduction on the controlling
 * player. The cost system (actions/cost-checker.ts) consults these when computing
 * the effective cost of a matching play this turn. Reductions are cleared at end
 * of turn alongside temporary resources.
 *
 * Registration is pure. Filter matching + cost reduction live in cost-checker.ts
 * so the affordability path has a single source of truth.
 */
import type { Effect } from '../types/effects.js';
import type {
  GameState,
  PlayerState,
  ActiveCostReduction,
  EffectContext,
  EffectResult,
} from '../types/game-state.js';

export function executeCostReduction(
  state: GameState,
  effect: Extract<Effect, { type: 'cost_reduction' }>,
  context: EffectContext,
): EffectResult {
  const player = state.players[context.controllerId];

  const existing = player.costReductions ?? [];
  const registration: ActiveCostReduction = {
    id: `cost_reduction_${context.sourceInstanceId}_${String(existing.length)}`,
    reduction: effect.reduction,
    appliesTo: effect.appliesTo,
    usedThisTurn: false,
  };

  const newPlayer: PlayerState = {
    ...player,
    costReductions: [...existing, registration],
  };
  const newPlayers = [...state.players] as [PlayerState, PlayerState];
  newPlayers[context.controllerId] = newPlayer;
  return { newState: { ...state, players: newPlayers }, events: [] };
}
