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

import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createActor } from 'xstate';
import {
  createGame,
  computeAvailableActions,
  computeReactiveActions,
  gameMachine,
  chooseAction,
  chooseReactiveAction,
  chooseChoiceResponse,
  shouldKeepHand,
} from './dist/index.js';
import { gameplanFor } from './dist/bot/gameplan.js';
import { summarizeStats } from './dist/sim/summarize-stats.js';
import { getDeck } from './deck-loader.mjs';
import { makeRolloutPilot } from './pilot-rollout.mjs';

const CARDS = process.env.AETHERION_CARDS
  ? process.env.AETHERION_CARDS
  : new URL('./sim-data/aetherion-cards.json', import.meta.url);
const FACTIONS = ['Onyx', 'Radiant', 'Sapphire', 'Verdant'];
const ENERGY_FACTIONS = new Set(['Verdant']);
const STEP_CAP = 8000;
const RANDOM_ACTION_PROB = 0.85;
const SNOWBALL_TURN = 10;

// ── Card data load (INPUT-ONLY) ──────────────────────────────────────────────

const raw = JSON.parse(readFileSync(CARDS, 'utf8'));
const fac = c => (Array.isArray(c.alignment) ? c.alignment[0] : c.alignment) || 'None';
const cst = c => { const o = c.cost || {}; return { mana: o.mana || 0, energy: o.energy || 0, flexible: o.flexible || 0 }; };
const stt = c => { const s = c.stats; return s ? { hp: s.hp || 0, atk: s.atk || 0, arm: s.arm || 0 } : undefined; };

const cardMap = new Map(), heroMap = new Map(), abilMap = new Map(), heroAbil = new Map(), transformMap = new Map();
for (const c of raw) {
  const dsls = (c.abilities || []).map(a => a.dsl).filter(Boolean);
  if (c.cardType === 'H') {
    heroMap.set(c.id, { id: c.id, name: c.name, lp: (c.stats && c.stats.hp) || 30, alignment: c.alignment || [] });
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
    cardMap.set(c.id, { id: c.id, name: c.name, cardType: c.cardType, cost: cst(c), stats: stt(c), traits: c.traits || [], tags: c.tags || [], alignment: c.alignment || [] });
    abilMap.set(c.id, dsls);
  }
}
const registry = { getCard: id => cardMap.get(id), getHero: id => heroMap.get(id) };
const rCards = raw.filter(c => c.cardType === 'R');
const manaR = rCards.find(c => /mana/i.test(c.name)) || rCards[0];
const energyR = rCards.find(c => /energy/i.test(c.name)) || rCards[rCards.length - 1];

// Target a LEGAL, REALISTIC 40-card main deck with a sensible type mix that
// guarantees Equipment + Spells + Characters. Quotas (~24 C / ~10 S / ~6 E) are
// clamped to each faction's copy-limited pool; any shortfall is backfilled from a
// global round-robin. Copy limits (3 / 1-Legendary) are never exceeded.
// Deterministic: stable pool order, round-robin pass order — no Math.random.
const DECK_SIZE = 40;
const TYPE_QUOTA = { C: 24, S: 10, E: 6 };

function copyLimit(c) { return c.rarity === 'Legendary' ? 1 : 3; }

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
  return { heroDefId: hero.id, mainDeckDefIds: main.slice(0, DECK_SIZE), resourceDeckDefIds: Array.from({ length: 15 }, () => rid) };
}
const decks = Object.fromEntries(FACTIONS.map(f => [f, buildDeck(f)]));

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

function plainDeck(d) {
  return { heroDefId: d.heroDefId, mainDeckDefIds: d.mainDeckDefIds, resourceDeckDefIds: d.resourceDeckDefIds };
}

// Resolve a deck spec against `fallbackFaction` (used when spec is null/auto).
// Synchronous: relies on deck-loader being preloaded (see preloadDecksIfNeeded).
function resolveDeckSpec(spec, fallbackFaction) {
  // null/undefined -> auto deck for the matchup faction
  if (spec == null) return { deck: decks[fallbackFaction], faction: fallbackFaction, label: `auto:${fallbackFaction}` };

  // explicit DeckSelection object
  if (isDeckSelection(spec)) {
    const faction = spec.faction && FACTIONS.includes(spec.faction) ? spec.faction : fallbackFaction;
    const id = spec.deckId != null ? `id${spec.deckId}` : `h${spec.heroDefId}`;
    return { deck: plainDeck(spec), faction, label: `sel:${id}` };
  }

  // "auto:<Faction>"
  if (typeof spec === 'string' && spec.startsWith('auto:')) {
    const f = spec.slice(5);
    const faction = FACTIONS.includes(f) ? f : fallbackFaction;
    return { deck: decks[faction], faction, label: `auto:${faction}` };
  }

  // faction name -> real official deck (deck-loader)
  if (typeof spec === 'string' && FACTIONS.includes(spec)) {
    const d = getDeck(spec);
    if (d) return { deck: plainDeck(d), faction: d.faction || spec, label: `real:${d.deckId}` };
    // loader unavailable: fall back to auto
    return { deck: decks[spec], faction: spec, label: `auto:${spec}` };
  }

  // deckId (int or string) -> deck-loader
  const d = getDeck(spec);
  if (d) {
    const faction = d.faction && FACTIONS.includes(d.faction) ? d.faction : fallbackFaction;
    return { deck: plainDeck(d), faction, label: `real:${d.deckId}` };
  }
  // unknown spec: degrade to auto rather than crash the whole sim.
  return { deck: decks[fallbackFaction], faction: fallbackFaction, label: `auto:${fallbackFaction}` };
}

// ── Abilities hydration (mirrors sim-abilities.mjs) ──────────────────────────

const hc = c => (c && abilMap.get(c.cardDefId)?.length ? { ...c, abilities: abilMap.get(c.cardDefId) } : c);
function hydrate(s) {
  return {
    ...s,
    players: s.players.map(p => ({
      ...p,
      hero: {
        ...p.hero,
        ...(heroAbil.get(p.hero.cardDefId)?.length ? { abilities: heroAbil.get(p.hero.cardDefId) } : {}),
        ...(transformMap.get(p.hero.cardDefId) ? { transformData: transformMap.get(p.hero.cardDefId) } : {}),
      },
      hand: p.hand.map(hc),
      mainDeck: p.mainDeck.map(hc),
      discardPile: p.discardPile.map(hc),
      zones: { reserve: p.zones.reserve.map(hc), frontline: p.zones.frontline.map(hc), highGround: p.zones.highGround.map(hc) },
    })),
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
  if (acts.canTransform) out.push({ type: 'declare_transform' });
  return out;
}

// ── First-player compensation ────────────────────────────────────────────────
// Applied at game start to the SECOND player (the one not active on turn 1).

let compInstanceCounter = 0;
function applyCompensation(gs, mode, faction) {
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

function playGame(fA, fB, seed, config, deckA, deckB, gameIndex) {
  let gs = createGame(deckA, deckB, registry, seed);
  if (config.abilitiesOn) gs = hydrate(gs);
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
  gs = applyCompensation(gs, config.firstPlayerCompensation, secondFaction);
  // Thread the termination + ablation knobs onto GameState so the engine's
  // transform gate, the heuristic bot, and the effect interpreter all see them.
  // A per-game `diag` (from the collector) is a mutable accumulator; it is NOT in
  // the hashed config (see resolveConfig) so attaching it keeps runHash identical.
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
      ...(diag ? { diag } : {}),
    },
  };

  const rnd = rngf((seed ^ 0x9e3779b9) >>> 0);
  const firstPlayer = gs.activePlayerIndex;
  const actor = createActor(gameMachine, { input: { gameState: gs } });
  actor.start();

  // Outcome-driven rollout pilot (botPolicy === 'rollout'): one instance per game,
  // forking THIS actor at each active-player decision point. Deterministic — its
  // rollout seeds derive purely from `seed`. Heuristic/random paths never touch it.
  const rolloutPilot = config.botPolicy === 'rollout'
    ? makeRolloutPilot({ rollouts: config.rollouts, playoutPolicy: config.rolloutPlayout, maxCandidates: config.maxCandidates, depth: config.rolloutDepth, closingReward: config.rolloutClosing, fixHandSizeStall: config.fixHandSizeStall, fairPilot: config.fairPilot })
    : null;

  let leaderAt10 = null; // 0|1|'tie' — side ahead on LP at SNOWBALL_TURN
  let equipPlayed = 0;   // count of attach_equipment actions actually dispatched
  let spellsCastA = 0;   // cast_spell actions dispatched by seat 0 (faction fA)
  let spellsCastB = 0;   // cast_spell actions dispatched by seat 1 (faction fB)
  let spellsCounters = 0; // reactive Counter/Flash casts (REACTIVE_ACTION) dispatched
  let steps = 0;
  let lastTurn = -1;
  const actionCounts = {};
  while (steps++ < STEP_CAP) {
    const snap = actor.getSnapshot();
    if (snap.status === 'done') break;
    gs = snap.context.gameState;
    // Per-turn telemetry (gated; read-only; fires once at the start of each turn).
    if (config.__trace && gs.turnNumber !== lastTurn) {
      lastTurn = gs.turnNumber;
      config.__trace.onTurn(gs, { spellsCastA, spellsCastB, equipPlayed, spellsCounters, actionCounts });
    }
    if (gs.winner != null) break;
    if (gs.turnNumber > config.turnCap) break;

    // STALL-FIX (gated, default OFF ⇒ byte-identical to v10): the end-of-turn
    // hand-size discard choice is set by the engine on context.pendingChoice but
    // NOT mirrored to context.gameState.pendingChoice, so the bot loop (which only
    // reads gameState.pendingChoice) never sees it and spins on END_PHASE until
    // STEP_CAP — surfacing as a bogus "timeout" with a noisy LP-tiebreak. When the
    // knob is ON, resolve that choice via the engine's own choice bot so the turn
    // can actually pass. Only active under config.fixHandSizeStall.
    if (config.fixHandSizeStall && gs.pendingChoice == null && snap.context.pendingChoice != null) {
      const cpc = snap.context.pendingChoice;
      try {
        const ids = chooseChoiceResponse({ ...gs, pendingChoice: cpc });
        actor.send({ type: 'PLAYER_RESPONSE', response: { selectedOptionIds: ids } });
      } catch { try { actor.send({ type: 'END_PHASE' }); } catch { break; } }
      continue;
    }

    if (leaderAt10 === null && gs.turnNumber >= SNOWBALL_TURN) {
      const a = gs.players[0].hero.currentLp, b = gs.players[1].hero.currentLp;
      leaderAt10 = a === b ? 'tie' : a > b ? 0 : 1;
    }

    // Reactive priority window (Rulebook 14): drive the responder before the
    // active player resumes. Heuristic uses chooseReactiveAction; random passes
    // unless it holds a reactive option (then casts it with prob RANDOM_ACTION_PROB).
    if (gs.pendingPriority != null) {
      try {
        let react = null;
        if (config.botPolicy === 'heuristic' || config.botPolicy === 'rollout') {
          // Minor decision (scarce reactive cards): both the heuristic and the
          // outcome-driven pilot use the engine's sensible, archetype-neutral
          // reactive policy. The pilot's archetype-neutral SEARCH is on the main
          // proactive turn (deploy/attack/spell/move/transform), not this window.
          react = chooseReactiveAction(gs);
        } else {
          const opts = computeReactiveActions(gs, gs.pendingPriority.toRespondPlayerId);
          if (opts.length && rnd() < RANDOM_ACTION_PROB) {
            react = { type: 'cast_spell', cardInstanceId: opts[0].cardInstanceId };
          }
        }
        if (react == null) actor.send({ type: 'PRIORITY_PASS' });
        else { spellsCounters++; actor.send({ type: 'REACTIVE_ACTION', action: react }); }
      } catch { try { actor.send({ type: 'PRIORITY_PASS' }); } catch { break; } }
      continue;
    }

    const pc = gs.pendingChoice;
    try {
      if (pc) {
        const competent = config.botPolicy === 'heuristic' || config.botPolicy === 'rollout';
        if (pc.type === 'mulligan') {
          const keep = competent ? shouldKeepHand(gs, pc.playerId) : true;
          actor.send({ type: 'MULLIGAN_DECISION', playerId: pc.playerId, keep });
        } else {
          const ids = competent
            ? chooseChoiceResponse(gs)
            : (pc.options || []).map(o => o.instanceId ?? o.id).slice(0, Math.max(pc.minSelections || 0, 0));
          actor.send({ type: 'PLAYER_RESPONSE', response: { selectedOptionIds: ids } });
        }
        continue;
      }
      let action;
      if (config.botPolicy === 'heuristic') {
        action = chooseAction(gs);
      } else if (config.botPolicy === 'rollout') {
        // OUTCOME-DRIVEN pilot: fork this actor, roll each candidate out, pick by
        // game outcome (win-rate, LP-diff tiebreak) — no archetype/board prior.
        action = rolloutPilot.chooseAction(actor, gs, seed, config.turnCap);
      } else {
        const choices = concreteActions(computeAvailableActions(gs, gs.activePlayerIndex));
        action = choices.length && rnd() < RANDOM_ACTION_PROB ? choices[Math.floor(rnd() * choices.length)] : null;
      }
      if (action == null) actor.send({ type: 'END_PHASE' });
      else {
        if (action.type === 'attach_equipment') equipPlayed++;
        if (action.type === 'cast_spell') { if (gs.activePlayerIndex === 0) spellsCastA++; else spellsCastB++; }
        actionCounts[action.type] = (actionCounts[action.type] || 0) + 1;
        actor.send({ type: 'PLAYER_ACTION', action });
      }
    } catch {
      try { actor.send({ type: 'END_PHASE' }); } catch { break; }
    }
  }

  const fin = actor.getSnapshot().context.gameState;
  const lp0 = fin.players[0].hero.currentLp, lp1 = fin.players[1].hero.currentLp;
  let winner = fin.winner;
  let timedOut = false;
  if (winner == null) {
    timedOut = true;
    if (config.termination === 'tiebreak') {
      winner = lp0 === lp1 ? 'draw' : lp0 > lp1 ? 0 : 1;
    } else {
      winner = 'draw';
    }
  }
  const decided = winner === 0 || winner === 1;
  // Diagnostic accounting hook (no-op unless a collector is supplied; not hashed).
  if (config.__diag && typeof config.__diag.onGame === 'function') {
    config.__diag.onGame(fin, { fA, fB, firstPlayer, winner, turns: fin.turnNumber }, diag);
  }
  return {
    fA, fB, seed,
    winner,
    decided,
    timedOut,
    firstPlayer,
    firstPlayerWon: decided ? winner === firstPlayer : null,
    turns: fin.turnNumber,
    leaderAt10,
    equipPlayed,
    spellsCastA,
    spellsCastB,
    spellsCounters,
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
  // config.decks: per-faction overrides ({ Onyx: <spec>, ... }) resolved up front.
  const overrides = {};
  if (config.decks && typeof config.decks === 'object' && !Array.isArray(config.decks)) {
    for (const [f, spec] of Object.entries(config.decks)) {
      if (FACTIONS.includes(f)) overrides[f] = resolveDeckSpec(spec, f);
    }
  }

  if (isMatchupList(config.matchups)) {
    return config.matchups.map((m, i) => {
      const A = resolveDeckSpec(m.p0Deck, FACTIONS[0]);
      const B = resolveDeckSpec(m.p1Deck, FACTIONS[0]);
      return { fA: A.faction, fB: B.faction, deckA: A.deck, deckB: B.deck, label: `m${i}:${A.label}|${B.label}` };
    });
  }

  const pairs = resolveMatchups(config.matchups);
  return pairs.map(([a, b]) => {
    const A = overrides[a] || { deck: decks[a], faction: a, label: `auto:${a}` };
    const B = overrides[b] || { deck: decks[b], faction: b, label: `auto:${b}` };
    return { fA: A.faction, fB: B.faction, deckA: A.deck, deckB: B.deck, label: `${A.label}|${B.label}` };
  });
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

function resolveConfig(config = {}) {
  return {
    matchups: config.matchups ?? 'all-pairs',
    gamesPerPairing: config.gamesPerPairing ?? 60,
    turnCap: config.turnCap ?? 80,
    abilitiesOn: config.abilitiesOn ?? true,
    botPolicy: config.botPolicy ?? 'heuristic',
    // Outcome-driven rollout pilot knobs. ONLY emitted (and hashed) when the
    // rollout policy is selected, so any heuristic/random run is byte-identical to
    // the v10 baseline. `rollouts` = playouts per candidate; `rolloutPlayout` =
    // the default policy inside a playout ('random' = archetype-neutral, primary;
    // 'heuristic' = the value-bot cross-check); `maxCandidates` caps branching.
    ...(config.botPolicy === 'rollout'
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
        }
      : {}),
    // STALL-FIX knob: resolve the end-of-turn hand-size discard choice (which the
    // engine sets on context.pendingChoice but does not mirror to
    // gameState.pendingChoice) so the bot loop can pass the turn instead of spinning
    // on END_PHASE until STEP_CAP. Only emitted (and hashed) when ENABLED ⇒ a default
    // run is byte-identical to the v10 baseline.
    ...(config.fixHandSizeStall ? { fixHandSizeStall: true } : {}),
    firstPlayerCompensation: config.firstPlayerCompensation ?? 'none',
    termination: config.termination ?? 'none',
    terminationMode: config.terminationMode ?? 'turn_cap',
    // ── Diagnostic ablation knobs (all default to a no-op) ───────────────────
    firstPlayer: config.firstPlayer ?? 'random',
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
    seedBase: config.seedBase ?? 12345,
    // Explicit-deck overrides / matchup-deck specs (undefined => auto decks).
    ...(config.decks !== undefined ? { decks: config.decks } : {}),
    // Diagnostic accounting collector (read-only side-channel). Stripped from the
    // hashed config in computeRunHash so attaching it keeps runHash byte-identical.
    ...(config.__diag !== undefined ? { __diag: config.__diag } : {}),
    // Per-turn telemetry collector (read-only side-channel; same hash-strip as __diag).
    ...(config.__trace !== undefined ? { __trace: config.__trace } : {}),
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

function summarize(results, config) {
  const games = results.length;
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

  const timeouts = results.filter(r => r.timedOut).length;

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

  return {
    factionWinPct,
    paritySpread,
    firstPlayerPct,
    mirrorFirstPlayerPct,
    gameLength,
    snowball: { leaderAtTurn10WinPct, comebackPct },
    decidedPct: +(100 * decided.length / Math.max(games, 1)).toFixed(1),
    timeoutPct: +(100 * timeouts / Math.max(games, 1)).toFixed(1),
    equipmentPlayedPerGame,
    gamesWithEquipPct,
    spellsCastPerGame,
    reactiveCastsPerGame,
    // ADDITIVE balance-read output (NOT hashed; computed from the same non-mirror
    // decided games as factionWinPct). `factionCounts` surfaces the raw {w,n} per
    // faction (previously discarded); `stats` is the inferential summary (G-test
    // imbalance p-value, bias-corrected spread + bootstrap CI, per-faction Wilson
    // CIs, worst-offender z). Reporting only ⇒ cannot perturb runHash.
    factionCounts: fc,
    stats: summarizeStats(fc),
    games,
    config,
  };
}

// ── runHash: stable digest over per-game outcomes (config-independent of order) ─

function computeRunHash(results, config, deckLabels = []) {
  const rows = results.map(r => `${r.fA}|${r.fB}|${r.seed}|${r.winner}|${r.firstPlayer}|${r.turns}|${r.timedOut ? 1 : 0}|${r.leaderAt10}`);
  // Decks used are part of the run's identity: fold their stable labels in so two
  // runs that differ only by deck selection produce different hashes. The diagnostic
  // accounting collector (__diag) is a read-only side-channel and is excluded.
  const { __diag, __trace, ...hashedConfig } = config;
  void __diag;
  void __trace;
  const payload = JSON.stringify(hashedConfig) + '\n' + deckLabels.join(',') + '\n' + rows.join('\n');
  return createHash('sha256').update(payload).digest('hex').slice(0, 16);
}

// ── Public: runSim ───────────────────────────────────────────────────────────

export function runSim(rawConfig = {}) {
  const config = resolveConfig(rawConfig);
  const plan = buildPairingPlan(config);
  const results = [];
  // Seed is a pure function of (seedBase, pairing index, game index): deterministic.
  for (let p = 0; p < plan.length; p++) {
    const { fA, fB, deckA, deckB } = plan[p];
    for (let g = 0; g < config.gamesPerPairing; g++) {
      const seed = (config.seedBase + p * 100003 + g * 7919) >>> 0;
      results.push(playGame(fA, fB, seed, config, deckA, deckB, g));
    }
  }
  const summary = summarize(results, config);
  const deckLabels = plan.map(p => p.label);
  return { ...summary, deckLabels, runHash: computeRunHash(results, config, deckLabels) };
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
    if (['gamesPerPairing', 'turnCap', 'seedBase', 'lpScale', 'healScale', 'defenderForceCap', 'damageScale', 'frontlineSlots', 'highGroundSlots', 'equalizeHeroLp', 'atkBonus', 'startingCardBonus', 'resourceRampBonus'].includes(key)) cfg[key] = Number(val);
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
    else if (key === 'disableFactionHeroReach') cfg[key] = { faction: val };
    else if (key === 'factions') cfg.matchups = val.split(',');
    else if (key === 'disableEffectTypes') cfg[key] = val.split(',').filter(Boolean);
    else cfg[key] = val;
  }
  return cfg;
}

function isMain() {
  return import.meta.url === `file://${process.argv[1]}`;
}

if (isMain()) {
  const cfg = parseCliConfig(process.argv.slice(2));
  if (cfg.__verify) {
    delete cfg.__verify;
    const a = runSim(cfg), b = runSim(cfg);
    const ok = a.runHash === b.runHash;
    console.log(`determinism: ${ok ? 'PASS' : 'FAIL'} (hash ${a.runHash} vs ${b.runHash})`);
    process.exit(ok ? 0 : 1);
  }
  const res = runSim(cfg);
  if (process.env.AETHERION_SIM_OUT) {
    writeFileSync(process.env.AETHERION_SIM_OUT, JSON.stringify(res, null, 1));
  }
  console.log(`runHash ${res.runHash} | games ${res.games} | parity ${res.paritySpread}% | ${JSON.stringify(res.factionWinPct)}`);
  console.log(`firstPlayer ${res.firstPlayerPct}% | mirrorFP ${res.mirrorFirstPlayerPct}% | decided ${res.decidedPct}% | timeout ${res.timeoutPct}% | avgTurns ${res.gameLength.avg} (median ${res.gameLength.median})`);
  console.log(`snowball leader@10 ${res.snowball.leaderAtTurn10WinPct}% | comeback ${res.snowball.comebackPct}%`);
  console.log(`equipmentPlayed/game ${res.equipmentPlayedPerGame} | gamesWithEquip ${res.gamesWithEquipPct}%`);
}
