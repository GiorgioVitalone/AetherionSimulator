/**
 * Mock card data for integration tests.
 * Provides two factions (Onyx + Radiant) with enough cards to build starter decks.
 */
import type { SimCard } from '@aetherion-sim/cards';

export const MOCK_CARDS: SimCard[] = [
  // ── Onyx Hero ───────────────────────────────────────────────────────────
  {
    id: 1,
    name: 'Malachar the Undying',
    cardType: 'H',
    rarity: 'Legendary',
    alignment: ['Onyx'],
    cost: { mana: 0, energy: 0, flexible: 0, xMana: false, xEnergy: false },
    stats: { hp: 28, atk: 0, arm: 0 },
    abilities: [
      {
        name: 'Soul Harvest',
        cost: null,
        effect: 'When an allied character is destroyed, draw a card.',
        trigger: 'Trigger',
        abilityType: 'Trigger',
        dsl: {
          type: 'triggered',
          trigger: { type: 'on_ally_destroyed', side: 'allied' },
          effects: [{ type: 'draw_cards', amount: 1, target: { type: 'self' } }],
        },
      },
    ],
    traits: [],
    flavorText: 'Death is merely a door.',
    setCode: 'CORE',
    transformsInto: null,
  },

  // ── Radiant Hero ────────────────────────────────────────────────────────
  {
    id: 2,
    name: 'Seraphina the Radiant',
    cardType: 'H',
    rarity: 'Legendary',
    alignment: ['Radiant'],
    cost: { mana: 0, energy: 0, flexible: 0, xMana: false, xEnergy: false },
    stats: { hp: 30, atk: 0, arm: 0 },
    abilities: [
      {
        name: 'Divine Shield',
        cost: null,
        effect: 'Allied characters gain +0/+1 ARM.',
        trigger: 'Aura',
        abilityType: 'Aura',
        dsl: {
          type: 'aura',
          target: { type: 'all_characters', side: 'allied' },
          modifiers: [{ stat: 'arm', amount: 1 }],
        },
      },
    ],
    traits: [],
    flavorText: 'Her light burns brightest in the dark.',
    setCode: 'CORE',
    transformsInto: null,
  },

  // ── Onyx Characters (8 cards for variety) ───────────────────────────────
  ...createCharacters('Onyx', 100, [
    { name: 'Grave Warden', rarity: 'Common', cost: 2, hp: 3, atk: 2, arm: 0 },
    { name: 'Shadow Stalker', rarity: 'Common', cost: 1, hp: 2, atk: 1, arm: 0 },
    { name: 'Bone Collector', rarity: 'Common', cost: 3, hp: 4, atk: 3, arm: 1 },
    { name: 'Dread Knight', rarity: 'Common', cost: 4, hp: 5, atk: 4, arm: 1 },
    { name: 'Soul Reaver', rarity: 'Ethereal', cost: 3, hp: 3, atk: 3, arm: 0 },
    { name: 'Lich Apprentice', rarity: 'Ethereal', cost: 5, hp: 6, atk: 4, arm: 2 },
    { name: 'Void Herald', rarity: 'Mythic', cost: 6, hp: 7, atk: 5, arm: 2 },
    { name: 'Abyssal Titan', rarity: 'Legendary', cost: 8, hp: 10, atk: 7, arm: 3 },
  ]),

  // ── Onyx Spells (4) ────────────────────────────────────────────────────
  ...createSpells('Onyx', 200, [
    { name: 'Dark Bolt', rarity: 'Common', cost: 2 },
    { name: 'Drain Life', rarity: 'Common', cost: 3 },
    { name: 'Shadow Grasp', rarity: 'Ethereal', cost: 4 },
    { name: 'Necrotic Wave', rarity: 'Mythic', cost: 5 },
  ]),

  // ── Radiant Characters (8) ─────────────────────────────────────────────
  ...createCharacters('Radiant', 300, [
    { name: 'Light Squire', rarity: 'Common', cost: 1, hp: 2, atk: 1, arm: 1 },
    { name: 'Temple Guard', rarity: 'Common', cost: 2, hp: 3, atk: 2, arm: 1 },
    { name: 'Faithful Healer', rarity: 'Common', cost: 3, hp: 4, atk: 2, arm: 1 },
    { name: 'Bastion Knight', rarity: 'Common', cost: 4, hp: 5, atk: 3, arm: 2 },
    { name: 'Sunblade Paladin', rarity: 'Ethereal', cost: 3, hp: 3, atk: 3, arm: 1 },
    { name: 'Dawn Sentinel', rarity: 'Ethereal', cost: 5, hp: 6, atk: 4, arm: 2 },
    { name: 'Archangel', rarity: 'Mythic', cost: 6, hp: 8, atk: 5, arm: 3 },
    { name: 'High Justicar', rarity: 'Legendary', cost: 7, hp: 9, atk: 6, arm: 3 },
  ]),

  // ── Radiant Spells (4) ─────────────────────────────────────────────────
  ...createSpells('Radiant', 400, [
    { name: 'Holy Light', rarity: 'Common', cost: 2 },
    { name: 'Blessing', rarity: 'Common', cost: 3 },
    { name: 'Divine Judgment', rarity: 'Ethereal', cost: 4 },
    { name: 'Radiant Nova', rarity: 'Mythic', cost: 6 },
  ]),

  // ── Onyx Resources ─────────────────────────────────────────────────────
  {
    id: 500, name: 'Onyx Mana Crystal', cardType: 'R', rarity: 'Common',
    alignment: ['Onyx'], cost: { mana: 0, energy: 0, flexible: 0, xMana: false, xEnergy: false },
    stats: null, abilities: [], traits: [], flavorText: null, setCode: 'CORE', transformsInto: null,
  },

  // ── Radiant Resources ──────────────────────────────────────────────────
  {
    id: 501, name: 'Radiant Mana Crystal', cardType: 'R', rarity: 'Common',
    alignment: ['Radiant'], cost: { mana: 0, energy: 0, flexible: 0, xMana: false, xEnergy: false },
    stats: null, abilities: [], traits: [], flavorText: null, setCode: 'CORE', transformsInto: null,
  },
];

// ── Helpers ─────────────────────────────────────────────────────────────────

interface CharTemplate {
  name: string;
  rarity: SimCard['rarity'];
  cost: number;
  hp: number;
  atk: number;
  arm: number;
}

function createCharacters(
  faction: string,
  startId: number,
  templates: CharTemplate[],
): SimCard[] {
  return templates.map((t, i) => ({
    id: startId + i,
    name: t.name,
    cardType: 'C' as const,
    rarity: t.rarity,
    alignment: [faction] as SimCard['alignment'],
    cost: { mana: t.cost, energy: 0, flexible: 0, xMana: false, xEnergy: false },
    stats: { hp: t.hp, atk: t.atk, arm: t.arm },
    abilities: [],
    traits: [],
    flavorText: null,
    setCode: 'CORE',
    transformsInto: null,
  }));
}

interface SpellTemplate {
  name: string;
  rarity: SimCard['rarity'];
  cost: number;
}

function createSpells(
  faction: string,
  startId: number,
  templates: SpellTemplate[],
): SimCard[] {
  return templates.map((t, i) => ({
    id: startId + i,
    name: t.name,
    cardType: 'S' as const,
    rarity: t.rarity,
    alignment: [faction] as SimCard['alignment'],
    cost: { mana: t.cost, energy: 0, flexible: 0, xMana: false, xEnergy: false },
    stats: null,
    abilities: [],
    traits: [],
    flavorText: null,
    setCode: 'CORE',
    transformsInto: null,
  }));
}
