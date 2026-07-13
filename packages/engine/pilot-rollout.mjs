// pilot-rollout.mjs — an OUTCOME-DRIVEN pilot with NO archetype prior.
//
// METHODOLOGY-VALIDATION TOOL (read-only analysis). This is the "fair pilot" that
// the pilot-robustness test runs against the canonical balance. Its purpose: decide
// whether Radiant's dominance under the single target-aware heuristic is real
// faction strength or an artifact of one board-value heuristic that happens to play
// Radiant's gameplan well.
//
// WHY IT IS ARCHETYPE-NEUTRAL
// ---------------------------
// It encodes ZERO hand-coded board score. At each of the active player's decision
// points it (1) enumerates the *legal* candidate actions for the current phase,
// (2) forks the live XState actor (via getPersistedSnapshot), applies each
// candidate, then plays BOTH seats out to game end (or turnCap) with a fast
// playout policy, R times, and (3) picks the action with the best *game outcome*
// (win-rate first, enemy-LP-removed as a tiebreaker) — never a board heuristic. The
// competence comes from the one-ply search over real outcomes, not from any prior
// about deploying bodies / holding board / grinding combat (which IS Radiant's
// plan). Whatever wins more games in actual playouts is chosen, faction-agnostic.
//
// DEFAULT PLAYOUT POLICY = uniform-random legal actions (the same concrete-action
// enumeration the `random` botPolicy uses). This is the classic MCTS default
// policy and carries no faction bias. (A `heuristic` playout is also selectable for
// the cross-check pilot, but the PRIMARY pilot uses random playouts so no archetype
// prior leaks in through the rollout.)
//
// DETERMINISM: every rollout's randomness comes from a seeded mulberry32 stream
// derived purely from (game seed, decision index, candidate index, rollout index).
// No Math.random, no wall clock. Same config + seed => identical runHash.
//
// The engine is NOT modified: this driver lives at the package root (like the other
// analysis .mjs), reuses the built dist's exported helpers, and forks the actor the
// runner already owns. The default `heuristic` botPolicy path is untouched.

import { createActor, transition } from 'xstate';
import {
  gameMachine,
  computeAvailableActions,
  computeReactiveActions,
  chooseAction as heuristicChooseAction,
  chooseReactiveAction,
  chooseChoiceResponse,
  shouldKeepHand,
  enumerateConcretePlayerActions,
} from './dist/index.js';

// mulberry32 — identical generator to the runner's, seeded per decision branch.
function rngf(a) {
  let s = a >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Candidate enumeration (the legal action set the pilot searches over) ──────
// We reuse the engine's available-actions, picking concrete targets that are
// LEGAL and SENSIBLE (attack the offered targets incl. hero; deploy to frontline;
// attach to a valid target). This is *not* a value judgement — it just turns each
// AvailableActions option into a sendable PlayerAction. Crucially we ALSO include
// the "stop" candidate (END_PHASE / pass), so holding back is itself searched and
// chosen when acting is worse by outcome.
//
// candidateGen (T2) SCOPING: this function is the 'legacy' candidate source and
// stays UNTOUCHED — every historical runHash depends on its exact output. The
// 'full' candidateGen option instead sources candidates from the engine's
// canonical `enumerateConcretePlayerActions(gs, 'full')` (see chooseAction below),
// which enumerates EVERY legal (cardInstanceId, zone/target) pair per kind instead
// of only the first. This ONLY changes CANDIDATE enumeration (what gets scored at
// a decision point) — the separate `concreteActions` enumerator below, used
// INSIDE random playouts, is intentionally left alone in both modes so changing
// both at once can't confound the planned A/B between the two enumerators.
function candidateActions(acts) {
  const out = [];
  for (const d of acts.canDeploy || []) {
    const slots = d.validSlots || [];
    const fl = slots.find(x => x.zone === 'frontline' && x.slots.length) || slots.find(x => x.slots.length);
    if (fl) out.push({ type: 'deploy', cardInstanceId: d.cardInstanceId, zone: fl.zone, slotIndex: fl.slots[0] });
  }
  for (const c of acts.canCastSpell || []) out.push({ type: 'cast_spell', cardInstanceId: c.cardInstanceId });
  for (const a of acts.canActivateAbility || []) out.push({ type: 'activate_ability', cardInstanceId: a.cardInstanceId, abilityIndex: a.abilityIndex });
  for (const e of acts.canAttachEquipment || []) { const t = (e.validTargets || [])[0]; if (t) out.push({ type: 'attach_equipment', cardInstanceId: e.cardInstanceId, targetInstanceId: t }); }
  for (const m of acts.canMove || []) { const dst = (m.validDestinations || [])[0]; if (dst) out.push({ type: 'move', cardInstanceId: m.cardInstanceId, toZone: dst }); }
  for (const id of acts.canTapReserve || []) out.push({ type: 'tap_reserve', cardInstanceId: id });
  if (acts.canTransform) out.push({ type: 'declare_transform' });
  // Attacks: one candidate per (attacker, target) so the search can choose face vs
  // trade vs hold per body — no pre-baked combat heuristic decides for it.
  for (const a of acts.canAttack || []) {
    const targets = a.validTargets || [];
    for (const tg of targets) {
      const targetId = tg === 'hero' || tg.type === 'hero' ? 'hero' : (tg.instanceId || tg.id);
      if (targetId) out.push({ type: 'declare_attack', attackerInstanceId: a.attackerInstanceId, targetId });
    }
  }
  return out;
}

// ── Playout policies (the default policy used INSIDE a rollout) ───────────────
// "random": uniform over legal concrete actions (no archetype prior — primary).
// "heuristic": the engine's target-aware bot (used only for the cross-check pilot).
const RANDOM_ACTION_PROB = 0.85;
// Under fair pilot, the probability a random playout actually fires a worthwhile
// counter (one the fair reactive bot would pick) — so counters matter inside playouts.
const FAIR_COUNTER_PROB = 0.9;

// Exported under an explicit alias for the T7 differential harness (which
// drives base games with the exact playout-internal action surface).
export { concreteActions as concretePlayoutActions };
function concreteActions(acts) {
  const out = [];
  for (const d of acts.canDeploy || []) { const s = (d.validSlots || []).find(x => x.zone === 'frontline') || (d.validSlots || [])[0]; if (s && s.slots && s.slots.length) out.push({ type: 'deploy', cardInstanceId: d.cardInstanceId, zone: s.zone, slotIndex: s.slots[0] }); }
  for (const a of acts.canAttack || []) { const t = (a.validTargets || []); const tg = t.length ? t[0] : 'hero'; out.push({ type: 'declare_attack', attackerInstanceId: a.attackerInstanceId, targetId: typeof tg === 'string' ? tg : (tg.type === 'hero' ? 'hero' : (tg.instanceId || tg.id || 'hero')) }); }
  for (const c of acts.canCastSpell || []) out.push({ type: 'cast_spell', cardInstanceId: c.cardInstanceId });
  for (const a of acts.canActivateAbility || []) out.push({ type: 'activate_ability', cardInstanceId: a.cardInstanceId, abilityIndex: a.abilityIndex });
  for (const e of acts.canAttachEquipment || []) { const t = (e.validTargets || [])[0]; if (t) out.push({ type: 'attach_equipment', cardInstanceId: e.cardInstanceId, targetInstanceId: t }); }
  for (const m of acts.canMove || []) { const d = (m.validDestinations || [])[0]; if (d) out.push({ type: 'move', cardInstanceId: m.cardInstanceId, toZone: d }); }
  for (const id of acts.canTapReserve || []) out.push({ type: 'tap_reserve', cardInstanceId: id });
  if (acts.canTransform) out.push({ type: 'declare_transform' });
  return out;
}

// ── Playout stepping backends (T7) ───────────────────────────────────────────
// `playout()` only needs `send(event)` + `getSnapshot()`, so the stepping
// machinery is swappable. 'actor' (default) forks a live XState actor per
// playout — the historical path, byte-untouched. 'snapshot' steps purely via
// xstate's `transition()` from ONE hydrated snapshot per decision (shared,
// never cloned — `transition()` does not mutate its input; spike-verified over
// 1204 paired playouts). A harness dimension like WORKERS: hash-exempt, both
// backends must produce identical runHashes (pinned in rollout-pin.test.ts).

// `transition()` rejects getPersistedSnapshot() output — hydrate it into a live
// snapshot first (createActor WITHOUT .start(): restoring does not re-run entry
// actions, so this allocates one actor per DECISION instead of one per playout).
export function hydratePersistedSnapshot(machine, persisted) {
  return createActor(machine, { snapshot: persisted }).getSnapshot();
}

// A pure drop-in for the actor fork: same send/getSnapshot/stop surface.
// Exceptions from `transition()` (e.g. an illegal action's assign throwing)
// propagate synchronously exactly like actor `.send()` — the differential
// harness pins this parity with an illegal-action fixture.
export function makeSnapshotFork(machine, startSnapshot) {
  let snap = startSnapshot;
  return {
    send(event) {
      [snap] = transition(machine, snap, event);
    },
    getSnapshot: () => snap,
    stop() {},
  };
}

// Drive a forked actor forward with the chosen playout policy until a terminal
// (winner set / machine done / turnCap) OR a turn-depth horizon is reached. Returns
// the final GameState. `rnd` is the seeded RNG. `horizonTurn` (absolute turn number)
// caps how far we simulate; beyond it we stop and the leaf is scored by LP-diff —
// still archetype-neutral. horizonTurn === Infinity means roll to game end.
export function playout(fork, playoutPolicy, turnCap, rnd, stepCap, horizonTurn, fixHandSizeStall = false, fairPilot = false) {
  let steps = 0;
  let gs;
  while (steps++ < stepCap) {
    const snap = fork.getSnapshot();
    if (snap.status === 'done') break;
    gs = snap.context.gameState;
    if (gs.winner != null) break;
    if (gs.turnNumber > turnCap) break;
    if (gs.turnNumber > horizonTurn) break;

    if (gs.pendingPriority != null) {
      // Responder policy in playouts: heuristic uses its reactive bot; random
      // mostly passes (reactive cards are scarce) but occasionally fires one.
      try {
        let react = null;
        if (playoutPolicy === 'heuristic') {
          react = heuristicReactive(gs);
        } else {
          const ropts = computeReactiveActions(gs, gs.pendingPriority.toRespondPlayerId);
          if (ropts.length) {
            if (fairPilot) {
              // Threat-aware: fire the counter the fair reactive bot would pick (it
              // reads gs.config.fairPilot), so control's counters matter in playouts.
              const wants = chooseReactiveAction(gs);
              if (wants) {
                if (rnd() < FAIR_COUNTER_PROB) react = wants;
              } else if (rnd() < RANDOM_ACTION_PROB * 0.2) {
                react = { type: 'cast_spell', cardInstanceId: ropts[0].cardInstanceId };
              }
            } else if (rnd() < RANDOM_ACTION_PROB) {
              react = { type: 'cast_spell', cardInstanceId: ropts[0].cardInstanceId };
            }
          }
        }
        if (react == null) fork.send({ type: 'PRIORITY_PASS' });
        else fork.send({ type: 'REACTIVE_ACTION', action: react });
      } catch { try { fork.send({ type: 'PRIORITY_PASS' }); } catch { break; } }
      continue;
    }

    // STALL-FIX (gated, default OFF ⇒ byte-identical: the rollout pilot's hashes and
    // the pilot-robustness locked-base anchors reproduce unchanged): the end-of-turn
    // hand-size discard choice is set by the engine on context.pendingChoice but NOT
    // mirrored to gameState.pendingChoice, so reading only gs.pendingChoice misses it
    // and the fork spins on END_PHASE to stepCap — producing a livelocked, garbage
    // leaf that corrupts the rollout's outcome score. Resolve it from
    // context.pendingChoice ONLY when the run opts in via fixHandSizeStall.
    if (fixHandSizeStall && gs.pendingChoice == null && snap.context.pendingChoice != null) {
      const cpc = snap.context.pendingChoice;
      try {
        const ids = playoutPolicy === 'heuristic'
          ? chooseChoiceResponse({ ...gs, pendingChoice: cpc })
          : (cpc.options || []).map(o => o.instanceId ?? o.id).slice(0, Math.max(cpc.minSelections || 0, 0));
        if (cpc.type === 'mulligan') fork.send({ type: 'MULLIGAN_DECISION', playerId: cpc.playerId, keep: true });
        else fork.send({ type: 'PLAYER_RESPONSE', response: { selectedOptionIds: ids } });
      } catch { try { fork.send({ type: 'END_PHASE' }); } catch { break; } }
      continue;
    }

    const pc = gs.pendingChoice;
    try {
      if (pc) {
        if (pc.type === 'mulligan') {
          const keep = playoutPolicy === 'heuristic' ? shouldKeepHand(gs, pc.playerId) : true;
          fork.send({ type: 'MULLIGAN_DECISION', playerId: pc.playerId, keep });
        } else {
          const ids = playoutPolicy === 'heuristic'
            ? chooseChoiceResponse(gs)
            : (pc.options || []).map(o => o.instanceId ?? o.id).slice(0, Math.max(pc.minSelections || 0, 0));
          fork.send({ type: 'PLAYER_RESPONSE', response: { selectedOptionIds: ids } });
        }
        continue;
      }
      let action;
      if (playoutPolicy === 'heuristic') {
        action = heuristicChooseAction(gs);
      } else {
        const choices = concreteActions(computeAvailableActions(gs, gs.activePlayerIndex));
        action = choices.length && rnd() < RANDOM_ACTION_PROB ? choices[Math.floor(rnd() * choices.length)] : null;
      }
      if (action == null) fork.send({ type: 'END_PHASE' });
      else fork.send({ type: 'PLAYER_ACTION', action });
    } catch { try { fork.send({ type: 'END_PHASE' }); } catch { break; } }
  }
  return fork.getSnapshot().context.gameState;
}

function heuristicReactive(gs) {
  // Use the engine's real reactive bot: it returns a sendable PlayerAction (a
  // properly-targeted counter) when holding a worthwhile counter in the window,
  // else null (pass). This keeps the heuristic playout faithful to the heuristic
  // bot while staying deterministic (chooseReactiveAction is pure over gs).
  return chooseReactiveAction(gs);
}

// Outcome of a finished/timed-out rollout from `meSeat`'s perspective.
// Primary signal: win (+1) / loss (-1) / draw (0). Tiebreaker among same-result
// rollouts: normalized LP differential (enemy LP removed minus own LP lost),
// scaled small so it never overrides a decided result. NO board-value term.
function outcomeScore(fin, meSeat, turnCap, closingReward = false) {
  const oppSeat = meSeat === 0 ? 1 : 0;
  const meLp = fin.players[meSeat].hero.currentLp;
  const oppLp = fin.players[oppSeat].hero.currentLp;
  const meMax = fin.players[meSeat].hero.maxLp || 1;
  const oppMax = fin.players[oppSeat].hero.maxLp || 1;
  const diff = (1 - oppLp / oppMax) - (1 - meLp / meMax); // damage dealt - damage taken
  if (closingReward) {
    // Closing-rewarding objective: a DECIDED result dominates, and winning SOONER
    // scores higher (so the pilot presses to END the game); a timeout is mildly
    // negative — sitting on an LP lead at the cap is NOT rewarded like a win, so
    // stalling is never preferred to a real win. A small LP-diff term only breaks
    // genuinely unwinnable spots. This removes the durdle incentive of the legacy
    // objective (where a timeout-with-LP-lead scored ~+0.5, almost a win).
    const turns = fin.turnNumber ?? turnCap;
    const speed = Math.max(0, Math.min(1, (turnCap - turns) / turnCap)); // 1 = fast, 0 = at cap
    if (fin.winner === meSeat) return 1 + 0.4 * speed;
    if (fin.winner === oppSeat) return -1 - 0.4 * speed;
    return -0.1 + 0.15 * Math.max(-1, Math.min(1, diff)); // timeout/draw: mildly bad
  }
  // Legacy objective: win (+1) / loss (-1) / draw (0) + LP-diff tiebreaker [-0.5, 0.5]
  // so a decided result dominates an undecided LP edge. (Rewards stalling-with-LP.)
  let base;
  if (fin.winner === meSeat) base = 1;
  else if (fin.winner === oppSeat) base = -1;
  else base = 0; // draw / timeout
  return base + 0.5 * Math.max(-1, Math.min(1, diff));
}

// ── The pilot: choose one action by rollout outcome, or null to END_PHASE ─────
// `actor` is the LIVE runner actor at a decision point; `gs` its current state.
// Returns a PlayerAction or null (END_PHASE). Pure w.r.t. the live actor: it only
// reads its persisted snapshot and forks copies.
export function makeRolloutPilot(opts = {}) {
  const rollouts = opts.rollouts ?? 16;      // playouts per candidate
  const playoutPolicy = opts.playoutPolicy ?? 'random';
  const stepCap = opts.stepCap ?? 8000;
  const maxCandidates = opts.maxCandidates ?? 12; // cap branching for feasibility
  // candidateGen (T2): 'legacy' (default) runs the untouched candidateActions()
  // path below — byte-identical to every historical run. 'full' sources
  // candidates from the engine's canonical enumerateConcretePlayerActions(gs,
  // 'full') instead, then flows through the SAME downstream pipeline (ordering,
  // per-kind caps, maxCandidates, scoring). Candidate enumeration only — playout-
  // internal enumeration (concreteActions) is unaffected in both modes.
  const candidateGen = opts.candidateGen ?? 'legacy';
  // candidateKindCaps (T2): explicit per-kind candidate-survivor cap, keyed by
  // PlayerAction['type']. Defaults to DEFAULT_CANDIDATE_KIND_CAPS (every kind
  // capped at 4 — the prior hardcoded `perKindCap` value), so an unset run is
  // byte-identical to the v10 baseline.
  const candidateKindCaps = opts.candidateKindCaps ?? DEFAULT_CANDIDATE_KIND_CAPS;
  // seedMode (T3): 'index' (default) derives each branch's playout stream from
  // the candidate's POSITION — mix(gameSeed, di, ci, r), byte-identical to every
  // historical run. 'actionKey' derives it from WHAT the action is (FNV-1a of
  // its stable keyOf string; the END_PHASE option uses 'end_phase'), so a
  // coverage A/B (candidateGen legacy vs full) keeps identical streams for the
  // candidates both modes share — position shifts no longer reseed everything.
  const seedMode = opts.seedMode ?? 'index';
  // T7 — playout stepping backend. 'actor' = historical per-playout actor fork
  // (default, byte-identical); 'snapshot' = pure transition() stepping from one
  // hydrated snapshot per decision. Hash-exempt harness dimension (see
  // sim-runner.mjs computeRunHash): equal hashes across backends ARE the
  // equivalence claim.
  const playoutBackend = opts.playoutBackend ?? 'actor';
  const search = opts.search ?? 'flat';      // 'flat' | 'ucb' budget allocation
  const fairPilot = opts.fairPilot ?? false; // control/value-aware fairness (depth=0 + threat-aware counters)
  // Turn-depth horizon: simulate at most this many of the deciding player's future
  // turns before scoring the leaf by LP-diff. 0 / undefined => roll to game end. Under
  // fair pilot DEFAULT to 0 (truest win/loss signal — control's late game isn't penalized).
  const depth = opts.depth ?? (fairPilot ? 0 : 3);
  const closingReward = opts.closingReward ?? true; // reward decided+fast wins, penalize stalls
  const fixHandSizeStall = opts.fixHandSizeStall ?? false; // gated end-phase discard fix in playouts

  // A per-decision counter folded into the rollout seed for determinism. Reset by
  // the runner at game start via reset().
  let decisionIndex = 0;
  // Pruning telemetry (hash-exempt; see sim-runner.mjs computeRunHash, which never
  // reads result/summary fields like this one). Accumulated across every decision
  // in this pilot's game: raw = pre-cap enumerated candidates, retained = post
  // per-kind-cap + maxCandidates survivors, prunedByKind = per-kind drop counts.
  const diag = { raw: 0, retained: 0, prunedByKind: {} };

  function reset() { decisionIndex = 0; diag.raw = 0; diag.retained = 0; diag.prunedByKind = {}; }

  function chooseAction(actor, gs, gameSeed, turnCap) {
    const di = decisionIndex++;
    const acts = computeAvailableActions(gs, gs.activePlayerIndex);
    const cands = candidateGen === 'full'
      ? enumerateConcretePlayerActions(gs, 'full')
      : candidateActions(acts);
    if (cands.length === 0) return null; // nothing to do but end the phase
    // Deterministic candidate order (stable across runs); cap branching factor.
    // Per-kind cap keeps any single action kind (e.g. many deploys) from crowding
    // out the rest before the global maxCandidates slice — purely a branching
    // budget, not a value ranking; every kept candidate is still scored by outcome.
    const orderedAll = orderCandidates(cands);
    const cappedByKind = capPerKind(orderedAll, candidateKindCaps);
    let limited = cappedByKind.slice(0, maxCandidates);
    recordPruning(diag, orderedAll, limited);
    // ALWAYS-INCLUDE the high_ground reach move (mirrors src/bot/heuristic.ts
    // chooseMove ~:366): promoting a ready, non-summoning-sick attacker from the
    // frontline to High Ground is the only way to threaten the enemy Hero, so it
    // must never be dropped by the branching cap or it can never be searched.
    for (const reach of reachMoves(acts, gs, gs.activePlayerIndex)) {
      if (!limited.some(a => sameCandidate(a, reach))) limited = [...limited, reach];
    }
    // The "stop" candidate (END_PHASE) is always evaluated: holding is a real option.
    const options = [...limited.map(a => ({ action: a })), { action: null }];
    // seedMode 'actionKey' (T3): precompute each option's seed slot from its
    // stable identity. null (index mode) keeps the historical `ci` argument.
    const seedSlots = seedMode === 'actionKey'
      ? options.map(o => hashActionKey(o.action ? seedKeyOf(o.action) : 'end_phase'))
      : null;

    const persisted = actor.getPersistedSnapshot();
    // 'snapshot' backend: hydrate ONCE per decision; every playout's pure fork
    // starts from this same live snapshot (transition() never mutates it).
    const hydrated = playoutBackend === 'snapshot' ? hydratePersistedSnapshot(gameMachine, persisted) : null;
    const meSeat = gs.activePlayerIndex;
    const horizonTurn = depth > 0 ? gs.turnNumber + depth : Infinity;

    // One rollout of candidate `ci` with the deterministic per-branch seed.
    const oneRollout = (ci, r) => {
      const cand = options[ci].action;
      const rnd = rngf(mix(gameSeed, di, seedSlots ? seedSlots[ci] : ci, r));
      let fork;
      if (hydrated != null) {
        fork = makeSnapshotFork(gameMachine, hydrated);
      } else {
        fork = createActor(gameMachine, { snapshot: persisted });
        fork.start();
      }
      try {
        if (cand != null) fork.send({ type: 'PLAYER_ACTION', action: cand });
        else fork.send({ type: 'END_PHASE' });
      } catch {
        // illegal in this fork: treat as a pass-equivalent rollout.
        // Investigated (playout-backend-differential.test.ts): the makeSnapshotFork
        // (transition()) path DOES throw synchronously here on a malformed action, but
        // xstate v5's Actor.send() never does — internal transition errors are swallowed
        // into `snapshot.status: 'error'` and reported asynchronously via setTimeout, by
        // the library's own design, so this catch was not proven reachable for the actor
        // backend with any input tried. Left in place for the transition() path (proven
        // reachable there) and for any pre-transition send failure.
      }
      const fin = playout(fork, playoutPolicy, turnCap, rnd, stepCap, horizonTurn, fixHandSizeStall, fairPilot);
      const score = outcomeScore(fin, meSeat, turnCap, closingReward);
      fork.stop();
      return score;
    };

    const stats = search === 'ucb'
      ? evalUcb(options.length, rollouts, oneRollout)
      : evalFlat(options.length, rollouts, oneRollout);

    let best = null;
    for (let ci = 0; ci < options.length; ci++) {
      const s = stats[ci];
      const mean = s.n > 0 ? s.sum / s.n : -Infinity;
      // Deterministic tie-break: higher mean, then earlier candidate index (which
      // is stable), so the "stop" option (last) only wins on a strict tie-break
      // when it is at least as good — biasing toward action, not idleness.
      if (best == null || mean > best.mean + 1e-12) best = { action: options[ci].action, mean, ci };
    }
    return best ? best.action : null;
  }

  return { chooseAction, reset, diag, meta: { rollouts, playoutPolicy, maxCandidates, candidateGen, candidateKindCaps, seedMode, playoutBackend, depth, closingReward, search, fixHandSizeStall, fairPilot } };
}

// ── Budget allocators (flat default; UCB1 optional behind opts.search==="ucb") ─
// Both spend exactly options.length * rollouts playouts and return per-candidate
// { sum, n }. FLAT is byte-identical to the legacy ci-outer / r-inner loop: each
// candidate gets `rollouts` pulls seeded mix(...,ci,r) for r=0..rollouts-1.
function evalFlat(nOptions, rollouts, oneRollout) {
  const stats = Array.from({ length: nOptions }, () => ({ sum: 0, n: 0 }));
  for (let ci = 0; ci < nOptions; ci++) {
    for (let r = 0; r < rollouts; r++) {
      stats[ci].sum += oneRollout(ci, r);
      stats[ci].n += 1;
    }
  }
  return stats;
}

// UCB1 over the SAME total budget. Seeding stays deterministic: candidate ci's
// k-th pull always uses local count r=k (seed mix(...,ci,k)), so the seeded mix()
// stream per candidate is independent of allocation order. After one pull each,
// remaining pulls go to argmax(mean + C*sqrt(ln T / n)); ties break to lower ci.
const UCB_C = Math.SQRT2;
function evalUcb(nOptions, rollouts, oneRollout) {
  const stats = Array.from({ length: nOptions }, () => ({ sum: 0, n: 0 }));
  const total = nOptions * rollouts;
  let t = 0;
  for (let ci = 0; ci < nOptions && t < total; ci++) {
    stats[ci].sum += oneRollout(ci, stats[ci].n); stats[ci].n += 1; t += 1;
  }
  for (; t < total; t++) {
    let pick = 0, bestUcb = -Infinity;
    for (let ci = 0; ci < nOptions; ci++) {
      const s = stats[ci];
      const ucb = s.n === 0 ? Infinity : s.sum / s.n + UCB_C * Math.sqrt(Math.log(t) / s.n);
      if (ucb > bestUcb + 1e-12) { bestUcb = ucb; pick = ci; }
    }
    stats[pick].sum += oneRollout(pick, stats[pick].n); stats[pick].n += 1;
  }
  return stats;
}

// T2 — the per-kind survivor cap `capPerKind` applied uniformly (4 per kind) via
// makeRolloutPilot's default `perKindCap`. Lifted into an explicit, overridable
// map (`candidateKindCaps` on makeRolloutPilot) so callers can shape branching
// per kind; unset ⇒ every kind capped at 4, byte-identical to the prior default.
export const DEFAULT_CANDIDATE_KIND_CAPS = {
  declare_attack: 4,
  cast_spell: 4,
  deploy: 4,
  move: 4,
  activate_ability: 4,
  attach_equipment: 4,
  declare_transform: 4,
  tap_reserve: 4,
  discard_for_energy: 4,
};

// Cap how many candidates of each action kind survive into the search (applied
// AFTER orderCandidates, so the kept ones are the stable-ordered first `cap`).
// `kindCaps` is an object keyed by action kind; a kind absent from it falls back
// to DEFAULT_CANDIDATE_KIND_CAPS' value for that kind (or 4 if wholly unknown).
function capPerKind(ordered, kindCaps) {
  const seen = {};
  const out = [];
  for (const c of ordered) {
    const k = c.type;
    seen[k] = (seen[k] ?? 0) + 1;
    const cap = kindCaps[k] ?? DEFAULT_CANDIDATE_KIND_CAPS[k] ?? 4;
    if (seen[k] <= cap) out.push(c);
  }
  return out;
}

// Pruning telemetry bookkeeping (Deliverable 3) — folds one decision's raw
// (pre-cap, ordered) candidate list and its post-cap survivors into the running
// `diag` accumulator, in place. Purely additive reporting; never read by
// computeRunHash or the search itself.
function recordPruning(diag, orderedAll, limited) {
  diag.raw += orderedAll.length;
  diag.retained += limited.length;
  const rawByKind = {};
  for (const c of orderedAll) rawByKind[c.type] = (rawByKind[c.type] ?? 0) + 1;
  const retainedByKind = {};
  for (const c of limited) retainedByKind[c.type] = (retainedByKind[c.type] ?? 0) + 1;
  for (const k of Object.keys(rawByKind)) {
    const pruned = rawByKind[k] - (retainedByKind[k] ?? 0);
    if (pruned > 0) diag.prunedByKind[k] = (diag.prunedByKind[k] ?? 0) + pruned;
  }
}

// High_ground reach moves, mirroring src/bot/heuristic.ts chooseMove: a ready,
// non-summoning-sick attacker (cardType 'C', currentAtk > 0) on the frontline
// that may move to high_ground. Returns sendable move candidates (may be empty).
function reachMoves(acts, gs, meSeat) {
  const cards = ownBodies(gs, meSeat);
  const out = [];
  for (const m of acts.canMove || []) {
    if (m.fromZone !== 'frontline') continue;
    if (!(m.validDestinations || []).includes('high_ground')) continue;
    const card = cards.get(m.cardInstanceId);
    if (!card || card.cardType !== 'C' || (card.currentAtk ?? 0) <= 0 || card.summoningSick) continue;
    out.push({ type: 'move', cardInstanceId: m.cardInstanceId, toZone: 'high_ground' });
  }
  return out;
}

// Flatten the active player's in-play bodies into an instanceId -> card map.
function ownBodies(gs, meSeat) {
  const z = gs.players?.[meSeat]?.zones ?? {};
  const map = new Map();
  for (const slots of Object.values(z)) {
    for (const c of slots || []) { if (c) map.set(c.instanceId, c); }
  }
  return map;
}

function sameCandidate(a, b) {
  return a.type === b.type && keyOf(a) === keyOf(b);
}

// Stable candidate ordering: attacks first (most outcome-relevant), then deploys,
// spells, abilities, equip, move, transform; ties broken by a stable string key.
// This is ORDER only (for the branching cap + determinism), not a value ranking —
// every kept candidate is still evaluated purely by rollout outcome.
const KIND_ORDER = { declare_attack: 0, cast_spell: 1, deploy: 2, move: 3, activate_ability: 4, attach_equipment: 5, declare_transform: 6 };
function orderCandidates(cands) {
  return [...cands].sort((a, b) => {
    const ka = KIND_ORDER[a.type] ?? 9, kb = KIND_ORDER[b.type] ?? 9;
    if (ka !== kb) return ka - kb;
    return keyOf(a).localeCompare(keyOf(b));
  });
}
function keyOf(a) {
  switch (a.type) {
    case 'declare_attack': return `${a.attackerInstanceId}>${a.targetId}`;
    case 'deploy': return `${a.cardInstanceId}@${a.zone}:${a.slotIndex}`;
    case 'attach_equipment': return `${a.cardInstanceId}->${a.targetInstanceId}`;
    case 'activate_ability': return `${a.cardInstanceId}#${a.abilityIndex}`;
    case 'move': return `${a.cardInstanceId}->${a.toZone}`;
    case 'cast_spell': return a.cardInstanceId;
    default: return a.type;
  }
}

// seedKeyOf (T4) — used ONLY for the 'actionKey' seed-slot computation, never
// for orderCandidates/sameCandidate. keyOf's `default: return a.type` collapses
// EVERY candidate of a kind it doesn't special-case (tap_reserve,
// discard_for_energy) onto one bare string, so under candidateGen:'full' +
// seedMode:'actionKey' distinct tap_reserve/discard_for_energy candidates share
// one seed stream. seedKeyOf fixes that by keying on cardInstanceId for those
// two kinds, and is identical to keyOf for every kind keyOf already
// distinguishes. Do NOT fold this into keyOf itself: keyOf also drives
// orderCandidates' tie-break sort, and extending it would re-sort legacy
// same-kind candidates and break the pinned legacy hash (rollout-pin.test.ts
// PINNED_HASH). Nothing pins actionKey-mode hashes yet (the full-mode test
// only asserts inequality), so this change is safe to make now.
export function seedKeyOf(a) {
  switch (a.type) {
    case 'tap_reserve': return `tap:${a.cardInstanceId}`;
    case 'discard_for_energy': return `dfe:${a.cardInstanceId}`;
    default: return keyOf(a);
  }
}

// FNV-1a 32-bit over an action's stable key string — the 'actionKey' seed slot
// (T3). Exported for the position-independence tests in rollout-pin.test.ts.
export function hashActionKey(key) {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// The branch-seed derivation, exported for tests: 'index' mode passes the
// candidate index as `slot`, 'actionKey' mode passes hashActionKey(keyOf(a)).
export function rolloutBranchSeed(gameSeed, di, slot, r) {
  return mix(gameSeed, di, slot, r);
}

// Deterministic seed mix for a rollout branch (no Math.random).
function mix(gameSeed, di, ci, r) {
  let h = (gameSeed ^ 0x85ebca6b) >>> 0;
  h = (Math.imul(h ^ di, 0xc2b2ae35) + 0x9e3779b9) >>> 0;
  h = (Math.imul(h ^ ci, 0x27d4eb2f) + 0x165667b1) >>> 0;
  h = (Math.imul(h ^ r, 0x85ebca6b) + 0xd3a2646c) >>> 0;
  return h >>> 0;
}
