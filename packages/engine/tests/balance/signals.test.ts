import { describe, expect, it } from 'vitest';
import { emitDemands, emitSignals } from '../../src/balance/signals.js';
import { aura, body, card, fixed, selfTarget, triggered } from './factory.js';

describe('emitSignals / emitDemands', () => {
  it('a Defender + self-heal offers wall (trait) and sustain (ability) from different sources', () => {
    const heal = triggered({ type: 'on_block' }, [
      { type: 'heal', amount: fixed(1), target: selfTarget },
    ]);
    const c = body(1, 'Guardian', 1, 2, 0, { traits: ['defender'], abilities: [heal] });
    const provides = emitSignals(c);
    const wall = provides.find((p) => p.kind === 'wall');
    const sustain = provides.find((p) => p.kind === 'sustain');
    expect(wall).toBeDefined();
    expect(sustain).toBeDefined();
    expect(wall?.source).not.toBe(sustain?.source);
    expect(emitDemands(c).some((d) => d.kind === 'wall_to_sustain')).toBe(true);
  });

  it('a tagged body offers tag + death_trigger for its tag', () => {
    const provides = emitSignals(body(2, 'Zombie', 2, 2, 0, { tags: ['Undead'] }));
    expect(provides.some((p) => p.kind === 'tag' && p.tag === 'Undead')).toBe(true);
    expect(provides.some((p) => p.kind === 'death_trigger' && p.tag === 'Undead')).toBe(true);
  });

  it('a spell offers spell_cast; equipment offers equipment and wants a body', () => {
    expect(
      emitSignals(card({ id: 3, name: 'Bolt', cardType: 'S' })).some(
        (p) => p.kind === 'spell_cast',
      ),
    ).toBe(true);
    const equip = card({ id: 4, name: 'Sword', cardType: 'E' });
    expect(emitSignals(equip).some((p) => p.kind === 'equipment')).toBe(true);
    expect(emitDemands(equip).some((d) => d.kind === 'attach_target')).toBe(true);
  });

  it('a tribal anthem wants tag_tribal for its tag filter', () => {
    const anthem = aura([
      {
        type: 'modify_stats',
        modifier: { atk: 1 },
        target: { type: 'all_characters', side: 'allied', filter: { tag: 'Construct' } },
        duration: { type: 'permanent' },
      },
    ]);
    const c = body(5, 'Overlord', 2, 2, 0, { abilities: [anthem] });
    expect(emitDemands(c).some((d) => d.kind === 'tag_tribal' && d.tag === 'Construct')).toBe(true);
  });
});
