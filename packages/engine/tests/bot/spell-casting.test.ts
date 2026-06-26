/**
 * Spell-casting policy — proves the heuristic bot (1) chooses a cast_spell action
 * for a worthwhile spell, (2) prioritizes proactive removal against a real enemy
 * threat, (3) resolves the spell's effect through executePlayerAction, and
 * (4) is deterministic. Guards the systemic "spells are live for the bot" lever.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { chooseAction } from '../../src/bot/heuristic.js';
import { scoreSpell } from '../../src/bot/spell-eval.js';
import { executePlayerAction } from '../../src/state-machine/actions.js';
import {
  mockCard,
  mockGameState,
  mockPlayerState,
  zonesWithCards,
  resetInstanceCounter,
} from '../helpers/card-factory.js';
import type { AbilityDSL } from '../../src/types/ability.js';
import type { ResourceCard, CardInstance, GameState } from '../../src/types/game-state.js';

function manaBank(n: number): ResourceCard[] {
  return Array.from({ length: n }, (_, i) => ({
    instanceId: `res_${String(i)}`,
    resourceType: 'mana' as const,
    exhausted: false,
  }));
}

const DESTROY_ENEMY: readonly AbilityDSL[] = [
  {
    type: 'triggered',
    trigger: { type: 'on_deploy' },
    effects: [{ type: 'destroy', target: { type: 'target_character', side: 'enemy' } }],
  },
];

function removalSpell(): CardInstance {
  return mockCard({
    instanceId: 'REMOVAL',
    cardType: 'S',
    name: 'Banish',
    cost: { mana: 2, energy: 0, flexible: 0 },
    abilities: DESTROY_ENEMY,
  });
}

function findCard(state: GameState, id: string): CardInstance | null {
  for (const p of state.players)
    for (const zone of [p.zones.reserve, p.zones.frontline, p.zones.highGround])
      for (const c of zone) if (c && c.instanceId === id) return c;
  return null;
}

describe('heuristic bot — cast_spell', () => {
  beforeEach(() => resetInstanceCounter());

  function scenario(): GameState {
    const bigThreat = mockCard({
      instanceId: 'THREAT', owner: 1, currentAtk: 5, currentHp: 5, baseAtk: 5, baseHp: 5,
    });
    const p0 = mockPlayerState(0, { hand: [removalSpell()], resourceBank: manaBank(4) });
    const p1 = mockPlayerState(1, { zones: zonesWithCards({ frontline: [bigThreat, null, null] }) });
    return mockGameState({ phase: 'strategy', players: [p0, p1] });
  }

  it('casts a removal spell on the biggest enemy threat', () => {
    const action = chooseAction(scenario());
    expect(action).not.toBeNull();
    expect(action!.type).toBe('cast_spell');
    expect((action as { cardInstanceId: string }).cardInstanceId).toBe('REMOVAL');
  });

  it('resolves the spell — the targeted enemy is destroyed', () => {
    const state = scenario();
    const action = chooseAction(state)!;
    const result = executePlayerAction(state, action);
    expect(findCard(result.state, 'THREAT')).toBeNull();
    expect(result.state.players[0].discardPile.some(c => c.instanceId === 'REMOVAL')).toBe(true);
  });

  it('is deterministic — identical state yields the identical action', () => {
    const a = chooseAction(scenario());
    const b = chooseAction(scenario());
    expect(a).toEqual(b);
  });

  it('does not waste removal when there is no worthwhile enemy threat', () => {
    const p0 = mockPlayerState(0, { hand: [removalSpell()], resourceBank: manaBank(4) });
    const state = mockGameState({ phase: 'strategy', players: [p0, mockPlayerState(1)] });
    // No enemy body: destroy auto-resolves to nothing, so the spell scores 0 and
    // the bot should not cast it (ends the phase instead).
    expect(chooseAction(state)).toBeNull();
  });
});

// ── Target-aware casting ──────────────────────────────────────────────────────

// Regrowth: sacrifice an allied character to draw a card. The draw gives the
// spell positive value so the bot will cast it; the sacrifice must aim the chump.
const SACRIFICE_ALLY: readonly AbilityDSL[] = [
  {
    type: 'triggered',
    trigger: { type: 'on_deploy' },
    effects: [
      { type: 'sacrifice', target: { type: 'target_character', side: 'allied' } },
      { type: 'draw_cards', player: 'allied', count: { type: 'fixed', value: 1 } },
    ],
  },
];

function sacrificeSpell(): CardInstance {
  return mockCard({
    instanceId: 'SACRIFICE',
    cardType: 'S',
    name: 'Regrowth',
    cost: { mana: 1, energy: 0, flexible: 0 },
    abilities: SACRIFICE_ALLY,
  });
}

describe('target-aware spell casting', () => {
  beforeEach(() => resetInstanceCounter());

  it('a chosen target resolves to THAT target, not front-of-zone', () => {
    const weak = mockCard({ instanceId: 'WEAK', currentAtk: 0, currentHp: 1, baseAtk: 0, baseHp: 1 });
    const strong = mockCard({ instanceId: 'STRONG', currentAtk: 6, currentHp: 6, baseAtk: 6, baseHp: 6 });
    // Front-of-zone (reserve, slot 0) is the STRONG body; aim past it at WEAK.
    const p0 = mockPlayerState(0, {
      hand: [sacrificeSpell()],
      resourceBank: manaBank(2),
      zones: zonesWithCards({ reserve: [strong, weak] }),
    });
    const state = mockGameState({ phase: 'strategy', players: [p0, mockPlayerState(1)] });
    const result = executePlayerAction(state, {
      type: 'cast_spell',
      cardInstanceId: 'SACRIFICE',
      selectedTargetIds: ['WEAK'],
    });
    expect(findCard(result.state, 'WEAK')).toBeNull(); // chosen target sacrificed
    expect(findCard(result.state, 'STRONG')).not.toBeNull(); // front-of-zone untouched
  });

  it('bot picks the WEAKEST own body for an ally-sacrifice spell', () => {
    const weak = mockCard({ instanceId: 'WEAK', currentAtk: 0, currentHp: 1, baseAtk: 0, baseHp: 1 });
    const strong = mockCard({ instanceId: 'STRONG', currentAtk: 6, currentHp: 6, baseAtk: 6, baseHp: 6 });
    const p0 = mockPlayerState(0, {
      hand: [sacrificeSpell()],
      resourceBank: manaBank(2),
      zones: zonesWithCards({ reserve: [strong, weak] }),
    });
    const state = mockGameState({ phase: 'strategy', players: [p0, mockPlayerState(1)] });
    const action = chooseAction(state)!;
    expect(action.type).toBe('cast_spell');
    expect((action as { selectedTargetIds?: readonly string[] }).selectedTargetIds).toEqual(['WEAK']);

    // And resolving it actually loses the weak chump, keeping the strong body.
    const result = executePlayerAction(state, action);
    expect(findCard(result.state, 'WEAK')).toBeNull();
    expect(findCard(result.state, 'STRONG')).not.toBeNull();
  });
});

// ── Verdant ramp / upgrade valuation + noAlly guard ────────────────────────────

// Rampant Evolution: destroy an allied character, then deploy a bigger body from
// deck (the upgrade engine). The destroyed chump is a cost, the deploy is value.
const RAMPANT_EVOLUTION: readonly AbilityDSL[] = [
  {
    type: 'triggered',
    trigger: { type: 'on_deploy' },
    effects: [
      { type: 'destroy', target: { type: 'target_character', side: 'allied' } },
      { type: 'deploy_from_deck', filter: { cardType: 'C' } },
    ],
  },
];

function rampantSpell(): CardInstance {
  return mockCard({
    instanceId: 'RAMPANT', cardType: 'S', name: 'Rampant Evolution',
    cost: { mana: 1, energy: 0, flexible: 0 }, abilities: RAMPANT_EVOLUTION,
  });
}

describe('Verdant ramp valuation + noAlly guard', () => {
  beforeEach(() => resetInstanceCounter());

  it('values Rampant Evolution (upgrade) positively when an ally is on board', () => {
    const chump = mockCard({ instanceId: 'CHUMP', currentAtk: 2, currentHp: 2, baseAtk: 2, baseHp: 2 });
    const caster = mockPlayerState(0, { zones: zonesWithCards({ frontline: [chump, null, null] }) });
    const opp = mockPlayerState(1);
    // destroy(allied) is a sunk cost (-0.4) but deploy_from_deck (+4) dominates.
    const score = scoreSpell(caster, opp, rampantSpell(), 0);
    expect(score.value).toBeGreaterThan(1);
  });

  it('values the upgrade engine far above a vanilla cantrip spell', () => {
    const chump = mockCard({ instanceId: 'CHUMP', currentAtk: 2, currentHp: 2, baseAtk: 2, baseHp: 2 });
    const caster = mockPlayerState(0, { zones: zonesWithCards({ frontline: [chump, null, null] }) });
    const opp = mockPlayerState(1);
    expect(scoreSpell(caster, opp, rampantSpell(), 0).value).toBeGreaterThan(3);
  });

  it('noAlly guard: never casts an ally-destroy spell with no eligible body', () => {
    // Empty board: the ramp spell scores deeply negative, so the bot ends the
    // phase instead of casting into thin air.
    const p0 = mockPlayerState(0, { hand: [rampantSpell()], resourceBank: manaBank(2) });
    const state = mockGameState({ phase: 'strategy', players: [p0, mockPlayerState(1)] });
    expect(chooseAction(state)).toBeNull();
  });

  it('noAlly guard scores the ramp spell below the cast threshold with no ally', () => {
    const caster = mockPlayerState(0); // no bodies
    const score = scoreSpell(caster, mockPlayerState(1), rampantSpell(), 0);
    expect(score.value).toBeLessThan(0);
  });
});
