import { describe, expect, it } from 'vitest';
import { deckInterSynergy, pairSynergy } from '../../src/balance/synergy.js';
import { interactionWeight } from '../../src/balance/interaction-matrix.js';
import { heroDemands } from '../../src/balance/signals.js';
import type { Demand, ProvideKind, Signal, WantKind } from '../../src/balance/types.js';
import { fixed, triggered } from './factory.js';

const sig = (kind: ProvideKind, weight: number, tag?: string): Signal => ({
  kind,
  weight,
  tag,
  source: 's',
});
const dem = (kind: WantKind, weight: number, tag?: string): Demand => ({
  kind,
  weight,
  tag,
  source: 'd',
});

describe('synergy', () => {
  it('tribal tag synergy requires tag equality', () => {
    expect(pairSynergy([sig('tag', 1, 'Undead')], [dem('tag_tribal', 2, 'Undead')])).toBeCloseTo(
      0.9,
    );
    expect(pairSynergy([sig('tag', 1, 'Undead')], [dem('tag_tribal', 2, 'Construct')])).toBe(0);
  });

  it('removal and reach are zero-row providers (the double-count guard)', () => {
    expect(interactionWeight('removal', 'wide_to_sacrifice')).toBe(0);
    expect(interactionWeight('reach', 'bodies_to_buff')).toBe(0);
    expect(pairSynergy([sig('removal', 5)], [dem('wide_to_sacrifice', 5)])).toBe(0);
  });

  it('an Undead death-trigger hero is fed by Undead deaths, not Construct', () => {
    const kael = heroDemands({
      id: 1,
      name: 'Kael',
      lp: 25,
      alignment: ['Onyx'],
      abilities: [
        triggered({ type: 'on_ally_destroyed', filter: { tag: 'Undead' } }, [
          { type: 'deal_damage', amount: fixed(1), target: { type: 'hero', side: 'enemy' } },
        ]),
      ],
    });
    expect(kael.some((d) => d.kind === 'death_of_tag' && d.tag === 'Undead')).toBe(true);
    expect(pairSynergy([sig('death_trigger', 3, 'Undead')], kael)).toBeGreaterThan(0);
    expect(pairSynergy([sig('death_trigger', 3, 'Construct')], kael)).toBe(0);
  });

  it('saturates a lone outlet fed by many redundant partners (throughput)', () => {
    const outlet = {
      id: 0,
      name: 'Outlet',
      copies: 3,
      provides: [],
      demands: [dem('wide_to_sacrifice', 2)],
    };
    const fodder = (k: number) => ({
      id: k,
      name: `F${String(k)}`,
      copies: 3,
      provides: [sig('wide_bodies', 2)],
      demands: [],
    });
    const big = 1_000_000; // keep the global cap far away — isolate saturation
    const two = deckInterSynergy([outlet, fodder(1), fodder(2)], big);
    const eight = deckInterSynergy([outlet, ...[1, 2, 3, 4, 5, 6, 7, 8].map(fodder)], big);
    expect(eight.raw).toBeGreaterThan(two.raw); // more fodder still helps a bit
    expect(eight.raw).toBeLessThan(two.raw * 2); // but 4× the fodder yields under 2× — saturated
  });

  it('caps a runaway pair at PAIR_CAP and globally', () => {
    const a = { id: 1, name: 'A', copies: 3, provides: [sig('tag', 50, 'X')], demands: [] };
    const b = { id: 2, name: 'B', copies: 3, provides: [], demands: [dem('tag_tribal', 50, 'X')] };
    const r = deckInterSynergy([a, b], 100);
    expect(r.raw).toBeLessThanOrEqual(4); // PAIR_CAP
    expect(r.capped).toBeLessThanOrEqual(40); // 0.4 * cardPowerSum
  });
});
