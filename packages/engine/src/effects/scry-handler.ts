/**
 * Scry effect handler — look at the top N of the controller deck and route the
 * cards per the ScryAction with a deterministic auto-policy.
 * Pure: (state, effect, context) => EffectResult. Never mutate input.
 */
import type { Effect } from '../types/effects.js';
import type {
  GameState,
  GameEvent,
  EffectContext,
  EffectResult,
  CardInstance,
  PlayerState,
  RngState,
} from '../types/game-state.js';
import { shuffle } from '../setup/rng.js';

type ScryEffect = Extract<Effect, { type: 'scry' }>;
type PickAction = Extract<ScryEffect['action'], { type: 'pick_and_remainder' }>;
type DistributeAction = Extract<ScryEffect['action'], { type: 'distribute' }>;

function setPlayer(state: GameState, playerId: 0 | 1, player: PlayerState): GameState {
  const players = [...state.players] as [PlayerState, PlayerState];
  players[playerId] = player;
  return { ...state, players };
}

export function executeScry(
  state: GameState,
  effect: ScryEffect,
  context: EffectContext,
): EffectResult {
  const playerId = context.controllerId;
  const player = state.players[playerId];
  const looked = player.mainDeck.slice(0, effect.lookCount);
  const rest = player.mainDeck.slice(effect.lookCount);
  if (looked.length === 0) return { newState: state, events: [] };

  const action = effect.action;
  switch (action.type) {
    case 'pick_and_remainder':
      return applyPickAndRemainder(state, playerId, player, looked, rest, action);
    case 'distribute':
      return applyDistribute(state, playerId, player, looked, rest, action);
    case 'rearrange':
      // Auto-policy: keep the looked cards on top in their current order.
      return { newState: state, events: [] };
  }
}

function applyPickAndRemainder(
  state: GameState,
  playerId: 0 | 1,
  player: PlayerState,
  looked: readonly CardInstance[],
  rest: readonly CardInstance[],
  action: PickAction,
): EffectResult {
  const picked = looked.slice(0, action.pickCount);
  const remainder = looked.slice(action.pickCount);
  const placed = placeRemainder(
    { ...player, hand: [...player.hand, ...picked] },
    remainder,
    rest,
    action.remainder,
    state.rng,
  );
  const events: GameEvent[] = picked.length > 0
    ? [{ type: 'CARD_DRAWN', playerId, count: picked.length }]
    : [];
  return { newState: setPlayer({ ...state, rng: placed.rng }, playerId, placed.player), events };
}

function placeRemainder(
  player: PlayerState,
  remainder: readonly CardInstance[],
  rest: readonly CardInstance[],
  destination: 'bottom' | 'discard' | 'shuffle',
  rng: RngState,
): { readonly player: PlayerState; readonly rng: RngState } {
  switch (destination) {
    case 'bottom':
      return { player: { ...player, mainDeck: [...rest, ...remainder] }, rng };
    case 'discard':
      return { player: { ...player, mainDeck: [...rest], discardPile: [...player.discardPile, ...remainder] }, rng };
    case 'shuffle': {
      // Faithful shuffle: the remainder is shuffled back into the rest of the deck
      // via the seeded RNG, advancing rng so the result stays deterministic.
      const { result, nextRng } = shuffle([...rest, ...remainder], rng);
      return { player: { ...player, mainDeck: result }, rng: nextRng };
    }
  }
}

function applyDistribute(
  state: GameState,
  playerId: 0 | 1,
  player: PlayerState,
  looked: readonly CardInstance[],
  rest: readonly CardInstance[],
  action: DistributeAction,
): EffectResult {
  const toHand: CardInstance[] = [];
  const toDiscard: CardInstance[] = [];
  const toBottom: CardInstance[] = [];
  looked.forEach((card, i) => {
    const dest = action.destinations[i] ?? 'bottom';
    if (dest === 'hand') toHand.push(card);
    else if (dest === 'discard') toDiscard.push(card);
    else toBottom.push(card);
  });
  const newPlayer: PlayerState = {
    ...player,
    hand: [...player.hand, ...toHand],
    discardPile: [...player.discardPile, ...toDiscard],
    mainDeck: [...rest, ...toBottom],
  };
  const events: GameEvent[] = toHand.length > 0
    ? [{ type: 'CARD_DRAWN', playerId, count: toHand.length }]
    : [];
  return { newState: setPlayer(state, playerId, newPlayer), events };
}
