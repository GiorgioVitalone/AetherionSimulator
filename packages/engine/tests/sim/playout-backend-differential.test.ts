/**
 * Differential trace harness — T7 (plan Phase 1, item 8).
 *
 * The equivalence instrument for the actor-free playout backend: at sampled
 * decision points of real (synthetic-registry) games, the SAME persisted
 * snapshot is forked through BOTH stepping backends and driven by the SAME
 * event sequence; after EVERY event the two snapshots are compared on
 * machine state node, GameState (deep), machine-level pendingChoice, and
 * status. Any mismatch is reported with (seed, decisionIndex, eventIndex).
 * Emitted events are covered by this deep GameState comparison too — every
 * dispatched GameEvent is appended to `gameState.log`, so a divergence in
 * emitted events surfaces as a `gameState` field mismatch without needing a
 * separate events-only assertion.
 *
 * Also covers the spike's named risk: illegal-send parity — sending a
 * well-typed-but-illegal action (unknown card instance) must be handled
 * identically by both backends. Investigation (see the test body) found
 * that xstate v5's `Actor.send()` never throws synchronously for an
 * internal transition error — it swallows it into `snapshot.status:
 * 'error'` and reports it asynchronously via `setTimeout` (by the library's
 * own design, specifically so it can't be caught by the caller's try/catch).
 * So the actor path's `try { fork.send(...) } catch {}` in `playout()` /
 * `oneRollout` cannot be proven reachable for engine-internal errors; this
 * fixture instead pins the real, provable contract — both backends silently
 * no-op the illegal action (GameState unchanged) — and continues to prove
 * the two playouts converge to identical outcomes.
 *
 * Skips gracefully when dist/ is missing (pilot-rollout.mjs imports dist),
 * mirroring rollout-pin.test.ts.
 */
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createActor } from 'xstate';

const here = dirname(fileURLToPath(import.meta.url));
const pilotPath = join(here, '..', '..', 'pilot-rollout.mjs');
const distPath = join(here, '..', '..', 'dist', 'index.js');

const ready = existsSync(pilotPath) && existsSync(distPath);
const d = ready ? describe : describe.skip;

// ── Minimal deterministic RNG (mulberry32 — same family the pilot uses) ─────
function rngf(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Tiny two-faction registry (same spirit as enumerate-actions.test.ts) ────
const CREATURES = [
  { id: 1, name: 'Grunt', hp: 2, atk: 2, cost: 1 },
  { id: 2, name: 'Soldier', hp: 3, atk: 3, cost: 1 },
  { id: 3, name: 'Knight', hp: 5, atk: 4, cost: 2 },
];
const EQUIP_ID = 10;
const SPELL_ID = 11;
const RES_ID = 99;

interface MinimalRegistry {
  getCard: (id: number) => Record<string, unknown> | undefined;
  getHero: (id: number) => Record<string, unknown>;
}

function registryFor(alignment: string): MinimalRegistry {
  return {
    getCard: (id: number) => {
      if (id === EQUIP_ID)
        return {
          id,
          name: 'Blade',
          cardType: 'E',
          cost: { mana: 1, energy: 0, flexible: 0 },
          alignment: [alignment],
        };
      if (id === SPELL_ID)
        return {
          id,
          name: 'Zap',
          cardType: 'S',
          cost: { mana: 1, energy: 0, flexible: 0 },
          alignment: [alignment],
        };
      if (id === RES_ID)
        return { id, name: 'Mana', cardType: 'R', cost: { mana: 0, energy: 0, flexible: 0 } };
      const c = CREATURES.find((x) => x.id === id);
      if (c === undefined) return undefined;
      return {
        id: c.id,
        name: c.name,
        cardType: 'C',
        cost: { mana: c.cost, energy: 0, flexible: 0 },
        stats: { hp: c.hp, atk: c.atk, arm: 0 },
        alignment: [alignment],
      };
    },
    getHero: (id: number) => ({ id, name: `Hero ${String(id)}`, lp: 24, alignment: [alignment] }),
  };
}

// `createGame` takes a SINGLE shared registry (same convention as
// enumerate-actions.test.ts) — card lookups are identity-shared across both
// decks, but each seat's hero keeps its own pairing alignment.
function pairingRegistry(alignA: string, alignB: string): MinimalRegistry {
  const base = registryFor(alignA);
  return {
    ...base,
    getHero: (id: number) => (id === 101 ? registryFor(alignB).getHero(id) : base.getHero(id)),
  };
}

function deckFor(heroDefId: number): Record<string, unknown> {
  const main: number[] = [];
  while (main.length < 44) {
    for (const c of CREATURES) main.push(c.id);
    main.push(EQUIP_ID, SPELL_ID);
  }
  return {
    heroDefId,
    mainDeckDefIds: main.slice(0, 44),
    resourceDeckDefIds: Array.from({ length: 15 }, () => RES_ID),
  };
}

// ── Snapshot comparison ──────────────────────────────────────────────────────
interface Mismatch {
  seed: number;
  decisionIndex: number;
  eventIndex: number;
  field: string;
}

interface ForkLike {
  send: (e: Record<string, unknown>) => void;
  getSnapshot: () => AnySnap;
  stop?: () => void;
}

interface AnySnap {
  value: unknown;
  status: string;
  context: { gameState: Record<string, unknown>; pendingChoice: unknown };
}

function compareSnaps(a: AnySnap, b: AnySnap, at: Omit<Mismatch, 'field'>, out: Mismatch[]): void {
  if (JSON.stringify(a.value) !== JSON.stringify(b.value)) out.push({ ...at, field: 'value' });
  if (a.status !== b.status) out.push({ ...at, field: 'status' });
  if (
    JSON.stringify(a.context.pendingChoice ?? null) !==
    JSON.stringify(b.context.pendingChoice ?? null)
  )
    out.push({ ...at, field: 'pendingChoice' });
  if (JSON.stringify(a.context.gameState) !== JSON.stringify(b.context.gameState))
    out.push({ ...at, field: 'gameState' });
}

// A fork that drives BOTH backends with every event and compares after each.
// Control flow (getSnapshot) follows the ACTOR — the reference implementation —
// and actor exceptions are rethrown so playout()'s catch branches behave
// exactly as in production; exception parity itself is a compared field.
function pairedFork(
  actorFork: ForkLike,
  snapFork: ForkLike,
  at: { seed: number; decisionIndex: number },
  out: Mismatch[],
): ForkLike & { events: number } {
  const paired = {
    events: 0,
    send(e: Record<string, unknown>) {
      const eventIndex = paired.events++;
      let actorErr: unknown = null;
      let snapErr: unknown = null;
      try {
        actorFork.send(e);
      } catch (err) {
        actorErr = err;
      }
      try {
        snapFork.send(e);
      } catch (err) {
        snapErr = err;
      }
      if ((actorErr == null) !== (snapErr == null))
        out.push({
          ...at,
          eventIndex,
          field: `exception (actor=${String(actorErr != null)} snapshot=${String(snapErr != null)})`,
        });
      compareSnaps(actorFork.getSnapshot(), snapFork.getSnapshot(), { ...at, eventIndex }, out);
      if (actorErr != null) throw actorErr;
    },
    getSnapshot: () => actorFork.getSnapshot(),
    stop() {
      actorFork.stop?.();
      snapFork.stop?.();
    },
  };
  return paired;
}

// ── The harness ──────────────────────────────────────────────────────────────
d('playout backend differential (T7)', () => {
  it('actor and snapshot backends agree after every event across sampled decisions (2 pairings × 26 seeds)', async () => {
    const dist = (await import(distPath)) as Record<string, never>;
    const { createGame, gameMachine, computeAvailableActions } = dist as unknown as {
      createGame: (
        a: Record<string, unknown>,
        b: Record<string, unknown>,
        c: MinimalRegistry,
        seed?: number,
      ) => Record<string, unknown>;
      gameMachine: unknown;
      computeAvailableActions: (gs: Record<string, unknown>, p: number) => Record<string, unknown>;
    };
    const pilot = (await import(pilotPath)) as unknown as {
      playout: (
        fork: ForkLike,
        policy: string,
        turnCap: number,
        rnd: () => number,
        stepCap: number,
        horizonTurn: number,
      ) => Record<string, unknown>;
      makeSnapshotFork: (machine: unknown, snapshot: AnySnap) => ForkLike;
      hydratePersistedSnapshot: (machine: unknown, persisted: unknown) => AnySnap;
      concretePlayoutActions: (acts: Record<string, unknown>) => Array<Record<string, unknown>>;
    };

    const mismatches: Mismatch[] = [];
    let pairedPlayouts = 0;

    const PAIRINGS: Array<[string, string]> = [
      ['Onyx', 'Radiant'],
      ['Sapphire', 'Verdant'],
    ];
    for (const [alignA, alignB] of PAIRINGS) {
      for (let seed = 1; seed <= 26; seed++) {
        // Base game: random self-play on the reference actor.
        const gs0 = createGame(deckFor(100), deckFor(101), pairingRegistry(alignA, alignB), seed);
        const base = createActor(
          gameMachine as never,
          { input: { gameState: gs0 } } as never,
        ) as unknown as ForkLike;
        (base as unknown as { start: () => void }).start();
        const rnd = rngf(seed * 2654435761);
        let decisionIndex = 0;
        let steps = 0;
        while (steps++ < 400) {
          const snap = base.getSnapshot();
          if (snap.status === 'done') break;
          const gs = snap.context.gameState as Record<string, unknown> & {
            winner: unknown;
            turnNumber: number;
            activePlayerIndex: number;
            pendingPriority: unknown;
            pendingChoice: {
              type?: string;
              playerId?: number;
              options?: Array<{ instanceId?: string; id?: string }>;
              minSelections?: number;
            } | null;
          };
          if (gs.winner != null || gs.turnNumber > 12) break;

          if (gs.pendingPriority != null) {
            try {
              base.send({ type: 'PRIORITY_PASS' });
            } catch {
              break;
            }
            continue;
          }
          const pc = gs.pendingChoice ?? (snap.context.pendingChoice as typeof gs.pendingChoice);
          if (pc != null) {
            try {
              if (pc.type === 'mulligan')
                base.send({ type: 'MULLIGAN_DECISION', playerId: pc.playerId, keep: true });
              else
                base.send({
                  type: 'PLAYER_RESPONSE',
                  response: {
                    selectedOptionIds: (pc.options ?? [])
                      .map((o) => o.instanceId ?? o.id)
                      .slice(0, Math.max(pc.minSelections ?? 0, 0)),
                  },
                });
            } catch {
              break;
            }
            continue;
          }

          // Active-player decision point: every 3rd one runs a paired playout.
          if (decisionIndex % 3 === 0) {
            const persisted = (
              base as unknown as { getPersistedSnapshot: () => unknown }
            ).getPersistedSnapshot();
            const at = { seed, decisionIndex };
            const actorFork = createActor(
              gameMachine as never,
              { snapshot: persisted } as never,
            ) as unknown as ForkLike;
            (actorFork as unknown as { start: () => void }).start();
            const hydrated = pilot.hydratePersistedSnapshot(gameMachine, persisted);
            const snapFork = pilot.makeSnapshotFork(gameMachine, hydrated);
            const paired = pairedFork(actorFork, snapFork, at, mismatches);
            const horizon = (gs.turnNumber as number) + 2;
            pilot.playout(paired, 'random', 20, rngf(seed * 31 + decisionIndex), 200, horizon);
            paired.stop?.();
            pairedPlayouts++;
          }
          decisionIndex++;

          // Advance the base game with one random legal action (or end phase).
          try {
            const acts = computeAvailableActions(gs, gs.activePlayerIndex as number);
            const choices = pilot.concretePlayoutActions(acts);
            const action =
              choices.length > 0 && rnd() < 0.8
                ? choices[Math.floor(rnd() * choices.length)]
                : null;
            if (action == null) base.send({ type: 'END_PHASE' });
            else base.send({ type: 'PLAYER_ACTION', action });
          } catch {
            try {
              base.send({ type: 'END_PHASE' });
            } catch {
              break;
            }
          }
        }
        base.stop?.();
      }
    }

    expect(pairedPlayouts).toBeGreaterThanOrEqual(200);
    expect(mismatches).toEqual([]);
  }, 120000);

  it('illegal-action no-op parity: both backends silently no-op an unknown-instance deploy identically', async () => {
    const dist = (await import(distPath)) as unknown as {
      createGame: (
        a: Record<string, unknown>,
        b: Record<string, unknown>,
        c: MinimalRegistry,
        seed?: number,
      ) => Record<string, unknown>;
      gameMachine: unknown;
    };
    const pilot = (await import(pilotPath)) as unknown as {
      playout: (
        fork: ForkLike,
        policy: string,
        turnCap: number,
        rnd: () => number,
        stepCap: number,
        horizonTurn: number,
      ) => { winner?: unknown };
      makeSnapshotFork: (machine: unknown, snapshot: AnySnap) => ForkLike;
      hydratePersistedSnapshot: (machine: unknown, persisted: unknown) => AnySnap;
    };
    const { createGame, gameMachine } = dist;

    const gs0 = createGame(deckFor(100), deckFor(101), pairingRegistry('Onyx', 'Radiant'), 7);
    const base = createActor(
      gameMachine as never,
      { input: { gameState: gs0 } } as never,
    ) as unknown as ForkLike & {
      start: () => void;
      getPersistedSnapshot: () => unknown;
    };
    base.start();
    // Resolve the opening mulligan choices so we sit at a real decision point.
    for (let i = 0; i < 6; i++) {
      const snap = base.getSnapshot();
      const pc =
        (snap.context.gameState as { pendingChoice?: { type?: string; playerId?: number } })
          .pendingChoice ??
        (snap.context.pendingChoice as { type?: string; playerId?: number } | null);
      if (pc == null) break;
      if (pc.type === 'mulligan')
        base.send({ type: 'MULLIGAN_DECISION', playerId: pc.playerId, keep: true });
      else break;
    }
    const persisted = base.getPersistedSnapshot();

    const ILLEGAL = {
      type: 'deploy',
      cardInstanceId: 'no-such-instance',
      zone: 'frontline',
      slotIndex: 0,
    };

    // Reproduce oneRollout's exact send-catch structure on both backends, and
    // additionally pin that the illegal send is a true no-op (GameState
    // unchanged), not merely "didn't throw". `threw` is retained and
    // asserted false on both backends — see the file-header investigation
    // note: xstate v5's Actor.send() never throws synchronously for an
    // internal transition error (it defers via setTimeout by design), so
    // `oneRollout`'s catch-as-pass branch cannot be proven reachable this
    // way for the actor backend; the no-op-parity assertions below are the
    // provable contract this fixture actually pins.
    const outcomes: Array<{
      threw: boolean;
      gsUnchanged: boolean;
      snapJson: string;
      finJson: string;
    }> = [];
    for (const backend of ['actor', 'snapshot'] as const) {
      let fork: ForkLike;
      if (backend === 'actor') {
        fork = createActor(
          gameMachine as never,
          { snapshot: persisted } as never,
        ) as unknown as ForkLike;
        (fork as unknown as { start: () => void }).start();
      } else {
        fork = pilot.makeSnapshotFork(
          gameMachine,
          pilot.hydratePersistedSnapshot(gameMachine, persisted),
        );
      }
      const gsBefore = JSON.stringify(fork.getSnapshot().context.gameState);
      let threw = false;
      try {
        fork.send({ type: 'PLAYER_ACTION', action: ILLEGAL });
      } catch {
        threw = true; // production comment: "illegal in this fork: treat as a pass-equivalent rollout"
      }
      const gsAfter = JSON.stringify(fork.getSnapshot().context.gameState);
      const snapJson = JSON.stringify({
        value: fork.getSnapshot().value,
        gs: fork.getSnapshot().context.gameState,
        pc: fork.getSnapshot().context.pendingChoice ?? null,
      });
      const fin = pilot.playout(fork, 'random', 20, rngf(4242), 200, Infinity);
      outcomes.push({
        threw,
        gsUnchanged: gsBefore === gsAfter,
        snapJson,
        finJson: JSON.stringify(fin),
      });
      fork.stop?.();
    }

    // Both backends: the illegal send neither throws nor mutates GameState.
    expect(outcomes[0]?.threw).toBe(false);
    expect(outcomes[1]?.threw).toBe(false);
    expect(outcomes[0]?.gsUnchanged).toBe(true);
    expect(outcomes[1]?.gsUnchanged).toBe(true);
    expect(outcomes[1]?.threw).toBe(outcomes[0]?.threw);
    expect(outcomes[1]?.snapJson).toBe(outcomes[0]?.snapJson);
    expect(outcomes[1]?.finJson).toBe(outcomes[0]?.finJson);
  }, 30000);
});
