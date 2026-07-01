// make-sapphire-redesign.mjs — encode docs/sapphire-redesign-proposal.md's 9
// redesigns + 2 light tweaks into real, testable card JSON. The proposal was
// hand-transcription-only (CMS is the source of truth); this is the first time
// it's actually applied to a pool so it can be simulated.
//
// applySapphireRedesign(raw) returns a COPY of raw with only these 11 Sapphire
// card ids touched (75, 86, 88, 80, 90, 100, 81, 93, 94, 141, 82); every other
// card (including the 2 untouchable walls, Sapphire Sentinel/Crystal Golem, and
// all 32 non-Sapphire-redesign cards) passes through unchanged.
import { readFileSync, writeFileSync } from 'node:fs';

function ability(dsl, { type, effect, cooldown = null }) {
  return { dsl, cost: { mana: 0, xMana: false, energy: 0, xEnergy: false, flexible: false }, type, effect, cooldown };
}
const modify = (target, duration, modifier, extra = {}) => ({
  type: 'modify_stats',
  target,
  duration,
  modifier,
  ...extra,
});

// id -> patch function (mutates a deep-cloned card in place).
const PATCHES = {
  // Arcane Scholar: 2-cost weakest c2 body -> the deck's missing 1-drop.
  75: (c) => {
    c.cost = { mana: 1, energy: 0, flexible: 0 };
    c.stats = { hp: 1, atk: 1, arm: 0 };
    c.abilities = [
      ability(
        {
          type: 'triggered',
          trigger: { type: 'on_spell_cast', side: 'allied' },
          effects: [modify({ type: 'self' }, { type: 'until_end_of_turn' }, { atk: 1, hp: 1 })],
        },
        { type: 'Trigger', effect: 'Whenever you cast a spell, this character gains +1/+1 until end of turn.' },
      ),
    ];
  },
  // Mana Leak: light numeric tweak, unlessPay 2 -> 3. Everything else identical.
  86: (c) => {
    c.abilities[0].dsl.effects[0].unlessPay = { mana: 3, energy: 0, flexible: 0 };
    c.abilities[0].effect = "Counter target spell unless its controller pays 3.";
  },
  // Wizard's Focus -> Arcane Bolt: card_flow clone -> removal (fills a real gap).
  88: (c) => {
    c.name = 'Arcane Bolt';
    c.abilities = [
      ability(
        {
          type: 'triggered',
          trigger: { type: 'on_cast' },
          effects: [
            {
              type: 'deal_damage',
              amount: { type: 'fixed', value: 2 },
              target: { side: 'enemy', type: 'target_character' },
            },
          ],
        },
        { type: 'Cast', effect: 'Deal 2 damage to target enemy character.' },
      ),
    ];
  },
  // Spellbound Adept: draw-on-cast -> permanent combat growth (the pressure threat).
  80: (c) => {
    c.abilities = [
      ability(
        {
          type: 'triggered',
          trigger: { type: 'on_spell_cast', side: 'allied' },
          effects: [modify({ type: 'self' }, { type: 'permanent' }, { atk: 1, hp: 1 })],
        },
        { type: 'Aura', effect: 'Whenever you cast a spell, this character gains +1/+1 permanently.' },
      ),
    ];
  },
  // Glimpse the Future: numeric tweak, draw 2 -> 3.
  90: (c) => {
    c.abilities[0].dsl.effects[0].count = { type: 'fixed', value: 3 };
    c.abilities[0].effect = 'Draw 3 cards, then discard 1.';
  },
  // Lens of Foresight -> Arcane Focus Blade: vanilla scry -> +1 ATK weapon + on-hit reach.
  100: (c) => {
    c.name = 'Arcane Focus Blade';
    c.abilities = [
      ability(
        {
          type: 'aura',
          effects: [
            modify({ type: 'equipped_character' }, { type: 'while_in_play' }, { atk: 1 }),
            {
              type: 'grant_ability',
              target: { type: 'equipped_character' },
              duration: { type: 'while_in_play' },
              ability: {
                type: 'triggered',
                trigger: { type: 'on_deal_damage' },
                effects: [
                  {
                    type: 'deal_damage',
                    amount: { type: 'fixed', value: 1 },
                    target: { side: 'enemy', type: 'hero' },
                  },
                ],
              },
            },
          ],
        },
        {
          type: 'Aura',
          effect: 'Equipped character gains +1/+0. When equipped character deals damage, deal 1 damage to the enemy Hero.',
        },
      ),
    ];
  },
  // Mystic Librarian: draw-on-deploy -> hand-size HP payoff (rewards the deck's own card flow).
  81: (c) => {
    c.abilities = [
      ability(
        {
          type: 'triggered',
          trigger: { type: 'on_deploy' },
          effects: [
            modify(
              { type: 'self' },
              { type: 'permanent' },
              { atk: 0, hp: 0 },
              {
                dynamicModifier: {
                  type: 'per_count',
                  stat: 'hp',
                  counting: { type: 'cards_in_zone', zone: 'hand', side: 'allied' },
                  valuePerCount: 1,
                },
              },
            ),
          ],
        },
        {
          type: 'Deploy',
          effect: 'When deployed, this character gains permanent +0/+X HP, where X is the number of cards in your hand.',
        },
      ),
    ];
  },
  // Time Reversal: numeric tweak, draw 3 -> 4.
  93: (c) => {
    c.abilities[0].dsl.effects[1].count = { type: 'fixed', value: 4 };
    c.abilities[0].effect = 'Shuffle your discard pile into your deck, then draw 4 cards.';
  },
  // Arcane Echoes: adds a draw-2 alongside the existing spell-copy (was badly
  // underpriced vs its real peer cluster -- other spells/equipment, not creatures).
  94: (c) => {
    c.abilities[0].dsl.effects.push({
      type: 'draw_cards',
      count: { type: 'fixed', value: 2 },
      player: 'allied',
    });
    c.abilities[0].effect =
      'Choose an Arcane spell in your discard; add a copy of it to your hand. Draw 2 cards.';
  },
  // Master Archivist: the clearest fix -- ATK 2 -> 4 only, ability untouched.
  141: (c) => {
    c.stats.atk = 4;
  },
  // Arcane Storm: adds spell-scaled reach to the enemy Hero, on top of the existing
  // board bounce + draw (the deck's top-end slot had zero closing power before).
  82: (c) => {
    c.abilities[0].dsl.effects.push({
      type: 'deal_damage',
      amount: { type: 'count', counting: { type: 'spells_cast_this_turn' }, max: 6 },
      target: { side: 'enemy', type: 'hero' },
    });
    c.abilities[0].effect =
      "Return all enemy characters to their owners' hands. Draw a card for each character returned this way. Deal damage to the enemy Hero equal to the number of spells you've cast this turn (max 6).";
  },
};

export function applySapphireRedesign(raw) {
  const cards = JSON.parse(JSON.stringify(raw));
  const byId = new Map(cards.map((c) => [c.id, c]));
  const changed = [];
  for (const [id, patch] of Object.entries(PATCHES)) {
    const c = byId.get(Number(id));
    if (!c) throw new Error(`Sapphire redesign: card id ${id} not found in pool`);
    patch(c);
    changed.push(c.name);
  }
  return { raw: cards, changed };
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  // No silent default to the raw committed file — that exact silent fallback (in
  // this file, and separately in a hand-typed sim invocation) caused two real
  // wrong-dataset runs in this investigation. SRC is required; fail loudly.
  const SRC = process.env.SRC;
  if (!SRC) {
    console.error('SRC env var required (no silent default) — e.g. SRC=/tmp/aetherion-current/BASELINE.json');
    process.exit(1);
  }
  const OUT = process.env.OUT || '/tmp/aetherion-sapphire-redesign.json';
  const { raw, changed } = applySapphireRedesign(JSON.parse(readFileSync(SRC, 'utf8')));
  writeFileSync(OUT, JSON.stringify(raw));
  console.log(`Wrote ${OUT} — ${changed.length} cards touched: ${changed.join(', ')}`);
}
