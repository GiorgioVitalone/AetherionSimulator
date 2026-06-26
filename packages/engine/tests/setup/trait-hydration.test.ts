/**
 * Integration: Title-Case authored traits hydrated via createGame must flow as
 * lowercase snake_case into the engine's gating (targeting / combat / summoning
 * sickness). This is the Wave-1 (Gap A1) regression guard — the real card DB
 * stores "Defender" / "Flying" / "Haste" / "First Strike" / "Sniper" /
 * "Regeneration N", and every gate compares lowercase.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  createGame,
  resetSetupInstanceCounter,
} from '../../src/setup/game-setup.js';
import type {
  CardDefinition,
  HeroDefinition,
  CardDefinitionRegistry,
} from '../../src/setup/game-setup.js';
import type { CardInstance } from '../../src/types/game-state.js';
import { getValidAttackTargets } from '../../src/zones/targeting.js';
import { calculateCombatDamage } from '../../src/combat/damage-calculator.js';
import { zonesWithCards } from '../helpers/card-factory.js';

const RESOURCE_IDS = Array.from({ length: 15 }, (_, i) => i + 101);

function traitCard(id: number, traits: readonly string[]): CardDefinition {
  return {
    id,
    name: `Trait Card ${String(id)}`,
    cardType: 'C',
    cost: { mana: 1, energy: 0, flexible: 0 },
    stats: { hp: 4, atk: 3, arm: 0 },
    traits,
    tags: [],
    alignment: ['Radiant'],
  };
}

function hero(id: number): HeroDefinition {
  return { id, name: `Hero ${String(id)}`, lp: 25, alignment: ['Radiant'] };
}

/** Build a registry mapping ids 1..N to the given Title-Case trait defs. */
function registryFor(defs: readonly CardDefinition[]): CardDefinitionRegistry {
  const cards = new Map<number, CardDefinition>();
  for (const d of defs) cards.set(d.id, d);
  for (const rid of RESOURCE_IDS) {
    cards.set(rid, {
      id: rid,
      name: `Mana Crystal ${String(rid)}`,
      cardType: 'R',
      cost: { mana: 0, energy: 0, flexible: 0 },
    });
  }
  const heroes = new Map([
    [200, hero(200)],
    [201, hero(201)],
  ]);
  return { getCard: id => cards.get(id), getHero: id => heroes.get(id) };
}

/** Hydrate one game and return every non-resource card instance hydrated. */
function hydrate(defs: readonly CardDefinition[]): readonly CardInstance[] {
  resetSetupInstanceCounter();
  const ids = defs.map(d => d.id);
  const state = createGame(
    { heroDefId: 200, mainDeckDefIds: ids, resourceDeckDefIds: RESOURCE_IDS },
    { heroDefId: 201, mainDeckDefIds: ids, resourceDeckDefIds: RESOURCE_IDS },
    registryFor(defs),
    7,
  );
  const p = state.players[0]!;
  return [...p.hand, ...p.mainDeck];
}

function findCard(cards: readonly CardInstance[], defId: number): CardInstance {
  const c = cards.find(x => x.cardDefId === defId);
  if (c === undefined) throw new Error(`card ${String(defId)} not hydrated`);
  return c;
}

describe('Title-Case trait hydration → engine gating', () => {
  beforeEach(() => {
    resetSetupInstanceCounter();
  });

  it('normalizes traits to lowercase snake_case on the instance', () => {
    const cards = hydrate([traitCard(1, ['Defender', 'First Strike'])]);
    expect(findCard(cards, 1).traits).toEqual(['defender', 'first_strike']);
  });

  it('Defender (Title-Case) now FORCES attackers to target it', () => {
    const cards = hydrate([traitCard(1, ['Defender']), traitCard(2, [])]);
    const defender = findCard(cards, 1);
    const plain = findCard(cards, 2);
    const zones = zonesWithCards({ frontline: [defender, plain, null] });

    const targets = getValidAttackTargets('frontline', [], zones);

    expect(targets).toHaveLength(1);
    expect(targets[0]).toEqual({ type: 'character', instanceId: defender.instanceId });
  });

  it('Flying (Title-Case) now bypasses a non-flying Defender wall', () => {
    const cards = hydrate([traitCard(1, ['Defender']), traitCard(2, ['Flying'])]);
    const defender = findCard(cards, 1);
    const flyer = findCard(cards, 2);
    const zones = zonesWithCards({ frontline: [defender, flyer, null] });

    // Attacker carries the hydrated Flying trait → should reach the flyer too.
    const targets = getValidAttackTargets('high_ground', flyer.traits, zones);
    const ids = targets.map(t => t.instanceId);

    expect(ids).toContain(flyer.instanceId);
    expect(ids).toContain(defender.instanceId);
  });

  it('Sniper (Title-Case) now lets a Reserve attacker hit the Frontline', () => {
    const cards = hydrate([traitCard(1, ['Sniper']), traitCard(2, [])]);
    const sniper = findCard(cards, 1);
    const target = findCard(cards, 2);
    const zones = zonesWithCards({ frontline: [target, null, null] });

    const targets = getValidAttackTargets('reserve', sniper.traits, zones);

    expect(targets).toHaveLength(1);
    expect(targets[0]?.instanceId).toBe(target.instanceId);
  });

  it('First Strike (Title-Case) now alters combat ordering', () => {
    const cards = hydrate([traitCard(1, ['First Strike'])]);
    const fs = findCard(cards, 1);

    // 3 ATK kills a 3-HP defender; First Strike => no counter-damage taken.
    const result = calculateCombatDamage(
      3, 0, 4,
      3, 0, 3,
      fs.traits,
      [],
    );
    expect(result.defenderDestroyed).toBe(true);
    expect(result.damageToAttacker).toBe(0);
  });

  it('Haste (Title-Case) hydrates so a deployed character is not summoning-sick', () => {
    // actions.ts sets summoningSick = !card.traits.includes('haste'); proving the
    // hydrated lowercase 'haste' satisfies that gate.
    const cards = hydrate([traitCard(1, ['Haste'])]);
    expect(findCard(cards, 1).traits.includes('haste')).toBe(true);
  });

  it('Regeneration N (Title-Case) hydrates as a regeneration status, not a trait', () => {
    const cards = hydrate([traitCard(1, ['Regeneration 2'])]);
    const c = findCard(cards, 1);
    expect(c.traits).toEqual([]);
    expect(c.statusEffects).toEqual([
      { statusType: 'regeneration', value: 2, remainingTurns: null },
    ]);
  });
});
