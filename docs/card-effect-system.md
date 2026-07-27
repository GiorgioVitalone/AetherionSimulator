# Card Effect System

This document describes how a validated effect moves through the current
runtime. For authoring shapes, see [Effect DSL Specification](dsl-spec.md); for
the broader dependency model, see [Simulation Engine Architecture](architecture.md).

Status: **diagnostic candidate**.

## Resolution pipeline

```text
validated command
  -> transactional declaration
  -> optional priority window
  -> stack item
  -> effect context + target snapshot
  -> atomic effect changes
  -> event envelopes
  -> state-based stabilization
  -> APNAP trigger dispatch
  -> aura derivation
  -> invariant validation
```

Declarations and resolutions have different ownership. Declaration records
costs, exhaustion, targets, and timing facts only after validation succeeds.
Resolution consumes that committed stack item. A countered or fizzled item
retains the declaration facts while skipping inapplicable resolution.

## Effect context

An effect context identifies the source instance, controller, action, triggering
event, selected targets/options, and paid X value. The context is immutable for
one resolution. Effects that create continuations serialize the information
needed to resume; they do not retain callbacks.

## Targeting and snapshots

`resolveTargets` evaluates a target expression against the state at the effect’s
resolution boundary. Explicit target legality is checked at declaration and
again where the rule requires resolution-time validity.

Simultaneous targets are collected before mutation. This prevents earlier
members of an `all` set from changing which later members belong to the set.
Source/card event facts use last-known snapshots so leaving play does not erase
the cause of a trigger.

## Damage, healing, and death

All effect damage passes through replacement/reduction handling, applies the
result, emits damage facts, and then invokes state-based stabilization.
Persistent damage uses this same path. Effect draws use `attemptDraw`, including
empty-deck loss.

State-based deaths are collected simultaneously. The engine snapshots every
lethal card, moves the whole batch, emits lifecycle events, and only then
dispatches resulting triggers. Combat-specific `dies`, general `destroy`, and
`leaves battlefield` observations remain distinct.

## Stack transactions and reactions

Reactive windows are represented by `PendingPriority`. A responder can submit a
legal reactive action or pass using the window ID. Accepted links are pushed
onto the stack; both players passing resolves the top item LIFO. The engine
rejects stale windows and prevents partial payment on invalid declarations.

Resolution outcomes are observable as accepted, rejected, countered, fizzled,
resolved, or failed rather than collapsed into an unchanged state.

## Explicit choices

Target selection, flexible payment, modal effects, scry/distribution, hand
limit, APNAP within-owner ordering, reserve strain, and other player decisions
use the same continuation protocol:

1. create an immutable pending interaction;
2. return it in a `pending` transition result;
3. validate responder, interaction ID, and response payload;
4. resume the stored continuation exactly once;
5. emit requested/submitted/accepted-or-rejected/resolved observations.

Bot and UI adapters only choose among presented options. They cannot resolve a
choice by mutating state.

## Continuous effects

Auras are derived, not incrementally trusted. The runtime:

1. collects sorted live aura sources from cards, equipment, and heroes;
2. computes contribution keys for stats, traits, statuses, replacements,
   triggers, and cost reductions;
3. rebuilds derived state;
4. records `auraDerivation` source/contribution keys;
5. verifies that a fresh derivation matches the recorded one at stable
   boundaries.

This makes recomputation order-independent and exposes stale or directly
mutated derived values as invariant failures.

## Durations

Duration expiry belongs to semantic boundaries:

- `instant`: after its atomic transition;
- `for_combat`: after the combat transaction;
- `until_end_of_turn`: end cleanup;
- `until_next_upkeep`: the affected controller’s next upkeep;
- `while_in_play`: aura derivation while the source remains eligible;
- `permanent`: until another rule removes it.

Turn-boundary work, including scheduled effects and hand-limit continuations,
is centralized in `src/state-machine/turn-boundary.ts`.

## Errors and guards

Invalid card data and configuration fail before play. Illegal player commands
return typed violations. Guard exhaustion, invariant failure, and unexpected
runtime exceptions are engine failures. Simulation maps these to typed
infrastructure terminal reasons and excludes them from gameplay estimands.

The stack, trigger dispatch, and state-based loops all have explicit guards.
No guard failure is converted into a pass, draw, or normal win.

## Testing contract

The effect system is covered at four levels:

- unit tests for handlers, targeting, replacements, and durations;
- transition tests for rejection atomicity and continuation identity;
- rule scenarios and every-card execution for semantic coverage;
- full-game replay tests comparing commands, events, final state, and trace
  hashes.

Historical hash pins are isolated under `tests/legacy` and are not evidence for
current correctness.
