/**
 * Value-net featurizer — the single source of truth turning a GameState into a
 * fixed-length Float32Array for the neural win-probability value net. Training
 * AND inference both call `featurize`, so it must be pure, deterministic, and
 * PERSPECTIVE-CANONICAL: the vector always describes the game from the mover's
 * point of view, so it is invariant to which physical seat (0/1) the mover
 * occupies.
 *
 * Bump FEATURE_SCHEMA_VERSION on any layout change (order, length, or
 * normalization constant) so stored training data can be invalidated.
 */
import type {
  CardInstance,
  GamePhase,
  GameState,
  PlayerState,
  ZoneState,
} from '../types/game-state.js';
import type { ProvideKind, Signal } from '../balance/index.js';
import { emitSignals } from '../balance/index.js';
import { ZONE_SLOTS, MAX_HAND_SIZE, RESOURCE_DECK_SIZE } from '../types/game-state.js';
import type { ResourceType, Trait } from '../types/common.js';
import { intrinsicValue, staticFromInstance } from '../bot/value-pilot.js';

export const FEATURE_SCHEMA_VERSION = 1;

// ── Normalization constants (documented; keep features roughly in [0, 1]) ────
const LP_NORM = 30;
const STAT_NORM = 10;
const POWER_NORM = 20;
const SIGNAL_COUNT_NORM = 3;
const RESOURCE_BANK_NORM = RESOURCE_DECK_SIZE;
const TEMP_RESOURCE_NORM = 5;
const HAND_NORM = MAX_HAND_SIZE;
const MAIN_DECK_NORM = 60;
const DISCARD_NORM = 60;
const TURN_NORM = 30;

// ── Fixed feature-order tables ───────────────────────────────────────────────
const RESOURCE_TYPES: readonly ResourceType[] = ['mana', 'energy', 'flexible'];
const TRAIT_ORDER: readonly Trait[] = [
  'defender',
  'flying',
  'haste',
  'rush',
  'sniper',
  'elite',
  'stealth',
  'swift',
  'volatile',
  'first_strike',
];
const SIGNAL_ORDER: readonly ProvideKind[] = ['ramp', 'removal', 'sustain', 'wide_bodies'];
const PHASE_ORDER: readonly GamePhase[] = [
  'setup',
  'mulligan',
  'upkeep',
  'strategy',
  'action',
  'end',
  'game_over',
];

// ── Per-card block ────────────────────────────────────────────────────────────
// 1 (presence) + 3 (stats) + 2 (net buff) + TRAIT_ORDER.length + 3 (status) +
// 1 (intrinsic value) + SIGNAL_ORDER.length
const CARD_BLOCK_LENGTH = 1 + 3 + 2 + TRAIT_ORDER.length + 3 + 1 + SIGNAL_ORDER.length;

function pushEmptyCardBlock(out: number[]): void {
  for (let i = 0; i < CARD_BLOCK_LENGTH; i++) out.push(0);
}

function pushCardBlock(out: number[], card: CardInstance): void {
  out.push(1); // presence
  out.push(card.currentHp / STAT_NORM);
  out.push(card.currentAtk / STAT_NORM);
  out.push(card.currentArm / STAT_NORM);
  out.push((card.currentHp - card.baseHp) / STAT_NORM);
  out.push((card.currentAtk - card.baseAtk) / STAT_NORM);

  const activeTraits = new Set<Trait>(card.traits);
  for (const granted of card.grantedTraits) activeTraits.add(granted.trait);
  for (const trait of TRAIT_ORDER) out.push(activeTraits.has(trait) ? 1 : 0);

  out.push(card.exhausted ? 1 : 0);
  out.push(card.summoningSick ? 1 : 0);
  out.push(card.equipment !== null ? 1 : 0);

  out.push(intrinsicValue(card) / POWER_NORM);

  const provides: readonly Signal[] = emitSignals(staticFromInstance(card));
  for (const kind of SIGNAL_ORDER) {
    const count = provides.filter((s) => s.kind === kind).length;
    out.push(count / SIGNAL_COUNT_NORM);
  }
}

// ── Fixed-size zone slots (v1 assumes default ZONE_SLOTS capacity: reserve 2,
// frontline 3, high_ground 2 — clamped/padded to those sizes regardless of the
// live array length so the vector length never varies with board config). ────
function fixedSlots(
  slots: readonly (CardInstance | null)[],
  size: number,
): readonly (CardInstance | null)[] {
  const padded = slots.slice(0, size);
  while (padded.length < size) padded.push(null);
  return padded;
}

function pushZoneBlock(out: number[], zones: ZoneState): void {
  const reserve = fixedSlots(zones.reserve, ZONE_SLOTS.reserve);
  const frontline = fixedSlots(zones.frontline, ZONE_SLOTS.frontline);
  const highGround = fixedSlots(zones.highGround, ZONE_SLOTS.high_ground);
  for (const slot of [...reserve, ...frontline, ...highGround]) {
    if (slot === null) pushEmptyCardBlock(out);
    else pushCardBlock(out, slot);
  }
}

// ── Per-player block ──────────────────────────────────────────────────────────
function pushPlayerBlock(out: number[], player: PlayerState): void {
  const hero = player.hero;
  out.push(hero.currentLp / LP_NORM);
  out.push(hero.maxLp / LP_NORM);
  out.push(hero.currentArm / STAT_NORM);
  out.push(hero.transformed ? 1 : 0);
  out.push(hero.canTransformThisGame ? 1 : 0);

  for (const type of RESOURCE_TYPES) {
    const count = player.resourceBank.filter((r) => !r.exhausted && r.resourceType === type).length;
    out.push(count / RESOURCE_BANK_NORM);
  }
  for (const type of RESOURCE_TYPES) {
    const amount = player.temporaryResources
      .filter((r) => r.resourceType === type)
      .reduce((sum, r) => sum + r.amount, 0);
    out.push(amount / TEMP_RESOURCE_NORM);
  }

  out.push(player.hand.length / HAND_NORM);
  out.push(player.mainDeck.length / MAIN_DECK_NORM);
  out.push(player.discardPile.length / DISCARD_NORM);

  pushZoneBlock(out, player.zones);
}

// Per-player block: 5 (hero) + 3 (resourceBank counts) + 3 (temp resources) +
// 3 (hand/mainDeck/discard counts) + 7 zone slots * CARD_BLOCK_LENGTH
const ZONE_SLOT_COUNT = ZONE_SLOTS.reserve + ZONE_SLOTS.frontline + ZONE_SLOTS.high_ground;
const PLAYER_BLOCK_LENGTH = 5 + 3 + 3 + 3 + ZONE_SLOT_COUNT * CARD_BLOCK_LENGTH;

// ── Global block (perspective-neutral) ───────────────────────────────────────
// PHASE_ORDER.length (one-hot) + 1 (turnNumber) + 1 (pendingChoice present) +
// 1 (pendingChoice belongs to mover)
const GLOBAL_BLOCK_LENGTH = PHASE_ORDER.length + 1 + 1 + 1;

export const FEATURE_LENGTH = 2 * PLAYER_BLOCK_LENGTH + GLOBAL_BLOCK_LENGTH;

/**
 * Turn a GameState into a fixed-length, perspective-canonical feature vector.
 * Pure and deterministic — same `gs` always yields the same vector, and `gs` is
 * never mutated. The mover (`gs.players[gs.activePlayerIndex]`) is always
 * encoded first ("me"), then the opponent ("them"), using an identical
 * per-player layout, so the vector is invariant to which seat the mover sits in.
 */
export function featurize(gs: GameState): Float32Array {
  const out: number[] = [];

  const opponentIndex: 0 | 1 = gs.activePlayerIndex === 0 ? 1 : 0;
  const me = gs.players[gs.activePlayerIndex];
  const them = gs.players[opponentIndex];
  pushPlayerBlock(out, me);
  pushPlayerBlock(out, them);

  for (const phase of PHASE_ORDER) out.push(phase === gs.phase ? 1 : 0);
  out.push(gs.turnNumber / TURN_NORM);
  out.push(gs.pendingChoice !== null ? 1 : 0);
  out.push(gs.pendingChoice !== null && gs.pendingChoice.playerId === gs.activePlayerIndex ? 1 : 0);

  return Float32Array.from(out);
}
