// balance-deck-panel.mjs — Layer-2 measurement instrument: play a frozen
// deck-set (sim-data/deck-sets/*.json) against starters, itself (--field), or
// an explicit pairing list, and report per-pairing + per-DECK (not just
// per-faction) results plus a per-card usage table.
//
// The simulator returns detached final-state observations as ordinary data.
// Card-usage accounting consumes those immutable snapshots after each run, so
// no callback or mutable collector can influence gameplay. Pair-level process
// sharding remains useful because this report emits one row per deck pairing.
//
// WHY ONE runSim CALL PER PAIRING, NOT ONE COMBINED CALL: sim-runner's
// matchupDetail is keyed by `${fA}|${fB}` FACTION names, which collide for two
// different decks sharing a faction (the exact case this tool must support —
// same-faction deckKey pairs). Running each requested pairing as its OWN
// single-matchup runSim call gives a matchupDetail with exactly one entry
// (zero collision risk) and reuses sim-runner's own win/turns/comeback
// aggregation verbatim — no reimplementation. It also makes the seat->deckKey
// mapping for the card-usage collector trivial: a single pairing's games are
// generateResults' `p=0` loop exactly, so the LOCAL game index (0..GPP-1) is
// enough to know the seatAlternation swap phase directly (see diagFor below).
//
// PAIRING IDENTITY: every pairing is canonicalized to an unordered tuple
// (sorted [deckKeyOf(a), deckKeyOf(b)]) before anything runs. Duplicate
// canonical pairings are deduped (with a warning); each pairing's seed is
// derived from a stable hash of its canonical id, NOT from its position in
// the list — the same logical pairing produces the same games in every mode,
// order, and worker count. This changes existing panel runHashes relative to
// the previous position-based scheme, but no panel runHash has been ledgered
// yet (the smoke entries that existed were reverted), so there is no
// migration to perform.
//
// Usage:
//   node balance-deck-panel.mjs --set <deck-set.json>
//     (--vs-starters | --field <deckKey,deckKey,...> | --pairs <pairs.json>)
//     [--gpp <n>] [--rung <8|12>] [--label <s>] [--out <path>] [--workers <n>]
//   --gpp must be a positive integer divisible by 4 (seat x first-player phase
//     balance).
//   --out: if given explicitly, the result JSON is COPIED to the ledger
//     archive (the file stays at the path you asked for); the default tmp
//     path keeps move semantics (archived, not left behind).
//   --workers <n> (default min(cpuCount,8)): shard the pairing list across n
//     child processes for wall-clock parallelism. --workers 1 is the pure
//     serial in-process path (no subprocess spawned). Output is byte-identical
//     regardless of worker count (see PAIRING IDENTITY above).
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { appendRun } from './balance-ledger.mjs';

const ENGINE_DIR = fileURLToPath(new URL('.', import.meta.url));
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const RUNS_DIR = `${ENGINE_DIR}balance-runs/runs/`;
const FACTIONS = ['Onyx', 'Radiant', 'Sapphire', 'Verdant'];

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--set') out.set = argv[++i];
    else if (a === '--vs-starters') out.vsStarters = true;
    else if (a === '--field') out.field = argv[++i];
    else if (a === '--pairs') out.pairs = argv[++i];
    else if (a === '--gpp') out.gpp = +argv[++i];
    else if (a === '--rung') out.rung = +argv[++i];
    else if (a === '--label') out.label = argv[++i];
    else if (a === '--out') out.out = argv[++i];
    else if (a === '--workers') out.workers = +argv[++i];
    else if (a === '--internal-shard') out.internalShard = argv[++i];
    else console.warn(`balance-deck-panel: ignoring unknown flag ${a}`);
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const IS_SHARD_CHILD = Boolean(args.internalShard);
const modeCount = [args.vsStarters, args.field, args.pairs, args.internalShard].filter(Boolean).length;
if (modeCount !== 1) {
  console.error('Usage: node balance-deck-panel.mjs --set <deck-set.json> (--vs-starters | --field <deckKey,...> | --pairs <pairs.json>) [--gpp 64] [--rung 8|12] [--label <s>] [--out <path>] [--workers <n>]');
  process.exit(1);
}
const SET_PATH = path.resolve(process.cwd(), args.set || 'sim-data/deck-sets/constructed-v1.json');
const GPP = args.gpp === undefined ? 64 : Number(args.gpp);
if (!Number.isInteger(GPP) || GPP <= 0 || GPP % 4 !== 0) {
  console.error(`balance-deck-panel: --gpp must be a positive integer divisible by 4 (seat x first-player phase balance) — got ${args.gpp}`);
  process.exit(1);
}
const RUNG = args.rung === undefined ? 8 : Number(args.rung);
const RUNG_PARAMS = { 8: { rollouts: 8, rolloutDepth: 3, maxCandidates: 8 }, 12: { rollouts: 12, rolloutDepth: 3, maxCandidates: 8 } }[RUNG];
if (!RUNG_PARAMS) { console.error('--rung must be 8 or 12'); process.exit(1); }
const LABEL = args.label || 'deck-panel';
const WORKERS = args.workers === undefined ? Math.min(os.cpus().length, 8) : Number(args.workers);
if (!Number.isInteger(WORKERS) || WORKERS <= 0) { console.error('--workers must be a positive integer'); process.exit(1); }

// ── Deck-set + pool ──────────────────────────────────────────────────────────
const deckSet = JSON.parse(readFileSync(SET_PATH, 'utf8'));
for (const d of deckSet.decks) {
  if (d.deckId == null) { console.error(`balance-deck-panel: set deck ${d.deckKey} has no deckId — sim-runner labels decks by deckId (sel:id<deckId>); every set deck must carry one.`); process.exit(1); }
}
// Identity invariants (BLOCKER 2): every set deck must have a unique deckKey,
// a unique deckId, deckId === deckKey (sim-runner labels decks by deckId; the
// panel labels/indexes by deckKey — they must be the same string), and no
// deckKey may collide with the 'starter:<Faction>' namespace this tool uses
// for starter decks (deckKeyOf below).
{
  const keySeen = new Set(), idSeen = new Set();
  for (const d of deckSet.decks) {
    if (d.deckKey.startsWith('starter:')) { console.error(`balance-deck-panel: set deck key "${d.deckKey}" collides with the reserved starter: namespace.`); process.exit(1); }
    if (keySeen.has(d.deckKey)) { console.error(`balance-deck-panel: duplicate deckKey "${d.deckKey}" in set.`); process.exit(1); }
    keySeen.add(d.deckKey);
    if (idSeen.has(d.deckId)) { console.error(`balance-deck-panel: duplicate deckId "${d.deckId}" in set.`); process.exit(1); }
    idSeen.add(d.deckId);
    if (d.deckId !== d.deckKey) { console.error(`balance-deck-panel: deck "${d.deckKey}" has deckId "${d.deckId}" !== deckKey.`); process.exit(1); }
  }
}
const setDecksByKey = new Map(deckSet.decks.map((d) => [d.deckKey, d]));

const poolAbsPath = path.resolve(ENGINE_DIR, deckSet.poolPath);
const poolRaw = readFileSync(poolAbsPath, 'utf8');
const poolSha = createHash('sha256').update(JSON.stringify(JSON.parse(poolRaw))).digest('hex').slice(0, 16);
if (poolSha !== deckSet.poolSha) {
  console.error(`balance-deck-panel: pool sha mismatch — set ${SET_PATH} records poolSha ${deckSet.poolSha}, but ${poolAbsPath} hashes to ${poolSha}. The deck set is stale (or the pool changed under it).`);
  process.exit(1);
}
// AETHERION_CARDS must be set BEFORE importing sim-runner.mjs (it reads the pool
// at import time — see balance-fp-probe.mjs for the same pattern).
process.env.AETHERION_CARDS = poolAbsPath;
const { runSim } = await import('./sim-runner.mjs');
const { getDeck } = await import('./deck-loader.mjs');
const { indexFromRaw } = await import('./balance-data.mjs');
const { index: cardIndex } = indexFromRaw(JSON.parse(poolRaw));

// ── Deck-side identity helpers (side = a set-deck object OR a starter faction string) ─
const isStarter = (side) => typeof side === 'string';
const deckKeyOf = (side) => (isStarter(side) ? `starter:${side}` : side.deckKey);
const specOf = (side) => (isStarter(side) ? side : side.deckKey); // resolveSideSpec-compatible
const factionOf = (side) => (isStarter(side) ? side : side.faction);
const labelOf = (side) => (isStarter(side) ? `${side} (starter)` : `${side.deckKey} [${side.faction}/${side.archetype}]`);
const mainIdsOf = (side) => (isStarter(side) ? (getDeck(side)?.mainDeckDefIds ?? []) : side.mainDeckDefIds);

function resolveSideSpec(x) {
  if (FACTIONS.includes(x)) return x;
  const d = setDecksByKey.get(x);
  if (!d) { console.error(`balance-deck-panel: unknown deck/faction spec "${x}"`); process.exit(1); }
  return d;
}

// ── Canonical pairing identity (SHOULD-FIX: pairing canonicalization) ───────
// Unordered tuple of the two sides' deck keys; a pairing and its mirror
// (a,b)/(b,a) share this id, so they dedupe and seed identically regardless
// of request order or --workers sharding.
function canonicalIdOf(a, b) {
  const ka = deckKeyOf(a), kb = deckKeyOf(b);
  return ka <= kb ? `${ka}|${kb}` : `${kb}|${ka}`;
}
function mixSeed(base, str) {
  const h = createHash('sha256').update(str).digest('hex').slice(0, 8);
  return (base + parseInt(h, 16)) >>> 0;
}
function canonicalizePairings(rawPairings) {
  const byId = new Map();
  const dupIds = [];
  for (const p of rawPairings) {
    const canonicalId = canonicalIdOf(p.a, p.b);
    if (byId.has(canonicalId)) { dupIds.push(canonicalId); continue; }
    // Reorder a/b into canonical order (sorted by deckKey) so a pairing and
    // its mirror produce IDENTICAL rows/runHashes regardless of request order.
    const [a, b] = deckKeyOf(p.a) <= deckKeyOf(p.b) ? [p.a, p.b] : [p.b, p.a];
    byId.set(canonicalId, { a, b, canonicalId, seedBase: mixSeed(deckSet.seed, canonicalId) });
  }
  if (dupIds.length > 0) {
    console.warn(`balance-deck-panel: deduped ${dupIds.length} duplicate pairing(s): ${[...new Set(dupIds)].join(', ')}`);
  }
  return [...byId.values()].sort((x, y) => (x.canonicalId < y.canonicalId ? -1 : x.canonicalId > y.canonicalId ? 1 : 0));
}

// ── Build the raw pairing list ───────────────────────────────────────────────
let rawPairings = []; // [{a, b}] — a/b are set-deck objects or faction strings
if (args.vsStarters) {
  for (const d of deckSet.decks) for (const f of FACTIONS) rawPairings.push({ a: d, b: f });
} else if (args.field) {
  const keys = args.field.split(',').map((s) => s.trim()).filter(Boolean);
  const sides = keys.map(resolveSideSpec);
  for (let i = 0; i < sides.length; i++) for (let j = i; j < sides.length; j++) rawPairings.push({ a: sides[i], b: sides[j] });
} else if (args.pairs) {
  const raw = JSON.parse(readFileSync(path.resolve(process.cwd(), args.pairs), 'utf8'));
  rawPairings = raw.map((p) => ({ a: resolveSideSpec(p.a), b: resolveSideSpec(p.b) }));
} else {
  // --internal-shard: a slice file of {a, b} spec strings written by the parent.
  const raw = JSON.parse(readFileSync(path.resolve(process.cwd(), args.internalShard), 'utf8'));
  rawPairings = raw.map((p) => ({ a: resolveSideSpec(p.a), b: resolveSideSpec(p.b) }));
}
const pairings = canonicalizePairings(rawPairings);

function wilson(w, n, z = 1.96) {
  if (n <= 0) return [0, 0, 0];
  const p = w / n, d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const h = (z / d) * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [100 * (c - h), 100 * p, 100 * (c + h)];
}

// ── Card-usage + per-deck accumulators (filled from final observations) ─────
const usage = new Map();   // deckKey -> Map(cardDefId -> {deployed,cast,discarded,destroyed})
const gamesByDeck = new Map(); // deckKey -> games played
const coverageByDeck = new Map(); // deckKey -> Map(kind -> {resolved, uncovered})
let uncoveredEvents = 0;   // events whose cardDefId never resolved (event payload absent AND end-state scan missed it)
const factionEventTotal = new Map(); // faction -> {deployed, cast} — cross-check vs sim-runner's own telemetry

function bump(deckKey, cardDefId, kind) {
  const m = usage.get(deckKey) ?? usage.set(deckKey, new Map()).get(deckKey);
  const c = m.get(cardDefId) ?? m.set(cardDefId, { deployed: 0, cast: 0, discarded: 0, destroyed: 0, attached: 0 }).get(cardDefId);
  c[kind]++;
}
function bumpCoverage(deckKey, kind, resolved) {
  const m = coverageByDeck.get(deckKey) ?? coverageByDeck.set(deckKey, new Map()).get(deckKey);
  const c = m.get(kind) ?? m.set(kind, { resolved: 0, uncovered: 0 }).get(kind);
  c[resolved ? 'resolved' : 'uncovered']++;
}

// Build the observation reducer for ONE pairing call. `gpp` = that call's
// gamesPerPairing, `seatAlt` = whether seatAlternation is on (both constant
// across the whole panel here). Because this call has exactly one pairing
// (plan index p=0 in sim-runner's generateResults loop), the local per-call
// game counter IS the `g` sim-runner uses internally for the swap-phase
// formula `(g>>1)%2===1` — no cross-pairing index bookkeeping needed.
function diagFor(aSide, bSide, gpp, seatAlt) {
  let g = 0;
  const aKey = deckKeyOf(aSide), bKey = deckKeyOf(bSide);
  const aFaction = factionOf(aSide), bFaction = factionOf(bSide);
  return {
    onGame: (fin) => {
      const swapSeats = seatAlt && (g >> 1) % 2 === 1;
      g++;
      const seatDeckKey = swapSeats ? [bKey, aKey] : [aKey, bKey];
      const seatFaction = swapSeats ? [bFaction, aFaction] : [aFaction, bFaction];
      gamesByDeck.set(seatDeckKey[0], (gamesByDeck.get(seatDeckKey[0]) || 0) + 1);
      gamesByDeck.set(seatDeckKey[1], (gamesByDeck.get(seatDeckKey[1]) || 0) + 1);

      // FALLBACK ONLY (BLOCKER 1 fix): the event payload now carries
      // `cardDefId` directly (engine-side, additive — see game-state.ts),
      // so this end-of-game zone scan is a fallback for events emitted
      // before that field existed nowhere, not the primary source. It stays
      // because an instance that left every zone (rare — see
      // destruction-destination.ts) is otherwise unrecoverable even from
      // the event payload if some future emit site is missed; such events
      // are counted as uncovered rather than misattributed either way.
      const instMap = new Map();
      for (const seat of [0, 1]) {
        const ps = fin.players[seat];
        const pool = [...ps.hand, ...ps.mainDeck, ...ps.discardPile, ...ps.zones.reserve, ...ps.zones.frontline, ...ps.zones.highGround];
        for (const inst of pool) if (inst && inst.instanceId) instMap.set(inst.instanceId, inst.cardDefId);
      }
      // EQUIPMENT_ATTACHED joined the tally 2026-07-13: the step-4 screen showed
      // ALL 122 equipment slots at zero uses — an instrument artifact (attaches
      // fire EQUIPMENT_ATTACHED, which wasn't counted; ground truth ~8 attaches/
      // game). Its instance field is equipmentId, hence the fallback below.
      const KIND = { CARD_DEPLOYED: 'deployed', SPELL_CAST: 'cast', CARD_DISCARDED: 'discarded', CARD_DESTROYED: 'destroyed', EQUIPMENT_ATTACHED: 'attached' };
      for (const e of fin.log) {
        const kind = KIND[e.type];
        if (!kind) continue;
        const dk = seatDeckKey[e.playerId];
        const defId = e.cardDefId !== undefined ? e.cardDefId : instMap.get(e.cardInstanceId ?? e.equipmentId);
        if (defId === undefined) { uncoveredEvents++; bumpCoverage(dk, kind, false); continue; }
        bumpCoverage(dk, kind, true);
        bump(dk, defId, kind);
        if (kind === 'deployed' || kind === 'cast') {
          const f = seatFaction[e.playerId];
          const t = factionEventTotal.get(f) ?? factionEventTotal.set(f, { deployed: 0, cast: 0 }).get(f);
          t[kind]++;
        }
      }
    },
  };
}

// Stronger/affordable bot knobs (mirror balance-verify.mjs): expose the existing
// rollout-pilot switches so a deck panel can read decks with heuristic playouts, full
// candidate enumeration, and the snapshot backend. Env-inherited by shard children.
// Unset ⇒ omitted (byte-identical to prior panels). rolloutPlayout/candidateGen change
// the runHash by design (different bot); playoutBackend is hash-exempt.
const ROLLOUT_PLAYOUT = process.env.ROLLOUT_PLAYOUT;
if (ROLLOUT_PLAYOUT !== undefined && ROLLOUT_PLAYOUT !== 'random' && ROLLOUT_PLAYOUT !== 'heuristic') { console.error(`ROLLOUT_PLAYOUT must be 'random' or 'heuristic' (got "${ROLLOUT_PLAYOUT}")`); process.exit(1); }
const CAND_GEN = process.env.CAND_GEN;
if (CAND_GEN !== undefined && CAND_GEN !== 'legacy' && CAND_GEN !== 'full') { console.error(`CAND_GEN must be 'legacy' or 'full' (got "${CAND_GEN}")`); process.exit(1); }
const PLAYOUT_BACKEND = process.env.PLAYOUT_BACKEND;
if (PLAYOUT_BACKEND !== undefined && PLAYOUT_BACKEND !== 'actor' && PLAYOUT_BACKEND !== 'snapshot') { console.error(`PLAYOUT_BACKEND must be 'actor' or 'snapshot' (got "${PLAYOUT_BACKEND}")`); process.exit(1); }
const STRONGER_KNOBS = {
  ...(ROLLOUT_PLAYOUT !== undefined ? { rolloutPlayout: ROLLOUT_PLAYOUT } : {}),
  ...(CAND_GEN !== undefined ? { candidateGen: CAND_GEN } : {}),
  ...(PLAYOUT_BACKEND !== undefined ? { playoutBackend: PLAYOUT_BACKEND } : {}),
};

// ── Run one runSim call per pairing ──────────────────────────────────────────
const BASE = { rulesProfile: 'current', firstPlayer: 'alternating', seatAlternation: true, termination: 'tiebreak', abilitiesOn: true, turnCap: 80, botPolicy: 'rollout', ...RUNG_PARAMS, ...STRONGER_KNOBS, gamesPerPairing: GPP };
if (!IS_SHARD_CHILD) {
  console.log(`Pool: ${poolAbsPath}  sha256/16 ${poolSha}  set ${deckSet.version}  pairings ${pairings.length}  gpp ${GPP}  rung r${RUNG}`);
}

const pairingRows = [];
const deckStats = new Map(); // deckKey -> {label, faction, wins, games}
const cellsForPacing = [];

function runPairing(a, b, seedBase) {
  const reducer = diagFor(a, b, GPP, BASE.seatAlternation);
  const cfg = {
    ...BASE,
    seedBase,
    matchups: [{ p0Deck: a, p1Deck: b }],
    observation: { finalState: true },
  };
  const r = runSim(cfg);
  for (const row of r.observations) {
    reducer.onGame(row.observation.finalState);
  }
  const cell = Object.values(r.matchupDetail)[0];

  const aKey = deckKeyOf(a), bKey = deckKeyOf(b);
  for (const [k, side] of [[aKey, a], [bKey, b]]) {
    if (!deckStats.has(k)) deckStats.set(k, { label: labelOf(side), faction: factionOf(side), wins: 0, games: 0 });
  }
  const sa = deckStats.get(aKey), sb = deckStats.get(bKey);
  sa.wins += cell.wA; sa.games += cell.n;
  sb.wins += cell.wB; sb.games += cell.n;

  const row = {
    aKey, bKey, aLabel: labelOf(a), bLabel: labelOf(b),
    n: cell.n, wA: cell.wA, wB: cell.wB, draws: cell.n - cell.wA - cell.wB,
    aDecidedWinPct: cell.aWinPct,
    decidedPct: +(100 * (cell.wA + cell.wB) / Math.max(cell.n, 1)).toFixed(1),
    turnsP50: cell.turnsP.p50, winMethod: cell.winMethod,
    comebackPct: cell.comeback.pct, runHash: r.runHash,
  };
  pairingRows.push(row);
  cellsForPacing.push(cell);
  if (!IS_SHARD_CHILD) {
    console.log(`  ${labelOf(a).padEnd(40)} vs ${labelOf(b).padEnd(40)} ${cell.aWinPct.toFixed(1)}%/${(100 - cell.aWinPct).toFixed(1)}%  n=${cell.n}  turnsP50=${cell.turnsP.p50}  tiebreak=${cell.winMethod.tiebreak}`);
  }
}

// ── SHARD CHILD: run this process's slice, write shard JSON, exit ──────────
if (IS_SHARD_CHILD) {
  for (const { a, b, seedBase } of pairings) runPairing(a, b, seedBase);
  const shard = {
    pairingRows,
    cellsForPacing,
    deckStats: Object.fromEntries(deckStats),
    usage: Object.fromEntries([...usage].map(([k, m]) => [k, Object.fromEntries(m)])),
    gamesByDeck: Object.fromEntries(gamesByDeck),
    coverageByDeck: Object.fromEntries([...coverageByDeck].map(([k, m]) => [k, Object.fromEntries(m)])),
    factionEventTotal: Object.fromEntries(factionEventTotal),
    uncoveredEvents,
  };
  if (!args.out) { console.error('balance-deck-panel: --internal-shard requires --out'); process.exit(1); }
  mkdirSync(path.dirname(args.out), { recursive: true });
  writeFileSync(args.out, JSON.stringify(shard));
  process.exit(0);
}

// ── PARALLEL ORCHESTRATION (--workers > 1): shard, spawn, merge ────────────
if (WORKERS > 1 && pairings.length > 1) {
  const shardDir = `${RUNS_DIR}shard-${process.pid}-${LABEL.replace(/[^A-Za-z0-9._-]+/g, '-')}/`;
  mkdirSync(shardDir, { recursive: true });
  const n = Math.min(WORKERS, pairings.length);
  const sliceFiles = [], outFiles = [];
  for (let i = 0; i < n; i++) {
    const lo = Math.floor((i * pairings.length) / n), hi = Math.floor(((i + 1) * pairings.length) / n);
    const slice = pairings.slice(lo, hi).map((p) => ({ a: specOf(p.a), b: specOf(p.b) }));
    const sliceFile = `${shardDir}slice-${i}.json`;
    const outFile = `${shardDir}out-${i}.json`;
    writeFileSync(sliceFile, JSON.stringify(slice));
    sliceFiles.push(sliceFile);
    outFiles.push(outFile);
  }
  console.log(`Pool: ${poolAbsPath}  sha256/16 ${poolSha}  set ${deckSet.version}  pairings ${pairings.length}  gpp ${GPP}  rung r${RUNG}  workers ${n}`);

  const childArgs = (i) => [
    SCRIPT_PATH, '--set', SET_PATH, '--gpp', String(GPP), '--rung', String(RUNG),
    '--label', `${LABEL}-shard${i}`, '--internal-shard', sliceFiles[i], '--out', outFiles[i],
  ];
  const children = [];
  const runChild = (i) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, childArgs(i), { stdio: ['ignore', 'ignore', 'inherit'] });
    children[i] = child;
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`shard ${i} exited with code ${code}`))));
  });

  try {
    await Promise.all(Array.from({ length: n }, (_, i) => runChild(i)));
  } catch (err) {
    // On first failure: kill remaining children, await their exit, then delete
    // ALL shard temp files (no post-mortem carcass, no partial ledger entry —
    // the failure below happens before appendRun is ever reached).
    await Promise.all(children.map((child) => new Promise((resolve) => {
      if (!child || child.exitCode !== null || child.signalCode !== null) { resolve(); return; }
      child.once('exit', () => resolve());
      child.kill();
    })));
    rmSync(shardDir, { recursive: true, force: true });
    console.error(`balance-deck-panel: ${err.message} — remaining shards killed, shard temp files cleaned up.`);
    process.exit(1);
  }

  // Merge shard JSONs. Sorting pairingRows/cellsForPacing pairs by canonical
  // id keeps the merged output independent of shard boundaries; summing the
  // per-deck maps keeps it independent of which shard touched a deck first.
  // TRUST BOUNDARY: the parent trusts each shard's own summary numbers
  // (pairingRows/cellsForPacing/usage/etc.) rather than recomputing them from
  // raw per-game data — this is safe because seeds are pairing-canonical (a
  // pairing's games are identical regardless of which shard/worker-count ran
  // it) and every merge step above is commutative/associative (sum, sort-by-
  // canonical-id). A parent-side full recompute (replaying every shard's
  // games and cross-checking against its summary) was considered and skipped
  // — it would double the wall-clock cost this tool exists to avoid, for a
  // check that determinism already rules out.
  const shards = outFiles.map((f) => JSON.parse(readFileSync(f, 'utf8')));
  const mergedRows = [];
  const mergedCells = [];
  for (const s of shards) {
    for (let i = 0; i < s.pairingRows.length; i++) { mergedRows.push(s.pairingRows[i]); mergedCells.push(s.cellsForPacing[i]); }
  }
  const rowOrder = mergedRows.map((r, i) => i).sort((i, j) => {
    const ci = [mergedRows[i].aKey, mergedRows[i].bKey].sort().join('|');
    const cj = [mergedRows[j].aKey, mergedRows[j].bKey].sort().join('|');
    return ci < cj ? -1 : ci > cj ? 1 : 0;
  });
  pairingRows.length = 0; cellsForPacing.length = 0;
  for (const i of rowOrder) { pairingRows.push(mergedRows[i]); cellsForPacing.push(mergedCells[i]); }

  for (const s of shards) {
    for (const [k, st] of Object.entries(s.deckStats)) {
      const cur = deckStats.get(k) ?? deckStats.set(k, { label: st.label, faction: st.faction, wins: 0, games: 0 }).get(k);
      cur.wins += st.wins; cur.games += st.games;
    }
    for (const [k, byId] of Object.entries(s.usage)) {
      for (const [id, counts] of Object.entries(byId)) {
        for (const kind of ['deployed', 'cast', 'discarded', 'destroyed']) for (let x = 0; x < counts[kind]; x++) bump(k, +id, kind);
      }
    }
    for (const [k, n2] of Object.entries(s.gamesByDeck)) gamesByDeck.set(k, (gamesByDeck.get(k) || 0) + n2);
    for (const [k, byKind] of Object.entries(s.coverageByDeck)) {
      for (const [kind, c] of Object.entries(byKind)) {
        for (let x = 0; x < c.resolved; x++) bumpCoverage(k, kind, true);
        for (let x = 0; x < c.uncovered; x++) bumpCoverage(k, kind, false);
      }
    }
    for (const [f, t] of Object.entries(s.factionEventTotal)) {
      const cur = factionEventTotal.get(f) ?? factionEventTotal.set(f, { deployed: 0, cast: 0 }).get(f);
      cur.deployed += t.deployed; cur.cast += t.cast;
    }
    uncoveredEvents += s.uncoveredEvents;
  }
  rmSync(shardDir, { recursive: true, force: true });
} else {
  // ── Pure serial path (--workers 1, or a single-pairing panel) ────────────
  for (const { a, b, seedBase } of pairings) runPairing(a, b, seedBase);
}

// ── Combined runHash (fold of every pairing's own runHash, over canonically
// ordered pairings — order-independent of mode/worker count) ──────────────
const runHash = createHash('sha256').update(pairingRows.map((r) => r.runHash).join(',')).digest('hex').slice(0, 16);

// ── Pacing WATCH (thresholds.pacing) — pooled over every pairing's single cell ─
const T = JSON.parse(readFileSync(new URL('./sim-data/balance-targets.json', import.meta.url), 'utf8')).thresholds.pacing;
function pacingFromCells(cells) {
  let games = 0, kill = 0, tiebreak = 0, cbN = 0, cbOver = 0;
  const p50s = [];
  for (const c of cells) {
    games += c.n; kill += c.winMethod.kill; tiebreak += c.winMethod.tiebreak;
    cbN += c.comeback.n; cbOver += c.comeback.overturned;
    p50s.push({ p50: c.turnsP.p50, n: c.n });
  }
  p50s.sort((x, y) => x.p50 - y.p50);
  let acc = 0, medianP50 = null;
  for (const x of p50s) { acc += x.n; if (acc >= games / 2) { medianP50 = x.p50; break; } }
  return {
    naturalKillPct: +(100 * kill / Math.max(games, 1)).toFixed(1),
    tiebreakPct: +(100 * tiebreak / Math.max(games, 1)).toFixed(1),
    turnsP50: medianP50,
    leaderAt10WinPct: +(100 * (cbN - cbOver) / Math.max(cbN, 1)).toFixed(1),
    comebackPct: +(100 * cbOver / Math.max(cbN, 1)).toFixed(1),
  };
}
const pacing = pacingFromCells(cellsForPacing);
const pacingVerdicts = {
  naturalKillPct: pacing.naturalKillPct < T.naturalKillPct.watchBelow ? 'WATCH' : 'OK',
  tiebreakPct: pacing.tiebreakPct > T.tiebreakPct.watchAbove ? 'WATCH' : 'OK',
  turnsP50: (pacing.turnsP50 < T.turnsP50.watchBelow || pacing.turnsP50 > T.turnsP50.watchAbove) ? 'WATCH' : 'OK',
  leaderAt10WinPct: pacing.leaderAt10WinPct > T.leaderAt10WinPct.watchAbove ? 'WATCH' : 'OK',
  comebackPct: pacing.comebackPct < T.comebackPct.watchBelow ? 'WATCH' : 'OK',
};
console.log(`\nPacing (WATCH-only): naturalKill ${pacing.naturalKillPct}% [${pacingVerdicts.naturalKillPct}]  tiebreak ${pacing.tiebreakPct}% [${pacingVerdicts.tiebreakPct}]  turnsP50 ${pacing.turnsP50} [${pacingVerdicts.turnsP50}]  leaderAt10Win ${pacing.leaderAt10WinPct}% [${pacingVerdicts.leaderAt10WinPct}]  comeback ${pacing.comebackPct}% [${pacingVerdicts.comebackPct}]`);

// ── Per-deck aggregation (Wilson 95% CI). Denominator is ALL games the deck
// played (including draws), not just decided ones — matches sim-runner's own
// win-rate convention. ──────────────────────────────────────────────────────
const decks = {};
console.log(`\n══ PER-DECK (vs field) ══`);
for (const [k, s] of deckStats) {
  const ci = wilson(s.wins, s.games);
  decks[k] = { label: s.label, faction: s.faction, wins: s.wins, games: s.games, winPct: +(100 * s.wins / Math.max(s.games, 1)).toFixed(1), wilsonCi: ci };
  console.log(`  ${s.label.padEnd(48)} ${s.wins}/${s.games}  ${(100 * s.wins / Math.max(s.games, 1)).toFixed(1)}%  CI [${ci[0].toFixed(1)}-${ci[2].toFixed(1)}]`);
}

// ── Card-usage report (BLOCKER 1: per-deck, per-event-kind coverage) ───────
const cardUsage = {};
let anyPartialCoverage = false;
console.log(`\n══ CARD USAGE ══`);
for (const [k, s] of deckStats) {
  const games = gamesByDeck.get(k) || 0;
  const mainIds = mainIdsOf(k.startsWith('starter:') ? k.slice(8) : setDecksByKey.get(k));
  const byId = usage.get(k) || new Map();
  const uniq = [...new Set(mainIds)];
  const rows = uniq.map((id) => {
    const copies = mainIds.filter((x) => x === id).length;
    const u = byId.get(id) || { deployed: 0, cast: 0, discarded: 0, destroyed: 0, attached: 0 };
    const uses = u.deployed + u.cast + (u.attached ?? 0);
    return { id, name: cardIndex.get(id)?.name || `#${id}`, copies, usesPerGame: games ? +(uses / games).toFixed(2) : 0, discardRate: games ? +(u.discarded / games).toFixed(2) : 0, totalUses: uses };
  });
  const neverUsed = rows.filter((r) => r.totalUses === 0).map((r) => r.name);
  const heavy = [...rows].sort((x, y) => y.usesPerGame - x.usesPerGame).slice(0, 5);

  const byKind = coverageByDeck.get(k) || new Map();
  let resolvedTotal = 0, uncoveredTotal = 0;
  const coverageDetail = {};
  for (const kind of ['deployed', 'cast', 'discarded', 'destroyed']) {
    const c = byKind.get(kind) || { resolved: 0, uncovered: 0 };
    coverageDetail[kind] = c;
    resolvedTotal += c.resolved; uncoveredTotal += c.uncovered;
  }
  const eventTotal = resolvedTotal + uncoveredTotal;
  const uncoveredFrac = eventTotal > 0 ? uncoveredTotal / eventTotal : 0;
  const coverageStatus = uncoveredFrac > 0.005 ? 'partial' : 'full';
  if (coverageStatus === 'partial') {
    anyPartialCoverage = true;
    console.warn(`  WARNING: ${s.label} usage coverage is PARTIAL — ${uncoveredTotal}/${eventTotal} events (${(100 * uncoveredFrac).toFixed(2)}%) had no recoverable cardDefId.`);
  }

  cardUsage[k] = { games, cards: rows, neverUsed, heavyHitters: heavy.map((r) => r.name), coverage: coverageStatus, coverageDetail };
  console.log(`  ${s.label} (n=${games}) [coverage: ${coverageStatus}]: never-used [${neverUsed.join(', ') || 'none'}]  top-uses [${heavy.map((r) => `${r.name} ${r.usesPerGame}/g`).join(', ')}]`);
}
if (uncoveredEvents > 0) console.log(`\n  (${uncoveredEvents} usage events had no recoverable cardDefId in total — see per-deck coverage above)`);

// ── Cross-check vs sim-runner's own per-faction telemetry ───────────────────
let mineDeployed = 0, mineCast = 0;
for (const m of usage.values()) for (const c of m.values()) { mineDeployed += c.deployed; mineCast += c.cast; }
let theirsDeployed = 0, theirsCast = 0;
for (const t of factionEventTotal.values()) { theirsDeployed += t.deployed; theirsCast += t.cast; }
console.log(`\nCross-check: collector deployed+cast=${mineDeployed + mineCast}  faction-tally deployed+cast=${theirsDeployed + theirsCast}  (should match exactly — both read the same CARD_DEPLOYED/SPELL_CAST log events)`);

// ── Report hash (SHOULD-FIX): sha256/16 over canonical JSON of the report's
// substantive content, independent of the simulation runHash above. ────────
function canonicalStringify(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalStringify(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
const reportHash = createHash('sha256').update(canonicalStringify({ pairings: pairingRows, decks, cardUsage, coverage: anyPartialCoverage ? 'partial' : 'full', pacing })).digest('hex').slice(0, 16);

// ── Output ────────────────────────────────────────────────────────────────
const OUT = process.env.GAUGE_OUT || args.out || `${RUNS_DIR}tmp-deck-panel-${LABEL}.json`;
mkdirSync(path.dirname(OUT), { recursive: true });
const totalGames = pairingRows.reduce((s, p) => s + p.n, 0);
const totalDecided = pairingRows.reduce((s, p) => s + p.wA + p.wB, 0);
const gaugeOut = {
  generatedFrom: 'balance-deck-panel.mjs',
  set: { version: deckSet.version, poolSha, seed: deckSet.seed },
  // NOTE: `workers` is deliberately NOT serialized here — it's an execution
  // detail (wall-clock sharding), not measurement config, and output must be
  // byte-identical across worker counts (see PAIRING IDENTITY comment above).
  config: { gpp: GPP, rung: RUNG, mode: args.vsStarters ? 'vs-starters' : args.field ? 'field' : 'pairs' },
  runHash,
  reportHash,
  pairings: pairingRows,
  decks,
  cardUsage,
  pacing: { metrics: pacing, verdicts: pacingVerdicts },
  pool: { path: String(poolAbsPath), sha256_16: poolSha },
  focus: null,
  // Minimal pilots shim — appendRun/headlinePilot (balance-ledger.mjs) expects
  // pilots[].{label,spread,mirrorFp,decidedPct,games,runHash,marg}; this run has
  // no faction marginal/spread concept (it's deck-level), so those are 0/null.
  pilots: [{ label: LABEL, kind: 'agg', marg: {}, spread: 0, mirrorFp: null, decidedPct: +(100 * totalDecided / Math.max(totalGames, 1)).toFixed(1), games: totalGames, runHash }],
};
writeFileSync(OUT, JSON.stringify(gaugeOut, null, 2));
console.log(`\nJSON -> ${OUT}`);

const entry = appendRun({ kind: 'deck-panel', label: LABEL, resultPath: OUT, env: { gpp: GPP, rung: RUNG, workers: WORKERS }, preset: null });
// appendRun archives by MOVING resultPath -> balance-runs/runs/<id>.json. When
// --out was explicitly given, copy the archive back so the file stays at the
// path the user asked for (default tmp path keeps pure move semantics).
if (args.out) copyFileSync(`${RUNS_DIR}${entry.id}.json`, OUT);
console.log(`Ledger: ${entry.id}  runHash ${runHash}  reportHash ${reportHash}`);
