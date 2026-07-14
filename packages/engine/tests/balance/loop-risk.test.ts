/**
 * §S4 — loop-risk veto graph regression tests. No simulations: pure DSL
 * analysis, anchored to the Arcane Echoes / Master Archivist catastrophe
 * (2026-07-13/14 investigation — see scratchpad/task-12-brief.md).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { assessLoopRisk } from '../../src/balance/loop-graph.js';
import type { Effect } from '../../src/types/effects.js';
import type { StaticCard } from '../../src/balance/types.js';
import { normalizeTraits } from '../../src/setup/trait-normalizer.js';
import { card, triggered, body } from './factory.js';

const onCast = { type: 'on_cast' } as const;
const onDeploy = { type: 'on_deploy' } as const;

// ── Item 1: Arcane-Echoes-shaped self-copy ───────────────────────────────────

/** Mirrors the real Arcane Echoes (id94): on_cast copy_card, filter matches
 * ITSELF (tag Arcane, cardType S) — no excludeSelf in the real card either. */
function echoesShaped(cost: number): StaticCard {
  const selfCopy: Effect = {
    type: 'copy_card',
    source: 'discard',
    destination: 'hand',
    filter: { tag: 'Arcane', cardType: 'S' },
  };
  return card({
    id: 94,
    name: 'Echoes-shaped',
    cardType: 'S',
    tags: ['Arcane'],
    cost: { mana: cost, energy: 0, flexible: 0 },
    abilities: [triggered(onCast, [selfCopy])],
  });
}

describe('loop-risk — Arcane Echoes self-copy (item 1)', () => {
  it('is a self-loop: net cost = effective cost (5), no resource generation — not likely', () => {
    // Arithmetic: distinct members = {94}, costSum = effectiveCost(5) = 5,
    // gainSum = 0 (no gain_resource effect) -> net = 5. net > 2 and cost > 1,
    // so neither the net<=2 'possible' rule nor the cost<=1 self-loop 'likely'
    // override fires -> 'none'. 'none' satisfies "possible at most".
    const risk = assessLoopRisk([echoesShaped(5)]);
    expect(risk.get(94)).toBe('none');
  });

  it('is likely at cost 1 — direct unthrottled self-copy at cost <=1', () => {
    // Arithmetic: a genuine self-loop (the card's own copy_card filter matches
    // itself) with effective cost <=1 is classified 'likely' regardless of the
    // net-cost sum — bounded only by discard/deck supply at that price, the
    // exact failed-patch shape (Echoes cut 5->1).
    const risk = assessLoopRisk([echoesShaped(1)]);
    expect(risk.get(94)).toBe('likely');
  });

  it('cost sensitivity: cost 3 (net=3, >2) is none; cost 2 (net=2, <=2) is possible', () => {
    expect(assessLoopRisk([echoesShaped(3)]).get(94)).toBe('none');
    expect(assessLoopRisk([echoesShaped(2)]).get(94)).toBe('possible');
  });
});

// ── Item 2: Master Archivist castFreeIfCost chain ────────────────────────────

/** Mirrors the real Master Archivist (id141): on_deploy search_deck, filter
 * {tag Arcane, cardType S}, castFreeIfCost:1. */
function archivistShaped(cost: number): StaticCard {
  const fetch: Effect = {
    type: 'search_deck',
    filter: { tag: 'Arcane', cardType: 'S' },
    destination: 'hand',
    castFreeIfCost: 1,
  };
  return card({
    id: 141,
    name: 'Archivist-shaped',
    cardType: 'C',
    stats: { atk: 2, hp: 5, arm: 0 },
    cost: { mana: cost, energy: 0, flexible: 0 },
    abilities: [triggered(onDeploy, [fetch])],
  });
}

/** A 1-cost Arcane spell that self-copies (Echoes-shaped at cost 1) — the
 * fetch target Archivist's search_deck can find and free-cast. */
const oneCostArcaneSpell = echoesShaped(1);

describe('loop-risk — Master Archivist castFreeIfCost chain (item 2)', () => {
  it("propagates the fetched self-copy loop's risk back to Archivist", () => {
    // Arithmetic: the 1-cost Arcane spell is its own self-loop at effective
    // cost 1 <=1 -> 'likely' (item-1 rule). Archivist's search_deck edge has
    // castFreeIfCost:1 and the target's effective cost (1) <= 1, so the free
    // cast covers it entirely: Archivist inherits the target's 'likely' via
    // backward feeder propagation (the exact real-world mechanism — deploying
    // Archivist drops the free-cast chain straight into the Echoes loop).
    const risk = assessLoopRisk([archivistShaped(6), oneCostArcaneSpell]);
    expect(risk.get(141)).toBe('likely');
    expect(risk.get(94)).toBe('likely');
  });

  it('does not propagate when the fetched target is well outside the free-cast threshold', () => {
    // Arithmetic: at live cost (5), the fetched spell's effective cost (5) is
    // neither <= the castFreeIfCost threshold (1) nor within 1 of it
    // (|5-1|=4) -> no propagation, no 'possible' bump either -> Archivist
    // stays 'none' (its own on_deploy is one-shot, not itself a cycle).
    const risk = assessLoopRisk([archivistShaped(6), echoesShaped(5)]);
    expect(risk.get(141)).toBe('none');
  });
});

// ── Item 3: no false-positive explosion ──────────────────────────────────────

describe('loop-risk — no false positives on plain cards', () => {
  it('is none for a plain draw spell and vanilla bodies', () => {
    const drawSpell = card({
      id: 200,
      name: 'Plain Draw',
      cardType: 'S',
      cost: { mana: 2, energy: 0, flexible: 0 },
      abilities: [
        triggered(onCast, [
          { type: 'draw_cards', count: { type: 'fixed', value: 2 }, player: 'allied' },
        ]),
      ],
    });
    const bodyA = body(201, 'Vanilla A', 3, 3);
    const bodyB = body(202, 'Vanilla B', 2, 4, 1);
    const risk = assessLoopRisk([drawSpell, bodyA, bodyB]);
    expect(risk.get(200)).toBe('none');
    expect(risk.get(201)).toBe('none');
    expect(risk.get(202)).toBe('none');
  });

  it('produces ZERO "likely" over the four starter decks\' live pool (possible entries printed for the record)', () => {
    const raw = JSON.parse(
      readFileSync(new URL('../../sim-data/aetherion-cards.json', import.meta.url), 'utf8'),
    ) as ReadonlyArray<{
      readonly id: number;
      readonly name: string;
      readonly cardType: string;
      readonly cost?: { mana?: number; energy?: number; flexible?: number };
      readonly stats?: { hp?: number; atk?: number; arm?: number } | null;
      readonly traits?: readonly string[];
      readonly tags?: readonly string[];
      readonly alignment?: readonly string[];
      readonly abilities?: ReadonlyArray<{ dsl?: unknown }>;
    }>;
    const decks = JSON.parse(
      readFileSync(new URL('../../sim-data/aetherion-decks.json', import.meta.url), 'utf8'),
    ) as ReadonlyArray<{ readonly mainDeckDefIds: readonly number[] }>;

    const liveIds = new Set<number>();
    for (const deck of decks) for (const id of deck.mainDeckDefIds) liveIds.add(id);

    const pool: StaticCard[] = raw
      .filter(
        (c) =>
          liveIds.has(c.id) && (c.cardType === 'C' || c.cardType === 'S' || c.cardType === 'E'),
      )
      .map((c) => {
        const norm = normalizeTraits(c.traits);
        return {
          id: c.id,
          name: c.name,
          cardType: c.cardType as StaticCard['cardType'],
          cost: {
            mana: c.cost?.mana ?? 0,
            energy: c.cost?.energy ?? 0,
            flexible: c.cost?.flexible ?? 0,
          },
          stats: c.stats
            ? { hp: c.stats.hp ?? 0, atk: c.stats.atk ?? 0, arm: c.stats.arm ?? 0 }
            : null,
          traits: norm.traits,
          tags: c.tags ?? [],
          // Trust boundary: authored DSL JSON -> AbilityDSL, as sim-runner.mjs
          // / balance-data.mjs already do for every other balance harness.
          abilities: (c.abilities ?? [])
            .map((a) => a.dsl)
            .filter(Boolean) as StaticCard['abilities'],
          alignment: c.alignment ?? [],
        };
      });

    const risk = assessLoopRisk(pool);
    const likely = pool.filter((c) => risk.get(c.id) === 'likely');
    const possible = pool.filter((c) => risk.get(c.id) === 'possible');
    // eslint-disable-next-line no-console
    console.log(
      '[loop-risk] live-pool possible entries:',
      possible.map((c) => `${String(c.id)} ${c.name}`),
    );
    expect(likely).toHaveLength(0);
  });
});
