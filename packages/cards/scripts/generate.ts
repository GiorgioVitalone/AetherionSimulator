/**
 * Card data generator — reads from PostgreSQL and outputs typed JSON.
 *
 * Connection modes (in priority order):
 * 1. DATABASE_URL env var (single connection string)
 * 2. Individual env vars: DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD
 *
 * Usage:
 *   pnpm generate:cards
 *
 * Prerequisites:
 *   Docker containers must be running with port 5432 exposed.
 *   Run `docker ps` to check.
 */

import pg from 'pg';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { SimCard, Cost, Stats, Ability, CardTypeCode, Rarity, Alignment } from '../src/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');

const VALID_ALIGNMENTS = new Set<string>([
  'Crimson', 'Sapphire', 'Verdant', 'Onyx', 'Radiant', 'Amethyst',
]);

const VALID_CARD_TYPES = new Set<string>(['C', 'S', 'E', 'H', 'T', 'R']);
const VALID_RARITIES = new Set<string>(['Common', 'Ethereal', 'Mythic', 'Legendary']);

function getConnectionConfig(): pg.PoolConfig {
  if (process.env['DATABASE_URL']) {
    return { connectionString: process.env['DATABASE_URL'] };
  }

  return {
    host: process.env['DB_HOST'] ?? 'localhost',
    port: parseInt(process.env['DB_PORT'] ?? '5432', 10),
    database: process.env['DB_NAME'] ?? 'aetheriondb',
    user: process.env['DB_USER'] ?? 'aetherionuser',
    password: process.env['DB_PASSWORD'] ?? 'aetherionpass',
  };
}

function parseCost(costData: Record<string, unknown> | null): Cost {
  if (!costData) {
    return { mana: 0, energy: 0, flexible: 0, xMana: false, xEnergy: false };
  }
  return {
    mana: Number(costData['mana'] ?? 0),
    energy: Number(costData['energy'] ?? 0),
    flexible: Number(costData['flexible'] ?? 0),
    xMana: Boolean(costData['xMana']),
    xEnergy: Boolean(costData['xEnergy']),
  };
}

function parseStats(statsData: Record<string, unknown> | null): Stats | null {
  if (!statsData) return null;
  const hp = Number(statsData['hp'] ?? 0);
  const atk = Number(statsData['atk'] ?? 0);
  const arm = Number(statsData['arm'] ?? 0);
  if (hp === 0 && atk === 0 && arm === 0) return null;
  return { hp, atk, arm };
}

function parseAbilities(abilitiesData: unknown): Ability[] {
  if (!Array.isArray(abilitiesData)) return [];
  return abilitiesData.map((a: Record<string, unknown>) => ({
    name: String(a['name'] ?? ''),
    cost: a['cost'] ? String(a['cost']) : null,
    effect: String(a['effect'] ?? ''),
    trigger: a['trigger'] ? String(a['trigger']) : null,
    abilityType: a['abilityType'] ? String(a['abilityType']) : null,
    dsl: a['dsl'] ?? null,
  }));
}

function parseAlignment(alignment: unknown): Alignment[] {
  if (Array.isArray(alignment)) {
    return alignment.filter((a): a is Alignment => VALID_ALIGNMENTS.has(String(a)));
  }
  if (typeof alignment === 'string' && VALID_ALIGNMENTS.has(alignment)) {
    return [alignment as Alignment];
  }
  return [];
}

interface DbRow {
  id: number;
  name: string;
  cardType: string;
  rarity: string;
  alignment: unknown;
  cost: Record<string, unknown> | null;
  stats: Record<string, unknown> | null;
  abilities: unknown;
  tags: unknown;
  flavorText: string | null;
  setCode: string | null;
  transformsInto: number | null;
}

function transformCard(row: DbRow): SimCard | null {
  const cardType = row.cardType;
  const rarity = row.rarity;

  if (!VALID_CARD_TYPES.has(cardType)) {
    console.warn(`Skipping card ${row.id} "${row.name}": invalid cardType "${cardType}"`);
    return null;
  }
  if (!VALID_RARITIES.has(rarity)) {
    console.warn(`Skipping card ${row.id} "${row.name}": invalid rarity "${rarity}"`);
    return null;
  }

  return {
    id: row.id,
    name: row.name,
    cardType: cardType as CardTypeCode,
    rarity: rarity as Rarity,
    alignment: parseAlignment(row.alignment),
    cost: parseCost(row.cost),
    stats: parseStats(row.stats),
    abilities: parseAbilities(row.abilities),
    traits: Array.isArray(row.tags) ? row.tags.map(String) : [],
    flavorText: row.flavorText ?? null,
    setCode: row.setCode ?? null,
    transformsInto: row.transformsInto ?? null,
  };
}

async function main(): Promise<void> {
  console.log('[generate:cards] Connecting to PostgreSQL...');

  const pool = new pg.Pool(getConnectionConfig());

  try {
    const { rows } = await pool.query<DbRow>(
      `SELECT
        id, name, "cardType", rarity, alignment, cost, stats,
        abilities, traits AS tags, "flavorText",
        "setId" AS "setCode", "transformationId" AS "transformsInto"
      FROM cards
      ORDER BY id`,
    );

    console.log(`[generate:cards] Fetched ${rows.length} cards from database`);

    const cards: SimCard[] = [];
    const byFaction: Record<string, SimCard[]> = {};

    for (const row of rows) {
      const card = transformCard(row);
      if (!card) continue;
      cards.push(card);

      const faction = card.alignment[0] ?? 'Unaligned';
      if (!byFaction[faction]) byFaction[faction] = [];
      byFaction[faction].push(card);
    }

    // Ensure output directory exists
    mkdirSync(DATA_DIR, { recursive: true });

    // Write combined index
    writeFileSync(join(DATA_DIR, 'cards.json'), JSON.stringify(cards, null, 2));

    // Write per-faction files
    for (const [faction, factionCards] of Object.entries(byFaction)) {
      writeFileSync(
        join(DATA_DIR, `${faction.toLowerCase()}.json`),
        JSON.stringify(factionCards, null, 2),
      );
    }

    // Write metadata
    const byType: Record<string, number> = {};
    const byFactionCount: Record<string, number> = {};
    for (const card of cards) {
      byType[card.cardType] = (byType[card.cardType] ?? 0) + 1;
      const faction = card.alignment[0] ?? 'Unaligned';
      byFactionCount[faction] = (byFactionCount[faction] ?? 0) + 1;
    }

    const meta = {
      generatedAt: new Date().toISOString(),
      totalCards: cards.length,
      byFaction: byFactionCount,
      byType,
    };
    writeFileSync(join(DATA_DIR, '_meta.json'), JSON.stringify(meta, null, 2));

    console.log(`[generate:cards] Written ${cards.length} cards to ${DATA_DIR}`);
    console.log('[generate:cards] Metadata:', JSON.stringify(meta, null, 2));
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code === 'ECONNREFUSED') {
      console.error(
        '[generate:cards] ERROR: Cannot connect to PostgreSQL.',
        '\n  Docker containers must be running with port 5432 exposed.',
        '\n  Run `docker ps` to check.',
      );
      process.exit(1);
    }
    throw error;
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error('[generate:cards] Fatal error:', err);
  process.exit(1);
});
