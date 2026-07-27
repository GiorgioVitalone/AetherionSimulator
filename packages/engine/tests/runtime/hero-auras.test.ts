/**
 * BUG FIX regression (config.heroAuras): `collectAuraSources` only scanned
 * battlefield zone cards (+ attached equipment) — a Hero/Transformed-Hero
 * `aura` ability (e.g. Seraphina's Holy Ward, Lyria's Knowledge Shield,
 * Lyria-T's Supreme Intellect) was silently inert. These tests exercise the
 * PRODUCTION path — recomputeAuras against a mock Hero — and never register
 * anything directly (that would mask the bug).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { recomputeAuras } from '../../src/runtime/aura-recompute.js';
import { canAfford, effectiveCost } from '../../src/actions/cost-checker.js';
import {
  mockCard,
  mockHero,
  mockGameState,
  mockPlayerState,
  zonesWithCards,
  resetInstanceCounter,
} from '../helpers/card-factory.js';
import type { AbilityDSL } from '../../src/types/ability.js';
import type { GameConfig } from '../../src/types/game-state.js';

// Arcanist Lyria's "Knowledge Shield": while hand size >= 5, allied characters
// gain +1 HP.
const knowledgeShield: AbilityDSL = {
  type: 'aura',
  effects: [
    {
      type: 'modify_stats',
      target: { type: 'all_characters', side: 'allied' },
      duration: { type: 'while_in_play' },
      modifier: { hp: 1 },
    },
  ],
  condition: { type: 'card_count', zone: 'hand', value: 5, comparison: 'greater_equal' },
};

// Shieldbearer Seraphina's "Holy Ward" (also Lyria-T's Supreme Intellect cost
// half): first Equipment played each turn costs 1 less.
const holyWard: AbilityDSL = {
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

// Lyria-T's "Supreme Intellect": first spell costs 1 less AND grants itself an
// on_spell_cast trigger that draws a card on the second spell cast in a turn.
const supremeIntellect: AbilityDSL = {
  type: 'aura',
  effects: [
    {
      type: 'cost_reduction',
      duration: { type: 'while_in_play' },
      appliesTo: { cardType: 'S', firstPerTurn: true },
      reduction: 1,
    },
    {
      type: 'grant_ability',
      target: { type: 'hero', side: 'allied' },
      duration: { type: 'while_in_play' },
      ability: {
        trigger: { type: 'on_spell_cast', side: 'allied' },
        effects: [{ type: 'draw_cards', count: { type: 'fixed', value: 1 }, player: 'allied' }],
      },
    },
  ],
};

describe('recomputeAuras — hero aura sources (config.heroAuras)', () => {
  beforeEach(() => resetInstanceCounter());

  it('OFF (default/absent): a Hero aura is never collected — no modifier, no cost reduction', () => {
    const hero = mockHero({ abilities: [knowledgeShield] });
    const ally = mockCard({ owner: 0, name: 'Knight', currentHp: 3, baseHp: 3 });
    const state = mockGameState({
      players: [
        mockPlayerState(0, {
          hero,
          zones: zonesWithCards({ frontline: [ally, null, null] }),
          hand: deck(5),
        }),
        mockPlayerState(1),
      ],
    });

    const recomputed = recomputeAuras(state);
    const buffed = recomputed.players[0].zones.frontline[0]!;
    expect(buffed.currentHp).toBe(3); // no +1 HP — hero aura never ran
    expect(buffed.modifiers.filter((m) => m.id.startsWith('aura_'))).toHaveLength(0);
  });

  it('ON: Knowledge Shield buffs allied characters while hand size >= 5, and stops when it drops', () => {
    const hero = mockHero({ abilities: [knowledgeShield] });
    const ally = mockCard({ owner: 0, name: 'Knight', currentHp: 3, baseHp: 3 });
    const config: GameConfig = { terminationMode: 'turn_cap', heroAuras: true };

    const withCondition = mockGameState({
      config,
      players: [
        mockPlayerState(0, {
          hero,
          zones: zonesWithCards({ frontline: [ally, null, null] }),
          hand: deck(5),
        }),
        mockPlayerState(1),
      ],
    });
    const buffed = recomputeAuras(withCondition).players[0].zones.frontline[0]!;
    expect(buffed.currentHp).toBe(4); // base 3 + hero aura's +1 HP
    expect(buffed.modifiers.some((m) => m.id.startsWith('aura_'))).toBe(true);

    const withoutCondition = mockGameState({
      config,
      players: [
        mockPlayerState(0, {
          hero,
          zones: zonesWithCards({ frontline: [ally, null, null] }),
          hand: deck(2),
        }),
        mockPlayerState(1),
      ],
    });
    const notBuffed = recomputeAuras(withoutCondition).players[0].zones.frontline[0]!;
    expect(notBuffed.currentHp).toBe(3); // condition unmet — no buff
    expect(notBuffed.modifiers.filter((m) => m.id.startsWith('aura_'))).toHaveLength(0);
  });

  it('ON: Holy Ward (hero cost_reduction) makes an otherwise-unaffordable Equipment affordable', () => {
    const hero = mockHero({ abilities: [holyWard] });
    const equip = mockCard({
      owner: 0,
      name: 'Sturdy Buckler',
      cardType: 'E',
      cost: { mana: 0, energy: 2, flexible: 0 },
    });
    const player = mockPlayerState(0, { hero, resourceBank: [] });
    const state = mockGameState({
      config: { terminationMode: 'turn_cap', heroAuras: true },
      players: [player, mockPlayerState(1)],
    });

    // Sanity: without recompute, no reduction is registered.
    expect(effectiveCost(player, equip).energy).toBe(2);

    const recomputed = recomputeAuras(state);
    const reduced = recomputed.players[0];
    expect(reduced.costReductions ?? []).toHaveLength(1);
    expect(reduced.costReductions![0]!.id.startsWith('aura_')).toBe(true);
    expect(effectiveCost(reduced, equip).energy).toBe(1);
  });

  it('ON: Supreme Intellect grants the hero the on_spell_cast draw trigger', () => {
    const hero = mockHero({ cardDefId: 74, abilities: [supremeIntellect] });
    const state = mockGameState({
      config: { terminationMode: 'turn_cap', heroAuras: true },
      players: [mockPlayerState(0, { hero }), mockPlayerState(1)],
    });

    const recomputed = recomputeAuras(state);
    const registered = recomputed.players[0].hero.registeredTriggers;
    expect(registered).toHaveLength(1);
    expect(registered[0]!.trigger.type).toBe('on_spell_cast');
    expect(registered[0]!.id.startsWith('aura_')).toBe(true);
    expect(registered[0]!.ownerPlayerId).toBe(0);

    // Also registers the cost reduction from the same aura's other effect.
    expect(recomputed.players[0].costReductions ?? []).toHaveLength(1);
  });

  it('ON: a re-recompute does not duplicate the granted hero trigger (strip-and-rebuild)', () => {
    const hero = mockHero({ cardDefId: 74, abilities: [supremeIntellect] });
    const state = mockGameState({
      config: { terminationMode: 'turn_cap', heroAuras: true },
      players: [mockPlayerState(0, { hero }), mockPlayerState(1)],
    });

    const once = recomputeAuras(state);
    const twice = recomputeAuras(once);
    expect(twice.players[0].hero.registeredTriggers).toHaveLength(1);
  });

  it('is deterministic', () => {
    const build = (): ReturnType<typeof recomputeAuras> => {
      resetInstanceCounter();
      const hero = mockHero({ cardDefId: 74, abilities: [supremeIntellect] });
      return recomputeAuras(
        mockGameState({
          config: { terminationMode: 'turn_cap', heroAuras: true },
          players: [mockPlayerState(0, { hero }), mockPlayerState(1)],
        }),
      );
    };
    expect(JSON.stringify(build())).toBe(JSON.stringify(build()));
  });
});

function deck(n: number): ReturnType<typeof mockCard>[] {
  return Array.from({ length: n }, () => mockCard({ name: 'Hand Card', owner: 0 }));
}

// ── runSim: byte-identical no-op + deterministic divergence ──────────────────
const here = dirname(fileURLToPath(import.meta.url));
const runnerPath = resolve(here, '../../sim-runner.mjs');
const distPath = join(here, '..', '..', 'dist', 'index.js');
const cardsPath = new URL('../../sim-data/aetherion-cards.json', import.meta.url);
const simReady = existsSync(runnerPath) && existsSync(distPath) && existsSync(cardsPath);
const ds = simReady ? describe : describe.skip;

ds('heroAuras (runSim)', () => {
  it('absent/false ⇒ baseline runHash; true ⇒ deterministic divergence', async () => {
    const { runSim } = (await import(runnerPath)) as {
      runSim: (c: unknown) => { runHash: string };
    };
    const base = {
      rulesProfile: 'legacy-v1',
      matchups: 'all-pairs',
      gamesPerPairing: 3,
      seedBase: 4242,
      abilitiesOn: true,
    } as const;
    const off = runSim(base).runHash;

    expect(runSim({ ...base, heroAuras: false }).runHash).toBe(off);

    const on = runSim({ ...base, heroAuras: true }).runHash;
    expect(on).not.toBe(off);
    expect(runSim({ ...base, heroAuras: true }).runHash).toBe(on);
  }, 30000);
});
