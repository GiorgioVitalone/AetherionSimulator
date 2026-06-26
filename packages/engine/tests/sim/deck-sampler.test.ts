/**
 * Tests for the seeded faction-deck sampler (deck-sampler.mjs).
 *
 * Verifies the WS-C contract: every sampled deck is LEGAL, the sample is DIVERSE
 * (5 archetype templates), the process is DETERMINISTIC (same seed => identical),
 * and distinct seeds produce distinct samples. The sampler imports the compiled
 * dist/sim/deck-legality.js, so we skip gracefully if the build is absent.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const samplerPath = join(here, '..', '..', 'deck-sampler.mjs');
const distLegality = join(here, '..', '..', 'dist', 'sim', 'deck-legality.js');
const cardsPath = '/Users/gvitalone/Projects/personal/temp/aetherion-cards.json';

const ready = existsSync(samplerPath) && existsSync(distLegality) && existsSync(cardsPath);
const d = ready ? describe : describe.skip;

interface DeckSelection {
  heroDefId: number;
  mainDeckDefIds: number[];
  resourceDeckDefIds: number[];
  faction: string;
  archetype: string;
  deckKey: string;
}
interface Sampler {
  sampleFactionDecks: (faction: string, count: number, opts: { seed: number }) => DeckSelection[];
  multisetHash: (ids: number[]) => string;
  ARCHETYPE_NAMES: string[];
  cardIndex: unknown;
}

const FACTIONS = ['Onyx', 'Radiant', 'Sapphire', 'Verdant'];

d('deck-sampler', () => {
  it('samples 5 legal decks per faction (validateDeck passes)', async () => {
    const m = (await import(samplerPath)) as unknown as Sampler;
    const { validateDeck } = (await import(distLegality)) as {
      validateDeck: (sel: unknown, idx: unknown) => { legal: boolean; errors: string[] };
    };
    for (const f of FACTIONS) {
      const decks = m.sampleFactionDecks(f, 5, { seed: 12345 });
      expect(decks).toHaveLength(5);
      for (const deck of decks) {
        expect(deck.mainDeckDefIds.length).toBe(40);
        expect(deck.resourceDeckDefIds.length).toBe(15);
        const r = validateDeck(deck, m.cardIndex);
        expect(r.errors).toEqual([]);
        expect(r.legal).toBe(true);
      }
    }
  });

  it('produces the documented DeckSelection shape resolveDeckSpec accepts', async () => {
    const m = (await import(samplerPath)) as unknown as Sampler;
    const [deck] = m.sampleFactionDecks('Onyx', 1, { seed: 1 });
    expect(deck).toMatchObject({
      heroDefId: expect.any(Number),
      mainDeckDefIds: expect.any(Array),
      resourceDeckDefIds: expect.any(Array),
      faction: 'Onyx',
    });
  });

  it('spans all 5 archetype templates and yields distinct decks', async () => {
    const m = (await import(samplerPath)) as unknown as Sampler;
    for (const f of FACTIONS) {
      const decks = m.sampleFactionDecks(f, 5, { seed: 999 });
      const archetypes = decks.map((x) => x.archetype);
      expect(new Set(archetypes)).toEqual(new Set(m.ARCHETYPE_NAMES));
      const keys = decks.map((x) => x.deckKey);
      expect(new Set(keys).size).toBe(5);
    }
  });

  it('is deterministic: same seed => byte-identical output', async () => {
    const m = (await import(samplerPath)) as unknown as Sampler;
    for (const f of FACTIONS) {
      const a = m.sampleFactionDecks(f, 5, { seed: 31337 });
      const b = m.sampleFactionDecks(f, 5, { seed: 31337 });
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    }
  });

  it('distinct seeds => distinct samples', async () => {
    const m = (await import(samplerPath)) as unknown as Sampler;
    const a = m.sampleFactionDecks('Sapphire', 5, { seed: 1 });
    const b = m.sampleFactionDecks('Sapphire', 5, { seed: 2 });
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
    // at least one deckKey differs between the two samples
    const ka = new Set(a.map((x) => x.deckKey));
    const kb = b.map((x) => x.deckKey);
    expect(kb.some((k) => !ka.has(k))).toBe(true);
  });

  it('multiset hash is order-independent', async () => {
    const m = (await import(samplerPath)) as unknown as Sampler;
    expect(m.multisetHash([3, 1, 2, 1])).toBe(m.multisetHash([1, 1, 2, 3]));
    expect(m.multisetHash([1, 2])).not.toBe(m.multisetHash([1, 1, 2]));
  });

  it('resource deck is exactly 15 of the faction resource id', async () => {
    const m = (await import(samplerPath)) as unknown as Sampler;
    const raw = JSON.parse(readFileSync(cardsPath, 'utf8')) as Array<{ id: number; cardType: string; name: string }>;
    const rIds = new Set(raw.filter((c) => c.cardType === 'R').map((c) => c.id));
    for (const f of FACTIONS) {
      const [deck] = m.sampleFactionDecks(f, 1, { seed: 5 });
      expect(deck.resourceDeckDefIds).toHaveLength(15);
      expect(new Set(deck.resourceDeckDefIds).size).toBe(1);
      expect(rIds.has(deck.resourceDeckDefIds[0] as number)).toBe(true);
    }
  });
});
