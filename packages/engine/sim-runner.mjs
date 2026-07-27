// sim-runner.mjs — ONE parameterized simulation runner the dashboard calls.
//
// Public API:  runSim(config) -> structured JSON results (see RETURN SHAPE below).
// Also a thin CLI:  node sim-runner.mjs [--key value ...]  (see parseCliConfig).
//
// Reuses the engine's heuristic bot + abilities pipeline (createGame, gameMachine,
// computeAvailableActions, chooseAction/chooseChoiceResponse/shouldKeepHand from
// the built dist). Determinism: every game is seeded purely from
// (seedBase, pairingIndex, gameIndex); identical config => identical results,
// including a stable runHash. Verified by sim-runner-determinism.test logic and
// the bundled `--verify-determinism` CLI flag.
//
// ── CONFIG SCHEMA ────────────────────────────────────────────────────────────
// {
//   matchups:    string[] (faction names) | "all-pairs" | "all-pairs-no-mirror"
//                | { factions?: string[], includeMirrors?: boolean }
//                  - "all-pairs": every unordered pair incl. mirrors
//                  - "all-pairs-no-mirror": every unordered pair excl. mirrors
//                  - a plain array of factions => all-pairs over those factions
//   gamesPerPairing: number  (games simulated per pairing; default 60)
//   turnCap:         number  (hard turn limit before a game is force-ended; default 80)
//   abilitiesOn:     boolean (hydrate card/hero abilities onto instances; default true)
//   botPolicy:       "random" | "heuristic"  (both seats; default "heuristic")
//   botPolicySeat:   { 0: "heuristic"|"random"|"rollout", 1: ... }  (optional;
//                     lets seat 0 and seat 1 run DIFFERENT policies, for
//                     bot-vs-bot head-to-heads. A spec where both seats name
//                     the SAME policy folds into the monolithic `botPolicy`
//                     field above and is omitted from the resolved/hashed
//                     config — byte-identical to setting `botPolicy` alone.
//                     Unset ⇒ omitted ⇒ the monolithic `botPolicy` path is
//                     untouched.
//   firstPlayerCompensation:
//       "none"        — no compensation (engine default)
//       "card"        — second player draws +1 card at game start
//       "resource"    — second player starts with +1 ready resource
//       "both"        — card + resource
//       "play_or_draw"— second player chooses draw (modeled as "card")
//       "reserveT1"   — first player skips their first-turn resource refresh edge
//                       (modeled as: first player's firstPlayerFirstTurn stays true,
//                        i.e. engine default — kept distinct for dashboard labeling)
//   termination:  "none" | "tiebreak"
//       "none"     — turnCap games with no engine winner are counted as timeouts
//       "tiebreak" — turnCap games are decided by higher hero LP (then board), draw if equal
//   terminationMode: "turn_cap" | "resource_deck_empty_transform"  (default "turn_cap")
//       "turn_cap"  — current behavior; games are bounded by turnCap and resolved
//                     via the `termination` field above (none|tiebreak). Engine
//                     transform gate = Rulebook standard only.
//       "resource_deck_empty_transform" — engine rules variant: a Hero may
//                     declare_transform UNCONDITIONALLY once that player's Resource
//                     Deck is empty (in addition to the standard gate + any printed
//                     Transformation Trigger). A comeback enabler that ends stalls.
//                     turnCap + `termination` still apply as a backstop.
//   ── Diagnostic ablation knobs (all default to a no-op) ─────────────────────
//   botPolicy:    "heuristic" | "random"  (see above; "random" is the neutral
//                 baseline that controls for bot-policy bias toward Onyx lines)
//   firstPlayer:  "random" | "alternating" | "p0" | "p1"   (default "random")
//       "random"      — engine RNG picks who moves first (current behavior)
//       "alternating" — first seat alternates by game index (each faction goes
//                       first equally often per pairing => neutral in aggregate)
//       "p0" | "p1"   — force a fixed first seat (symmetric, controlled baseline)
//   lpScale:      number (default 1) — multiplies each Hero's starting & max LP
//                 (high-HP regime). Healing is scaled separately via healScale.
//   healScale:    number (default 1) — in-engine multiplier on EVERY `heal`
//                 amount (heal-stall regime); 0 neutralizes all healing.
//   damageScale:  number (default 1) — DESIGN-SWEEP multiplier on COMBAT damage
//                 (character + hero-face), applied after ARM + shield, rounded with
//                 Math.round. Tests "increase damage / faster kills". 1 = no-op.
//                 Non-combat direct `deal_damage` is NOT scaled.
//   frontlineSlots / highGroundSlots: numbers (defaults 3 / 2) — DESIGN-SWEEP
//                 per-player zone-capacity overrides. Resizes the zone arrays so a
//                 4th Frontline / 3rd High Ground deploy is legal (or a tighter
//                 board caps it). Defaults reproduce the current board exactly.
//   disableEffectTypes: string[] (default []) — Effect `type` strings to no-op
//                 at resolution in the interpreter (e.g. ["return_from_discard"]
//                 to neutralize Onyx recursion / value-loop mechanics by-data).
//   registerPrintedTriggers: boolean (default false) — BUG FIX: register a
//                 card's printed triggered abilities (on_destroy/Last Breath,
//                 on_ally_destroyed, on_turn_end, on_spell_cast, etc. — anything
//                 other than on_cast/on_deploy) the moment it enters play, and
//                 the base Hero's printed abilities at hydration, so the
//                 dispatch runtime can actually see and fire them (see
//                 game-state.ts's GameConfig.registerPrintedTriggers).
//   equipmentTriggers: boolean (default false) — BUG FIX: register an attached
//                 equipment's own printed triggered abilities at attach time and
//                 include them in the dispatch trigger pool, so on_turn_start/
//                 on_turn_end/on_ally_deployed/on_spell_cast/on_gain_resource/
//                 on_equipment_attached printed on an equipment card can
//                 actually fire (see game-state.ts's GameConfig.equipmentTriggers).
//   seedBase:     number (root seed; default 12345)
// }
//
// ── RETURN SHAPE ─────────────────────────────────────────────────────────────
// {
//   factionWinPct: { [faction]: number },   // non-mirror decided games only
//   paritySpread:  number,                   // max - min faction win%
//   firstPlayerPct:        number,           // overall, decided games
//   mirrorFirstPlayerPct:  number,           // mirror matchups only
//   gameLength: { histogram: { [bucket]: number }, median: number, avg: number },
//   snowball:  { leaderAtTurn10WinPct: number, comebackPct: number },
//   decidedPct: number, timeoutPct: number,
//   games: number,
//   config: <resolved config>,
//   runHash: string                          // deterministic over per-game results
// }

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainThread } from 'node:worker_threads';
import { createActor } from 'xstate';
import {
  createGame,
  createCurrentGame,
  computeAvailableActions,
  computeReactiveActions,
  enumerateConcretePlayerActions,
  gameMachine,
  chooseAction,
  chooseReactiveAction,
  chooseChoiceResponse,
  shouldKeepHand,
  applyMulligan,
  featurize,
  FEATURE_SCHEMA_VERSION,
  RESOURCE_DECK_SIZE,
  registerHeroTriggers,
  CURRENT_GAME_CONFIG,
  CURRENT_RULES_MANIFEST,
  validateGameStateInvariants,
  recomputeAuras,
} from './dist/index.js';
import { gameplanFor } from './dist/bot/gameplan.js';
import { summarizeStats } from './dist/sim/summarize-stats.js';
import { getDeck } from './deck-loader.mjs';
import { sampleFactionDecks } from './deck-sampler.mjs';
import { makeRolloutPilot } from './pilot-rollout.mjs';
import { makeValuePilot, computeModelSha } from './pilot-value.mjs';
import { validateCardData } from './dist/sim/card-data-validator.js';
import { validateDeck } from './dist/sim/deck-legality.js';
import { validateStudyManifest } from './dist/sim/study-manifest.js';
import { validatePolicyCalibrationManifest } from './dist/sim/policy-calibration.js';

const CARDS = process.env.AETHERION_CARDS
  ? process.env.AETHERION_CARDS
  : new URL('./sim-data/aetherion-cards.json', import.meta.url);
const USING_COMMITTED_CARD_POOL = process.env.AETHERION_CARDS === undefined;
const FACTIONS = ['Onyx', 'Radiant', 'Sapphire', 'Verdant'];
const ENERGY_FACTIONS = new Set(['Verdant']);
const STEP_CAP = 8000;
const RANDOM_ACTION_PROB = 0.85;
const SNOWBALL_TURN = 10;

export function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value)
      .filter(([, entry]) => entry !== undefined && typeof entry !== 'function')
      .sort(([a], [b]) => a.localeCompare(b));
    return `{${entries
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function canonicalHash(value) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function policyConfigHash(config) {
  return canonicalHash({
    botPolicy: config.botPolicy,
    botPolicySeat: config.botPolicySeat,
    rollouts: config.rollouts,
    rolloutDepth: config.rolloutDepth,
    rolloutClosing: config.rolloutClosing,
    maxCandidates: config.maxCandidates,
    candidateGen: config.candidateGen,
    candidateKindCaps: config.candidateKindCaps,
    rolloutPlayout: config.rolloutPlayout,
    rolloutSeedMode: config.rolloutSeedMode,
    rolloutInteractions: config.rolloutInteractions,
    fairPilot: config.fairPilot,
    valueLeafModelSha: config.valueLeafModelSha,
    valueLeafFeatureSchemaVersion: config.valueLeafFeatureSchemaVersion,
    valueModelSha: config.valueModelSha,
    valueFeatureSchemaVersion: config.valueFeatureSchemaVersion,
  });
}

function deepFreeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const entry of Object.values(value)) deepFreeze(entry);
  }
  return value;
}

function immutableSnapshot(value) {
  return deepFreeze(JSON.parse(
    JSON.stringify(value, (key, entry) =>
      key === 'diag' || typeof entry === 'function' ? undefined : entry,
    ),
  ));
}

function normalizeObservation(spec) {
  if (spec === undefined || spec === null) return null;
  if (typeof spec !== 'object' || Array.isArray(spec)) {
    throw new TypeError('observation must be an object');
  }
  const allowed = new Set(['finalState', 'turnStates', 'actions']);
  const unknown = Object.keys(spec).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw new TypeError(`observation.${unknown[0]} is unknown`);
  }
  for (const key of allowed) {
    if (spec[key] !== undefined && typeof spec[key] !== 'boolean') {
      throw new TypeError(`observation.${key} must be boolean`);
    }
  }
  const normalized = {
    finalState: spec.finalState === true,
    turnStates: spec.turnStates === true,
    actions: spec.actions === true,
  };
  return Object.values(normalized).some(Boolean) ? Object.freeze(normalized) : null;
}

function listJavaScriptFiles(root, directory = root) {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const absolute = join(directory, entry.name);
      if (entry.isDirectory()) return listJavaScriptFiles(root, absolute);
      return entry.isFile() && entry.name.endsWith('.js')
        ? [relative(root, absolute)]
        : [];
    })
    .sort((left, right) => left.localeCompare(right));
}

/**
 * Exact, content-addressed identity for the executable engine loaded by this
 * runner. Timestamps and filesystem traversal order are deliberately excluded.
 */
export function computeEngineBuildHash() {
  const root = fileURLToPath(new URL('./dist/', import.meta.url));
  const hash = createHash('sha256');
  for (const path of listJavaScriptFiles(root)) {
    hash.update(path);
    hash.update('\0');
    hash.update(readFileSync(join(root, path)));
    hash.update('\0');
  }
  return hash.digest('hex');
}

function computePackageFileHash(paths) {
  const packageRoot = fileURLToPath(new URL('./', import.meta.url));
  const hash = createHash('sha256');
  for (const path of [...paths].sort((left, right) => left.localeCompare(right))) {
    hash.update(path);
    hash.update('\0');
    hash.update(readFileSync(join(packageRoot, path)));
    hash.update('\0');
  }
  return hash.digest('hex');
}

export function computeHarnessBuildHash() {
  return computePackageFileHash([
    'deck-loader.mjs',
    'deck-sampler.mjs',
    'pilot-rollout.mjs',
    'pilot-value.mjs',
    'sim-runner.mjs',
  ]);
}

export function computeBotImplementationHash() {
  const distRoot = fileURLToPath(new URL('./dist/', import.meta.url));
  const compiledBotPaths = listJavaScriptFiles(
    distRoot,
    join(distRoot, 'bot'),
  ).map((path) => `dist/${path}`);
  return computePackageFileHash([
    ...compiledBotPaths,
    'pilot-rollout.mjs',
    'pilot-value.mjs',
    'sim-runner.mjs',
  ]);
}

// ── Card data load (INPUT-ONLY) ──────────────────────────────────────────────

const raw = JSON.parse(readFileSync(CARDS, 'utf8'));
const CARD_POOL_HASH = createHash('sha256')
  .update(JSON.stringify(raw))
  .digest('hex');
const ENGINE_PACKAGE = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
);
const CURRENT_ENGINE_BUILD_HASH = computeEngineBuildHash();
const CURRENT_HARNESS_BUILD_HASH = computeHarnessBuildHash();
const CURRENT_BOT_IMPLEMENTATION_HASH = computeBotImplementationHash();
const semanticExceptions = JSON.parse(
  readFileSync(new URL('./sim-data/card-semantic-exceptions.json', import.meta.url), 'utf8'),
);
const POLICY_CALIBRATION_MANIFEST = validatePolicyCalibrationManifest(JSON.parse(
  readFileSync(new URL('./sim-data/policy-calibration-manifest.json', import.meta.url), 'utf8'),
));
const POLICY_CALIBRATION_MANIFEST_HASH = canonicalHash(
  POLICY_CALIBRATION_MANIFEST,
);
const CURRENT_STUDY_MANIFEST = validateStudyManifest(JSON.parse(
  readFileSync(new URL('./sim-data/current-study-manifest.json', import.meta.url), 'utf8'),
));
const CURRENT_STUDY_MANIFEST_HASH = canonicalHash(CURRENT_STUDY_MANIFEST);
const cardDataFindings = validateCardData(raw, { exceptions: semanticExceptions });
const fatalCardDataFindings = cardDataFindings.filter(finding => finding.severity === 'error');
if (fatalCardDataFindings.length > 0) {
  const details = fatalCardDataFindings
    .slice(0, 20)
    .map(finding =>
      `card ${finding.cardId} ability ${finding.abilityIndex ?? '-'} ${finding.path ?? '-'} [${finding.rule}] ${finding.message}`,
    )
    .join('\n');
  throw new Error(
    `Simulation card pool failed semantic validation (${fatalCardDataFindings.length} errors):\n${details}`,
  );
}
const fac = c => c.alignment[0];
const cst = c => ({ mana: c.cost.mana, energy: c.cost.energy, flexible: c.cost.flexible });
const stt = c => c.stats === null
  ? undefined
  : { hp: c.stats.hp, atk: c.stats.atk, arm: c.stats.arm };
const xResource = ability => ability?.cost?.xMana === true
  ? 'mana'
  : ability?.cost?.xEnergy === true
    ? 'energy'
    : undefined;
const abilityKind = ability => {
  switch (String(ability?.type || '').toLowerCase()) {
    case 'ultimate': return 'ultimate';
    case 'counter': return 'counter';
    case 'flash': return 'flash';
    case 'trigger': return 'trigger';
    default: return undefined;
  }
};
const heroResourceTypes = hero => {
  if (Array.isArray(hero.resourceTypes) && hero.resourceTypes.length > 0) {
    return [...new Set(hero.resourceTypes)];
  }
  const inferred = [];
  if ((hero.cost?.mana ?? 0) > 0) inferred.push('mana');
  if ((hero.cost?.energy ?? 0) > 0) inferred.push('energy');
  if (inferred.length > 0) return inferred;
  return [ENERGY_FACTIONS.has(hero.alignment[0]) ? 'energy' : 'mana'];
};
const cardRequiredResourceTypes = card => {
  const costs = [card.cost, ...(card.abilities ?? []).map((ability) => ability.cost)];
  const required = [];
  if (costs.some((cost) => (cost?.mana ?? 0) > 0 || cost?.xMana === true)) {
    required.push('mana');
  }
  if (costs.some((cost) => (cost?.energy ?? 0) > 0 || cost?.xEnergy === true)) {
    required.push('energy');
  }
  return required;
};
const LEGALITY_CARD_BY_ID = new Map(
  raw
    .filter((card) => card.cardType !== 'H' && card.cardType !== 'T')
    .map((card) => [
      card.id,
      {
        id: card.id,
        cardType: card.cardType,
        faction: card.alignment[0],
        alignments: card.alignment,
        rarity: card.rarity,
        requiredResourceTypes: cardRequiredResourceTypes(card),
        ...(card.cardType === 'R'
          ? { resourceType: card.resourceType }
          : {}),
      },
    ]),
);
const LEGALITY_HERO_BY_ID = new Map(
  raw
    .filter((card) => card.cardType === 'H')
    .map((hero) => {
      const resourceTypes = heroResourceTypes(hero);
      return [
        hero.id,
        {
          id: hero.id,
          faction: hero.alignment[0],
          alignments: hero.alignment,
          resourceType: resourceTypes[0],
          resourceTypes,
        },
      ];
    }),
);
const DECK_LEGALITY_INDEX = {
  card: (id) => LEGALITY_CARD_BY_ID.get(id),
  hero: (id) => LEGALITY_HERO_BY_ID.get(id),
};

const cardMap = new Map(), heroMap = new Map(), abilMap = new Map(), heroAbil = new Map(), transformMap = new Map();
for (const c of raw) {
  const dsls = c.abilities.map(a => ({
    ...a.dsl,
    ...(abilityKind(a) ? { abilityKind: abilityKind(a) } : {}),
    ...(xResource(a) ? { xCostResource: xResource(a) } : {}),
  }));
  if (c.cardType === 'H') {
    heroMap.set(c.id, { id: c.id, name: c.name, lp: c.stats.hp, alignment: c.alignment });
    heroAbil.set(c.id, dsls);
  } else if (c.cardType === 'T') {
    if (c.originalHeroId != null) {
      transformMap.set(c.originalHeroId, {
        cardDefId: c.id,
        name: c.name,
        lpDelta: 0,
        abilities: dsls,
      });
    }
  } else {
    const cardXResource = c.abilities.map(xResource).find(Boolean);
    cardMap.set(c.id, { id: c.id, name: c.name, cardType: c.cardType, cost: cst(c), stats: stt(c), traits: c.traits, tags: c.tags, alignment: c.alignment, ...(c.resourceType ? { resourceType: c.resourceType } : {}), ...(cardXResource ? { xCostResource: cardXResource } : {}) });
    abilMap.set(c.id, dsls);
  }
}
const registry = { getCard: id => cardMap.get(id), getHero: id => heroMap.get(id) };
const rCards = raw.filter(c => c.cardType === 'R');
const manaR = rCards.find(c => c.resourceType === 'mana');
const energyR = rCards.find(c => c.resourceType === 'energy');
if (!manaR || !energyR) {
  throw new Error('Card data must define explicit mana and energy Resource cards');
}

// Target a LEGAL, REALISTIC 40-card main deck with a sensible type mix that
// guarantees Equipment + Spells + Characters. Quotas (~24 C / ~10 S / ~6 E) are
// clamped to each faction's copy-limited pool; any shortfall is backfilled from a
// global round-robin. Copy limits (3 / 2-Ethereal / 2-Mythic / 1-Legendary) are never exceeded.
// Deterministic: stable pool order, round-robin pass order — no Math.random.
const DECK_SIZE = 40;
const TYPE_QUOTA = { C: 24, S: 10, E: 6 };

// Mirror deck-legality.ts's copyLimitFor (Rulebook is authoritative): Legendary 1,
// Ethereal 2, Mythic 2, Common 3.
function copyLimit(c) {
  if (c.rarity === 'Legendary') return 1;
  if (c.rarity === 'Ethereal' || c.rarity === 'Mythic') return 2;
  return 3;
}

// Round-robin copies of a type's cards into `main` up to `quota` (and the deck cap),
// tracking per-card copies used so far. Returns number of cards added.
function fillType(main, cards, quota, used) {
  let added = 0;
  let progress = true;
  while (added < quota && main.length < DECK_SIZE && progress) {
    progress = false;
    for (const c of cards) {
      if (added >= quota || main.length >= DECK_SIZE) break;
      const u = used.get(c.id) || 0;
      if (u < copyLimit(c)) { main.push(c.id); used.set(c.id, u + 1); added++; progress = true; }
    }
  }
  return added;
}

function buildDeck(f) {
  const hero = raw.find(c => c.cardType === 'H' && fac(c) === f);
  const pool = raw.filter(c => ['C', 'S', 'E'].includes(c.cardType) && fac(c) === f);
  const byType = { C: [], S: [], E: [] };
  for (const c of pool) byType[c.cardType].push(c);
  const main = [];
  const used = new Map();
  // Fill each type to its quota (clamped to pool copy-limits), then backfill
  // any remaining slots from the whole pool so the deck always reaches DECK_SIZE.
  for (const t of ['C', 'S', 'E']) fillType(main, byType[t], TYPE_QUOTA[t], used);
  if (main.length < DECK_SIZE) fillType(main, pool, DECK_SIZE, used);
  const rid = ENERGY_FACTIONS.has(f) ? energyR.id : manaR.id;
  return { heroDefId: hero.id, mainDeckDefIds: main.slice(0, DECK_SIZE), resourceDeckDefIds: Array.from({ length: RESOURCE_DECK_SIZE }, () => rid) };
}
const decks = Object.fromEntries(FACTIONS.map(f => [f, buildDeck(f)]));
const STUDY_DECK_SEED = 20260726;
const STUDY_DECKS_PER_FACTION = 5;

export function buildCurrentStudyDeckPopulation() {
  return FACTIONS.flatMap((faction) =>
    sampleFactionDecks(faction, STUDY_DECKS_PER_FACTION, {
      seed: STUDY_DECK_SEED,
    }),
  );
}

// ── Explicit-deck resolution (config.decks / matchup deck specs) ──────────────
// A "deck spec" is one of:
//   - a DeckSelection object: { heroDefId, mainDeckDefIds, resourceDeckDefIds }
//   - an integer/string deckId  -> loaded from the DB via deck-loader
//   - a faction name ("Onyx")   -> that faction's REAL official deck (deck-loader)
//   - "auto:<Faction>"          -> the quota-builder auto deck (current fallback)
//   - null/undefined            -> auto deck for the matchup's faction
//
// Resolution returns { deck, faction, label } where `deck` is a plain
// DeckSelection ({heroDefId, mainDeckDefIds, resourceDeckDefIds}). `label` is a
// stable string folded into the runHash so different decks => different hashes.
//
// deck-loader is statically imported (no side effects at import time — it only
// shells out to docker the first time getDeck/loadDecksFromDB is actually
// called). This keeps runSim SYNCHRONOUS (the determinism test relies on it) and
// means auto-only sims never touch the DB.

const DECK_KEY_FIELDS = ['heroDefId', 'mainDeckDefIds', 'resourceDeckDefIds'];
const isDeckSelection = v => v && typeof v === 'object' && DECK_KEY_FIELDS.every(k => k in v);

function plainDeck(d, includeFaction = d.faction !== undefined) {
  return {
    heroDefId: d.heroDefId,
    mainDeckDefIds: d.mainDeckDefIds,
    resourceDeckDefIds: d.resourceDeckDefIds,
    ...(!includeFaction || d.faction === undefined ? {} : { faction: d.faction }),
  };
}

// Resolve a deck spec against `fallbackFaction` (used when spec is null/auto).
// Synchronous: relies on deck-loader being preloaded (see preloadDecksIfNeeded).
function resolveDeckSpec(spec, fallbackFaction, strict = false) {
  // null/undefined -> auto deck for the matchup faction
  if (spec == null) return { deck: decks[fallbackFaction], faction: fallbackFaction, label: `auto:${fallbackFaction}` };

  // explicit DeckSelection object
  if (isDeckSelection(spec)) {
    if (strict && spec.faction !== undefined && !FACTIONS.includes(spec.faction)) {
      throw new Error(`Unknown deck-selection faction ${JSON.stringify(spec.faction)}`);
    }
    const faction = spec.faction && FACTIONS.includes(spec.faction) ? spec.faction : fallbackFaction;
    const id = spec.deckId != null ? `id${spec.deckId}` : `h${spec.heroDefId}`;
    return { deck: plainDeck(spec, strict), faction, label: `sel:${id}` };
  }

  // "auto:<Faction>"
  if (typeof spec === 'string' && spec.startsWith('auto:')) {
    const f = spec.slice(5);
    if (strict && !FACTIONS.includes(f)) {
      throw new Error(`Unknown auto-deck faction ${JSON.stringify(f)}`);
    }
    const faction = FACTIONS.includes(f) ? f : fallbackFaction;
    return { deck: decks[faction], faction, label: `auto:${faction}` };
  }

  // faction name -> real official deck (deck-loader)
  if (typeof spec === 'string' && FACTIONS.includes(spec)) {
    const d = getDeck(spec);
    if (d) {
      return {
        deck: plainDeck(d, strict),
        faction: d.faction || spec,
        label: `real:${d.deckId}`,
      };
    }
    if (strict) throw new Error(`Official deck for faction ${JSON.stringify(spec)} is unavailable`);
    // Legacy diagnostic runs preserve the historical auto-deck fallback.
    return { deck: decks[spec], faction: spec, label: `auto:${spec}` };
  }

  // deckId (int or string) -> deck-loader
  const d = getDeck(spec);
  if (d) {
    const faction = d.faction && FACTIONS.includes(d.faction) ? d.faction : fallbackFaction;
    return { deck: plainDeck(d, strict), faction, label: `real:${d.deckId}` };
  }
  if (strict) throw new Error(`Unknown deck specification ${JSON.stringify(spec)}`);
  // Legacy diagnostic runs preserve the historical auto-deck fallback.
  return { deck: decks[fallbackFaction], faction: fallbackFaction, label: `auto:${fallbackFaction}` };
}

// ── Abilities hydration (mirrors sim-abilities.mjs) ──────────────────────────

const hc = c => (c && abilMap.get(c.cardDefId)?.length ? { ...c, abilities: abilMap.get(c.cardDefId) } : c);
// BUG FIX (config.registerPrintedTriggers): the base Hero's printed triggered
// abilities are hydrated onto `hero.abilities` here but were never registered
// onto `hero.registeredTriggers`, so the dispatch runtime could never see them
// (see GameConfig.registerPrintedTriggers). `registerTriggers` param default
// false ⇒ byte-identical no-op.
function hydrate(s, registerTriggers = false) {
  return {
    ...s,
    players: s.players.map((p, i) => {
      let hero = {
        ...p.hero,
        ...(heroAbil.get(p.hero.cardDefId)?.length ? { abilities: heroAbil.get(p.hero.cardDefId) } : {}),
        ...(transformMap.get(p.hero.cardDefId) ? { transformData: transformMap.get(p.hero.cardDefId) } : {}),
      };
      if (registerTriggers) hero = registerHeroTriggers(hero, i);
      return {
        ...p,
        hero,
        hand: p.hand.map(hc),
        mainDeck: p.mainDeck.map(hc),
        discardPile: p.discardPile.map(hc),
        zones: { reserve: p.zones.reserve.map(hc), frontline: p.zones.frontline.map(hc), highGround: p.zones.highGround.map(hc) },
      };
    }),
  };
}

// ── Deterministic RNG (mulberry32) ───────────────────────────────────────────

function rngf(a) {
  let s = a >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Random policy: concrete actions from available-actions ───────────────────

function concreteActions(acts) {
  const out = [];
  for (const d of (acts.canDeploy || [])) {
    const s = (d.validSlots || []).find(x => x.zone === 'frontline') || (d.validSlots || [])[0];
    if (s && s.slots && s.slots.length) out.push({ type: 'deploy', cardInstanceId: d.cardInstanceId, zone: s.zone, slotIndex: s.slots[0] });
  }
  for (const a of (acts.canAttack || [])) {
    const t = (a.validTargets || a.targets || []);
    const tg = t.length ? t[0] : 'hero';
    out.push({ type: 'declare_attack', attackerInstanceId: a.attackerInstanceId, targetId: typeof tg === 'string' ? tg : (tg.type === 'hero' ? 'hero' : (tg.instanceId || tg.id || 'hero')) });
  }
  for (const c of (acts.canCastSpell || [])) out.push({ type: 'cast_spell', cardInstanceId: c.cardInstanceId });
  for (const a of (acts.canActivateAbility || [])) out.push({ type: 'activate_ability', cardInstanceId: a.cardInstanceId, abilityIndex: a.abilityIndex });
  for (const e of (acts.canAttachEquipment || [])) { const t = (e.validTargets || [])[0]; if (t) out.push({ type: 'attach_equipment', cardInstanceId: e.cardInstanceId, targetInstanceId: t }); }
  for (const m of (acts.canMove || [])) { const d = (m.validDestinations || [])[0]; if (d) out.push({ type: 'move', cardInstanceId: m.cardInstanceId, toZone: d }); }
  for (const id of (acts.canTapReserve || [])) out.push({ type: 'tap_reserve', cardInstanceId: id });
  if (acts.canTransform) out.push({ type: 'declare_transform' });
  return out;
}

export function enumerateChoiceResponses(choice) {
  const optionIds = (choice.options ?? []).map((option) => option.id);
  const min = Math.max(0, choice.minSelections ?? 0);
  const max = Math.min(optionIds.length, choice.maxSelections ?? min);
  const responses = [];
  const build = (start, need, selected) => {
    if (need === 0) {
      responses.push([...selected]);
      return;
    }
    for (let index = start; index <= optionIds.length - need; index++) {
      selected.push(optionIds[index]);
      build(index + 1, need - 1, selected);
      selected.pop();
    }
  };
  for (let count = min; count <= max; count++) build(0, count, []);
  return responses;
}

const ACTION_LIFECYCLE_OUTCOMES = Object.freeze([
  'attempted',
  'declared',
  'resolved',
  'countered',
  'fizzled',
  'rejected',
  'failed',
  'pending',
]);

function emptyActionLifecycleCounts() {
  return Object.fromEntries(
    ACTION_LIFECYCLE_OUTCOMES.map((outcome) => [outcome, 0]),
  );
}

/**
 * Convert command-acceptance records plus the authoritative event log into
 * mutually exclusive terminal action outcomes. `declared` is the accepted
 * subset and therefore intentionally overlaps the terminal buckets; all other
 * terminal buckets reconcile exactly to `attempted`.
 */
export function summarizeActionLifecycle(
  records,
  events,
  pendingChoice = null,
  pendingPriority = null,
) {
  const stackOutcome = new Map();
  for (const event of events) {
    if (event.type === 'STACK_ITEM_RESOLVED') {
      stackOutcome.set(event.stackItemId, 'resolved');
    } else if (event.type === 'STACK_ITEM_COUNTERED') {
      stackOutcome.set(event.stackItemId, 'countered');
    } else if (event.type === 'STACK_ITEM_FIZZLED') {
      stackOutcome.set(event.stackItemId, 'fizzled');
    }
  }
  const overall = emptyActionLifecycleCounts();
  const byKind = {};
  for (const record of records) {
    const counts = byKind[record.kind] ??= emptyActionLifecycleCounts();
    overall.attempted++;
    counts.attempted++;
    let outcome = record.outcome;
    if (outcome === 'pending' && record.stackItemId !== null) {
      outcome = stackOutcome.get(record.stackItemId) ?? 'pending';
    } else if (outcome === 'pending' && record.interactionId !== null) {
      outcome =
        pendingChoice?.interactionId === record.interactionId
          ? 'pending'
          : 'resolved';
    } else if (outcome === 'pending' && pendingPriority === null) {
      outcome = 'resolved';
    }
    if (outcome !== 'rejected' && outcome !== 'failed') {
      overall.declared++;
      counts.declared++;
    }
    overall[outcome]++;
    counts[outcome]++;
  }
  return { overall, byKind };
}

function uniformlyRandomChoiceResponse(choice, random) {
  const responses = enumerateChoiceResponses(choice);
  if (responses.length === 0) return [];
  return responses[Math.floor(random() * responses.length)];
}

// ── First-player compensation ────────────────────────────────────────────────
// Applied at game start to the SECOND player (the one not active on turn 1).

let compInstanceCounter = 0;
export function applyCompensation(gs, mode, faction) {
  if (mode === 'none' || mode === 'reserveT1') return gs;
  const second = gs.activePlayerIndex === 0 ? 1 : 0;
  const wantCard = mode === 'card' || mode === 'both' || mode === 'play_or_draw';
  const wantResource = mode === 'resource' || mode === 'both';
  const resType = ENERGY_FACTIONS.has(faction) ? 'energy' : 'mana';
  const players = gs.players.map((p, i) => {
    if (i !== second) return p;
    let np = p;
    if (wantCard && np.mainDeck.length) {
      np = { ...np, hand: [...np.hand, np.mainDeck[0]], mainDeck: np.mainDeck.slice(1) };
    }
    if (wantResource) {
      // Add one extra ready resource to the bank (counts in getAvailableResources).
      const extra = { instanceId: `comp-${compInstanceCounter++}`, resourceType: resType, exhausted: false };
      np = { ...np, resourceBank: [...np.resourceBank, extra] };
    }
    return np;
  });
  return { ...gs, players };
}

// RULES-ACCURACY FIX (config.firstPlayerCompAfterMulligan, harness-only):
// pre-resolves BOTH players' opening-hand mulligan decisions via the engine's
// pure `applyMulligan`, mirroring the main loop's own mulligan-decision policy
// exactly (see the `pc.type === 'mulligan'` branch further below). Used only so
// `applyCompensation` can run strictly AFTER mulligans resolve (Rulebook: "after
// any mulligans") instead of before. Only called when the flag is ON.
export function resolveMulligans(gs, policyForSeat) {
  let state = gs;
  while (state.pendingChoice && state.pendingChoice.type === 'mulligan') {
    const pc = state.pendingChoice;
    const pcPolicy = policyForSeat(pc.playerId);
    const competent = pcPolicy === 'heuristic' || pcPolicy === 'rollout' || pcPolicy === 'valueGreedy';
    const keep = competent ? shouldKeepHand(state, pc.playerId) : true;
    state = applyMulligan(state, pc.playerId, keep);
  }
  return state;
}

// ── First-player control (diagnostic ablation) ────────────────────────────────
// Neutralize first-player asymmetry without touching game rules by overriding
// which seat is active on turn 1. "random" is the engine default (no-op).
//   "random"      — engine RNG picks (current behavior)
//   "alternating" — seat 0 / seat 1 alternate by game index (each faction goes
//                   first equally often across a pairing => aggregate neutral)
//   "p0" / "p1"   — force a fixed first seat (controlled, symmetric baseline)
function applyFirstPlayer(gs, mode, gameIndex) {
  if (mode === 'random') return gs;
  const first = mode === 'alternating' ? (gameIndex % 2) : mode === 'p1' ? 1 : 0;
  return gs.activePlayerIndex === first ? gs : { ...gs, activePlayerIndex: first };
}

// ── LP scale (diagnostic ablation) ────────────────────────────────────────────
// Multiply each Hero's starting (and max) Life Points by lpScale (default 1) to
// test a high-HP / heal-stall regime. Healing itself is scaled in-engine via
// config.healScale; lpScale only changes the starting/max pool.
function applyLpScale(gs, scale) {
  if (scale === 1) return gs;
  const players = gs.players.map(p => ({
    ...p,
    hero: { ...p.hero, currentLp: Math.round(p.hero.currentLp * scale), maxLp: Math.round(p.hero.maxLp * scale) },
  }));
  return { ...gs, players };
}

// ── Hero-LP override (diagnostic ablation) ────────────────────────────────────
// Override the starting + max LP of ONE faction's Hero to a fixed value, to
// measure the LP head-start's causal contribution (e.g. Radiant 35 -> 30/25).
// `spec` = { faction, lp } (default absent ⇒ no-op). `fA`/`fB` map seat to
// faction so only the matching seat's hero is overridden; both seats in a mirror
// get it (LP cancels — the mirror control). Sets currentLp AND maxLp so the heal
// cap moves with it. Pure: returns a new GameState; never mutates input.
function applyHeroLpOverride(gs, spec, fA, fB) {
  if (!spec || typeof spec.lp !== 'number') return gs;
  const players = gs.players.map((p, i) => {
    const seatFaction = i === 0 ? fA : fB;
    if (seatFaction !== spec.faction) return p;
    return { ...p, hero: { ...p.hero, currentLp: spec.lp, maxLp: spec.lp } };
  });
  return { ...gs, players };
}

// ── Equalize hero LP (design-sweep) ───────────────────────────────────────────
// Set EVERY hero's starting AND max LP to a fixed value, removing the per-faction
// LP head-start variance entirely (distinct from lpScale, which is proportional).
// `lp` = number (default absent ⇒ no-op). Applies to BOTH seats unconditionally
// (faction-agnostic — the whole point is a level LP floor). Pure: returns a new
// GameState; never mutates input. Absent / non-number ⇒ gs untouched ⇒ no-op.
export function applyEqualizeHeroLp(gs, lp) {
  if (typeof lp !== 'number') return gs;
  const players = gs.players.map(p => ({
    ...p,
    hero: { ...p.hero, currentLp: lp, maxLp: lp },
  }));
  return { ...gs, players };
}

// ── Flat creature ATK bonus (design-sweep) ────────────────────────────────────
// Add a flat +N to EVERY CHARACTER instance's ATK (base + current) for BOTH seats
// at hydration — the "pace" lever that lifts small bodies most (distinct from
// damageScale, a multiplier on dealt combat damage). Applied to hand + mainDeck so
// the bonus lands at deploy; runtime tokens are unaffected by design (they are not
// in hand/deck at setup). Heroes / non-character cards untouched. `bonus` = number
// (default absent / 0 ⇒ no-op). ATK floored at 0. Pure: returns a new GameState.
export function applyAtkBonus(gs, bonus) {
  if (typeof bonus !== 'number' || bonus === 0) return gs;
  const bump = c => {
    if (!c || c.cardType !== 'C') return c;
    const atk = Math.max(0, c.baseAtk + bonus);
    return { ...c, baseAtk: atk, currentAtk: atk };
  };
  const players = gs.players.map(p => ({
    ...p,
    hand: p.hand.map(bump),
    mainDeck: p.mainDeck.map(bump),
  }));
  return { ...gs, players };
}

// ── Starting-card bonus (design-sweep) ────────────────────────────────────────
// Each player draws N EXTRA cards into the opening hand (off the top of the
// already-shuffled main deck, after the standard 5). `bonus` = number (default
// absent / <= 0 ⇒ no-op). Never draws past the deck. Applied at setup for BOTH
// seats symmetrically. Pure: returns a new GameState; never mutates input.
export function applyStartingCardBonus(gs, bonus) {
  if (typeof bonus !== 'number' || bonus <= 0) return gs;
  const players = gs.players.map(p => {
    const n = Math.min(bonus, p.mainDeck.length);
    if (n === 0) return p;
    return {
      ...p,
      hand: [...p.hand, ...p.mainDeck.slice(0, n)],
      mainDeck: p.mainDeck.slice(n),
    };
  });
  return { ...gs, players };
}

// ── Faction creature-stat scale (diagnostic ablation) ─────────────────────────
// Scale every CHARACTER instance's stats (ATK/HP/ARM, both base and current) for
// ONE faction's seat by `scale` at setup time — isolating raw stat-for-cost from
// LP and from Flying/evasion. `spec` = { faction, scale } (default absent ⇒
// no-op). Scales cards in hand + mainDeck (every not-yet-deployed body) so the
// effect lands at deploy; runtime tokens (e.g. Defender tokens) are unscaled by
// design. Heroes and resource cards are untouched. Rounds to whole stats; floors
// at HP>=1 so a scaled body is never born dead. Pure: returns new GameState.
function applyFactionStatScale(gs, spec, fA, fB) {
  if (!spec || typeof spec.scale !== 'number' || spec.scale === 1) return gs;
  const s = spec.scale;
  const scaleCard = c => {
    if (!c || c.cardType !== 'C') return c;
    const hp = Math.max(1, Math.round(c.baseHp * s));
    const atk = Math.max(0, Math.round(c.baseAtk * s));
    const arm = Math.max(0, Math.round(c.baseArm * s));
    return { ...c, baseHp: hp, baseAtk: atk, baseArm: arm, currentHp: hp, currentAtk: atk, currentArm: arm };
  };
  const players = gs.players.map((p, i) => {
    const seatFaction = i === 0 ? fA : fB;
    if (seatFaction !== spec.faction) return p;
    return { ...p, hand: p.hand.map(scaleCard), mainDeck: p.mainDeck.map(scaleCard) };
  });
  return { ...gs, players };
}

// ── EC-006 — per-card stat override (default OFF) ─────────────────────────────
// Apply per-card stat DELTAS to specific cardDefIds at setup/hydration time —
// the surgical-nerf lever for EC-006 (e.g. shave −1 HP off a body that wins
// combat exchanges on the last point of stat). `map` = { [cardId]: { atk?, hp?,
// arm? } } where each value is a signed DELTA applied to base AND current stats.
// Card data itself (aetherion-cards.json / DB) is NEVER edited — this is purely a
// sim-time hydration override, exactly like applyFactionStatScale but keyed by
// cardDefId and faction-agnostic (a card is the same card whoever fields it).
// HP floored at 1 (a nerfed body is never born dead), ATK/ARM floored at 0.
// Applied to hand + mainDeck (every not-yet-deployed body) for BOTH seats, so the
// deltas land at deploy. Default OFF (undefined / empty map) ⇒ returns gs
// untouched ⇒ byte-identical no-op. Pure: returns a new GameState.
export function applyCardStatOverride(gs, map) {
  if (!map || typeof map !== 'object' || Object.keys(map).length === 0) return gs;
  const overrideCard = c => {
    if (!c || c.cardType !== 'C') return c;
    const d = map[c.cardDefId];
    if (!d) return c;
    const hp = Math.max(1, c.baseHp + (d.hp || 0));
    const atk = Math.max(0, c.baseAtk + (d.atk || 0));
    const arm = Math.max(0, c.baseArm + (d.arm || 0));
    return { ...c, baseHp: hp, baseAtk: atk, baseArm: arm, currentHp: hp, currentAtk: atk, currentArm: arm };
  };
  const players = gs.players.map(p => ({
    ...p,
    hand: p.hand.map(overrideCard),
    mainDeck: p.mainDeck.map(overrideCard),
  }));
  return { ...gs, players };
}

// ── Per-card COST override (default OFF) — sim-time re-cost lever ──────────────
// `map` = { [cardDefId]: deltaTotal } adds `delta` resource to the card's cost at
// setup (hand + mainDeck, BOTH seats), so the re-cost lands at cast/deploy. Delta is
// added to the card's primary (largest) resource component (mana/energy/flexible).
// Card data is NEVER edited. Default OFF (undefined/empty) ⇒ byte-identical no-op.
function applyCardCostOverride(gs, map) {
  if (!map || typeof map !== 'object' || Object.keys(map).length === 0) return gs;
  const bump = c => {
    if (!c) return c;
    const d = map[c.cardDefId];
    if (!d) return c;
    const cost = c.cost || {};
    const m = cost.mana || 0, e = cost.energy || 0, fx = cost.flexible || 0;
    let key = 'mana';
    if (e >= m && e >= fx && e > 0) key = 'energy';
    else if (fx >= m && fx >= e && fx > 0) key = 'flexible';
    return { ...c, cost: { ...cost, [key]: (cost[key] || 0) + d } };
  };
  const players = gs.players.map(p => ({ ...p, hand: p.hand.map(bump), mainDeck: p.mainDeck.map(bump) }));
  return { ...gs, players };
}

// ── Faction hero-reach ablation (diagnostic) ──────────────────────────────────
// Resolve the public `disableFactionHeroReach: { faction }` spec to the per-SEAT
// flag pair the engine config carries: a seat's flag is true when that seat's
// faction matches `spec.faction` (so a mirror flags BOTH seats — the symmetric
// control). With the flag set, that seat can never reduce the ENEMY hero's LP
// (attack hero-target stripped, direct hero-damage effects no-op). Returns
// undefined when the spec is absent/invalid ⇒ the engine config omits the field
// entirely ⇒ byte-identical no-op. Pure.
function resolveHeroReachSeats(spec, fA, fB) {
  if (!spec || typeof spec.faction !== 'string' || !FACTIONS.includes(spec.faction)) return undefined;
  const flags = [fA === spec.faction, fB === spec.faction];
  return (flags[0] || flags[1]) ? flags : undefined;
}

// ── Zone capacity (design-sweep) ──────────────────────────────────────────────
// Resize each player's Frontline / High Ground zone arrays to the configured slot
// counts (the "add a Frontline / High Ground zone" lever). Capacity in the engine
// is carried by the physical zone-array length (firstOpenSlot / hasOpenSlot /
// getOpenSlotIndices / deploy range-check all read it), so growing the array adds
// real deploy slots and shrinking it caps the board. Pads with `null` (empty new
// slots) or truncates (dropping trailing slots — empty at game start). Reserve is
// never overridden. Defaults (frontline 3, highGround 2) ⇒ arrays unchanged ⇒
// byte-identical no-op. Pure: returns a new GameState; never mutates input.
function resizeSlots(arr, size) {
  if (size === arr.length) return arr;
  if (size > arr.length) return [...arr, ...Array(size - arr.length).fill(null)];
  return arr.slice(0, size);
}
function applyZoneCapacity(gs, frontlineSlots, highGroundSlots) {
  const fl = frontlineSlots ?? 3;
  const hg = highGroundSlots ?? 2;
  if (fl === 3 && hg === 2) return gs;
  const players = gs.players.map(p => ({
    ...p,
    zones: {
      ...p.zones,
      frontline: resizeSlots(p.zones.frontline, fl),
      highGround: resizeSlots(p.zones.highGround, hg),
    },
  }));
  return { ...gs, players };
}

// ── Single game ──────────────────────────────────────────────────────────────

export const LEADER_MODEL = Object.freeze({
  id: 'multicomponent_leader_v1',
  weights: Object.freeze({
    heroLp: 1,
    boardPower: 0.5,
    availableResources: 0.75,
    handSize: 0.5,
    deckRemaining: 0.1,
    transformed: 2,
    readyFrontline: 1,
  }),
});

/**
 * Recomputable turn-snapshot leader model. Every component is directly
 * observable in GameState; no eventual winner or post-snapshot information is
 * used. The weights are predeclared in the study manifest.
 */
export function computeLeaderSnapshot(state) {
  const components = state.players.map((player) => {
    const bodies = [
      ...player.zones.reserve,
      ...player.zones.frontline,
      ...player.zones.highGround,
    ].filter((card) => card?.cardType === 'C');
    return {
      heroLp: player.hero.currentLp,
      boardPower: bodies.reduce(
        (sum, card) =>
          sum + card.currentAtk + card.currentHp + card.currentArm,
        0,
      ),
      availableResources:
        player.resourceBank.filter((resource) => !resource.exhausted).length +
        player.temporaryResources.reduce(
          (sum, resource) => sum + resource.amount,
          0,
        ),
      handSize: player.hand.length,
      deckRemaining: player.mainDeck.length + player.resourceDeck.length,
      transformed: player.hero.transformed ? 1 : 0,
      readyFrontline: [
        ...player.zones.frontline,
        ...player.zones.highGround,
      ].filter((card) => card?.cardType === 'C' && !card.exhausted).length,
    };
  });
  const scores = components.map((component) =>
    Object.entries(LEADER_MODEL.weights).reduce(
      (score, [key, weight]) => score + component[key] * weight,
      0,
    ),
  );
  return {
    modelId: LEADER_MODEL.id,
    components,
    scores,
    leader:
      Math.abs(scores[0] - scores[1]) < 1e-12
        ? 'tie'
        : scores[0] > scores[1]
          ? 0
          : 1,
  };
}

// ── Per-game diagnostics (reporting only) ─────────────────────────────────────
// One post-game walk over the final state's event log. Runs AFTER the game ends
// and writes only result fields computeRunHash never reads — provably unable to
// change outcomes or hashes. Powers the per-matchup/per-faction mechanism evidence
// (§12: win method, transform usage, resource curves, tempo) so verdicts rest on
// in-game data, not marginal win rates alone.
export function gameDiagnostics(fin, winner, decided, timedOut) {
  let turn = 0;
  let active = 0;
  const resAt = [[0, 0, 0], [0, 0, 0]]; // cumulative RESOURCE_GAINED by turn ≤5 / ≤10 / ≤15
  const deploys = [0, 0], deploysEarly = [0, 0], spellsEarly = [0, 0], discards = [0, 0];
  const transformTurn = [null, null];
  // §13b transform autopsy: hero-ability USAGE per side of the flip (counts of
  // hero_* ABILITY_ACTIVATED per ability index, pre vs post transform) plus the
  // hero's LP when the flip happened — distinguishes "kits are weak" from "bots
  // never press the buttons" from "flipped while already dead".
  const heroUsesPre = [{}, {}], heroUsesPost = [{}, {}];
  const lpDelta = [0, 0]; // cumulative heals−damage; LP ≈ maxLp + delta
  const lpAtFlip = [null, null];
  const transformLpDelta = [null, null];
  for (const e of fin.log) {
    switch (e.type) {
      case 'TURN_START':
        turn = e.turnNumber; active = e.playerId; break;
      case 'RESOURCE_GAINED':
        if (turn <= 5) resAt[e.playerId][0] += e.amount;
        if (turn <= 10) resAt[e.playerId][1] += e.amount;
        if (turn <= 15) resAt[e.playerId][2] += e.amount;
        break;
      case 'CARD_DEPLOYED':
        deploys[e.playerId]++; if (turn <= 6) deploysEarly[e.playerId]++; break;
      case 'SPELL_CAST':
        if (turn <= 6) spellsEarly[e.playerId]++; break;
      case 'CARD_DISCARDED':
        // NOTE: hand-size, effect, and discard-for-energy pitches all share this
        // event — total discards, not valve uses (the valve has no distinct event).
        discards[e.playerId]++; break;
      case 'HERO_DAMAGED':
        lpDelta[e.playerId] -= e.amount; break;
      case 'HERO_HEALED':
        lpDelta[e.playerId] += e.amount; break;
      case 'HERO_TRANSFORMED':
        if (transformTurn[e.playerId] === null) {
          transformTurn[e.playerId] = turn;
          lpAtFlip[e.playerId] = e.newCurrentLp ?? e.currentLp;
          transformLpDelta[e.playerId] = {
            maxLp: e.maxLpDelta ?? e.newMaxLp - e.previousMaxLp,
            currentLp:
              e.currentLpDelta ??
              (e.newCurrentLp ?? e.currentLp) -
                (e.previousCurrentLp ?? e.currentLp),
          };
        }
        break;
      case 'ABILITY_ACTIVATED': {
        if (typeof e.cardInstanceId !== 'string' || !e.cardInstanceId.startsWith('hero_')) break;
        const bucket = transformTurn[active] === null ? heroUsesPre : heroUsesPost;
        bucket[active][e.abilityIndex] = (bucket[active][e.abilityIndex] || 0) + 1;
        break;
      }
    }
  }
  return {
    winMethod: timedOut ? (decided ? 'tiebreak' : 'draw') : 'kill',
    winnerLp: decided ? fin.players[winner].hero.currentLp : null,
    transformed: [fin.players[0].hero.transformed, fin.players[1].hero.transformed],
    transformTurn,
    lpAtFlip,
    transformLpDelta,
    survivedAfterFlip: [
      transformTurn[0] !== null ? fin.turnNumber - transformTurn[0] : null,
      transformTurn[1] !== null ? fin.turnNumber - transformTurn[1] : null,
    ],
    heroUsesPre,
    heroUsesPost,
    resAt,
    deploys,
    deploysEarly,
    spellsEarly,
    discards,
  };
}

// SEAT ALTERNATION support: when a game's physical seats are swapped (deckB in
// seat 0, deckA in seat 1) so playGame's internal per-seat logic (hero LP
// override, gameplan, compensation — all keyed by the fA/fB param passed to
// THAT call) stays correct, playGame's raw return labels itself from the seat-0
// deck's point of view — the OPPOSITE of the pairing's true (deck-oriented) A/B.
// This flips every seat-indexed field back so the caller always sees results
// keyed to the pairing's true fA/fB, never a physical seat. `r.dx`'s fields are
// ALL either scalar (winMethod, winnerLp — no seat encoding) or exactly
// length-2 seat-indexed arrays, so a generic array swap is safe and exhaustive.
// Exported for the unit test in tests/sim/seat-fix-knobs.test.ts: runHash does
// not cover dx/spellsCast, so a remap regression on telemetry fields would be
// invisible to the hash-based knob tests; the unit test closes that class.
export function remapSeatSwap(r, trueFA, trueFB) {
  const flip = (v) => (v === 0 ? 1 : v === 1 ? 0 : v); // 'draw'/'tie'/null pass through
  const leaderAt10Snapshot = r.leaderAt10Snapshot
    ? {
        ...r.leaderAt10Snapshot,
        components: [
          r.leaderAt10Snapshot.components[1],
          r.leaderAt10Snapshot.components[0],
        ],
        scores: [
          r.leaderAt10Snapshot.scores[1],
          r.leaderAt10Snapshot.scores[0],
        ],
        leader: flip(r.leaderAt10Snapshot.leader),
      }
    : r.leaderAt10Snapshot;
  const dx = r.dx
    ? Object.fromEntries(
        Object.entries(r.dx).map(([k, v]) =>
          Array.isArray(v) && v.length === 2 ? [k, [v[1], v[0]]] : [k, v],
        ),
      )
    : r.dx;
  return {
    ...r,
    fA: trueFA,
    fB: trueFB,
    winner: flip(r.winner),
    firstPlayer: flip(r.firstPlayer),
    leaderAt10: flip(r.leaderAt10),
    leaderAt10Snapshot,
    spellsCastA: r.spellsCastB,
    spellsCastB: r.spellsCastA,
    dx,
    // trainingRows.mover is stored in PHYSICAL-seat space; remap to true-deck space so
    // the downstream faction stamp (finalize: mover===0?fA:fB) is correct for swapped
    // games. y is already the swap-invariant "side-to-move won" bit — leave it untouched.
    ...(r.trainingRows
      ? { trainingRows: r.trainingRows.map((row) => ({ ...row, mover: flip(row.mover) })) }
      : {}),
    // decisionLog.mover is stored in PHYSICAL-seat space, same as trainingRows.mover
    // above; remap to true-deck space so the downstream faction stamp is correct.
    ...(r.decisionLog
      ? { decisionLog: r.decisionLog.map((row) => ({ ...row, mover: flip(row.mover) })) }
      : {}),
  };
}

function playGame(fA, fB, seed, config, deckA, deckB, gameIndex) {
  // Current simulations must enter through the same canonical constructor as
  // production clients. In particular, the constructor stamps the opening
  // mulligan interaction with the nonce/token required by the authoritative
  // transition boundary. Building a legacy state and adding current flags
  // afterwards leaves the machine unable to accept either mulligan.
  let gs =
    config.rulesProfile === 'current'
      ? createCurrentGame(deckA, deckB, registry, seed)
      : createGame(deckA, deckB, registry, seed, {
          ...(config.resourceDeckSize
            ? { resourceDeckSize: config.resourceDeckSize }
            : {}),
        });
  if (config.abilitiesOn) gs = hydrate(gs, config.registerPrintedTriggers === true);
  gs = applyFirstPlayer(gs, config.firstPlayer, gameIndex);
  gs = applyZoneCapacity(gs, config.frontlineSlots, config.highGroundSlots);
  gs = applyLpScale(gs, config.lpScale);
  gs = applyHeroLpOverride(gs, config.heroLpOverride, fA, fB);
  gs = applyEqualizeHeroLp(gs, config.equalizeHeroLp);
  gs = applyAtkBonus(gs, config.atkBonus);
  gs = applyStartingCardBonus(gs, config.startingCardBonus);
  gs = applyFactionStatScale(gs, config.factionStatScale, fA, fB);
  gs = applyCardStatOverride(gs, config.cardStatOverride);
  gs = applyCardCostOverride(gs, config.cardCostOverride);
  // Resolve the faction-keyed hero-reach ablation to a per-SEAT flag pair the
  // engine config carries (seat = attacking/source player). Absent spec ⇒ undefined
  // ⇒ omitted below ⇒ byte-identical no-op. A mirror gives BOTH seats the flag.
  const disableHeroReachBySeat = resolveHeroReachSeats(config.disableFactionHeroReach, fA, fB);
  // WS-A T-A5 — per-SEAT strategic gameplans for the heuristic pilot. Only built
  // when a gameplan is requested (config.botGameplan truthy); absent ⇒ undefined ⇒
  // omitted below ⇒ the pilot uses its hardcoded constants (≡ NEUTRAL) ⇒
  // byte-identical no-op. Seat 0 = fA, seat 1 = fB (a mirror gives both the same
  // plan). The engine's resolution path never reads this — it cannot affect runHash.
  const botGameplan = config.botGameplan
    ? { 0: gameplanFor(fA), 1: gameplanFor(fB) }
    : undefined;
  const secondFaction = gs.activePlayerIndex === 0 ? fB : fA;
  const policyForSeat = (seatIdx) => (config.botPolicySeat ? config.botPolicySeat[seatIdx] : config.botPolicy);
  // RULES-ACCURACY FIX (config.firstPlayerCompAfterMulligan, harness-only): the
  // book applies the second-player compensation "after any mulligans" — pre-
  // resolve both players' mulligan decisions (mirroring the main loop's own
  // policy below) via the engine's pure applyMulligan BEFORE compensation, so a
  // mulliganing second player still keeps the bonus. Absent/false ⇒
  // byte-identical no-op — compensation runs before the actor (and its
  // MULLIGAN_DECISION-driven mulligan flow) exactly as before.
  gs = config.firstPlayerCompAfterMulligan
    ? applyCompensation(resolveMulligans(gs, policyForSeat), config.firstPlayerCompensation, secondFaction)
    : applyCompensation(gs, config.firstPlayerCompensation, secondFaction);
  // Thread the termination + ablation knobs onto GameState so the engine's
  // transform gate, the heuristic bot, and the effect interpreter all see them.
  // Legacy/custom diagnostic profiles may still provide their archived mutable
  // collector. Current rules reject those hooks and expose only detached,
  // immutable observations in the result envelope.
  const diag = config.__diag ? config.__diag.begin() : undefined;
  gs = {
    ...gs,
    config: {
      terminationMode: config.terminationMode,
      disableEffectTypes: config.disableEffectTypes,
      healScale: config.healScale,
      // DESIGN-SWEEP: combat-damage multiplier (default 1 ⇒ engine-default). Read by
      // the combat resolver / damage calculator. Always threaded (1 = no-op).
      damageScale: config.damageScale,
      // DESIGN-SWEEP: zone-capacity overrides (carried for completeness; the engine
      // reads live capacity off the resized zone arrays). Absent ⇒ default 3/2.
      ...(config.frontlineSlots !== undefined ? { frontlineSlots: config.frontlineSlots } : {}),
      ...(config.highGroundSlots !== undefined ? { highGroundSlots: config.highGroundSlots } : {}),
      ablateShield: config.ablateShield,
      ablateFlying: config.ablateFlying,
      ablateDefenderForcing: config.ablateDefenderForcing,
      ablateBulwark: config.ablateBulwark,
      armBuffsTakeMax: config.armBuffsTakeMax,
      armFirstInstanceOnly: config.armFirstInstanceOnly,
      shieldFirstInstanceOnly: config.shieldFirstInstanceOnly,
      defenderForceCap: config.defenderForceCap,
      disableHeroHealing: config.disableHeroHealing,
      defenderHighGroundOnly: config.defenderHighGroundOnly,
      // DESIGN-SWEEP — engine-read knobs (only emitted when set ⇒ default no-op).
      ...(config.noOverheal ? { noOverheal: true } : {}),
      ...(config.resourceRampBonus ? { resourceRampBonus: config.resourceRampBonus } : {}),
      ...(config.directHighGroundDeploy ? { directHighGroundDeploy: true } : {}),
      ...(disableHeroReachBySeat ? { disableHeroReachBySeat } : {}),
      ...(botGameplan ? { botGameplan } : {}),
      ...(config.fairPilot ? { fairPilot: true } : {}),
      ...(config.reachDiscard ? { reachDiscard: true } : {}),
      ...(config.exileDiscardForEnergy ? { exileDiscardForEnergy: true } : {}),
      ...(config.valuePilot ? { valuePilot: true } : {}),
      ...(config.rampPilot ? { rampPilot: true } : {}),
      ...(config.disableDiscardForEnergy ? { disableDiscardForEnergy: true } : {}),
      // COST FLOOR — rule guard: discounts never take effective cost below 1
      // unless printed 0 (kills the §12c Echoes×Robe 0-cost loop class). ON-only hashed.
      ...(config.costFloor ? { costFloor: true } : {}),
      // RESERVE TAP PACKAGE (§13m): choice = Rulebook 8 step 4's "may" (tap is a
      // player action, not automatic); strain = tapping costs 1 HP, 1-HP bodies
      // can't tap. ON-only hashed; both absent ⇒ byte-identical.
      ...(config.reserveTapChoice ? { reserveTapChoice: true } : {}),
      ...(config.reserveTapStrain ? { reserveTapStrain: true } : {}),
      // RESOURCE DECK SIZE (§13o): truncate each player's Resource Deck post-shuffle.
      ...(config.resourceDeckSize ? { resourceDeckSize: config.resourceDeckSize } : {}),
      // APNAP ANY-ORDER FIX (§13q): side:'any' target resolution returns
      // [activePlayer, nonActivePlayer] instead of seat order. ON-only hashed;
      // absent ⇒ byte-identical.
      ...(config.apnapAnyOrderFix ? { apnapAnyOrderFix: true } : {}),
      // FIRST-PLAYER COMPENSATION CANDIDATES (§13r): alternatives to the locked
      // firstPlayerCompensation:'card' rule, under evaluation. ON-only hashed;
      // absent ⇒ byte-identical.
      ...(config.firstPlayerSkipsFirstResource ? { firstPlayerSkipsFirstResource: true } : {}),
      ...(config.firstPlayerDrawsNormally ? { firstPlayerDrawsNormally: true } : {}),
      // RULES-ACCURACY FIXES — book-order/timing corrections under evaluation for
      // ruleset-v2. ON-only hashed; absent ⇒ byte-identical.
      ...(config.endPhaseOrderFix ? { endPhaseOrderFix: true } : {}),
      ...(config.startOfTurnTriggerAfterReserve ? { startOfTurnTriggerAfterReserve: true } : {}),
      ...(config.transformAtStartOfTurn ? { transformAtStartOfTurn: true } : {}),
      ...(config.heroAbilitiesOncePerTurn ? { heroAbilitiesOncePerTurn: true } : {}),
      // ENGINE CODE TICKET — Tier 3: Flash usable at-will (Action Phase too) +
      // battlefield/Hero Counter/Flash reactions. ON-only hashed; absent ⇒
      // byte-identical no-op (see game-state.ts's GameConfig doc comments).
      ...(config.flashAtWill ? { flashAtWill: true } : {}),
      ...(config.boardReactions ? { boardReactions: true } : {}),
      // ENGINE CODE TICKET — Tier 4: response windows on ALL actions (attack/
      // ability/equip/move), not just casts. ON-only hashed & threaded; absent
      // ⇒ byte-identical no-op (see game-state.ts's GameConfig doc comment).
      ...(config.responseWindowsOnAllActions ? { responseWindowsOnAllActions: true } : {}),
      // BUG FIX: register a card's printed triggered abilities the moment it
      // enters play (deploy/deploy_from_deck/return_from_discard/deploy_token)
      // and register the base Hero's printed abilities at hydration, so
      // on_destroy/on_ally_destroyed/etc. can actually fire. ON-only hashed;
      // absent ⇒ byte-identical no-op (see game-state.ts's GameConfig doc comment).
      ...(config.registerPrintedTriggers ? { registerPrintedTriggers: true } : {}),
      // BUG FIX: an attached equipment's own printed triggers (on_turn_start,
      // on_turn_end, on_ally_deployed, on_spell_cast, on_gain_resource,
      // on_equipment_attached, ...) never fire. ON-only hashed; absent ⇒
      // byte-identical no-op (see game-state.ts's GameConfig.equipmentTriggers
      // doc comment).
      ...(config.equipmentTriggers ? { equipmentTriggers: true } : {}),
      // NEW ABILITY CATEGORY — [React]: event-driven, exhausts source on proc, cannot
      // proc while source is exhausted. ON-only hashed; absent ⇒ byte-identical no-op
      // (see game-state.ts's GameConfig.reactAbilities doc comment).
      ...(config.reactAbilities ? { reactAbilities: true } : {}),
      // BOT TEMPO FIX (see game-state.ts's GameConfig.dynamicDrawValue).
      ...(config.dynamicDrawValue ? { dynamicDrawValue: true } : {}),
      // BUG FIX: a Hero/Transformed-Hero `aura` ability (Seraphina's Holy Ward,
      // Lyria's Knowledge Shield, Lyria-T's Supreme Intellect, ...) was never
      // collected as an aura source. ON-only hashed; absent ⇒ byte-identical
      // no-op (see game-state.ts's GameConfig.heroAuras doc comment).
      ...(config.heroAuras ? { heroAuras: true } : {}),
      ...(config.authoritativeTransitions ? { authoritativeTransitions: true } : {}),
      ...(config.explicitEffectChoices ? { explicitEffectChoices: true } : {}),
      ...(config.observableInteractions ? { observableInteractions: true } : {}),
      ...(config.scopedTurnResets ? { scopedTurnResets: true } : {}),
      ...(config.dispatchTurnBoundaryTriggers ? { dispatchTurnBoundaryTriggers: true } : {}),
      ...(config.effectDrawDeckout ? { effectDrawDeckout: true } : {}),
      ...(config.stateBasedActions ? { stateBasedActions: true } : {}),
      ...(config.simultaneousAllEffects ? { simultaneousAllEffects: true } : {}),
      ...(config.transactionalDeclarations ? { transactionalDeclarations: true } : {}),
      // BOT TEMPO FIX (see game-state.ts's GameConfig.activateAfterDeploy).
      ...(config.activateAfterDeploy ? { activateAfterDeploy: true } : {}),
      // Never hand-copy the current profile: stamp the complete canonical
      // manifest last so newly added rules cannot disappear in this adapter.
      ...(config.rulesProfile === 'current' ? CURRENT_GAME_CONFIG : {}),
      ...(diag ? { diag } : {}),
    },
  };
  if (config.rulesProfile === 'current') gs = recomputeAuras(gs);
  const replayInitialState =
    config.collectReplay === true
      ? JSON.parse(
          JSON.stringify(gs, (key, value) =>
            key === 'diag' || typeof value === 'function' ? undefined : value,
          ),
        )
      : null;
  const replayCommands = [];

  const rnd = rngf((seed ^ 0x9e3779b9) >>> 0);
  const firstPlayer = gs.activePlayerIndex;
  const actor = createActor(gameMachine, { input: { gameState: gs } });
  actor.start();

  // Outcome-driven rollout pilot (botPolicy === 'rollout'): one instance per game,
  // forking THIS actor at each active-player decision point. Deterministic — its
  // rollout seeds derive purely from `seed`. Heuristic/random paths never touch it.
  // config.botPolicySeat is only ever present (see resolveConfig) for a GENUINE
  // per-seat split, so a monolithic run allocates exactly ONE shared pilot here
  // (its decisionIndex counts every decision of the game, exactly as before) —
  // byte-identical to the v10 baseline. A split allocates one pilot PER SEAT that
  // needs it, each counting only that seat's own decisions.
  const legacyHandSizeBridge =
    config.rulesProfile !== 'current' && config.fixHandSizeStall === true;
  const rolloutOpts = { rollouts: config.rollouts, playoutPolicy: config.rolloutPlayout, maxCandidates: config.maxCandidates, depth: config.rolloutDepth, closingReward: config.rolloutClosing, fixHandSizeStall: legacyHandSizeBridge, fairPilot: config.fairPilot, candidateGen: config.candidateGen, candidateKindCaps: config.candidateKindCaps, seedMode: config.rolloutSeedMode, playoutBackend: config.playoutBackend, valueLeafModelPath: config.valueLeafModelPath, collectDecisionLog: config.collectDecisionLog, collectDecisionStates: config.collectDecisionStates, rolloutInteractions: config.rolloutInteractions };
  const rolloutPilot = !config.botPolicySeat && config.botPolicy === 'rollout' ? makeRolloutPilot(rolloutOpts) : null;
  // Neural value-net greedy pilot (botPolicy === 'valueGreedy'): same one-
  // instance-per-monolithic-run / one-per-split-seat allocation discipline as
  // the rollout pilot above, sharing `valueModelPath` from the resolved config.
  const valueOpts = { modelPath: config.valueModelPath };
  const valuePilot = !config.botPolicySeat && config.botPolicy === 'valueGreedy' ? makeValuePilot(valueOpts) : null;
  const botPilotsBySeat = config.botPolicySeat
    ? {
        0: config.botPolicySeat[0] === 'rollout' ? makeRolloutPilot(rolloutOpts)
          : config.botPolicySeat[0] === 'valueGreedy' ? makeValuePilot(valueOpts)
          : null,
        1: config.botPolicySeat[1] === 'rollout' ? makeRolloutPilot(rolloutOpts)
          : config.botPolicySeat[1] === 'valueGreedy' ? makeValuePilot(valueOpts)
          : null,
      }
    : null;
  // Resolve seat 0/1's effective pilot for this decision point (policyForSeat
  // is defined earlier, before compensation/mulligan resolution, for reuse there).
  const pilotForSeat = (seatIdx) => (config.botPolicySeat ? botPilotsBySeat[seatIdx] : (rolloutPilot ?? valuePilot));

  let leaderAt10 = null;
  let leaderAt10Snapshot = null;
  let equipPlayed = 0;   // count of attach_equipment actions actually dispatched
  let spellsCastA = 0;   // cast_spell actions dispatched by seat 0 (faction fA)
  let spellsCastB = 0;   // cast_spell actions dispatched by seat 1 (faction fB)
  let spellsCounters = 0; // reactive Counter/Flash casts (REACTIVE_ACTION) dispatched
  let steps = 0;
  let lastTurn = -1;
  let trainingRowsLastTurn = -1;
  const trainingRows = [];
  const observedTurns = [];
  const observedActions = [];
  const actionCounts = {};
  const choiceCounts = {};
  const responseCounts = {};
  const actionLifecycleRecords = [];
  const xValuesSeen = new Set();
  let terminalReason = null;
  let failure = null;
  const recordFailure = (reason, error, details = {}) => {
    terminalReason = reason;
    failure = {
      code:
        error && typeof error === 'object' && typeof error.code === 'string'
          ? error.code
          : reason,
      message:
        error instanceof Error
          ? error.message
          : typeof error === 'string'
            ? error
            : String(error ?? reason),
      ...details,
    };
  };
  // Test-only, hash-exempt fault seam used to prove that every infrastructure
  // terminal class remains distinct and certification fails closed. It is never
  // synthesized by presets or production entry points.
  if (config.__faultInjection !== undefined) {
    recordFailure(
      config.__faultInjection,
      `Injected simulator fault: ${config.__faultInjection}`,
      { injected: true },
    );
  }
  const sendActorEvent = (event, lifecycleKind = null) => {
    const lifecycle =
      lifecycleKind === null
        ? null
        : {
            kind: lifecycleKind,
            outcome: 'failed',
            stackItemId: null,
            interactionId: null,
          };
    if (lifecycle !== null) actionLifecycleRecords.push(lifecycle);
    try {
      actor.send(event);
      if (lifecycle !== null && config.rulesProfile === 'current') {
        const transitionResult = actor.getSnapshot().context.lastTransition;
        if (transitionResult?.status === 'rejected') {
          lifecycle.outcome = 'rejected';
        } else if (transitionResult?.status === 'failed') {
          lifecycle.outcome = 'failed';
        } else if (transitionResult?.status === 'resolved') {
          lifecycle.outcome = 'resolved';
        } else if (transitionResult?.status === 'pending') {
          const declaration = transitionResult.events.find(
            (candidate) => candidate.type === 'STACK_ITEM_DECLARED',
          );
          lifecycle.outcome = 'pending';
          lifecycle.stackItemId = declaration?.stackItemId ?? null;
          lifecycle.interactionId =
            transitionResult.interaction?.type === 'priority'
              ? null
              : transitionResult.interaction?.interactionId ?? null;
        }
      } else if (lifecycle !== null) {
        lifecycle.outcome = 'resolved';
      }
      if (config.collectReplay === true) {
        replayCommands.push(
          JSON.parse(JSON.stringify(event)),
        );
      }
      if (config.rulesProfile === 'current') {
        const violations = validateGameStateInvariants(
          actor.getSnapshot().context.gameState,
        );
        if (violations.length > 0) {
          const error = new Error(
            `Current state invariant failure: ${violations
              .map((violation) => `${violation.code}@${violation.path}`)
              .join('; ')}`,
          );
          error.code = 'invariant_failure';
          recordFailure('engine_exception', error, { violations });
          return false;
        }
      }
      return true;
    } catch (error) {
      recordFailure('engine_exception', error, { submittedEventType: event.type });
      return false;
    }
  };
  while (steps++ < STEP_CAP) {
    if (terminalReason !== null) break;
    const snap = actor.getSnapshot();
    if (snap.status === 'done') break;
    if (snap.status === 'error') {
      recordFailure('engine_exception', snap.error);
      break;
    }
    gs = snap.context.gameState;
    const lastTransition = snap.context.lastTransition;
    if (lastTransition?.status === 'rejected') {
      recordFailure(
        'illegal_or_stale_action',
        'The authoritative transition rejected a simulator-submitted command',
        {
          actionId: lastTransition.actionId,
          violations: lastTransition.violations,
        },
      );
      break;
    }
    if (lastTransition?.status === 'failed') {
      const reason =
        lastTransition.failure.code === 'guard_exhaustion'
          ? 'guard_exhaustion'
          : 'engine_exception';
      recordFailure(reason, lastTransition.failure.message, {
        actionId: lastTransition.actionId,
        engineFailure: lastTransition.failure,
      });
      break;
    }
    // Observation is result data, never a callback into a running game. Each
    // snapshot is detached and frozen before control returns to the caller.
    if (
      (config.observation?.turnStates === true || config.__trace) &&
      gs.turnNumber !== lastTurn
    ) {
      lastTurn = gs.turnNumber;
      if (config.observation?.turnStates === true) {
        observedTurns.push(immutableSnapshot(gs));
      }
      if (config.__trace) {
        config.__trace.onTurn(gs, {
          spellsCastA,
          spellsCastB,
          equipPlayed,
          spellsCounters,
          actionCounts,
        });
      }
    }
    // Value-net training-data collection (opt-in, parallel-safe): buffer one
    // featurized row per turn start; labeled + attached to the plain result
    // object at game end below (rides back across worker boundaries — unlike
    // __trace, which is a function hook and cannot cross workers).
    if (config.collectTrainingData && gs.turnNumber !== trainingRowsLastTurn) {
      trainingRowsLastTurn = gs.turnNumber;
      trainingRows.push({ f: Array.from(featurize(gs)), turn: gs.turnNumber, mover: gs.activePlayerIndex });
    }
    if (gs.winner != null) break;
    if (gs.turnNumber > config.turnCap) {
      terminalReason =
        config.termination === 'tiebreak'
          ? 'turn_cap_tiebreak'
          : 'turn_cap_draw';
      break;
    }

    // Archived-profile compatibility bridge: legacy-v1 stored the end-of-turn
    // hand-size discard choice is set by the engine on context.pendingChoice but
    // NOT mirrored to context.gameState.pendingChoice, so the bot loop (which only
    // reads gameState.pendingChoice) never sees it and spins on END_PHASE until
    // STEP_CAP — surfacing as a bogus "timeout" with a noisy LP-tiebreak. When the
    // knob is ON, resolve that choice via the engine's own choice bot so the turn
    // can actually pass. Current rules never enter this branch: the interaction
    // is authoritative and mirrored directly in GameState.
    if (legacyHandSizeBridge && gs.pendingChoice == null && snap.context.pendingChoice != null) {
      const cpc = snap.context.pendingChoice;
      let ids;
      try {
        ids = chooseChoiceResponse({ ...gs, pendingChoice: cpc });
      } catch (error) {
        recordFailure('bot_exception', error, {
          decisionKind: 'legacy_hand_limit_choice',
        });
        break;
      }
      if (!sendActorEvent({
        type: 'PLAYER_RESPONSE',
        response: { selectedOptionIds: ids },
      })) break;
      continue;
    }

    if (leaderAt10 === null && gs.turnNumber >= SNOWBALL_TURN) {
      leaderAt10Snapshot = computeLeaderSnapshot(gs);
      leaderAt10 = leaderAt10Snapshot.leader;
    }

    // Reactive priority window (Rulebook 14): drive the responder before the
    // active player resumes. Heuristic uses chooseReactiveAction; random passes
    // unless it holds a reactive option (then casts it with prob RANDOM_ACTION_PROB).
    if (gs.pendingPriority != null) {
      let react = null;
      try {
        const reactPolicy = policyForSeat(gs.pendingPriority.toRespondPlayerId);
        if (
          reactPolicy === 'rollout' &&
          config.rolloutInteractions === true
        ) {
          react = pilotForSeat(
            gs.pendingPriority.toRespondPlayerId,
          ).chooseInteractionReaction(actor, gs, seed, config.turnCap);
        } else if (reactPolicy === 'heuristic' || reactPolicy === 'rollout' || reactPolicy === 'valueGreedy') {
          // Minor decision (scarce reactive cards): both the heuristic and the
          // outcome-driven pilot use the engine's sensible, archetype-neutral
          // reactive policy. The pilot's archetype-neutral SEARCH is on the main
          // proactive turn (deploy/attack/spell/move/transform), not this window.
          react = chooseReactiveAction(gs);
        } else {
          const opts = computeReactiveActions(gs, gs.pendingPriority.toRespondPlayerId);
          if (config.rulesProfile === 'current') {
            const concrete = opts.flatMap((option) => {
              const xValues = option.xValues ?? [undefined];
              return xValues.map((xValue) =>
                option.source === 'board'
                  ? {
                      type: 'activate_ability',
                      cardInstanceId: option.cardInstanceId,
                      abilityIndex: option.abilityIndex,
                      ...(xValue !== undefined ? { xValue } : {}),
                    }
                  : {
                      type: 'cast_spell',
                      cardInstanceId: option.cardInstanceId,
                      ...(xValue !== undefined ? { xValue } : {}),
                    },
              );
            });
            const uniform = [null, ...concrete];
            react = uniform[Math.floor(rnd() * uniform.length)];
          } else if (opts.length && rnd() < RANDOM_ACTION_PROB) {
            react = { type: 'cast_spell', cardInstanceId: opts[0].cardInstanceId };
          }
        }
      } catch (error) {
        recordFailure('bot_exception', error, {
          decisionKind: 'reactive_action',
          playerId: gs.pendingPriority.toRespondPlayerId,
        });
        break;
      }
      if (react == null) {
        responseCounts.pass = (responseCounts.pass || 0) + 1;
        if (!sendActorEvent({ type: 'PRIORITY_PASS' })) break;
      } else {
        spellsCounters++;
        responseCounts[react.type] = (responseCounts[react.type] || 0) + 1;
        if (react.xValue !== undefined) xValuesSeen.add(react.xValue);
      if (!sendActorEvent(
        { type: 'REACTIVE_ACTION', action: react },
        `reactive:${react.type}`,
      )) break;
      }
      continue;
    }

    const pc = gs.pendingChoice;
    if (pc) {
      try {
        choiceCounts[pc.type] = (choiceCounts[pc.type] || 0) + 1;
        const pcPolicy = policyForSeat(pc.playerId);
        const competent = pcPolicy === 'heuristic' || pcPolicy === 'rollout' || pcPolicy === 'valueGreedy';
        if (pc.type === 'mulligan') {
          const keep =
            pcPolicy === 'rollout' && config.rolloutInteractions === true
              ? pilotForSeat(pc.playerId).chooseInteractionMulligan(
                  actor,
                  gs,
                  seed,
                  config.turnCap,
                )
              : competent
                ? shouldKeepHand(gs, pc.playerId)
            : config.rulesProfile === 'current'
              ? rnd() < 0.5
              : true;
          if (!sendActorEvent({
            type: 'MULLIGAN_DECISION',
            playerId: pc.playerId,
            keep,
          })) break;
        } else {
          const ids =
            pcPolicy === 'rollout' && config.rolloutInteractions === true
              ? pilotForSeat(pc.playerId).chooseInteractionChoice(
                  actor,
                  gs,
                  seed,
                  config.turnCap,
                )
              : competent
                ? chooseChoiceResponse(gs)
            : config.rulesProfile === 'current'
              ? uniformlyRandomChoiceResponse(pc, rnd)
              : (pc.options || [])
                  .map(o => o.id)
                  .slice(0, Math.max(pc.minSelections || 0, 0));
          if (!sendActorEvent({
            type: 'PLAYER_RESPONSE',
            playerId: pc.playerId,
            interactionId: pc.interactionId,
            response: { selectedOptionIds: ids },
          })) break;
        }
      } catch (error) {
        recordFailure('bot_exception', error, {
          decisionKind: 'choice_response',
          playerId: pc.playerId,
          interactionId: pc.interactionId,
        });
        break;
      }
      continue;
    }

    let action;
    try {
      const actPolicy = policyForSeat(gs.activePlayerIndex);
      if (actPolicy === 'heuristic') {
        action = chooseAction(gs);
      } else if (actPolicy === 'rollout' || actPolicy === 'valueGreedy') {
        // OUTCOME-DRIVEN rollout pilot: fork this actor, roll each candidate out,
        // pick by game outcome (win-rate, LP-diff tiebreak) — no archetype/board
        // prior. NEURAL value-net pilot: one-ply search over each candidate's
        // afterstate, scored by the value net — see pilot-value.mjs.
        action = pilotForSeat(gs.activePlayerIndex).chooseAction(actor, gs, seed, config.turnCap);
      } else {
        const choices =
          config.rulesProfile === 'current'
            ? enumerateConcretePlayerActions(gs, 'full')
            : concreteActions(
                computeAvailableActions(gs, gs.activePlayerIndex),
              );
        if (config.rulesProfile === 'current') {
          // The current random baseline is uniform over the complete canonical
          // action surface plus the legal pass/phase-advance choice.
          const uniform = [null, ...choices];
          action = uniform[Math.floor(rnd() * uniform.length)];
        } else {
          action =
            choices.length && rnd() < RANDOM_ACTION_PROB
              ? choices[Math.floor(rnd() * choices.length)]
              : null;
        }
      }
    } catch (error) {
      recordFailure('bot_exception', error, {
        decisionKind: 'proactive_action',
        playerId: gs.activePlayerIndex,
      });
      break;
    }
    if (action == null) {
      if (!sendActorEvent({ type: 'END_PHASE' })) break;
    } else {
      if (action.type === 'attach_equipment') equipPlayed++;
      if (action.type === 'cast_spell') { if (gs.activePlayerIndex === 0) spellsCastA++; else spellsCastB++; }
      actionCounts[action.type] = (actionCounts[action.type] || 0) + 1;
      if (action.xValue !== undefined) xValuesSeen.add(action.xValue);
      if (config.observation?.actions === true) {
        observedActions.push(Object.freeze({
          type: action.type,
          turnNumber: gs.turnNumber,
          playerId: gs.activePlayerIndex,
          action: immutableSnapshot(action),
        }));
      }
      if (config.__trace && config.__trace.onAction) config.__trace.onAction(action.type, gs.turnNumber, gs.activePlayerIndex);
      if (!sendActorEvent({ type: 'PLAYER_ACTION', action }, action.type)) break;
    }
  }

  const fin = actor.getSnapshot().context.gameState;
  const lp0 = fin.players[0].hero.currentLp, lp1 = fin.players[1].hero.currentLp;
  let winner = fin.winner;
  let timedOut = false;
  if (terminalReason === null && winner != null) {
    if (fin.log.some((event) => event.type === 'GAME_CONCEDED')) {
      terminalReason = 'concession';
    } else if (
      fin.log.some(
        (event) =>
          event.type === 'GAME_ENDED' &&
          event.reason === 'deck_exhaustion',
      )
    ) {
      terminalReason = 'deck_exhaustion';
    } else {
      terminalReason = 'normal_win';
    }
  }
  if (winner == null) {
    timedOut = true;
    if (terminalReason === null) {
      terminalReason =
        fin.pendingChoice !== null || fin.pendingPriority != null
          ? 'unresolved_interaction'
          : 'step_cap_loop';
    }
    if (
      (terminalReason === 'turn_cap_tiebreak' ||
        terminalReason === 'turn_cap_draw') &&
      config.termination === 'tiebreak'
    ) {
      winner = lp0 === lp1 ? 'draw' : lp0 > lp1 ? 0 : 1;
    } else {
      winner = 'draw';
    }
  }
  const decided = winner === 0 || winner === 1;
  const actionLifecycle = summarizeActionLifecycle(
    actionLifecycleRecords,
    fin.log,
    fin.pendingChoice,
    fin.pendingPriority,
  );
  let replay;
  if (config.collectReplay === true && replayInitialState !== null) {
    const replayConfig = JSON.parse(
      JSON.stringify(config, (key, value) =>
        key === '__diag' ||
        key === '__trace' ||
        key === 'observation' ||
        typeof value === 'function'
          ? undefined
          : value,
      ),
    );
    const provenance = {
      artifactStatus: config.artifactStatus,
      rulesProfile: config.rulesProfile,
      rulesManifestHash: config.rulesManifestHash,
      studyManifestId: config.studyManifestId,
      studyManifestHash: config.studyManifestHash,
      studyArtifactStatus: config.studyArtifactStatus,
      effectiveConfig: replayConfig,
      engine: {
        packageName: ENGINE_PACKAGE.name,
        packageVersion: ENGINE_PACKAGE.version,
        commit: process.env.AETHERION_COMMIT ?? null,
        dirtyPatchHash: process.env.AETHERION_DIRTY_PATCH_HASH ?? null,
        buildHash: CURRENT_ENGINE_BUILD_HASH,
        harnessBuildHash: CURRENT_HARNESS_BUILD_HASH,
      },
      cardPoolHash: CARD_POOL_HASH,
      decks: {
        player0: {
          faction: fA,
          hash: deckContentHash(deckA),
          contents: plainDeck(deckA),
        },
        player1: {
          faction: fB,
          hash: deckContentHash(deckB),
          contents: plainDeck(deckB),
        },
      },
      bot: {
        policy: config.botPolicy,
        policyBySeat: config.botPolicySeat ?? null,
        configHash: policyConfigHash(config),
        implementationHash: CURRENT_BOT_IMPLEMENTATION_HASH,
        calibrationManifestHash: POLICY_CALIBRATION_MANIFEST_HASH,
      },
      rng: {
        gameSeed: seed,
        scheduleVersion: 'semantic-key-v1',
        engineAlgorithm: 'xorshift32-v1',
        policyAlgorithm: 'mulberry32-v1',
      },
    };
    const initialStateHash = canonicalHash(replayInitialState);
    const eventHash = canonicalHash(fin.log);
    const finalStateHash = canonicalHash(fin);
    const traceCore = {
      schemaVersion: 1,
      provenance,
      initialStateHash,
      commands: replayCommands,
      eventHash,
      finalStateHash,
      terminalReason,
    };
    replay = {
      ...traceCore,
      initialState: replayInitialState,
      traceHash: canonicalHash(traceCore),
    };
  }
  // Diagnostic accounting hook (no-op unless a collector is supplied; not hashed).
  if (config.__diag && typeof config.__diag.onGame === 'function') {
    config.__diag.onGame(fin, { fA, fB, firstPlayer, winner, turns: fin.turnNumber }, diag);
  }
  return {
    fA, fB, seed,
    replicate: gameIndex,
    // Four consecutive games form the predeclared counterbalancing block:
    // both first-player assignments within both physical seat assignments.
    // Statistics resample the block as one cluster.
    scheduleBlockId: Math.floor(gameIndex / 4),
    matchupId: canonicalHash({
      participants: [
        { faction: fA, deckHash: deckContentHash(deckA) },
        { faction: fB, deckHash: deckContentHash(deckB) },
      ].sort((a, b) =>
        a.faction.localeCompare(b.faction) ||
        a.deckHash.localeCompare(b.deckHash),
      ),
    }).slice(0, 16),
    winner,
    decided,
    timedOut,
    firstPlayer,
    firstPlayerWon: decided ? winner === firstPlayer : null,
    turns: fin.turnNumber,
    leaderAt10,
    leaderAt10Snapshot,
    equipPlayed,
    spellsCastA,
    spellsCastB,
    spellsCounters,
    policyCoverage: {
      actions: actionCounts,
      choices: choiceCounts,
      responses: responseCounts,
      xValues: [...xValuesSeen].sort((a, b) => a - b),
    },
    actionLifecycle,
    terminalReason,
    ...(failure !== null ? { failure } : {}),
    ...(replay !== undefined ? { replay } : {}),
    ...(config.observation !== null
      ? {
          observation: Object.freeze({
            ...(config.observation.finalState
              ? { finalState: immutableSnapshot(fin) }
              : {}),
            ...(config.observation.turnStates
              ? { turnStates: Object.freeze(observedTurns) }
              : {}),
            ...(config.observation.actions
              ? { actions: Object.freeze(observedActions) }
              : {}),
          }),
        }
      : {}),
    // Post-game diagnostics — computeRunHash never reads this field (hash-exempt).
    dx: gameDiagnostics(fin, winner, decided, timedOut),
    // Candidate-generation pruning telemetry (T2, rollout only) — computeRunHash
    // never reads this field either (same hash-exemption as dx/__diag/__trace).
    ...(rolloutPilot ? { candidatePruning: rolloutPilot.diag } : {}),
    // Value-net training rows (opt-in via config.collectTrainingData) — labeled
    // here from the resolved winner and attached to the plain result object so
    // they ride back across worker boundaries. Draws/timeouts (winner not 0|1)
    // yield clean binary labels only, so nothing is attached for them.
    ...(config.collectTrainingData && decided
      ? { trainingRows: trainingRows.map(row => ({ ...row, y: row.mover === winner ? 1 : 0 })) }
      : {}),
    // Decision log (opt-in via config.collectDecisionLog) — the foundation for
    // pilotability analysis + policy calibration. computeRunHash never reads
    // this field. Decisions made before any terminal outcome remain valid
    // tactical observations, so turn-cap games retain them too.
    ...(config.collectDecisionLog && rolloutPilot
      ? { decisionLog: rolloutPilot.decisionLog }
      : {}),
  };
}

// ── Matchup resolution ───────────────────────────────────────────────────────

function resolveMatchups(matchups) {
  let factions = FACTIONS;
  let includeMirrors = true;
  if (typeof matchups === 'string') {
    includeMirrors = matchups !== 'all-pairs-no-mirror';
  } else if (Array.isArray(matchups)) {
    factions = matchups.filter(f => FACTIONS.includes(f));
    if (!factions.length) factions = FACTIONS;
  } else if (matchups && typeof matchups === 'object') {
    if (Array.isArray(matchups.factions) && matchups.factions.length) {
      factions = matchups.factions.filter(f => FACTIONS.includes(f));
      if (!factions.length) factions = FACTIONS;
    }
    if (typeof matchups.includeMirrors === 'boolean') includeMirrors = matchups.includeMirrors;
  }
  const pairs = [];
  for (let i = 0; i < factions.length; i++) {
    for (let j = i; j < factions.length; j++) {
      if (i === j && !includeMirrors) continue;
      pairs.push([factions[i], factions[j]]);
    }
  }
  return pairs;
}

// A matchup list is an array whose entries are { p0Deck, p1Deck } objects.
function isMatchupList(m) {
  return Array.isArray(m) && m.length > 0 && m.every(x => x && typeof x === 'object' && !Array.isArray(x) && ('p0Deck' in x || 'p1Deck' in x));
}

// Build the full pairing plan: an array of resolved games-per-pairing groups,
// each { fA, fB, deckA, deckB, label }. Two modes:
//   1. EXPLICIT matchup list: config.matchups = [{ p0Deck, p1Deck }, ...]
//   2. Faction pairings (default): from resolveMatchups, with each faction's
//      deck taken from config.decks[faction] override (any deck spec) else auto.
function buildPairingPlan(config) {
  const strict = config.rulesProfile === 'current';
  const assertDeck = (resolved) => {
    if (!strict) return resolved;
    const legality = validateDeck(resolved.deck, DECK_LEGALITY_INDEX);
    if (!legality.legal) {
      const error = new Error(
        `Invalid current-rules deck ${resolved.label}: ${legality.errors.join('; ')}`,
      );
      error.code = 'invalid_deck';
      error.deckLabel = resolved.label;
      error.violations = legality.errors;
      throw error;
    }
    return resolved;
  };
  if (config.studyPopulation === true) {
    if (config.rulesProfile !== 'current') {
      throw new Error('studyPopulation requires rulesProfile current');
    }
    if (config.decks !== undefined || config.matchups !== 'all-pairs') {
      throw new Error(
        'studyPopulation owns decks and requires matchups all-pairs',
      );
    }
    const population = buildCurrentStudyDeckPopulation().map((deck) =>
      assertDeck({
        deck,
        faction: deck.faction,
        label: `study:${deck.deckKey}`,
      }),
    );
    const plan = [];
    for (let left = 0; left < population.length; left++) {
      for (let right = left; right < population.length; right++) {
        const A = population[left];
        const B = population[right];
        plan.push({
          fA: A.faction,
          fB: B.faction,
          deckA: A.deck,
          deckB: B.deck,
          label: `${A.label}:${deckContentHash(A.deck)}|${B.label}:${deckContentHash(B.deck)}`,
        });
      }
    }
    return plan;
  }
  // config.decks: per-faction overrides ({ Onyx: <spec>, ... }) resolved up front.
  const overrides = {};
  if (config.decks && typeof config.decks === 'object' && !Array.isArray(config.decks)) {
    for (const [f, spec] of Object.entries(config.decks)) {
      if (!FACTIONS.includes(f)) {
        if (strict) throw new Error(`Unknown deck override faction ${JSON.stringify(f)}`);
        continue;
      }
      overrides[f] = assertDeck(resolveDeckSpec(spec, f, strict));
    }
  }

  if (isMatchupList(config.matchups)) {
    return config.matchups.map((m, i) => {
      const A = assertDeck(resolveDeckSpec(m.p0Deck, FACTIONS[0], strict));
      const B = assertDeck(resolveDeckSpec(m.p1Deck, FACTIONS[0], strict));
      return {
        fA: A.faction,
        fB: B.faction,
        deckA: A.deck,
        deckB: B.deck,
        label:
          config.rulesProfile === 'current'
            ? `${A.label}:${deckContentHash(A.deck)}|${B.label}:${deckContentHash(B.deck)}`
            : `m${i}:${A.label}|${B.label}`,
      };
    });
  }

  const pairs = resolveMatchups(config.matchups);
  return pairs.map(([a, b]) => {
    const A = assertDeck(
      overrides[a] || { deck: decks[a], faction: a, label: `auto:${a}` },
    );
    const B = assertDeck(
      overrides[b] || { deck: decks[b], faction: b, label: `auto:${b}` },
    );
    return {
      fA: A.faction,
      fB: B.faction,
      deckA: A.deck,
      deckB: B.deck,
      label:
        config.rulesProfile === 'current'
          ? `${A.label}:${deckContentHash(A.deck)}|${B.label}:${deckContentHash(B.deck)}`
          : `${A.label}|${B.label}`,
    };
  });
}

function deckContentHash(deck) {
  return createHash('sha256')
    .update(JSON.stringify(plainDeck(deck)))
    .digest('hex')
    .slice(0, 16);
}

/**
 * Current seed streams are keyed by the matchup's semantic inputs, not its
 * position in a panel. Reordering or expanding a panel therefore cannot change
 * an existing matchup/replicate stream. Historical profiles retain the archived
 * panel-index formula so their pins remain reproducible.
 */
function gameSeed(config, pairing, pairingIndex, replicate) {
  if (config.rulesProfile !== 'current') {
    return (config.seedBase + pairingIndex * 100003 + replicate * 7919) >>> 0;
  }
  const policyKey =
    config.pairedPolicySeedKey ??
    (config.botPolicySeat
      ? `${config.botPolicySeat[0]}|${config.botPolicySeat[1]}`
      : config.botPolicy);
  const key = [
    'aetherion-seed-v1',
    config.seedBase,
    pairing.fA,
    pairing.fB,
    pairing.label,
    policyKey,
    replicate,
  ].join('|');
  const digest = createHash('sha256').update(key).digest();
  return digest.readUInt32LE(0);
}

// ── Config resolution (defaults) ─────────────────────────────────────────────

// Normalize a cardStatOverride map ({ cardId: { atk?, hp?, arm? } }) to a stable,
// canonical form for hashing + application: ascending-cardId key order, and only
// the entries that carry at least one nonzero delta (atk/hp/arm). Returns null when
// the override is absent or has no effective entries — so OFF and an all-zero map
// both resolve to null ⇒ byte-identical to the v10 baseline. Pure.
export function normalizeCardStatOverride(map) {
  if (!map || typeof map !== 'object') return null;
  const out = {};
  for (const id of Object.keys(map).map(Number).filter(n => !Number.isNaN(n)).sort((a, b) => a - b)) {
    const d = map[id];
    if (!d || typeof d !== 'object') continue;
    const entry = {};
    for (const k of ['atk', 'hp', 'arm']) if (typeof d[k] === 'number' && d[k] !== 0) entry[k] = d[k];
    if (Object.keys(entry).length) out[id] = entry;
  }
  return Object.keys(out).length ? out : null;
}

const BOT_POLICIES = ['heuristic', 'random', 'rollout', 'valueGreedy'];

const LEGACY_RULE_PROFILES = Object.freeze({
  'legacy-v1': JSON.parse(readFileSync(new URL('./sim-data/ruleset-v1.json', import.meta.url), 'utf8')),
  'legacy-v2': JSON.parse(readFileSync(new URL('./sim-data/ruleset-v2.json', import.meta.url), 'utf8')),
  'legacy-v3': JSON.parse(readFileSync(new URL('./sim-data/ruleset-v3.json', import.meta.url), 'utf8')),
});

const CURRENT_MANIFEST_HASH = createHash('sha256')
  .update(JSON.stringify(CURRENT_RULES_MANIFEST))
  .digest('hex');

// Normalize a botPolicySeat spec ({ 0: policy, 1: policy }) to a genuine
// per-seat split, or null when it's absent, malformed, or both seats name the
// SAME policy (a "split" that isn't actually one — folds into the monolithic
// botPolicy field instead, see resolveConfig). Pure.
function normalizeBotPolicySeat(spec) {
  if (!spec || typeof spec !== 'object') return null;
  const p0 = spec[0], p1 = spec[1];
  if (!BOT_POLICIES.includes(p0) || !BOT_POLICIES.includes(p1)) return null;
  if (p0 === p1) return null;
  return { 0: p0, 1: p1 };
}

export function assertFreshArtifactExpectations(expectations, actual) {
  if (expectations === undefined || expectations === null) return;
  if (
    typeof expectations !== 'object' ||
    Array.isArray(expectations)
  ) {
    throw new TypeError('artifactExpectations must be an object');
  }
  const allowed = new Set([
    'rulesManifestHash',
    'studyManifestHash',
    'cardPoolHash',
    'engineBuildHash',
  ]);
  for (const key of Object.keys(expectations)) {
    if (!allowed.has(key)) {
      throw new TypeError(`artifactExpectations.${key} is unknown`);
    }
  }
  for (const key of allowed) {
    const expected = expectations[key];
    if (expected !== undefined && expected !== actual[key]) {
      const error = new Error(
        `Stale artifact: expected ${key} ${String(expected)}, current is ${String(actual[key])}`,
      );
      error.code = 'stale_artifact';
      error.artifact = key;
      error.expected = expected;
      error.actual = actual[key];
      throw error;
    }
  }
}

function resolveConfig(config = {}) {
  const requestedConfig = config;
  const rulesProfile = config.rulesProfile ?? 'current';
  if (
    rulesProfile !== 'current' &&
    rulesProfile !== 'custom-diagnostic' &&
    !Object.hasOwn(LEGACY_RULE_PROFILES, rulesProfile)
  ) {
    throw new Error(
      `Unknown rulesProfile ${JSON.stringify(rulesProfile)}; expected current, legacy-v1, legacy-v2, legacy-v3, or custom-diagnostic`,
    );
  }
  const legacyManifest = LEGACY_RULE_PROFILES[rulesProfile];
  if (rulesProfile === 'current') {
    if (config.__diag !== undefined || config.__trace !== undefined) {
      throw new Error(
        'Current rules require declarative observation; mutable __diag/__trace hooks are legacy-only',
      );
    }
    for (const [field, manifestValue] of Object.entries(CURRENT_GAME_CONFIG)) {
      if (
        Object.hasOwn(config, field) &&
        config[field] !== manifestValue
      ) {
        throw new Error(
          `Current rules setting ${field} is locked by the canonical manifest`,
        );
      }
    }
    if (
      Object.hasOwn(config, 'firstPlayerCompensation') &&
      config.firstPlayerCompensation !== 'none'
    ) {
      throw new Error(
        'Current rules setting firstPlayerCompensation is locked by the canonical engine setup',
      );
    }
    if (config.firstPlayerCompAfterMulligan === true) {
      throw new Error(
        'Current rules setting firstPlayerCompAfterMulligan is locked by the canonical engine setup',
      );
    }
  }
  if (requestedConfig.studyPopulation === true) {
    if (!USING_COMMITTED_CARD_POOL) {
      throw new Error(
        'studyPopulation requires the committed sim-data/aetherion-cards.json pool',
      );
    }
    const allowedInputs = new Set([
      'rulesProfile',
      'studyPopulation',
      'gamesPerPairing',
      'collectReplay',
      'certification',
      'artifactExpectations',
      'observation',
      ...Object.keys(CURRENT_GAME_CONFIG),
    ]);
    const unsupported = Object.keys(requestedConfig).filter(
      (key) => !allowedInputs.has(key),
    );
    if (unsupported.length > 0) {
      throw new Error(
        `studyPopulation does not permit diagnostic override ${unsupported[0]}`,
      );
    }
    const gamesPerPairing = requestedConfig.gamesPerPairing ?? 60;
    if (
      !Number.isSafeInteger(gamesPerPairing) ||
      gamesPerPairing <= 0 ||
      gamesPerPairing % 4 !== 0
    ) {
      throw new Error(
        'studyPopulation gamesPerPairing must be a positive multiple of 4',
      );
    }
  }
  const profileRules =
    rulesProfile === 'current'
      ? CURRENT_GAME_CONFIG
      : legacyManifest?.rules ?? {};
  config = { ...profileRules, ...config };
  const artifactStatus =
    rulesProfile === 'current'
      ? CURRENT_RULES_MANIFEST.status
      : rulesProfile.startsWith('legacy-')
        ? 'legacy'
        : 'diagnostic';
  const rulesManifestHash =
    rulesProfile === 'current'
      ? CURRENT_MANIFEST_HASH
      : legacyManifest
        ? createHash('sha256').update(JSON.stringify(legacyManifest)).digest('hex')
        : null;
  const studyManifest =
    rulesProfile === 'current' ? CURRENT_STUDY_MANIFEST : null;
  assertFreshArtifactExpectations(config.artifactExpectations, {
    rulesManifestHash,
    studyManifestHash:
      studyManifest === null ? null : CURRENT_STUDY_MANIFEST_HASH,
    cardPoolHash: CARD_POOL_HASH,
    engineBuildHash: CURRENT_ENGINE_BUILD_HASH,
  });
  const botPolicySeat = normalizeBotPolicySeat(config.botPolicySeat);
  // A uniform (non-split) botPolicySeat spec resolves the monolithic botPolicy
  // to that seat's policy instead — so { 0: 'rollout', 1: 'rollout' } replays
  // byte-identical (same runHash) to plain botPolicy: 'rollout'.
  const uniformSeatPolicy = !botPolicySeat && config.botPolicySeat && typeof config.botPolicySeat === 'object'
    && BOT_POLICIES.includes(config.botPolicySeat[0]) && config.botPolicySeat[0] === config.botPolicySeat[1]
    ? config.botPolicySeat[0]
    : undefined;
  const resolvedBotPolicy = uniformSeatPolicy ?? (config.botPolicy ?? 'heuristic');
  const rolloutActive = resolvedBotPolicy === 'rollout'
    || (botPolicySeat != null && (botPolicySeat[0] === 'rollout' || botPolicySeat[1] === 'rollout'));
  const valueGreedyActive = resolvedBotPolicy === 'valueGreedy'
    || (botPolicySeat != null && (botPolicySeat[0] === 'valueGreedy' || botPolicySeat[1] === 'valueGreedy'));
  const primaryStudy = config.studyPopulation === true;
  const observation = normalizeObservation(config.observation);
  return {
    rulesProfile,
    artifactStatus,
    rulesManifestHash,
    studyManifestId: studyManifest?.studyId ?? null,
    studyManifestHash:
      studyManifest === null ? null : CURRENT_STUDY_MANIFEST_HASH,
    studyArtifactStatus: studyManifest?.status ?? null,
    observation,
    ...(primaryStudy
      ? {
          studyPopulation: true,
          cardPoolHash: CARD_POOL_HASH,
          engineBuildHash: CURRENT_ENGINE_BUILD_HASH,
          harnessBuildHash: CURRENT_HARNESS_BUILD_HASH,
          botImplementationHash: CURRENT_BOT_IMPLEMENTATION_HASH,
          policyCalibrationManifestHash: POLICY_CALIBRATION_MANIFEST_HASH,
        }
      : {}),
    ...(config.artifactExpectations !== undefined
      ? { artifactExpectations: { ...config.artifactExpectations } }
      : {}),
    matchups: primaryStudy ? 'all-pairs' : (config.matchups ?? 'all-pairs'),
    gamesPerPairing: config.gamesPerPairing ?? 60,
    turnCap: primaryStudy ? 80 : (config.turnCap ?? 80),
    abilitiesOn: primaryStudy ? true : (config.abilitiesOn ?? true),
    botPolicy: primaryStudy ? 'heuristic' : resolvedBotPolicy,
    // Per-seat policy split (see the doc header + normalizeBotPolicySeat). Only
    // emitted (and hashed) for a GENUINE split — a uniform spec folds into
    // `botPolicy` above and never reaches here, so a default/monolithic run
    // (or a uniform per-seat spec) is byte-identical to the v10 baseline.
    ...(botPolicySeat ? { botPolicySeat } : {}),
    // Outcome-driven rollout pilot knobs. ONLY emitted (and hashed) when the
    // rollout policy is active on at least one seat, so any heuristic/random run
    // is byte-identical to the v10 baseline. `rollouts` = playouts per candidate;
    // `rolloutPlayout` = the default policy inside a playout ('random' =
    // archetype-neutral, primary; 'heuristic' = the value-bot cross-check);
    // `maxCandidates` caps branching.
    ...(rolloutActive
      ? {
          rollouts: config.rollouts ?? 16,
          rolloutPlayout: config.rolloutPlayout ?? 'random',
          maxCandidates: config.maxCandidates ?? 12,
          // Turn-depth horizon for each playout (0 = roll to game end). A positive
          // depth scores the leaf by LP-differential — faster, still archetype-neutral.
          // Fair pilot defaults the horizon to 0 (roll to game end) so control's
          // late-game inevitability is not penalized; recorded in the hashed config.
          rolloutDepth: config.rolloutDepth ?? (config.fairPilot ? 0 : 3),
          // T-A2 — reward decided+fast wins / penalize stalls in the outcome score.
          // Default true to match pilot-rollout; emitted (and hashed) ONLY under the
          // rollout policy, so heuristic/random runs stay byte-identical to v10.
          rolloutClosing: config.rolloutClosing ?? true,
          // T2 — candidateGen: NEW candidate-enumeration dimension for the pilot's
          // CANDIDATE search only (not the separate playout-internal enumerator —
          // see CONFIG.md). Emitted (and hashed) ONLY when explicitly set to a
          // non-'legacy' value, so an unset (or explicit 'legacy') run stays
          // byte-identical to every historical runHash.
          ...(config.candidateGen && config.candidateGen !== 'legacy'
            ? { candidateGen: config.candidateGen }
            : {}),
          // T2 — candidateKindCaps: explicit per-kind candidate-survivor caps.
          // Emitted (and hashed) ONLY when the caller supplies an override; the
          // default (4 per kind, internal to pilot-rollout.mjs) is a byte-identical
          // no-op.
          ...(config.candidateKindCaps && typeof config.candidateKindCaps === 'object'
            ? { candidateKindCaps: config.candidateKindCaps }
            : {}),
          // T3 — rolloutSeedMode: 'actionKey' keys each candidate's playout
          // streams by its stable action identity instead of its position, so a
          // coverage A/B (candidateGen legacy vs full) shares streams for common
          // candidates. Emitted (and hashed) ONLY when explicitly set to a
          // non-'index' value ⇒ unset/'index' runs stay byte-identical to every
          // historical runHash.
          ...(config.rolloutSeedMode && config.rolloutSeedMode !== 'index'
            ? { rolloutSeedMode: config.rolloutSeedMode }
            : {}),
          // T7 — playoutBackend: 'snapshot' steps playouts purely (no actor
          // forking). A HARNESS dimension like WORKERS, not a rules dimension:
          // carried in the resolved config for provenance (results/ledger show
          // which backend produced a run) but STRIPPED from the hash by
          // computeRunHash — identical hashes across backends are the
          // equivalence claim (pinned in rollout-pin.test.ts). Emitted only
          // when explicitly set to a non-'actor' value.
          ...(config.playoutBackend && config.playoutBackend !== 'actor'
            ? { playoutBackend: config.playoutBackend }
            : {}),
          // Policy-calibration dimension: apply rollout outcome search to real
          // priority and explicit-choice decisions as well as proactive turns.
          // Explicit opt-in preserves every historical rollout configuration.
          ...(config.rolloutInteractions
            ? { rolloutInteractions: true }
            : {}),
          // Stage E — valueLeafModelPath: when set, a TRUNCATED (non-terminal)
          // rollout leaf is scored by this value net's win-probability instead
          // of the LP-diff heuristic; terminal leaves are unaffected. A real
          // rules dimension (a different net picks different games), so it is
          // deliberately NOT stripped by computeRunHash. The model's own
          // content hash (`valueLeafModelSha`) and the featurizer's schema
          // version are hashed alongside it, same discipline as valueModelPath
          // above. Emitted (and hashed) ONLY when set ⇒ an unset run stays
          // byte-identical to every historical runHash.
          ...(config.valueLeafModelPath
            ? {
                valueLeafModelPath: config.valueLeafModelPath,
                ...(computeModelSha(config.valueLeafModelPath)
                  ? { valueLeafModelSha: computeModelSha(config.valueLeafModelPath) }
                  : {}),
                valueLeafFeatureSchemaVersion: FEATURE_SCHEMA_VERSION,
              }
            : {}),
        }
      : {}),
    // Neural value-net greedy pilot (botPolicy 'valueGreedy'). ONLY emitted (and
    // hashed) when the policy is active on at least one seat, so any
    // heuristic/random/rollout run is byte-identical to before. `valueModelPath`
    // is a real rules dimension — a different net picks different games — so it
    // is deliberately NOT stripped by computeRunHash. The model's own content
    // hash (`valueModelSha`) and the featurizer's schema version are hashed
    // alongside it: two configs naming the same path but a DIFFERENT model file
    // (or a stale featurizer) must not collide on runHash.
    ...(valueGreedyActive
      ? {
          valueModelPath: config.valueModelPath ?? null,
          ...(config.valueModelPath && computeModelSha(config.valueModelPath)
            ? { valueModelSha: computeModelSha(config.valueModelPath) }
            : {}),
          valueFeatureSchemaVersion: FEATURE_SCHEMA_VERSION,
        }
      : {}),
    // STALL-FIX knob: resolve the end-of-turn hand-size discard choice (which the
    // engine sets on context.pendingChoice but does not mirror to
    // gameState.pendingChoice) so the bot loop can pass the turn instead of spinning
    // on END_PHASE until STEP_CAP. Only emitted (and hashed) when ENABLED ⇒ a default
    // run is byte-identical to the v10 baseline.
    ...(rulesProfile !== 'current' && config.fixHandSizeStall
      ? { fixHandSizeStall: true }
      : {}),
    firstPlayerCompensation: primaryStudy
      ? 'none'
      : (config.firstPlayerCompensation ?? 'none'),
    termination: primaryStudy ? 'none' : (config.termination ?? 'none'),
    terminationMode: primaryStudy
      ? 'turn_cap'
      : (config.terminationMode ?? 'turn_cap'),
    // ── Diagnostic ablation knobs (all default to a no-op) ───────────────────
    firstPlayer: primaryStudy ? 'alternating' : (config.firstPlayer ?? 'random'),
    lpScale: config.lpScale ?? 1,
    healScale: config.healScale ?? 1,
    disableEffectTypes: Array.isArray(config.disableEffectTypes) ? config.disableEffectTypes : [],
    // DESIGN-SWEEP — combat-damage multiplier (the "increase damage / faster kills"
    // lever). Scales every COMBAT damage instance (character + hero face) after
    // ARM + shield, rounded with Math.round. Only emitted into the resolved (hashed)
    // config when a real (≠1) scale is given ⇒ a default run is byte-identical.
    ...(typeof config.damageScale === 'number' && config.damageScale !== 1
      ? { damageScale: config.damageScale }
      : {}),
    // DESIGN-SWEEP — per-player zone-capacity overrides (the "add a Frontline / High
    // Ground zone" lever). frontlineSlots default 3, highGroundSlots default 2.
    // Only emitted (and hashed) when a value differs from the default ⇒ a default
    // 3/2 run is byte-identical to the baseline. The sim-runner resizes the physical
    // zone arrays to match (applyZoneCapacity); the engine reads capacity off the
    // live array length.
    ...(typeof config.frontlineSlots === 'number' && config.frontlineSlots !== 3
      ? { frontlineSlots: config.frontlineSlots }
      : {}),
    ...(typeof config.highGroundSlots === 'number' && config.highGroundSlots !== 2
      ? { highGroundSlots: config.highGroundSlots }
      : {}),
    // Radiant win-driver single-component ablations. Only emitted into the resolved
    // (hashed) config when ENABLED, so a default run is byte-identical to before.
    ...(config.ablateShield ? { ablateShield: true } : {}),
    ...(config.ablateFlying ? { ablateFlying: true } : {}),
    ...(config.ablateDefenderForcing ? { ablateDefenderForcing: true } : {}),
    ...(config.ablateBulwark ? { ablateBulwark: true } : {}),
    // EC-001 rule variant: combine ARM buffs by max instead of sum. Only emitted
    // into the resolved (hashed) config when ENABLED, so a default run is
    // byte-identical to the v10 baseline.
    ...(config.armBuffsTakeMax ? { armBuffsTakeMax: true } : {}),
    // EC-002 rule variant: ARM reduces only a body's FIRST combat instance per
    // turn. Same gating discipline — only emitted (and hashed) when ENABLED, so a
    // default run is byte-identical to the v10 baseline.
    ...(config.armFirstInstanceOnly ? { armFirstInstanceOnly: true } : {}),
    // EC-003 rule variant: the −1 "would take damage" shield reduces only a body's
    // FIRST combat instance per turn. Same gating discipline — only emitted (and
    // hashed) when ENABLED, so a default run is byte-identical to the v10 baseline.
    ...(config.shieldFirstInstanceOnly ? { shieldFirstInstanceOnly: true } : {}),
    // EC-004 rule variant: a Frontline Defender forces at most N attackers onto
    // itself per turn (then attackers flow around). Only emitted (and hashed) when a
    // positive cap is set, so an unset/<=0 cap is byte-identical to the v10 baseline.
    ...(typeof config.defenderForceCap === 'number' && config.defenderForceCap > 0
      ? { defenderForceCap: config.defenderForceCap }
      : {}),
    // EC-005 rule variant: nullify all healing applied to a HERO (character healing
    // intact). Only emitted (and hashed) when ENABLED ⇒ default is byte-identical.
    ...(config.disableHeroHealing ? { disableHeroHealing: true } : {}),
    // EC-007 rule variant: a Defender forces ONLY from High Ground (Frontline
    // Defenders no longer wall). Only emitted (and hashed) when ENABLED ⇒ default
    // is byte-identical to the v10 baseline.
    ...(config.defenderHighGroundOnly ? { defenderHighGroundOnly: true } : {}),
    // TEST A rule variant: ARM reduces only the FIRST combat instance a body ever
    // takes (absolute, once per game), then never again. Only emitted (and hashed)
    // when ENABLED ⇒ default run is byte-identical to the base.
    ...(config.armOneTimeAbsolute ? { armOneTimeAbsolute: true } : {}),
    // TEST B rule variant: ARM is a charge counter — each instance fully negated and
    // a charge spent until charges reach 0; no recovery without a fresh ARM buff.
    // Only emitted (and hashed) when ENABLED ⇒ default run is byte-identical.
    ...(config.armChargeAbsorb ? { armChargeAbsorb: true } : {}),
    // REACH DECOMP — disableFactionHeroReach: pin ONE faction so it can never reduce
    // the ENEMY Hero's LP ({ faction }) — its attackers cannot target the enemy hero
    // and its direct-hero-damage effects no-op (it can still kill enemy creatures).
    // Isolates "reach" (the hero-damage win condition): with it ON the faction can
    // only win by deckout/tiebreak, never by lethal. Only emitted (and hashed) when a
    // valid faction is given ⇒ default run is byte-identical to the v10 baseline.
    ...(config.disableFactionHeroReach && FACTIONS.includes(config.disableFactionHeroReach.faction)
      ? { disableFactionHeroReach: { faction: config.disableFactionHeroReach.faction } }
      : {}),
    // DESIGN-SWEEP — equalize EVERY hero's starting+max LP to a fixed value (removes
    // the LP head-start variance; distinct from the proportional lpScale). Only
    // emitted (and hashed) when a number is given ⇒ default run is byte-identical.
    ...(typeof config.equalizeHeroLp === 'number'
      ? { equalizeHeroLp: config.equalizeHeroLp }
      : {}),
    // DESIGN-SWEEP — flat +N ATK on every CHARACTER (base+current) at hydration (the
    // "pace" lever; lifts small bodies most). Only emitted (and hashed) when a real
    // (≠0) bonus is given ⇒ a default run is byte-identical to the baseline.
    ...(typeof config.atkBonus === 'number' && config.atkBonus !== 0
      ? { atkBonus: config.atkBonus }
      : {}),
    // DESIGN-SWEEP — +N opening-hand cards per player. Only emitted (and hashed) when
    // a positive bonus is given ⇒ a default run is byte-identical to the baseline.
    ...(typeof config.startingCardBonus === 'number' && config.startingCardBonus > 0
      ? { startingCardBonus: config.startingCardBonus }
      : {}),
    // DESIGN-SWEEP — healing yields no overheal payoff (CHARACTER_OVERHEALED
    // suppressed). Only emitted (and hashed) when ENABLED ⇒ default is byte-identical.
    ...(config.noOverheal ? { noOverheal: true } : {}),
    // DESIGN-SWEEP — N extra Resource draws per Upkeep (faster ramp). Only emitted
    // (and hashed) when a positive bonus is given ⇒ default run is byte-identical.
    ...(typeof config.resourceRampBonus === 'number' && config.resourceRampBonus > 0
      ? { resourceRampBonus: config.resourceRampBonus }
      : {}),
    // DESIGN-SWEEP — any character may deploy directly to High Ground (surcharge 0).
    // Only emitted (and hashed) when ENABLED ⇒ default run is byte-identical.
    ...(config.directHighGroundDeploy ? { directHighGroundDeploy: true } : {}),
    // WS-A T-A5 — per-faction PILOT gameplans (the heuristic de-bias knob). When
    // truthy, playGame threads gameplanFor(seatFaction) per-seat onto gs.config so
    // the pilot scores to each faction's archetype instead of its hardcoded
    // constants. Only emitted (and hashed) when ENABLED ⇒ a default run is
    // byte-identical to the v10 baseline (absent ⇒ NEUTRAL ⇒ no-op).
    ...(config.botGameplan ? { botGameplan: true } : {}),
    // FAIR-PILOT — opt-in heuristic/rollout fairness for control/value/recursion decks.
    // Only emitted (and hashed) when ENABLED ⇒ a default run is byte-identical to baseline.
    ...(config.fairPilot ? { fairPilot: true } : {}),
    // REACH-DISCARD — opt-in bot policy: discard only to fund a one-resource-short play.
    // Read only by the heuristic; emitted (and hashed) only when ON ⇒ default is no-op.
    ...(config.reachDiscard ? { reachDiscard: true } : {}),
    // EXILE-DISCARD — rule variant: discard_for_energy exiles instead of binning.
    // Emitted (and hashed) only when ON ⇒ default is byte-identical.
    ...(config.exileDiscardForEnergy ? { exileDiscardForEnergy: true } : {}),
    // VALUE-PILOT — opt-in bot policy: rank deploy/keep by the card-power+synergy engine.
    // Read only by the heuristic; emitted (and hashed) only when ON ⇒ default is no-op.
    ...(config.valuePilot ? { valuePilot: true } : {}),
    // RAMP-PILOT — opt-in bot policy on top of valuePilot: early-game deploy bonus for
    // ramp signals (the cost-free score's blind spot). Heuristic-only; ON-only hashed.
    ...(config.rampPilot ? { rampPilot: true } : {}),
    // DISCARD-FOR-ENERGY ABLATION — diagnostic rule probe: remove the action entirely
    // (a universal rule only the pool's Energy faction can exploit). ON-only hashed.
    ...(config.disableDiscardForEnergy ? { disableDiscardForEnergy: true } : {}),
    // COST FLOOR — rule guard: discounts never take effective cost below 1 unless
    // printed 0 (kills the §12c Echoes×Robe 0-cost loop class). ON-only hashed.
    ...(config.costFloor ? { costFloor: true } : {}),
    ...(config.reserveTapChoice ? { reserveTapChoice: true } : {}),
    ...(config.reserveTapStrain ? { reserveTapStrain: true } : {}),
    ...(config.resourceDeckSize ? { resourceDeckSize: config.resourceDeckSize } : {}),
    // APNAP ANY-ORDER FIX (§13q) — see game-state.ts. ON-only hashed.
    ...(config.apnapAnyOrderFix ? { apnapAnyOrderFix: true } : {}),
    // FIRST-PLAYER COMPENSATION CANDIDATES (§13r) — see game-state.ts. ON-only hashed.
    ...(config.firstPlayerSkipsFirstResource ? { firstPlayerSkipsFirstResource: true } : {}),
    ...(config.firstPlayerDrawsNormally ? { firstPlayerDrawsNormally: true } : {}),
    // RULES-ACCURACY FIXES — book-order/timing corrections under evaluation for
    // ruleset-v2 (endPhaseOrderFix/startOfTurnTriggerAfterReserve/
    // transformAtStartOfTurn are engine GameConfig flags — see game-state.ts;
    // firstPlayerCompAfterMulligan is harness-only, see playGame/resolveMulligans
    // above). All ON-only hashed; absent ⇒ byte-identical.
    ...(config.endPhaseOrderFix ? { endPhaseOrderFix: true } : {}),
    ...(config.startOfTurnTriggerAfterReserve ? { startOfTurnTriggerAfterReserve: true } : {}),
    ...(config.transformAtStartOfTurn ? { transformAtStartOfTurn: true } : {}),
    ...(config.heroAbilitiesOncePerTurn ? { heroAbilitiesOncePerTurn: true } : {}),
    // ENGINE CODE TICKET — Tier 3 (see game-state.ts's GameConfig doc comments).
    // ON-only hashed; absent ⇒ byte-identical.
    ...(config.flashAtWill ? { flashAtWill: true } : {}),
    ...(config.boardReactions ? { boardReactions: true } : {}),
    // ENGINE CODE TICKET — Tier 4 (see game-state.ts's GameConfig doc comment).
    // ON-only hashed; absent ⇒ byte-identical.
    ...(config.responseWindowsOnAllActions ? { responseWindowsOnAllActions: true } : {}),
    // BUG FIX (see game-state.ts's GameConfig.registerPrintedTriggers doc comment).
    // ON-only hashed; absent ⇒ byte-identical.
    ...(config.registerPrintedTriggers ? { registerPrintedTriggers: true } : {}),
    // BUG FIX (see game-state.ts's GameConfig.equipmentTriggers doc comment).
    // ON-only hashed; absent ⇒ byte-identical.
    ...(config.equipmentTriggers ? { equipmentTriggers: true } : {}),
    // NEW ABILITY CATEGORY — [React] (see game-state.ts's GameConfig.reactAbilities
    // doc comment). ON-only hashed; absent ⇒ byte-identical.
    ...(config.reactAbilities ? { reactAbilities: true } : {}),
    // BOT TEMPO FIX (see game-state.ts's GameConfig.dynamicDrawValue). Bot-only but
    // hashed so ON runs are distinguishable; absent ⇒ byte-identical.
    ...(config.dynamicDrawValue ? { dynamicDrawValue: true } : {}),
    // BUG FIX (see game-state.ts's GameConfig.heroAuras doc comment). ON-only
    // hashed; absent ⇒ byte-identical.
    ...(config.heroAuras ? { heroAuras: true } : {}),
    ...(config.authoritativeTransitions ? { authoritativeTransitions: true } : {}),
    ...(config.explicitEffectChoices ? { explicitEffectChoices: true } : {}),
    ...(config.observableInteractions ? { observableInteractions: true } : {}),
    ...(config.scopedTurnResets ? { scopedTurnResets: true } : {}),
    ...(config.dispatchTurnBoundaryTriggers ? { dispatchTurnBoundaryTriggers: true } : {}),
    ...(config.effectDrawDeckout ? { effectDrawDeckout: true } : {}),
    ...(config.stateBasedActions ? { stateBasedActions: true } : {}),
    ...(config.simultaneousAllEffects ? { simultaneousAllEffects: true } : {}),
    ...(config.transactionalDeclarations ? { transactionalDeclarations: true } : {}),
    // BOT TEMPO FIX (see game-state.ts's GameConfig.activateAfterDeploy). Bot-only,
    // but hashed so ON runs are distinguishable; absent ⇒ byte-identical.
    ...(config.activateAfterDeploy ? { activateAfterDeploy: true } : {}),
    ...(config.firstPlayerCompAfterMulligan ? { firstPlayerCompAfterMulligan: true } : {}),
    // MEASUREMENT-HARNESS KNOB — seat-neutral panels (see playPairing). NOT a rule;
    // affects only which seat each deck sits in per game, hashed so ON runs differ.
    ...(primaryStudy || config.seatAlternation ? { seatAlternation: true } : {}),
    // RAW-POWER DECOMP — hero-LP head-start override: pin ONE faction's Hero
    // starting+max LP to a fixed value ({ faction, lp }). Only emitted (and hashed)
    // when a valid spec is given ⇒ default run is byte-identical to the v10 baseline.
    ...(config.heroLpOverride && typeof config.heroLpOverride.lp === 'number'
      ? { heroLpOverride: { faction: config.heroLpOverride.faction, lp: config.heroLpOverride.lp } }
      : {}),
    // RAW-POWER DECOMP — faction creature-stat scale: multiply ONE faction's
    // CHARACTER stats ({ faction, scale }) at setup. Only emitted (and hashed) when
    // a real (≠1) scale is given ⇒ default run is byte-identical to the v10 baseline.
    ...(config.factionStatScale && typeof config.factionStatScale.scale === 'number' && config.factionStatScale.scale !== 1
      ? { factionStatScale: { faction: config.factionStatScale.faction, scale: config.factionStatScale.scale } }
      : {}),
    // EC-006 — per-card stat OVERRIDE (the surgical-nerf lever): a map of cardId →
    // { atk?, hp?, arm? } signed deltas applied at hydration. Card data is never
    // edited; this is sim-time only. Normalized to a stable, non-empty form and only
    // emitted into the resolved (hashed) config when it has real entries ⇒ a default
    // (undefined / empty) override is byte-identical to the v10 baseline.
    ...(normalizeCardStatOverride(config.cardStatOverride)
      ? { cardStatOverride: normalizeCardStatOverride(config.cardStatOverride) }
      : {}),
    ...(config.cardCostOverride && typeof config.cardCostOverride === 'object' && Object.keys(config.cardCostOverride).length
      ? { cardCostOverride: config.cardCostOverride }
      : {}),
    seedBase: primaryStudy ? 20260726 : (config.seedBase ?? 12345),
    // Cross-policy sensitivity panels set one explicit key so policy arms share
    // exogenous game streams. The key is hashed and forbidden in primary-study
    // mode; ordinary runs remain keyed by their actual policy identity.
    ...(typeof config.pairedPolicySeedKey === 'string' &&
    config.pairedPolicySeedKey.length > 0
      ? { pairedPolicySeedKey: config.pairedPolicySeedKey }
      : {}),
    // Explicit-deck overrides / matchup-deck specs (undefined => auto decks).
    ...(config.decks !== undefined ? { decks: config.decks } : {}),
    // Diagnostic accounting collector (read-only side-channel). Stripped from the
    // hashed config in computeRunHash so attaching it keeps runHash byte-identical.
    ...(config.__diag !== undefined ? { __diag: config.__diag } : {}),
    // Per-turn telemetry collector (read-only side-channel; same hash-strip as __diag).
    ...(config.__trace !== undefined ? { __trace: config.__trace } : {}),
    // Value-net training-data collection (opt-in harness knob; read-only
    // side-channel). Stripped from the hashed config in computeRunHash, so
    // attaching it keeps runHash byte-identical to a run without it set.
    ...(config.collectTrainingData ? { collectTrainingData: true } : {}),
    // Decision-log collection (opt-in harness knob; read-only side-channel, rollout
    // policy only). Stripped from the hashed config in computeRunHash, so attaching
    // it keeps runHash byte-identical to a run without it set.
    ...(config.collectDecisionLog ? { collectDecisionLog: true } : {}),
    ...(config.collectDecisionStates ? { collectDecisionStates: true } : {}),
    ...(config.collectReplay ? { collectReplay: true } : {}),
    ...(INFRASTRUCTURE_TERMINAL_REASONS.has(config.__faultInjection)
      ? { __faultInjection: config.__faultInjection }
      : {}),
    // Certification is a harness gate, not a gameplay rule. It makes any
    // infrastructure terminal class fail the run after exact reasons have been
    // collected, and is excluded from behavioral hashing below.
    ...(config.certification ? { certification: true } : {}),
    // The resolved current profile is the manifest's full singleton setting.
    // Keeping this final prevents an adapter default from silently deleting or
    // overriding a current rule.
    ...(rulesProfile === 'current' ? CURRENT_GAME_CONFIG : {}),
  };
}

// ── Metrics ──────────────────────────────────────────────────────────────────

function lengthBucket(turns) {
  if (turns <= 10) return '1-10';
  if (turns <= 20) return '11-20';
  if (turns <= 30) return '21-30';
  if (turns <= 40) return '31-40';
  if (turns <= 60) return '41-60';
  return '61+';
}

function median(nums) {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : +((s[m - 1] + s[m]) / 2).toFixed(1);
}

export const INFRASTRUCTURE_TERMINAL_REASONS = new Set([
  'step_cap_loop',
  'unresolved_interaction',
  'guard_exhaustion',
  'illegal_or_stale_action',
  'bot_exception',
  'engine_exception',
  'invalid_data',
  'invalid_config',
  'invalid_deck',
]);

function summarize(results, config) {
  const games = results.length;
  const terminalReasons = Object.fromEntries(
    [...new Set(results.map((result) => result.terminalReason ?? 'unclassified'))]
      .sort()
      .map((reason) => [
        reason,
        results.filter(
          (result) => (result.terminalReason ?? 'unclassified') === reason,
        ).length,
      ]),
  );
  const infrastructureFailures = results.filter((result) =>
    INFRASTRUCTURE_TERMINAL_REASONS.has(result.terminalReason),
  );
  const gameplayResults = results.filter(
    (result) => !INFRASTRUCTURE_TERMINAL_REASONS.has(result.terminalReason),
  );
  const decided = results.filter(r => r.decided);
  const nonMirror = decided.filter(r => r.fA !== r.fB);

  const fc = {};
  for (const r of nonMirror) {
    fc[r.fA] = fc[r.fA] || { w: 0, n: 0 };
    fc[r.fB] = fc[r.fB] || { w: 0, n: 0 };
    fc[r.fA].n++; fc[r.fB].n++;
    if (r.winner === 0) fc[r.fA].w++; else fc[r.fB].w++;
  }
  const factionWinPct = {};
  for (const f of Object.keys(fc)) factionWinPct[f] = +(100 * fc[f].w / Math.max(fc[f].n, 1)).toFixed(1);
  const wps = Object.values(factionWinPct);
  const paritySpread = wps.length ? +(Math.max(...wps) - Math.min(...wps)).toFixed(1) : 0;

  const fpWon = decided.filter(r => r.firstPlayerWon).length;
  const firstPlayerPct = +(100 * fpWon / Math.max(decided.length, 1)).toFixed(1);
  const mirror = decided.filter(r => r.fA === r.fB);
  const mirrorFP = mirror.filter(r => r.firstPlayerWon).length;
  const mirrorFirstPlayerPct = +(100 * mirrorFP / Math.max(mirror.length, 1)).toFixed(1);

  const histogram = { '1-10': 0, '11-20': 0, '21-30': 0, '31-40': 0, '41-60': 0, '61+': 0 };
  for (const r of results) histogram[lengthBucket(r.turns)]++;
  const turns = results.map(r => r.turns);
  const gameLength = {
    histogram,
    median: median(turns),
    avg: +(turns.reduce((a, b) => a + b, 0) / Math.max(games, 1)).toFixed(1),
  };

  // Snowball: of games with a leader at turn 10, how often did that leader win?
  const snapped = decided.filter(r => r.leaderAt10 === 0 || r.leaderAt10 === 1);
  const leaderWon = snapped.filter(r => r.leaderAt10 === r.winner).length;
  const leaderAtTurn10WinPct = +(100 * leaderWon / Math.max(snapped.length, 1)).toFixed(1);
  const comebackPct = +(100 * (snapped.length - leaderWon) / Math.max(snapped.length, 1)).toFixed(1);

  const timeouts = results.filter(
    (result) =>
      result.terminalReason === 'turn_cap_draw' ||
      result.terminalReason === 'turn_cap_tiebreak',
  ).length;

  // Equipment actually played (attach_equipment dispatched) per game — confirms the
  // deck builder now seeds Equipment AND the bot's chooseEquip path fires on real cards.
  const totalEquip = results.reduce((a, r) => a + (r.equipPlayed || 0), 0);
  const equipmentPlayedPerGame = +(totalEquip / Math.max(games, 1)).toFixed(3);
  const gamesWithEquip = results.filter(r => (r.equipPlayed || 0) > 0).length;
  const gamesWithEquipPct = +(100 * gamesWithEquip / Math.max(games, 1)).toFixed(1);

  // Spells cast per game, per faction. Each game a faction plays (seat 0 = fA,
  // seat 1 = fB; mirrors count both seats) contributes one game-instance.
  const sc = {};
  for (const r of results) {
    sc[r.fA] = sc[r.fA] || { cast: 0, games: 0 };
    sc[r.fB] = sc[r.fB] || { cast: 0, games: 0 };
    sc[r.fA].cast += r.spellsCastA || 0; sc[r.fA].games++;
    sc[r.fB].cast += r.spellsCastB || 0; sc[r.fB].games++;
  }
  const spellsCastPerGame = {};
  for (const f of Object.keys(sc)) spellsCastPerGame[f] = +(sc[f].cast / Math.max(sc[f].games, 1)).toFixed(3);

  // Reactive Counter/Flash casts per game (across both seats) — confirms the
  // priority window makes Sapphire's counters live (was 0 casts / 99 discards).
  const totalCounters = results.reduce((a, r) => a + (r.spellsCounters || 0), 0);
  const reactiveCastsPerGame = +(totalCounters / Math.max(games, 1)).toFixed(3);

  // ── Mechanism diagnostics (reporting only; nothing here is hashed) ──────────
  // Per ordered matchup cell: enough to judge each pairing on evidence, not just
  // a marginal — win split, first-player split, length percentiles, HOW games end,
  // comeback rate (turn-10 leader overturned), victory margin.
  const cells = {};
  for (const r of results) {
    const c = (cells[`${r.fA}|${r.fB}`] ??= {
      fA: r.fA, fB: r.fB, n: 0, wA: 0, wB: 0, draws: 0,
      fpDecided: 0, fpWon: 0, turns: [], kill: 0, tiebreak: 0, undecided: 0,
      snapN: 0, comebacks: 0, winnerLps: [],
    });
    c.n++;
    if (r.winner === 0) c.wA++; else if (r.winner === 1) c.wB++; else c.draws++;
    if (r.decided) { c.fpDecided++; if (r.firstPlayerWon) c.fpWon++; }
    c.turns.push(r.turns);
    const m = r.dx?.winMethod;
    if (m === 'kill') c.kill++; else if (m === 'tiebreak') c.tiebreak++; else c.undecided++;
    if (r.decided && (r.leaderAt10 === 0 || r.leaderAt10 === 1)) {
      c.snapN++; if (r.winner !== r.leaderAt10) c.comebacks++;
    }
    if (r.dx && r.dx.winnerLp != null) c.winnerLps.push(r.dx.winnerLp);
  }
  const pct1 = (w, n) => +(100 * w / Math.max(n, 1)).toFixed(1);
  const matchupDetail = {};
  for (const [k, c] of Object.entries(cells)) {
    c.turns.sort((a, b) => a - b);
    const pTurn = (q) => c.turns[Math.min(c.turns.length - 1, Math.floor(q * c.turns.length))] ?? 0;
    matchupDetail[k] = {
      fA: c.fA, fB: c.fB, n: c.n, wA: c.wA, wB: c.wB, draws: c.draws,
      aWinPct: pct1(c.wA, c.wA + c.wB),
      firstPlayerWinPct: pct1(c.fpWon, c.fpDecided),
      turnsP: { p25: pTurn(0.25), p50: pTurn(0.5), p75: pTurn(0.75), p90: pTurn(0.9) },
      winMethod: { kill: c.kill, tiebreak: c.tiebreak, undecided: c.undecided },
      comeback: { n: c.snapN, overturned: c.comebacks, pct: pct1(c.comebacks, c.snapN) },
      winnerLpMedian: median(c.winnerLps.sort((a, b) => a - b)),
    };
  }

  // Per faction (both seats): the mechanism evidence — transform usage + payoff,
  // resource-development curve (upkeep + reserve + ramp effects), tempo curve.
  // `raw` keeps mergeable sums so multi-run drivers can pool without re-deriving.
  const fdet = {};
  for (const r of results) {
    for (const seat of [0, 1]) {
      const f = seat === 0 ? r.fA : r.fB;
      const d = (fdet[f] ??= {
        games: 0, transforms: 0, transformTurnSum: 0, transformTurnN: 0,
        winsT: 0, decT: 0, winsN: 0, decN: 0,
        res5: 0, res10: 0, res15: 0, deploys: 0, deploysEarly: 0, spellsEarly: 0, discards: 0,
        flipLpSum: 0, flipLpN: 0, flipSurvSum: 0, flipSurvN: 0, heroPre: 0, heroPost: 0,
        transformMaxLpDeltaSum: 0, transformCurrentLpDeltaSum: 0, transformDeltaN: 0,
        heroPostIdx: {},
      });
      d.games++;
      const dx = r.dx;
      if (!dx) continue;
      const t = dx.transformed[seat] === true;
      if (t) {
        d.transforms++;
        if (dx.transformTurn[seat] != null) { d.transformTurnSum += dx.transformTurn[seat]; d.transformTurnN++; }
        if (dx.lpAtFlip?.[seat] != null) { d.flipLpSum += dx.lpAtFlip[seat]; d.flipLpN++; }
        if (dx.survivedAfterFlip?.[seat] != null) { d.flipSurvSum += dx.survivedAfterFlip[seat]; d.flipSurvN++; }
        if (dx.transformLpDelta?.[seat] != null) {
          d.transformMaxLpDeltaSum += dx.transformLpDelta[seat].maxLp;
          d.transformCurrentLpDeltaSum += dx.transformLpDelta[seat].currentLp;
          d.transformDeltaN++;
        }
      }
      for (const [idx, n] of Object.entries(dx.heroUsesPre?.[seat] || {})) { d.heroPre += n; void idx; }
      for (const [idx, n] of Object.entries(dx.heroUsesPost?.[seat] || {})) {
        d.heroPost += n;
        d.heroPostIdx[idx] = (d.heroPostIdx[idx] || 0) + n;
      }
      if (r.decided) {
        const won = r.winner === seat;
        if (t) { d.decT++; if (won) d.winsT++; }
        else { d.decN++; if (won) d.winsN++; }
      }
      d.res5 += dx.resAt[seat][0]; d.res10 += dx.resAt[seat][1]; d.res15 += dx.resAt[seat][2];
      d.deploys += dx.deploys[seat]; d.deploysEarly += dx.deploysEarly[seat];
      d.spellsEarly += dx.spellsEarly[seat]; d.discards += dx.discards[seat];
    }
  }
  const factionDetail = {};
  for (const [f, d] of Object.entries(fdet)) {
    factionDetail[f] = {
      games: d.games,
      transformPct: pct1(d.transforms, d.games),
      transformAvgTurn: d.transformTurnN ? +(d.transformTurnSum / d.transformTurnN).toFixed(1) : null,
      winPctWhenTransformed: d.decT ? pct1(d.winsT, d.decT) : null,
      winPctWhenNot: d.decN ? pct1(d.winsN, d.decN) : null,
      // §13b transform autopsy: how dead was the hero at flip time, how long did
      // it live after, and were the (base/transformed) kit buttons ever pressed?
      avgLpAtFlip: d.flipLpN ? +(d.flipLpSum / d.flipLpN).toFixed(1) : null,
      avgTransformMaxLpDelta:
        d.transformDeltaN
          ? +(d.transformMaxLpDeltaSum / d.transformDeltaN).toFixed(2)
          : null,
      avgTransformCurrentLpDelta:
        d.transformDeltaN
          ? +(d.transformCurrentLpDeltaSum / d.transformDeltaN).toFixed(2)
          : null,
      avgTurnsAfterFlip: d.flipSurvN ? +(d.flipSurvSum / d.flipSurvN).toFixed(1) : null,
      heroAbilityUsesPerGame: {
        preFlip: +(d.heroPre / d.games).toFixed(2),
        postFlip: d.transforms ? +(d.heroPost / d.transforms).toFixed(2) : null,
      },
      postFlipUsesByIndex: d.heroPostIdx,
      resourcesByTurn: {
        t5: +(d.res5 / d.games).toFixed(2),
        t10: +(d.res10 / d.games).toFixed(2),
        t15: +(d.res15 / d.games).toFixed(2),
      },
      deploysPerGame: +(d.deploys / d.games).toFixed(2),
      earlyDeploysPerGame: +(d.deploysEarly / d.games).toFixed(2),
      earlySpellsPerGame: +(d.spellsEarly / d.games).toFixed(2),
      discardsPerGame: +(d.discards / d.games).toFixed(2),
      raw: d,
    };
  }

  // Candidate-generation pruning telemetry (T2, rollout only) — sums each game's
  // hash-exempt `candidatePruning` (see playGame) across the whole run. Absent
  // for non-rollout runs; never read by computeRunHash.
  let candidatePruning;
  if (config.botPolicy === 'rollout') {
    const acc = { raw: 0, retained: 0, prunedByKind: {} };
    for (const r of results) {
      const cp = r.candidatePruning;
      if (!cp) continue;
      acc.raw += cp.raw;
      acc.retained += cp.retained;
      for (const [k, n] of Object.entries(cp.prunedByKind)) acc.prunedByKind[k] = (acc.prunedByKind[k] ?? 0) + n;
    }
    candidatePruning = acc;
  }
  const policyCoverage = {
    actions: {},
    choices: {},
    responses: {},
    xValues: [],
  };
  const actionLifecycle = {
    overall: emptyActionLifecycleCounts(),
    byKind: {},
  };
  const xValues = new Set();
  for (const result of results) {
    const coverage = result.policyCoverage;
    if (coverage === undefined) continue;
    for (const family of ['actions', 'choices', 'responses']) {
      for (const [kind, count] of Object.entries(coverage[family] ?? {})) {
        policyCoverage[family][kind] =
          (policyCoverage[family][kind] ?? 0) + count;
      }
    }
    for (const value of coverage.xValues ?? []) xValues.add(value);
    const lifecycle = result.actionLifecycle;
    if (lifecycle !== undefined) {
      for (const outcome of ACTION_LIFECYCLE_OUTCOMES) {
        actionLifecycle.overall[outcome] += lifecycle.overall[outcome] ?? 0;
      }
      for (const [kind, sourceCounts] of Object.entries(lifecycle.byKind)) {
        const targetCounts =
          actionLifecycle.byKind[kind] ??= emptyActionLifecycleCounts();
        for (const outcome of ACTION_LIFECYCLE_OUTCOMES) {
          targetCounts[outcome] += sourceCounts[outcome] ?? 0;
        }
      }
    }
  }
  actionLifecycle.unresolved = results
    .filter((result) => (result.actionLifecycle?.overall.pending ?? 0) > 0)
    .map((result) => ({
      factionA: result.fA,
      factionB: result.fB,
      seed: result.seed,
      terminalReason: result.terminalReason,
      pending: result.actionLifecycle.overall.pending,
      byKind: Object.fromEntries(
        Object.entries(result.actionLifecycle.byKind)
          .filter(([, counts]) => (counts.pending ?? 0) > 0)
          .map(([kind, counts]) => [kind, counts.pending]),
      ),
    }));
  policyCoverage.xValues = [...xValues].sort((a, b) => a - b);

  return {
    factionWinPct,
    paritySpread,
    firstPlayerPct,
    mirrorFirstPlayerPct,
    gameLength,
    snowball: { leaderAtTurn10WinPct, comebackPct },
    decidedPct: +(100 * decided.length / Math.max(games, 1)).toFixed(1),
    timeoutPct: +(100 * timeouts / Math.max(games, 1)).toFixed(1),
    validGameplayGames: gameplayResults.length,
    infrastructureFailureCount: infrastructureFailures.length,
    infrastructureFailurePct:
      +(100 * infrastructureFailures.length / Math.max(games, 1)).toFixed(1),
    failures: infrastructureFailures.map((result) => ({
      factionA: result.fA,
      factionB: result.fB,
      seed: result.seed,
      reason: result.terminalReason,
      failure: result.failure ?? null,
    })),
    terminalReasons,
    policyCoverage,
    actionLifecycle,
    equipmentPlayedPerGame,
    gamesWithEquipPct,
    spellsCastPerGame,
    reactiveCastsPerGame,
    ...(candidatePruning ? { candidatePruning } : {}),
    // ADDITIVE balance-read output (NOT hashed; computed from the same non-mirror
    // decided games as factionWinPct). `factionCounts` surfaces the raw {w,n} per
    // faction (previously discarded); `stats` uses the decided-game schedule for
    // a coupled winner permutation, maxT-adjusted contrasts, and a
    // matchup×replicate cluster bootstrap. Wilson intervals are descriptive
    // marginals only. Reporting cannot perturb runHash.
    factionCounts: fc,
    stats: summarizeStats(fc, 'win', results, [
      ...(infrastructureFailures.length > 0
        ? ['infrastructure_failures_present']
        : []),
      ...(config.artifactStatus !== 'ratified'
        ? [`rules_artifact_status:${config.artifactStatus}`]
        : []),
      ...(config.studyArtifactStatus !== 'ratified'
        ? [`study_artifact_status:${config.studyArtifactStatus ?? 'missing'}`]
        : []),
    ]),
    // Mechanism diagnostics (§12) — per-cell + per-faction evidence, hash-exempt.
    matchupDetail,
    factionDetail,
    games,
    config,
  };
}

// ── runHash: stable digest over per-game outcomes (config-independent of order) ─

function computeRunHash(results, config, deckLabels = []) {
  const rows = results.map(r =>
    `${r.fA}|${r.fB}|${r.seed}|${r.winner}|${r.firstPlayer}|${r.turns}|${r.timedOut ? 1 : 0}|${r.leaderAt10}${
      config.rulesProfile === 'current' ? `|${r.terminalReason}` : ''
    }`,
  );
  // Decks used are part of the run's identity: fold their stable labels in so two
  // runs that differ only by deck selection produce different hashes. The diagnostic
  // accounting collector (__diag) is a read-only side-channel and is excluded.
  // playoutBackend is a harness dimension (like WORKERS): both stepping
  // backends must hash identically — that equality IS the T7 equivalence
  // claim. Stripping an absent key is a no-op, so historical hashes are
  // untouched. Pinned in rollout-pin.test.ts.
  // collectTrainingData is a harness-only data-collection knob (like __diag):
  // it changes nothing about gameplay, so it must strip out identically to a
  // run without it set. result.trainingRows is a result field computeRunHash
  // never reads (rows array above builds hashes from fA/fB/seed/winner/
  // firstPlayer/turns/timedOut/leaderAt10 only), so it needs no handling here.
  // collectDecisionLog is the same discipline: a harness-only data-collection
  // knob (result.decisionLog is never read here either).
  const {
    __diag,
    __trace,
    observation,
    playoutBackend,
    collectTrainingData,
    collectDecisionLog,
    collectDecisionStates,
    collectReplay,
    certification,
    __faultInjection,
    artifactStatus,
    rulesManifestHash,
    studyManifestId,
    studyManifestHash,
    studyArtifactStatus,
    rulesProfile,
    ...hashedConfig
  } = config;
  void __diag;
  void __trace;
  void observation;
  void playoutBackend;
  void collectTrainingData;
  void collectDecisionLog;
  void collectDecisionStates;
  void collectReplay;
  void certification;
  void __faultInjection;
  void artifactStatus;
  void rulesManifestHash;
  void studyManifestId;
  void studyManifestHash;
  void studyArtifactStatus;
  void rulesProfile;
  const payload = JSON.stringify(hashedConfig) + '\n' + deckLabels.join(',') + '\n' + rows.join('\n');
  return createHash('sha256').update(payload).digest('hex').slice(0, 16);
}

// ── Public: runSim ───────────────────────────────────────────────────────────

// Play the per-game results for `plan`. When `shard = {index, count}` is given,
// only games whose GLOBAL index ≡ index (mod count) are actually played. Because
// each seed is a pure function of (seedBase, pairing p, game g), any shard produces
// byte-identical games to the serial run for its slice — and every result carries
// __gi (its global index) so a parallel driver can restore exact serial order.
function generateResults(plan, config, shard = null) {
  const results = [];
  let gi = 0;
  for (let p = 0; p < plan.length; p++) {
    const { fA, fB, deckA, deckB } = plan[p];
    for (let g = 0; g < config.gamesPerPairing; g++) {
      if (!shard || gi % shard.count === shard.index) {
        const seed = gameSeed(config, plan[p], p, g);
        // SEAT ALTERNATION (measurement-harness knob, not a rule): swap which deck
        // sits in seat 0 on a 4-phase cycle vs firstPlayer's g%2 alternation, so the
        // two axes stay UNCORRELATED — games 0,1 normal seats, 2,3 swapped, both
        // first-player phases occur within each seat phase. playGame is called with
        // fA/fB/deckA/deckB swapped together (so its internal per-seat faction logic
        // stays correct for whichever seat each deck physically occupies); its raw
        // return is then remapped back to the pairing's true (deck-oriented) fA/fB
        // via remapSeatSwap so results never depend on physical seat. gamesPerPairing
        // should be a multiple of 4 for exact seat/first-player neutrality (true of
        // all presets; not enforced here). Default OFF ⇒ byte-identical to the
        // unswapped call below.
        const swapSeats = config.seatAlternation === true && (g >> 1) % 2 === 1;
        const r = swapSeats
          ? remapSeatSwap(playGame(fB, fA, seed, config, deckB, deckA, g), fA, fB)
          : playGame(fA, fB, seed, config, deckA, deckB, g);
        r.__gi = gi; // ignored by summarize + computeRunHash; used only for reassembly
        results.push(r);
      }
      gi++;
    }
  }
  return results;
}

// Reduce a full, serial-ORDERED results array to the public summary + runHash.
function finalize(results, config, plan) {
  const summary = summarize(results, config);
  const deckLabels = plan.map(p => p.label);
  if (config.certification === true && summary.infrastructureFailureCount > 0) {
    const error = new Error(
      `Certification failed: ${String(summary.infrastructureFailureCount)} infrastructure failure(s): ${JSON.stringify(summary.terminalReasons)}`,
    );
    error.code = 'certification_failed';
    error.failures = summary.failures;
    throw error;
  }
  return {
    ...summary,
    deckLabels,
    runHash: computeRunHash(results, config, deckLabels),
    ...(config.observation !== null
      ? {
          observations: immutableSnapshot(
            results.map((result) => ({
              factionA: result.fA,
              factionB: result.fB,
              seed: result.seed,
              replicate: result.replicate,
              outcome: Object.freeze({
                winner: result.winner,
                decided: result.decided,
                terminalReason: result.terminalReason,
              }),
              observation: result.observation,
            })),
          ),
        }
      : {}),
    ...(config.studyPopulation
      ? {
          studyBindings: {
            rulesManifestHash: config.rulesManifestHash,
            studyManifestHash: config.studyManifestHash,
            cardPoolHash: config.cardPoolHash,
            engineBuildHash: config.engineBuildHash,
            harnessBuildHash: config.harnessBuildHash,
            botImplementationHash: config.botImplementationHash,
            deckContentHashes: [
              ...new Set(
                plan.flatMap(({ deckA, deckB }) => [
                  deckContentHash(deckA),
                  deckContentHash(deckB),
                ]),
              ),
            ].sort(),
            policyConfigHash: policyConfigHash(config),
            policyCalibrationManifestHash:
              config.policyCalibrationManifestHash,
          },
        }
      : {}),
    // Value-net training rows (opt-in via config.collectTrainingData): the
    // summary object above never retains raw per-game results, so flatten each
    // game's labeled rows here — stamped with the mover's faction (fA if it
    // moved as seat 0, fB if seat 1) — for callers like neural-datagen.mjs.
    // Hash-exempt: computeRunHash above is computed from `results` directly and
    // never reads this field.
    ...(config.collectTrainingData
      ? {
          trainingRows: results.flatMap((r, gi) =>
            (r.trainingRows || []).map(row => ({ ...row, game: gi, faction: row.mover === 0 ? r.fA : r.fB })),
          ),
        }
      : {}),
    // Decision-log rows (opt-in via config.collectDecisionLog): flattened the same
    // way as trainingRows above, stamped with a unique game id + the mover's
    // faction. Hash-exempt: computeRunHash above never reads this field.
    ...(config.collectDecisionLog
      ? {
          decisionLog: results.flatMap((r, gi) =>
            (r.decisionLog || []).map((row, decision) => ({
              ...row,
              game: gi,
              decision,
              seed: r.seed,
              faction: row.mover === 0 ? r.fA : r.fB,
            })),
          ),
        }
      : {}),
    ...(config.collectReplay
      ? {
          replays: results.flatMap((result, gameIndex) =>
            result.replay === undefined
              ? []
              : [{ gameIndex, factionA: result.fA, factionB: result.fB, ...result.replay }],
          ),
        }
      : {}),
  };
}

export function runSim(rawConfig = {}) {
  const config = resolveConfig(rawConfig);
  const plan = buildPairingPlan(config);
  return finalize(generateResults(plan, config, null), config, plan);
}

// ── Parallel building blocks (orchestrated by sim-parallel.mjs) ───────────────
// A worker runs ONE shard via runSimShard and returns its partial results (each
// tagged __gi); the driver concatenates all shards, sorts by __gi to restore
// serial order, then calls finalizeResults — yielding a result byte-identical to
// runSim (same runHash). That identity is the whole point: parallelism must never
// change a number. Verified by scratch-verify-parallel + the CLI --parallel path.
export function runSimShard(rawConfig, shardIndex, shardCount) {
  const config = resolveConfig(rawConfig);
  const plan = buildPairingPlan(config);
  return generateResults(plan, config, { index: shardIndex, count: shardCount });
}

// Dynamic work-stealing variant: instead of a fixed 1/N slice, every worker shares
// one atomic counter (an Int32Array over a SharedArrayBuffer) and pulls the NEXT
// global game index until the pool is exhausted. This keeps all cores busy to the
// end even when games/worker is small and per-game cost varies wildly (the rollout
// pilots) — static sharding leaves fast workers idle waiting on the slowest slice.
// gi maps to (pairing p, game g) exactly as the serial loop: p = gi/G, g = gi%G, so
// each game keeps its serial seed and the merged runHash is unchanged.
export function runSimQueue(rawConfig, counterBuffer) {
  const config = resolveConfig(rawConfig);
  const plan = buildPairingPlan(config);
  const G = config.gamesPerPairing;
  const total = plan.length * G;
  const counter = new Int32Array(counterBuffer);
  const results = [];
  let gi;
  while ((gi = Atomics.add(counter, 0, 1)) < total) {
    const p = Math.floor(gi / G);
    const g = gi - p * G;
    const { fA, fB, deckA, deckB } = plan[p];
    const seed = gameSeed(config, plan[p], p, g);
    // SEAT ALTERNATION — see the matching comment in generateResults; kept in sync
    // so parallel (work-stealing) runs stay byte-identical to the serial run.
    const swapSeats = config.seatAlternation === true && (g >> 1) % 2 === 1;
    const r = swapSeats
      ? remapSeatSwap(playGame(fB, fA, seed, config, deckB, deckA, g), fA, fB)
      : playGame(fA, fB, seed, config, deckA, deckB, g);
    r.__gi = gi;
    results.push(r);
  }
  return results;
}

export function finalizeResults(rawConfig, results) {
  const config = resolveConfig(rawConfig);
  const plan = buildPairingPlan(config);
  return finalize(results, config, plan);
}

// ── Thin CLI ─────────────────────────────────────────────────────────────────

function parseCliConfig(argv) {
  const cfg = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    if (key === 'verify-determinism') { cfg.__verify = true; continue; }
    // --realDecks: use each faction's REAL official deck (from the DB loader)
    // for every faction in the run (per-faction override for all 4 factions).
    if (key === 'realDecks') { cfg.decks = Object.fromEntries(FACTIONS.map(f => [f, f])); continue; }
    const val = argv[i + 1]; i++;
    if (key === 'parallel') { cfg.__parallel = Number(val); continue; } // driver-only; not part of the sim config/hash
    if (['gamesPerPairing', 'turnCap', 'seedBase', 'lpScale', 'healScale', 'defenderForceCap', 'damageScale', 'frontlineSlots', 'highGroundSlots', 'equalizeHeroLp', 'atkBonus', 'startingCardBonus', 'resourceRampBonus', 'resourceDeckSize'].includes(key)) cfg[key] = Number(val);
    else if (key === 'abilitiesOn') cfg[key] = val !== 'false';
    else if (key === 'armBuffsTakeMax') cfg[key] = val === 'true';
    else if (key === 'armFirstInstanceOnly') cfg[key] = val === 'true';
    else if (key === 'shieldFirstInstanceOnly') cfg[key] = val === 'true';
    else if (key === 'disableHeroHealing') cfg[key] = val === 'true';
    else if (key === 'defenderHighGroundOnly') cfg[key] = val === 'true';
    else if (key === 'noOverheal') cfg[key] = val === 'true';
    else if (key === 'directHighGroundDeploy') cfg[key] = val === 'true';
    else if (key === 'armOneTimeAbsolute') cfg[key] = val === 'true';
    else if (key === 'armChargeAbsorb') cfg[key] = val === 'true';
    else if (key === 'rampPilot') cfg[key] = val === 'true';
    else if (key === 'costFloor') cfg[key] = val === 'true';
    else if (key === 'reserveTapChoice') cfg[key] = val === 'true';
    else if (key === 'reserveTapStrain') cfg[key] = val === 'true';
    else if (key === 'disableDiscardForEnergy') cfg[key] = val === 'true';
    else if (key === 'apnapAnyOrderFix') cfg[key] = val === 'true';
    else if (key === 'firstPlayerSkipsFirstResource') cfg[key] = val === 'true';
    else if (key === 'firstPlayerDrawsNormally') cfg[key] = val === 'true';
    else if (key === 'seatAlternation') cfg[key] = val === 'true';
    else if (key === 'flashAtWill') cfg[key] = val === 'true';
    else if (key === 'boardReactions') cfg[key] = val === 'true';
    else if (key === 'responseWindowsOnAllActions') cfg[key] = val === 'true';
    else if (key === 'registerPrintedTriggers') cfg[key] = val === 'true';
    else if (key === 'equipmentTriggers') cfg[key] = val === 'true';
    else if (key === 'reactAbilities') cfg[key] = val === 'true';
    else if (key === 'dynamicDrawValue') cfg[key] = val === 'true';
    else if (key === 'heroAuras') cfg[key] = val === 'true';
    else if (key === 'activateAfterDeploy') cfg[key] = val === 'true';
    else if (key === 'disableFactionHeroReach') cfg[key] = { faction: val };
    else if (key === 'botPolicySeat0' || key === 'botPolicySeat1') {
      cfg.botPolicySeat = cfg.botPolicySeat || {};
      cfg.botPolicySeat[key === 'botPolicySeat0' ? 0 : 1] = val;
    }
    else if (key === 'factions') cfg.matchups = val.split(',');
    else if (key === 'disableEffectTypes') cfg[key] = val.split(',').filter(Boolean);
    else cfg[key] = val;
  }
  return cfg;
}

function isMain() {
  // isMainThread guards against worker threads (sim-worker.mjs) inheriting the
  // main thread's process.argv and re-running the CLI block on import.
  return isMainThread && import.meta.url === `file://${process.argv[1]}`;
}

// NOT top-level await: kicking off an async runCli() lets THIS module finish
// evaluating before runCli dynamically imports sim-parallel.mjs (which imports
// this module back). A top-level await here would freeze sim-runner mid-eval and
// deadlock that circular import.
async function runCli() {
  const cfg = parseCliConfig(process.argv.slice(2));
  // __parallel / __verify are DRIVER flags, not sim config — strip them so they
  // never reach runSim (and so a parallel run hashes identically to a serial one).
  const { __parallel, __verify, ...simCfg } = cfg;
  if (__verify) {
    const a = runSim(simCfg), b = runSim(simCfg);
    const ok = a.runHash === b.runHash;
    console.log(`determinism: ${ok ? 'PASS' : 'FAIL'} (hash ${a.runHash} vs ${b.runHash})`);
    process.exit(ok ? 0 : 1);
  }
  const res =
    __parallel > 1
      ? await (await import('./sim-parallel.mjs')).runSimParallel(simCfg, __parallel)
      : runSim(simCfg);
  if (process.env.AETHERION_SIM_OUT) {
    writeFileSync(process.env.AETHERION_SIM_OUT, JSON.stringify(res, null, 1));
  }
  console.log(`runHash ${res.runHash} | games ${res.games} | parity ${res.paritySpread}% | ${JSON.stringify(res.factionWinPct)}`);
  console.log(`firstPlayer ${res.firstPlayerPct}% | mirrorFP ${res.mirrorFirstPlayerPct}% | decided ${res.decidedPct}% | timeout ${res.timeoutPct}% | avgTurns ${res.gameLength.avg} (median ${res.gameLength.median})`);
  console.log(`snowball leader@10 ${res.snowball.leaderAtTurn10WinPct}% | comeback ${res.snowball.comebackPct}%`);
  console.log(`equipmentPlayed/game ${res.equipmentPlayedPerGame} | gamesWithEquip ${res.gamesWithEquipPct}%`);
}

if (isMain()) {
  runCli().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
