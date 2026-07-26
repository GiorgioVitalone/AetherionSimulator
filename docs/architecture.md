# Simulation Engine Architecture

This document describes the current engine implemented in
`packages/engine`. It is maintained against the canonical
[`current` rules manifest](../packages/engine/sim-data/ruleset-current.json).

Status: **diagnostic candidate** (`4.0.0-diagnostic.1`). “Current” identifies
the only correctness profile; it does not mean externally ratified. Historical
profiles are replay-only and are described in
[Legacy simulation compatibility](legacy-simulation-compatibility.md).

## Authority and dependency direction

The engine has one authoritative mutation boundary:
`transition(state, command) -> TransitionResult`. Callers may enumerate,
display, simulate, or choose commands, but they do not bypass validation or
mutate game state.

```text
card definitions + rules manifest
              |
              v
types -> selectors -> validation -> transition
                                 |       |
                                 |       +-> declaration / choice continuation
                                 |       +-> stack / effects / combat
                                 |       +-> event dispatch / APNAP
                                 |       +-> state-based stabilization / auras
                                 v
                    immutable state + event envelope
                                 |
                  +--------------+--------------+
                  v                             v
             UI adapter                    simulator / bots
```

Core modules never import simulator or policy implementations. Policy data
contracts live under `src/types`; policy decisions live under `src/bot`.
Simulation entrypoints are adapters around the same transition API.

## Semantic owners

| Concern | Owner |
|---|---|
| Current configuration and artifact status | `src/rules/manifest.ts` |
| Command validation and authoritative result | `src/transitions/` |
| Legal-action projection | `src/actions/` |
| Action declaration and resolution | `src/state-machine/actions.ts` |
| Turn cleanup, hand-limit continuation, and turn events | `src/state-machine/turn-boundary.ts` |
| Choice protocol | `src/transitions/choice-continuation.ts` and effect handlers |
| Stack transactions | `src/effects/stack-resolver.ts` |
| Effect interpretation | `src/effects/` |
| Event identity, matching, APNAP, and dispatch | `src/runtime/event-envelope.ts`, `src/events/`, `src/runtime/dispatch.ts` |
| Simultaneous state-based processing | `src/runtime/state-based-stabilizer.ts` |
| Continuous-effect derivation | `src/runtime/aura-derivation.ts`, `src/runtime/aura-recompute.ts` |
| Runtime invariants | `src/invariants/game-state-invariants.ts` |
| Setup and deterministic RNG | `src/setup/` |
| Simulation, observation, replay, and provenance | `sim-runner.mjs`, `replay-game.mjs` |

## Transition lifecycle

1. The caller submits an `EngineCommand`.
2. `transition` canonicalizes the command and validates phase, priority,
   controller, source zone, costs, readiness, timing, targets, and interaction
   identity.
3. A rejected command returns the original state plus typed rule violations.
4. An accepted declaration commits declaration-time costs and facts
   transactionally.
5. If an explicit choice or priority window is required, the result is
   `pending` with a stable interaction identifier.
6. Resolution applies stack/effect/combat changes, emits sequenced event
   envelopes, dispatches matching triggers in APNAP order, and stabilizes
   state-based actions.
7. Aura-derived state is rebuilt from explicit sources and stamped with its
   derivation record.
8. Invariants validate the stable state. Internal failures are typed and never
   converted into gameplay outcomes.

`TransitionResult` distinguishes `resolved`, `pending`, `rejected`, and
`failed`. A command that rejects or fails cannot partially charge costs or
exhaust a source.

## State model and invariants

`GameState` is readonly. Stable authoritative states satisfy:

- every instance has one owner and one durable location;
- pending interactions have unique IDs and legal responders;
- event sequence numbers increase monotonically;
- zone capacities and equipment ownership are valid;
- the winner and phase agree;
- state-based deaths have been processed;
- aura-derived contributions equal a fresh derivation from current sources;
- current-profile configuration matches the immutable manifest.

Choice and priority states are deliberate intermediate states. State-based and
aura invariants are checked again when their continuation reaches a stable
boundary.

## Events, LKI, and trigger ordering

Events are immutable envelopes with sequence, action identity, source snapshot,
controller, and typed payload. Source snapshots provide last-known information
after a card leaves play. Trigger matching consumes envelopes, not live object
identity.

Simultaneous events are batched before state-based observation. When multiple
triggers are ready, active-player triggers precede non-active-player triggers;
each owner chooses within their own group. Guard exhaustion is an engine
failure.

## Public API

`src/index.ts` is the supported facade. The primary APIs are:

- `createCurrentGame` for current-profile setup;
- `transition` for every player or interaction command;
- `computeAvailableActions` and `enumerateConcretePlayerActions` as UI/bot
  projections, never authorization;
- `CURRENT_GAME_CONFIG` and `CURRENT_RULES_MANIFEST` for artifact identity;
- selectors such as `effectiveTraits`;
- invariant validators and trusted effect helpers.

Direct effect/runtime exports exist for engine tests and trusted integrations;
untrusted callers should use `transition`.

## Simulation boundary

`sim-runner.mjs` binds the rules, card pool, compiled engine, executable
simulation harness, bot implementation, complete policy configuration, deck,
and seed-schedule hashes. Declarative observations return detached frozen
snapshots and are excluded from behavior/replay identity. Replays contain the
initial state, canonical commands, event hash, final-state hash, trace hash, and
provenance.

Primary-study settings are defined by
[`current-study-manifest.json`](../packages/engine/sim-data/current-study-manifest.json).
The manifest deliberately blocks decision-grade claims until rules, policy
calibration, and an independent oracle are ratified.

## Architecture decisions

The decision index is [docs/adr/README.md](adr/README.md). Architecture and
performance contracts are exercised by `tests/architecture` and the current
correctness/coverage CI jobs.
