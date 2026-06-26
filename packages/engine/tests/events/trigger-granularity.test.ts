import { describe, it, expect } from 'vitest';
import { triggerMatchesEvent } from '../../src/events/trigger-matcher.js';
import type { GameEvent } from '../../src/types/game-state.js';

// Wave 6: on_block, the destruction hierarchy (on_dies / on_destroy /
// on_leaves_battlefield + ally variants), and the on_stat_modified side filter.

const destroyedCombat: GameEvent = { type: 'CARD_DESTROYED', cardInstanceId: 'c1', cause: 'combat', playerId: 0 };
const destroyedEffect: GameEvent = { type: 'CARD_DESTROYED', cardInstanceId: 'c1', cause: 'effect', playerId: 0 };
const destroyedSacrifice: GameEvent = { type: 'CARD_DESTROYED', cardInstanceId: 'c1', cause: 'sacrifice', playerId: 0 };
const exiled: GameEvent = { type: 'CARD_EXILED', cardInstanceId: 'c1', playerId: 0 };
const bounced: GameEvent = { type: 'CARD_BOUNCED', cardInstanceId: 'c1', playerId: 0 };

describe('on_block', () => {
  it('matches CHARACTER_BLOCKED for the blocker', () => {
    const ev: GameEvent = { type: 'CHARACTER_BLOCKED', blockerId: 'c1', attackerId: 'a1' };
    expect(triggerMatchesEvent({ type: 'on_block' }, ev, 'c1', 0)).toBe(true);
  });
  it('does NOT match for a different character', () => {
    const ev: GameEvent = { type: 'CHARACTER_BLOCKED', blockerId: 'c2', attackerId: 'a1' };
    expect(triggerMatchesEvent({ type: 'on_block' }, ev, 'c1', 0)).toBe(false);
  });
});

describe('destruction hierarchy — self scope', () => {
  it('on_dies fires ONLY on combat kills', () => {
    expect(triggerMatchesEvent({ type: 'on_dies' }, destroyedCombat, 'c1', 0)).toBe(true);
    expect(triggerMatchesEvent({ type: 'on_dies' }, destroyedEffect, 'c1', 0)).toBe(false);
    expect(triggerMatchesEvent({ type: 'on_dies' }, destroyedSacrifice, 'c1', 0)).toBe(false);
    expect(triggerMatchesEvent({ type: 'on_dies' }, exiled, 'c1', 0)).toBe(false);
  });

  it('on_destroy fires on ANY destruction but NOT bounce/exile', () => {
    expect(triggerMatchesEvent({ type: 'on_destroy' }, destroyedCombat, 'c1', 0)).toBe(true);
    expect(triggerMatchesEvent({ type: 'on_destroy' }, destroyedEffect, 'c1', 0)).toBe(true);
    expect(triggerMatchesEvent({ type: 'on_destroy' }, destroyedSacrifice, 'c1', 0)).toBe(true);
    expect(triggerMatchesEvent({ type: 'on_destroy' }, exiled, 'c1', 0)).toBe(false);
    expect(triggerMatchesEvent({ type: 'on_destroy' }, bounced, 'c1', 0)).toBe(false);
  });

  it('on_leaves_battlefield fires on destroy, exile, AND bounce', () => {
    expect(triggerMatchesEvent({ type: 'on_leaves_battlefield' }, destroyedEffect, 'c1', 0)).toBe(true);
    expect(triggerMatchesEvent({ type: 'on_leaves_battlefield' }, exiled, 'c1', 0)).toBe(true);
    expect(triggerMatchesEvent({ type: 'on_leaves_battlefield' }, bounced, 'c1', 0)).toBe(true);
  });

  it('none of the self-scope triggers fire for another card', () => {
    const other: GameEvent = { type: 'CARD_DESTROYED', cardInstanceId: 'c2', cause: 'combat', playerId: 0 };
    expect(triggerMatchesEvent({ type: 'on_dies' }, other, 'c1', 0)).toBe(false);
    expect(triggerMatchesEvent({ type: 'on_leaves_battlefield' }, other, 'c1', 0)).toBe(false);
  });
});

describe('destruction hierarchy — ally scope', () => {
  it('on_ally_dies fires for an allied combat kill, not self, not enemy', () => {
    const ally: GameEvent = { type: 'CARD_DESTROYED', cardInstanceId: 'c2', cause: 'combat', playerId: 0 };
    const enemy: GameEvent = { type: 'CARD_DESTROYED', cardInstanceId: 'c2', cause: 'combat', playerId: 1 };
    const allyByEffect: GameEvent = { type: 'CARD_DESTROYED', cardInstanceId: 'c2', cause: 'effect', playerId: 0 };
    expect(triggerMatchesEvent({ type: 'on_ally_dies' }, ally, 'c1', 0)).toBe(true);
    expect(triggerMatchesEvent({ type: 'on_ally_dies' }, enemy, 'c1', 0)).toBe(false);
    expect(triggerMatchesEvent({ type: 'on_ally_dies' }, allyByEffect, 'c1', 0)).toBe(false);
    expect(triggerMatchesEvent({ type: 'on_ally_dies' }, destroyedCombat, 'c1', 0)).toBe(false); // self
  });

  it('on_ally_leaves_battlefield fires for allied bounce/exile too', () => {
    const allyBounce: GameEvent = { type: 'CARD_BOUNCED', cardInstanceId: 'c2', playerId: 0 };
    const enemyBounce: GameEvent = { type: 'CARD_BOUNCED', cardInstanceId: 'c2', playerId: 1 };
    expect(triggerMatchesEvent({ type: 'on_ally_leaves_battlefield' }, allyBounce, 'c1', 0)).toBe(true);
    expect(triggerMatchesEvent({ type: 'on_ally_leaves_battlefield' }, enemyBounce, 'c1', 0)).toBe(false);
  });
});

describe('on_stat_modified side filter', () => {
  const buffAllied: GameEvent = { type: 'STAT_MODIFIED', cardInstanceId: 'x', modifier: { atk: 1 }, playerId: 0 };
  const buffEnemy: GameEvent = { type: 'STAT_MODIFIED', cardInstanceId: 'x', modifier: { atk: 1 }, playerId: 1 };

  it('side=allied matches only own buffs', () => {
    expect(triggerMatchesEvent({ type: 'on_stat_modified', side: 'allied' }, buffAllied, 'c1', 0)).toBe(true);
    expect(triggerMatchesEvent({ type: 'on_stat_modified', side: 'allied' }, buffEnemy, 'c1', 0)).toBe(false);
  });

  it('side=enemy matches only enemy buffs', () => {
    expect(triggerMatchesEvent({ type: 'on_stat_modified', side: 'enemy' }, buffAllied, 'c1', 0)).toBe(false);
    expect(triggerMatchesEvent({ type: 'on_stat_modified', side: 'enemy' }, buffEnemy, 'c1', 0)).toBe(true);
  });

  it('no side filter matches any buff; missing owner is permissive', () => {
    const noOwner: GameEvent = { type: 'STAT_MODIFIED', cardInstanceId: 'x', modifier: { atk: 1 } };
    expect(triggerMatchesEvent({ type: 'on_stat_modified' }, buffEnemy, 'c1', 0)).toBe(true);
    expect(triggerMatchesEvent({ type: 'on_stat_modified', side: 'allied' }, noOwner, 'c1', 0)).toBe(true);
  });
});
