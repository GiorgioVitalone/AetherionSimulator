# Aetherion Simulator — Comprehensive Remediation Plan

- **Plan date:** 2026-07-26
- **Source review:** `docs/simulation-engine-deep-review-2026-07-26.md`
- **Source revision:** current dirty working tree based on commit `524d648`
- **Coverage target:** all 12 critical summaries and all 167 categorized findings
- **Mode:** planning only; this document does not authorize or perform implementation

## 1. Intended outcome

This plan moves the simulator through three distinct levels of trust:

1. **Authoritative rules engine:** every accepted action, effect, choice, trigger, turn transition, and terminal result agrees with one versioned rules contract.
2. **Valid simulation instrument:** every game is replayable, every failure is classified, every deck and card is validated, and bots exercise the complete legal decision surface.
3. **Decision-grade balance system:** experiments preserve the matchup/seat/deck dependence structure, report practically meaningful effects, and make claims no broader than the tested rules, decks, and policies.

The work is complete only when the final ratification gate in §12 passes. A green unit suite, stable hash, or large simulation count is not sufficient by itself.

## 2. Scope and non-goals

### In scope

- ruleset authority and rulebook reconciliation;
- state-machine and action legality;
- choices, effect semantics, timing, stack, triggers, auras, statuses, zones, costs, equipment, and transformation;
- card schema, hydration, semantic validation, and every-card execution coverage;
- simulator control flow, error taxonomy, provenance, replay, and reproducibility;
- legal-action coverage and calibration of bots;
- deck/policy experimental design and balance statistics;
- testing hierarchy, documentation, maintainability, and performance guardrails;
- migration from legacy rule flags and legacy balance artifacts.

### Out of scope

- changing card balance values before semantic ratification;
- claiming human or metagame balance from the current four-faction, fixed-deck bot panel;
- building a production multiplayer server or UI;
- preserving known incorrect behavior in the canonical rules path;
- selecting unresolved game-design meanings without a recorded rules decision.

Legacy behavior may remain available for historical reproduction, but only behind explicitly named legacy manifests. It must not be the default or be described as current rules.

## 3. Definition of done

The program is done when all of the following are true:

| Dimension | Required evidence |
|---|---|
| Finding closure | Every one of the 167 finding IDs is linked to a merged change, a passing acceptance test, and retained evidence; every C-01–C-12 summary is closed by its constituent changes |
| Rules authority | One immutable `current` rules manifest identifies the rulebook revision and is used by every normal engine, simulator, bot, and balance entry point |
| Action authority | Every action is validated at execution; illegal or stale actions return typed rejection and produce no state mutation |
| Semantic integrity | Choices, all-effects, draw/deckout, state-based deaths, status duration, turn counters, response timing, and triggers pass rulebook scenarios |
| Data integrity | Card hydration fails closed; every card/ability/mode has an executable semantic scenario; text-to-DSL exceptions are explicit |
| Invariants | Property runs show zone conservation, valid HP, valid attachments, coherent identities, reset lifetimes, and deterministic traces |
| Simulation validity | No engine error, unresolved choice, guard exhaustion, or step loop is hidden as an ordinary timeout |
| Replay/provenance | Clean checkout plus manifest/artifact hashes can reproduce sampled full traces |
| Bot validity | All legal action classes, targets, choices, X values, and response types are reachable by the policy interface |
| Statistical validity | Estimands, clusters, pairing, multiplicity, practical thresholds, and claim scope are predeclared and tested with synthetic fixtures |
| Ratification | A clean, versioned release passes the rulebook, every-card, invariant, replay, policy, and experiment gates in §12 |

## 4. Program rules

### 4.1 Stop-the-line rules

Until milestone M5 is complete:

- label all new simulation output **diagnostic, not balance-certifying**;
- do not ratify card or faction changes from current headline p-values or faction-spread intervals;
- do not update legacy “balanced” baselines as if they represented the current rulebook;
- fail certification runs on invalid data, illegal actions, unresolved choices, engine/bot exceptions, or guard exhaustion;
- preserve the current diagnostic probes as red tests before changing behavior.

### 4.2 Authority hierarchy

The implementation must use this order of authority:

1. ratified rulebook revision and recorded interpretation decisions;
2. canonical current-rules manifest;
3. executable validation/transition contracts;
4. card DSL and card-specific approved exceptions;
5. bots, simulator adapters, and reporting.

Lower layers must not override or silently reinterpret higher layers.

### 4.3 Change discipline

Each remediation change must include:

- finding IDs in the change description;
- a rule or invariant citation;
- a failing test/probe before the fix where practical;
- positive, negative, and integration tests;
- migration notes when serialized state, manifests, traces, or artifacts change;
- updated documentation in the same change;
- no unrelated balance edits.

### 4.4 Roles

These are responsibility labels, not assumptions about named staff.

| Role | Primary responsibility |
|---|---|
| Rules owner | Ratifies ambiguous timing, replacement, ordering, resource, and card-text interpretations |
| Engine owner | Transition API, state machine, actions, stack, triggers, zones, and invariants |
| DSL/data owner | Effect semantics, card schema, hydration, validators, and card scenarios |
| Simulation owner | Runner, terminal reasons, seeds, replay, manifests, and artifacts |
| Bot owner | Complete action/choice policies, calibration, and policy-sensitivity reporting |
| Quantitative owner | Experimental design, estimands, inference, multiplicity, and statistical validation |
| Verification owner | Test architecture, property/oracle suites, coverage gates, and ratification evidence |
| Release owner | Migration, compatibility labeling, documentation, and artifact publication |

No person should self-approve both an ambiguous rules interpretation and its acceptance oracle.

## 5. Delivery map and dependencies

### 5.1 Milestones

| Milestone | Outcome | Required work packages |
|---|---|---|
| M0 — Evidence freeze | Current defects, manifests, and artifact provenance are captured; ambiguous rules have owners | WP-00, start WP-17 |
| M1 — Authoritative boundary | Canonical rules and typed action/choice outcomes exist; direct illegality is contained | WP-01, WP-02, WP-03 |
| M2 — Semantic core | Turn, trigger, timing, state-based, status, target, aura, cost, equipment, and transform semantics are corrected | WP-04 through WP-11 |
| M3 — Executable card corpus | Hydration and semantic validation fail closed; all cards have scenarios | WP-12, relevant WP-17 gates |
| M4 — Trustworthy harness | Terminal reasons, replay, provenance, and complete bot decision interfaces are in place | WP-13, WP-14 |
| M5 — Valid experiment design | Deck/policy population and statistics are fit for declared claims | WP-15, WP-16 |
| M6 — Ratified release | Docs, performance, clean-build evidence, and current-rules artifacts pass | WP-18, WP-19, complete WP-17 |

### 5.2 Critical path

```text
WP-00
  └─ WP-01
      ├─ WP-02 ─┬─ WP-07 ─┬─ WP-11
      │         │         └─ WP-14
      ├─ WP-03 ─┴─ WP-12 ─── WP-13
      └─ WP-04 ─┬─ WP-05
                ├─ WP-06
                ├─ WP-08
                ├─ WP-09
                └─ WP-10

WP-13 + WP-14 ── WP-15 ── WP-16 ── WP-19
WP-17 spans every package; WP-18 begins at M0 and closes before WP-19.
```

Parallel work is allowed only where the dependency inputs are stable. In particular, bot, card-corpus, replay, and statistical baselines must not be finalized against pre-M2 semantics.

### 5.3 Relative effort

Effort bands are for sequencing, not calendar promises:

- **S:** focused local change with narrow surface;
- **M:** several modules plus integration tests;
- **L:** cross-cutting contract or migration;
- **XL:** multi-stage subsystem requiring rules signoff and staged rollout.

| Package | Effort | Main dependency |
|---|---:|---|
| WP-00 | M | none |
| WP-01 | XL | WP-00 |
| WP-02 | XL | WP-01 |
| WP-03 | L | WP-01 |
| WP-04 | L | WP-01 |
| WP-05 | XL | WP-04 |
| WP-06 | XL | WP-01, WP-04 |
| WP-07 | XL | WP-01, WP-02 |
| WP-08 | L | WP-04, WP-06 |
| WP-09 | L | WP-01, WP-06 |
| WP-10 | L | WP-06, WP-08, WP-09 |
| WP-11 | XL | WP-02, WP-07 |
| WP-12 | XL | WP-03, WP-06, WP-08, WP-09, WP-11 |
| WP-13 | XL | WP-01 through WP-12 |
| WP-14 | XL | WP-02, WP-03, WP-07, WP-11, WP-13 |
| WP-15 | L | WP-13, WP-14 |
| WP-16 | XL | WP-13, WP-15 |
| WP-17 | XL/spanning | all |
| WP-18 | L/spanning | all |
| WP-19 | L | all |

## 6. Work packages

## WP-00 — Freeze evidence and ratify semantic authority

**Purpose:** stop rules drift before implementation and create one auditable source of current semantics.

- **Primary findings:** RULE-14, ARCH-05, FID-10, REPRO-06, REPRO-07, EXP-01, EXP-02, EXP-03, EXP-14, TEST-03, TEST-10, OPS-01, OPS-02, OPS-03, OPS-04, OPS-10.
- **Critical summaries:** C-10.
- **Primary role:** Rules owner; Release owner.
- **Dependencies:** none.

### Deliverables

1. Create a decision register for every ambiguity exposed by the review:
   - declaration versus resolution timing for attack, cast, equipment, movement, and activated abilities;
   - which costs/exhaustion remain committed when an action is countered;
   - “All” snapshot, replacement, destruction, and trigger ordering;
   - APNAP and within-owner simultaneous trigger ordering;
   - Persistent/Regeneration replacement and duration;
   - Stun decrement boundary;
   - typed X costs and flexible resource semantics;
   - equipment remove/replace/transfer destinations and event vocabulary;
   - transformation eligibility and Ultimate lockout;
   - effect-driven deckout;
   - exile-zone visibility;
   - token fallback clauses and current card-text corrections.
2. Introduce a schema-validated, immutable `current` rules manifest containing:
   - semantic version and rulebook revision/hash;
   - every behaviorally material rule;
   - incompatible-combination constraints;
   - engine/card schema compatibility range;
   - ratification status and evidence references.
3. Make legacy v1/v2/v3 manifests explicit historical profiles. No version may silently inherit absent correctness flags from generic defaults.
4. Define a canonical constructor/export used by engine setup, simulator, rollout, trace, validator, and all balance scripts.
5. Capture a pre-fix evidence bundle:
   - exact commit plus dirty-patch hash;
   - hashes of v1/v2/v3, card pool, decks, bots, and scripts;
   - the 11 focused probe outputs from the review;
   - current test/build/lint/validator results;
   - a list of stale artifacts that must not be treated as current.
6. Add a visible artifact status: `legacy`, `diagnostic`, `candidate`, or `ratified`.

### Acceptance

- a manifest-schema test rejects omitted, unknown, incoherent, or mutable settings;
- all ordinary entry points resolve to the same current manifest content hash;
- legacy manifests require explicit selection and stamp output as legacy;
- a clean process can print the complete effective rules without consulting script-local defaults;
- the decision register has an owner and disposition for every item above;
- no artifact can be called ratified without matching manifest, build, and data hashes.

## WP-01 — Build one authoritative transition API

**Purpose:** make legality, execution, event production, and error semantics one enforceable contract.

- **Primary findings:** RULE-01, ARCH-01, ARCH-07, LEGAL-01, LEGAL-11, DSL-12, PLAY-08, REPRO-05, EXP-11, TEST-01, OPS-06.
- **Critical summaries:** C-01.
- **Primary role:** Engine owner.
- **Dependencies:** WP-00.

### Target contract

Use one public transition boundary conceptually shaped like:

```ts
type TransitionResult =
  | { status: 'resolved'; state: GameState; events: GameEvent[]; actionId: string }
  | { status: 'pending'; state: GameState; interaction: PendingInteraction; actionId: string }
  | { status: 'rejected'; state: GameState; violations: RuleViolation[]; actionId: string }
  | { status: 'failed'; state: GameState; failure: EngineFailure; actionId: string };
```

The exact type may differ, but the distinctions may not collapse into “unchanged state.”

### Deliverables

1. Separate:
   - canonicalization of caller input;
   - structural validation;
   - state/rules legality validation;
   - declaration;
   - response/stack handling;
   - resolution;
   - post-transition trigger/state-based processing.
2. Define typed rule violations for phase, priority, controller, source zone, card/ability kind, cost, readiness, timing, target, choice, cooldown/once use, transformation, stale window, and malformed action.
3. Make enumerators and executors call the same validators. Enumeration proposes candidates; validation is authoritative.
4. Give response windows stable IDs/nonces and require reactive actions to reference the current window.
5. Make accepted, pending, rejected, countered, fizzled, and failed distinct observations.
6. Restrict low-level `executeEffect` to trusted engine composition/tests; do not expose it as a player-action equivalent.
7. Guarantee rejection is referentially transparent: same state object semantics, no payment, no counters, no log/event mutation, no RNG consumption.
8. Migrate state-machine, bot, simulator, and test callers from tuple/unchanged-state assumptions.

### Acceptance

- every review probe that fabricated an illegal action returns a specific violation and byte-equivalent game state;
- a generated adversarial matrix submits every action kind in every phase, from both controllers, with stale IDs and malformed targets;
- every enumerated action validates and transitions or produces a documented pending interaction;
- every non-enumerated direct action is rejected unless the action is intentionally legal but lazily enumerated, which must be documented and tested;
- simulator telemetry never records a rejected action as resolved play;
- public exports do not offer an unvalidated player-action path.

## WP-02 — Complete and harden action legality

**Purpose:** enforce every action class at the final boundary and make the legal surface complete.

- **Primary findings:** RULE-02, RULE-03, LEGAL-02 through LEGAL-10, COMBAT-10, ECON-07, ECON-10, BOT-01, BOT-02, BOT-04.
- **Critical summaries:** C-01.
- **Primary role:** Engine owner.
- **Dependencies:** WP-01.

### Deliverables by action

| Action | Required validation and enumeration |
|---|---|
| Deploy | Strategy phase/timing, active priority, controller, hand membership, Character type, legal zone, capacity, Elite-only direct High Ground, readiness/summoning state, complete typed cost |
| Cast | timing/Flash/React context, hand membership, Spell type, legal source/controller, targets, cost/X, response eligibility |
| Equip | Equipment type, owner/controller, valid friendly Character target, slot/replacement rules, timing, cost/reduction |
| Remove equipment | legal controller, attachment existence, cost/timing if any, discard/removal events rather than destruction |
| Transfer equipment | legal source/target/controller, slot handling, once-per-turn cost reduction semantics, response timing |
| Move | active controller, Strategy phase, readiness/exhaustion, summoning/status restrictions, move count, adjacency, destination capacity |
| Attack | active controller, Action phase, ready attacker, target matrix, Defender/Flying/Sniper/effective traits, declaration state |
| Activate ability | stable ability ID, activated kind, legal phase/window, source zone/controller, readiness/exhaustion/summoning, costs, cooldown/once rules |
| Discard for Energy | Strategy timing, active controller, hand membership, once-per-turn use, eligible card, exile destination |
| Transform | exclusive start-of-turn timing after Upkeep and before Strategy, controller, one of the three eligibility predicates, once-per-game, current form, pending windows |
| Hand-size response | current pending interaction, exact cardinality, unique IDs, ownership and current hand membership |
| Reactive action | current window ID, offered source/ability/targets, priority, cost, timing kind, stack legality |

Use stable action/ability IDs; do not use labels or array indices as semantic authority.

### Acceptance

- positive and negative contract tests exist for every table row;
- remove/transfer, activated abilities, X variants, and reactive board abilities appear in `computeAvailableActions`;
- legal action enumeration is deterministic under data reordering;
- fabricated index, enemy target, illegal zone, stale source, or wrong phase is rejected;
- movement/attack enumerator and executor use identical predicates;
- direct transformation and equipment calls cannot bypass eligibility/ownership.

## WP-03 — Unify choices and effect continuations

**Purpose:** make every required player decision visible, resumable, validated, and policy-controlled.

- **Primary findings:** PLAY-01, PLAY-04, FID-01, ARCH-02, LEGAL-09, DSL-01, DSL-02, DSL-03, DSL-04, DATA-02, BOT-06.
- **Critical summaries:** C-02, C-05.
- **Primary role:** Engine owner; DSL/data owner.
- **Dependencies:** WP-01.

### Deliverables

1. Replace machine-context-only and game-state choice concepts with one `PendingInteraction` stored in authoritative observable state.
2. Model:
   - stable interaction ID and controller;
   - choice kind;
   - source/action/event IDs;
   - effect continuation path;
   - legal option IDs with display metadata;
   - minimum/maximum cardinality;
   - optional/mandatory status;
   - visibility;
   - validation token tied to the originating state/window.
3. Replace shared `selectedTargets` with per-effect/per-prompt selections keyed by stable effect path.
4. Make `choose_one` consume a selected mode and execute exactly that branch.
5. Let `minSelections = 0` resolve with zero selections.
6. Revalidate every submitted option against the pending interaction and current state.
7. Remove `fixHandSizeStall`; hand-limit discard becomes an ordinary visible interaction used by human, bot, rollout, and trace callers.
8. Require every controller/policy to implement a choice-response interface. No core engine auto-first behavior.
9. Emit choice-requested, choice-submitted, choice-accepted/rejected, and choice-resolved observations.

### Acceptance

- Bloom Assembly executes either branch and only the selected branch;
- Overgrowth Protocol executes both modes in dedicated tests;
- multi-effect abilities can choose distinct targets;
- “up to N” can choose zero, one, or N as legal;
- invalid, duplicate, stale, wrong-owner, and wrong-count responses reject without mutation;
- every pending interaction is visible in `GameState` and resolvable through the same public transition API;
- default and rollout simulations complete hand-size discard without a special flag;
- card/JSON order changes do not decide a choice unless the selected policy explicitly uses that order as a tie-break.

## WP-04 — Centralize turn boundaries and scoped lifetime reset

**Purpose:** make turn/phase events, counters, and per-turn lifetimes advance exactly once in rulebook order.

- **Primary findings:** FID-01, RULE-10, TIME-01, TIME-11.
- **Critical summaries:** C-03, C-04.
- **Primary role:** Engine owner.
- **Dependencies:** WP-01.

### Deliverables

1. Define one turn-boundary orchestrator; prohibit direct `TURN_START`/`TURN_END` log append without dispatch.
2. Record the ratified order for:
   - end-phase actions and hand limit;
   - end-of-turn scheduled effects/triggers;
   - duration expiry;
   - cleanup;
   - active-player switch;
   - per-turn reset;
   - refresh/status ticks;
   - reserve/resource/main draw;
   - start-of-turn scheduled effects/triggers;
   - priority handoff.
3. Route phase/turn events through the same event envelope, trigger, state-based, and aura pipeline as action events.
4. Reset `spellsCast`, `equipmentPlayed`, `charactersDeployed`, `abilitiesActivated`, movement/attack/activation markers, reduction usage, and replacement usage at their exact scoped boundary.
5. Increment every counter only on its ratified accepted/declaration/resolution timing.
6. Encode lifetimes by scope (`action`, `combat`, `phase`, `turn`, `next_upkeep`, `while_source_active`, `game`) rather than unrelated booleans.

### Acceptance

- two consecutive turns prove counters reset and increment exactly once;
- Lyria’s “second spell each turn” works on multiple turns;
- activated-ability conditions can become true;
- ordinary and aura-derived once-per-turn replacements reset once and preserve used state through aura recomputation;
- printed turn-start/end triggers fire in full game-loop tests in the ratified order;
- phase/turn events cannot be logged without having traversed dispatch.

## WP-05 — Rebuild trigger identity, multiplicity, recursion, and ordering

**Purpose:** make every trigger observe correct last-known information and fire the rulebook-allowed number of times.

- **Primary findings:** RULE-11, ARCH-03, TIME-06, TIME-07, TIME-08, TIME-09, TIME-10, REPRO-03.
- **Critical summaries:** C-08.
- **Primary role:** Engine owner.
- **Dependencies:** WP-04.

### Deliverables

1. Define an immutable event envelope containing:
   - unique event ID;
   - causal parent/action/transaction IDs;
   - event type and timing;
   - actor/controller/owner/player IDs;
   - source instance and definition IDs;
   - affected instance IDs;
   - last-known card/source snapshots where zones can change;
   - numeric values and destination/reason;
   - turn/phase/sequence metadata.
2. Match filters against last-known event data, never permissively against `null`.
3. Make missing required identity a typed engine/data failure, not a broad match.
4. Key trigger rate limiting by the intended scope:
   - `(trigger instance, event ID)` for ordinary once-per-event behavior;
   - explicit turn/game usage for authored limits;
   - never one batch-wide set that suppresses distinct events.
5. Thread the source registry and last-known snapshots through recursive dispatch so trigger-created deaths retain Last Breath and leave-play triggers.
6. Replace module-global registration counters with state-owned deterministic IDs derived from game/source/ability identity.
7. Represent simultaneous trigger groups as pending ordering interactions:
   - APNAP orders player groups;
   - each affected player chooses the order of their own group;
   - deterministic policy fallback exists only for non-interactive simulation and is stamped.
8. Replace silent depth/stack truncation with a typed `guard_exhausted` terminal/failure containing pending work and causal chain.

### Acceptance

- a nonmatching destroyed card cannot satisfy a filtered trigger after leaving play;
- two matching deaths cause two ordinary firings;
- a trigger-caused death retains and resolves Last Breath;
- identical fresh games have identical trigger IDs regardless of process history;
- owner-selected ordering can produce both legal order outcomes in tests;
- guard exhaustion never produces a normal completed trace;
- event snapshots serialize and replay without live-zone lookup.

## WP-06 — Centralize state-based actions, draws, damage, and “All”

**Purpose:** give mechanically equivalent outcomes one shared semantic pipeline.

- **Primary findings:** RULE-04, RULE-05, DSL-05, DSL-06, DSL-07, COMBAT-01, COMBAT-06, COMBAT-07, COMBAT-09.
- **Critical summaries:** C-06, C-07, C-11.
- **Primary role:** Engine owner; DSL/data owner.
- **Dependencies:** WP-01, WP-04.

### Deliverables

1. Add a state-based stabilization loop after each atomic action/effect batch, trigger batch, modifier expiry, aura change, status tick, and turn-boundary step.
2. Detect all battlefield cards with nonpositive HP from one snapshot; move/destroy them as one simultaneous group; emit complete last-known events; repeat until stable.
3. Centralize damage and HP-loss semantics:
   - ordinary and persistent damage enter the same prevention/replacement pipeline;
   - direct stat reduction remains distinguishable from damage but still invokes state-based destruction;
   - destruction replacement and destination logic are shared.
4. Centralize `attemptDraw(player, count, cause)` and process attempts one card at a time. The first impossible draw produces the ratified deck-exhaustion loss regardless of source.
5. Split target expressions into targeted selections and untargeted sets. `all_*`:
   - ignores Hexproof/Stealth/target-protection unless the rule explicitly protects from the effect;
   - resolves membership and dynamic inputs from one pre-effect snapshot;
   - applies the batch before death/trigger observation;
   - emits deterministic per-instance events with one shared batch ID.
6. Specify interaction between simultaneous all-effects, prevention/replacement, Last Breath, auras, and dynamic modifiers in rule scenarios.

### Acceptance

- HP reduction and aura expiry cannot leave a living nonpositive-HP card;
- simultaneous deaths preserve all relevant leave-play/Last Breath triggers;
- draw 1 from empty and draw 2 from one card both lose at the failed attempt;
- main draw, DSL draw, recycle, tutor-then-draw, and scheduled draw share the same deckout service;
- Hexproof/Stealth do not evade untargeted all-effects;
- reordering board storage does not change an all-effect result;
- combat, effect, and persistent damage share replacement tests.

## WP-07 — Make declaration, response, stack, and resolution transactional

**Purpose:** model priority windows without partial pre-resolution mutation or unresponseable board effects.

- **Primary findings:** RULE-13, TIME-02, TIME-03, TIME-04, TIME-05, ECON-06.
- **Critical summaries:** C-12.
- **Primary role:** Engine owner; Rules owner.
- **Dependencies:** WP-01, WP-02.

### Deliverables

1. Ratify and encode an action lifecycle:
   `submitted → validated → declared → costs/commitments paid → responseable stack item → countered or resolved → state-based/trigger processing`.
2. Store a typed stack item with declared source, targets, costs, committed state, effect continuation, LKI, and counter disposition.
3. Apply attack declaration commitments at declaration as ratified (including exhaustion/attack use); a countered attack must not restore commitments that the rule says are spent.
4. Defer equipment attachment, replacement removal, and play/resolution effects until resolution. A countered equipment action must leave attachment state coherent.
5. Put board Counter/Flash/React abilities on the same responseable LIFO stack as hand reactions.
6. Emit `SPELL_DECLARED`/`SPELL_CAST` at the rulebook’s cast timing independently of later resolution, plus `SPELL_RESOLVED`, `SPELL_COUNTERED`, or `SPELL_FIZZLED`.
7. Define legal target recheck/fizzle behavior at resolution.
8. Make payment, reductions, once-per-turn use, counters, and telemetry align with the chosen declaration/resolution boundary.

### Acceptance

- responders observe the correct declared attack/equipment state;
- countering equipment restores no pre-resolution mutation because none occurred;
- countered spells can still satisfy “cast” triggers when rulebook semantics require it;
- board reactions can themselves be responded to;
- LIFO chains containing hand and board reactions resolve in exact order;
- every stack item ends as resolved/countered/fizzled/failed and cannot disappear silently.

## WP-08 — Unify statuses, durations, and replacement lifetimes

**Purpose:** remove double clocks and make authored durations/replacements exact.

- **Primary findings:** RULE-06, RULE-07, RULE-08, DSL-08, TIME-11, TIME-12, COMBAT-02, COMBAT-04, COMBAT-05, ECON-05.
- **Primary role:** Engine owner; DSL/data owner.
- **Dependencies:** WP-04, WP-06.

### Deliverables

1. Define a single lifecycle engine for every duration:
   - instant;
   - for current combat;
   - until end of phase/turn;
   - until next upkeep;
   - fixed number of owner/opponent turns;
   - permanent;
   - while source remains active.
2. Remove duplicate Stun decrement paths; record whether duration counts owner upkeeps or another ratified boundary.
3. Implement Persistent/Regeneration as value replacement according to the rulebook (higher replaces lower, no stacking) and test equal/lower/higher applications.
4. Preserve replacement usage through aura recomputation and reset it through the scope engine.
5. Route persistent damage through the ordinary damage/replacement service.
6. Move rule-accuracy behavior such as ARM first-instance and cost floor into canonical current semantics, not opt-in flags.
7. Validate unsupported duration/effect combinations at data load.

### Acceptance

- two-turn Stun survives exactly the ratified number of boundaries;
- applying Persistent/Regeneration lower/equal/higher values yields exactly one correct status;
- `for_combat` expires after combat, instant grants do not persist, and `until_next_upkeep` expires once;
- replacement use survives unrelated aura recomputation and resets once;
- persistent damage honors shields/immunity/replacement exactly like equivalent ordinary damage;
- current rules need no correctness flag for ARM or cost floor.

## WP-09 — Canonicalize traits, identities, targets, tokens, and exile

**Purpose:** make every subsystem agree on what a card “is,” what traits it has, and where it exists.

- **Primary findings:** FID-03, FID-05, FID-06, FID-07, FID-08, DSL-10, DSL-11, COMBAT-03, DATA-03, DATA-06.
- **Primary role:** Engine owner; DSL/data owner.
- **Dependencies:** WP-01, WP-06.

### Deliverables

1. Add central selectors for effective traits/tags that combine printed, granted, suppressed, and aura-derived state. Combat, targets, conditions, counts, triggers, bots, and telemetry must call them.
2. Use stable distinct identifiers:
   - `playerId` for players/Hero life targets;
   - `cardInstanceId` for an in-game card;
   - `definitionId` only for printed identity;
   - `abilityId`/`effectPath` for authored behavior.
3. Remove seat pseudo-ID/definition-ID ambiguity from Hero/player target round trips.
4. Make `side: any` enumerate both controllers where legal.
5. Add an explicit exile zone/ledger with instance, owner, cause, turn, and source. Enforce one-zone conservation.
6. Normalize Bio-Construct token definition/name/tag references; validate all tag/token references have reachable populations.
7. Encode full-zone token fallback as DSL behavior or an explicit approved card rule, never silent no-op.
8. Revalidate selected target IDs using canonical identity and effective-trait selectors.

### Acceptance

- granted Flying/Defender/etc. is observed identically by combat, targeting, conditions, counts, and triggers;
- two players using the same Hero definition remain unambiguous;
- `side: any` reaches both friendly and opposing Hero/player targets;
- discard-for-energy and Volatile/destruction exile remain visible and preserve zone conservation;
- every referenced token/tag resolves to a definition and reachable population;
- Biotech Harvest’s full-Reserve fallback executes;
- data ordering cannot change identity resolution.

## WP-10 — Make modifier and aura recomputation invariant-driven

**Purpose:** eliminate order-sensitive aura results and prevent recomputation from repairing or corrupting unrelated state.

- **Primary findings:** FID-04, ARCH-06, COMBAT-07, COMBAT-08, OPS-09.
- **Primary role:** Engine owner.
- **Dependencies:** WP-06, WP-08, WP-09.

### Deliverables

1. Separate printed/base state, durable modifiers, continuous contributions, and derived effective stats.
2. Evaluate dynamic auras from a common stable snapshot or a documented fixed-point algorithm; never registry scan order.
3. Restrict dynamic modifiers to explicitly authored stat axes; Synthetic Evolution cannot multiply ARM when only ATK/HP are named.
4. Preserve stable IDs and usage state for continuous replacement/trigger contributions across recomputation.
5. Invoke the state-based stabilization loop after any aura contribution change.
6. Add incremental dependency tracking or bounded dirty-set recomputation after correctness is proven.
7. Bound/compact logs for rollouts without changing canonical event hashes; retain complete traces when requested.

### Acceptance

- permuting battlefield/registry order produces identical effective stats and trace semantics;
- adding/removing HP auras cannot leave nonpositive living cards;
- recomputation does not reset used replacement state;
- dynamic modifier tests prove only authored fields change;
- performance benchmarks set budgets for recomputation and trace memory while semantic outputs stay identical.

## WP-11 — Correct costs, resources, equipment, and transformation

**Purpose:** make economic and transformation choices typed, enumerable, and enforceable.

- **Primary findings:** RULE-03, RULE-09, RULE-12, LEGAL-04, LEGAL-07, LEGAL-08, ECON-01 through ECON-12.
- **Primary role:** Engine owner; DSL/data owner.
- **Dependencies:** WP-02, WP-07, WP-08, WP-09.

### Deliverables

1. Represent X cost as a typed component retaining Mana/Energy/flexible kind through card schema, hydration, enumeration, payment, telemetry, and bot evaluation.
2. Enumerate every legal X value from minimum through affordability/cap, with target-dependent legality checked per candidate.
3. Replace resource-name inference with explicit validated resource type; unknown/missing values fail closed.
4. Ratify and implement flexible resource-card semantics separately from flexible action costs.
5. Consolidate payment, floor, reductions, and first-per-turn usage into one cost transaction used by play, transfer, activation, and reactions.
6. Make equipment attachment a first-class owned relation with cardinality and target invariants.
7. Emit distinct equipment events: declared, attached, detached, transferred, discarded, destroyed, countered. Voluntary removal/replacement must not emit destruction.
8. Ensure transfer consumes or preserves first-per-turn reductions exactly as ratified.
9. Validate transformation’s three conditions, timing, controller, form, and once-per-game status at execution.
10. Store `transformedThisTurn`/turn identity as explicit semantic state and block Ultimate at the executor.
11. Replace label-based Ultimate recognition with typed ability kind/ID.
12. Record meaningful pre/post Hero LP and transform state in telemetry.

### Acceptance

- typed-X payment cannot use an unauthorized resource and every legal X is offered;
- malformed resource definitions fail validation;
- play and transfer cannot reuse a consumed reduction;
- enemy/invalid equipment targets reject; all mappings remain bidirectionally coherent;
- voluntary removal cannot trigger destruction watchers;
- fabricated transform and same-turn Ultimate reject at execution;
- transform telemetry records actual state and LP deltas;
- all current-rules cost behavior works without correction flags.

## WP-12 — Build semantic card validation and an every-card corpus

**Purpose:** make a clean validator mean that printed cards are loadable, reachable, and semantically exercised.

- **Primary findings:** FID-01, FID-02, FID-03, FID-09, DSL-09, DSL-11, DATA-01 through DATA-10, TEST-05.
- **Primary role:** DSL/data owner; Verification owner.
- **Dependencies:** WP-03, WP-06, WP-08, WP-09, WP-11.

### Deliverables

1. Define a strict card schema with unique definition ID/slug, explicit resource/X types, legal numeric ranges, supported ability/effect combinations, duration compatibility, target cardinality, and valid references.
2. Make hydration lossless and fail closed:
   - no null DSL filtering;
   - no unknown-ID fallback;
   - no name-based type inference;
   - errors identify exact card/ability/effect path.
3. Add semantic lint passes for:
   - choose-one mode reachability;
   - target and `side` reachability;
   - tag/token population existence;
   - unsupported/degraded durations;
   - tautological/impossible conditions such as self-comparing `triggering_card_cost`;
   - dynamic stat-axis mismatch;
   - text/DSL fallback and cardinality hints;
   - references and stable IDs.
4. Maintain a machine-readable exception register for text that cannot be automatically compared. Every exception has owner, rationale, expected semantics, and scenario ID.
5. Generate a scenario inventory for every printed ability, including:
   - trigger/declaration path;
   - each choose-one mode;
   - zero/min/max optional selections;
   - friendly/enemy/any target reach;
   - full/empty zone fallback;
   - duration expiry;
   - meaningful state/event assertion or explicit authored no-op.
6. Make semantic validator errors fatal for build/certification and simulation manifest creation.
7. Retain structural validation as an earlier, faster gate.

### Acceptance

- every one of the 130 reviewed definitions and every ability/mode maps to at least one passing scenario;
- Bloom Assembly, Overgrowth Protocol, Biotech Harvest, Synthetic Evolution, Lyria Supreme Intellect, filtered death triggers, Last Breath recursion, statuses, typed X, and modal/optional cards have named regression scenarios;
- an intentionally corrupted fixture is rejected for every validation family;
- validator output includes zero unowned exceptions;
- a simulation cannot start with a semantically invalid pool.

## WP-13 — Make simulation outcomes, replay, and provenance trustworthy

**Purpose:** distinguish gameplay from harness failure and make runs reconstructible.

- **Primary findings:** PLAY-06, PLAY-08, FID-10, REPRO-01, REPRO-02, REPRO-04, REPRO-05, REPRO-06, REPRO-07, EXP-06, EXP-07, EXP-08, EXP-09, EXP-10, EXP-11, TEST-04, TEST-08, OPS-06, OPS-07, OPS-10.
- **Primary role:** Simulation owner.
- **Dependencies:** WP-01 through WP-12.

### Deliverables

1. Define terminal/result taxonomy:
   - normal win;
   - deck-exhaustion loss;
   - concession;
   - ratified turn-cap draw/tiebreak;
   - step-cap loop;
   - unresolved interaction;
   - stack/trigger guard exhaustion;
   - illegal/stale action;
   - bot exception;
   - engine exception;
   - invalid data/config/deck.
2. Certification runs fail on every non-gameplay defect and report counts by exact reason.
3. Record action lifecycle fields separately: proposed, submitted, accepted, declared, resolved, countered, fizzled, rejected, failed.
4. Remove mutable diagnostic side channels from behavioral config; use an explicit observer receiving immutable events.
5. Derive matchup seeds from stable matchup/deck/policy/replicate/seat keys, independent of panel index/order.
6. Validate explicit decks before setup; unknown requested decks fail rather than auto-fallback.
7. Define a canonical replay record containing:
   - complete effective manifest;
   - engine/build/commit/dirty-patch hashes;
   - card-pool and exact deck contents/hashes;
   - bot implementation/config hashes;
   - seed schedule and RNG algorithm/version;
   - every accepted action/choice and event hash;
   - terminal reason and failures;
   - validation/test status.
8. Distinguish run-summary hash, manifest hash, and full trace hash.
9. Redesign comeback/snowball telemetry around a documented state-value model; preserve raw LP, board, hand, resources, deck, transformation, and tempo components so definitions can be recomputed.
10. Make stale reports refuse “current” status when any decisive hash changes.

### Acceptance

- reordering or expanding a panel leaves an existing matchup’s seed stream unchanged;
- same clean build + manifest + seed reproduces the same full trace hash in isolated and batch processes;
- an engine exception, bot exception, unresolved choice, loop, and guard exhaustion each produce distinct failing fixtures;
- no diagnostic failure is included in ordinary timeout or win-rate denominators;
- unknown/illegal decks fail with no auto substitution;
- sampled artifacts replay from a clean checkout.

## WP-14 — Complete and calibrate bot decision quality

**Purpose:** ensure policies can play the ratified game and quantify their limitations.

- **Primary findings:** PLAY-02, PLAY-03, PLAY-04, PLAY-07, PLAY-08, BOT-01 through BOT-10.
- **Primary role:** Bot owner.
- **Dependencies:** WP-02, WP-03, WP-07, WP-11, WP-13.

### Deliverables

1. Consume only the canonical legal action and pending-interaction interfaces.
2. Cover every action class:
   - normal/Flash/React ability activation;
   - equipment play/remove/transfer;
   - all legal X values;
   - discard-for-energy;
   - all movement/attack candidates;
   - pass/advance only when strategically chosen.
3. Add a strategic choice evaluator for modes, optional cardinality, independent targets, trigger ordering, full-zone fallback, and future board-space effects.
4. Evaluate threats for every responseable action, not only spells.
5. Replace partial legacy rollout candidate generation in current mode; retain historical mode only as explicitly legacy.
6. Define a genuinely uniform-legal random baseline and separately name pass-heavy or first-option baselines.
7. Remove data-order leakage:
   - sort by stable semantic IDs before deterministic tie-breaking;
   - randomize test data order;
   - log tie sets and tie-break reason.
8. Build calibration sets:
   - rulebook tactical positions with known legal/illegal moves;
   - lethal, defense, resource, equipment, reaction, mode, and transform puzzles;
   - cross-policy round robin;
   - independently authored expert labels for the tactical corpus;
   - human decision logs before making any human-skill-equivalence claim.
9. Report policy sensitivity and disagreement, not one policy as human truth.
10. Block rollout/balance ratification until its forward model uses the ratified engine and all action classes.

### Acceptance

- reachability instrumentation observes every legal action/choice class in targeted scenarios;
- X and modal-choice tests select different values/modes when utility changes;
- reaction tests respond appropriately to attacks, equipment, movement/abilities, and spells;
- permuting card/action JSON does not change decisions except documented stable tie breaks;
- random baseline is uniform over canonical legal actions;
- calibration results include action accuracy/regret or agreement by scenario family and uncertainty;
- heuristic/rollout disagreements are reported as policy sensitivity.

## WP-15 — Define valid deck, policy, and matchup populations

**Purpose:** make balance claims match a declared population rather than a few order-dependent auto decks.

- **Primary findings:** PLAY-05, PLAY-07, BOT-10, EXP-01, EXP-04, EXP-05, EXP-06, EXP-07, EXP-08, EXP-09, EXP-10.
- **Primary role:** Simulation owner; Bot owner; Quantitative owner.
- **Dependencies:** WP-13, WP-14.

### Deliverables

1. Define separate claim tiers:
   - fixed deck-vs-deck under fixed policies;
   - archetype panel under declared deck/policy distributions;
   - faction card-pool robustness;
   - human/metagame claim, allowed only with human/external evidence.
2. For every study, lock a manifest specifying all EXP-01 dimensions.
3. Build an authoritative deck registry:
   - exact contents and stable IDs;
   - legality validation;
   - faction/archetype label and construction provenance;
   - no silent fallback.
4. Replace first-match auto construction with:
   - seeded stratified legal sampling;
   - archetype templates;
   - optimization/search with held-out evaluation;
   - data-order permutation checks.
5. Treat absent Crimson/Amethyst explicitly:
   - do not call four-faction results full-game balance;
   - add those factions only when legal pool/deck and semantic coverage exist.
6. Create blocked seat-swapped seed schedules and record the common-random-number policy.
7. Define gameplay cap outcomes separately from infrastructure failures.
8. Define leader/comeback metrics before observation and retain component time series.
9. Include multiple policy strengths and policy pairings as an experimental factor.

### Acceptance

- every report states its claim tier and refuses broader language;
- every deck is legal, exact, hashed, and reconstructible;
- changing card JSON order does not change a seeded sampled panel;
- fixed matchup blocks preserve deck, policy, seed, and seat pairing;
- four-faction reports carry an explicit limited-scope label;
- no infrastructure failure enters gameplay endpoint estimates.

## WP-16 — Replace invalid headline statistics

**Purpose:** make uncertainty and alerts respect exposure, coupling, clustering, selection, and practical relevance.

- **Primary findings:** MATH-01 through MATH-10, EXP-12, EXP-13, EXP-14.
- **Critical summaries:** C-09.
- **Primary role:** Quantitative owner.
- **Dependencies:** WP-13, WP-15.

### Deliverables by finding

| Problem | Replacement |
|---|---|
| Unequal-exposure G-test | Model wins with trials/exposure and schedule; for simple tables use a valid contingency/logistic test, not raw win-count uniformity |
| Faction-rate bootstrap | Resample declared experimental clusters such as deck-pair × policy × seed/seat blocks; never resample four point estimates |
| Independent null binomials | Use schedule-preserving permutation/parametric simulation that produces one coupled winner/loser outcome per game |
| Worst-offender overlapping z-test | Estimate all contrasts from one simultaneous model; predeclare contrasts and apply Holm/FWER or BH/FDR as appropriate |
| Missing hierarchy | Persist and model ruleset, policy pair, deck pair, matchup, seed pair, seat, and game identifiers |
| Unstable normal tails | Use a numerically stable survival function/log-tail implementation with high-absolute-z fixtures |
| Approximate t interval | Use validated Student-t quantiles for all finite degrees of freedom or clearly label an asymptotic interval |
| Weak domains | Reject invalid trials/wins/confidence/non-finite values with typed errors |
| Heuristic “power ranges” | Rename as design-score scenario bands; separate from confidence/credible intervals; validate against held-out outcomes before predictive claims |
| Significance overclaim | Introduce a claim ladder and require semantic/experimental validity gates before statistical interpretation |

Additional deliverables:

1. Predeclare primary estimand(s), minimally important effect, acceptable matchup envelope, target power, sample-size logic, and stopping rule.
2. Report effect estimates and practical intervals before p-values.
3. Keep fixed-deck results distinct from population-over-decks results.
4. Add synthetic-data validation:
   - calibrated null false-positive rate;
   - known injected effects recovered;
   - unequal exposures;
   - strong matchup/seat/deck clustering;
   - panel reordering;
   - missing/failed games;
   - multiplicity families.
5. Independently reproduce representative results with a trusted statistical package or reviewed reference calculation.
6. Remove/deprecate old headline fields so downstream HTML/ledger tools cannot silently display invalid values.

### Acceptance

- every statistic names its observation unit, cluster, estimand, and interval method;
- null calibration and coverage meet predeclared tolerances on synthetic fixtures;
- unequal exposure does not create false faction imbalance;
- schedule-preserving null results retain one winner/loser relation per decided game;
- worst-offender reporting uses adjusted simultaneous inference;
- invalid inputs fail;
- large-tail and small-df reference values match trusted calculations;
- output cannot call static valuation bands confidence intervals;
- balance conclusions are blocked when engine/harness validity gates fail.

## WP-17 — Establish the verification hierarchy

**Purpose:** prove semantics and invariants at the boundaries that the current suite misses.

- **Primary findings:** TEST-01 through TEST-10; this package supplies closure evidence for every other finding.
- **Primary role:** Verification owner.
- **Dependencies:** spans all packages.

### Verification layers

1. **Schema tests:** manifests, cards, decks, actions, interactions, events, replays.
2. **Semantic unit tests:** each effect/status/cost/target/duration.
3. **Authoritative contract tests:** every action’s accept/reject matrix.
4. **State-machine integration tests:** full phase, choice, response, stack, trigger, and turn paths.
5. **Invariant/property tests:** randomized legal traces and adversarial direct submissions.
6. **Rulebook scenario oracle:** manually reviewed input/expected outcome fixtures independent of production implementation.
7. **Every-card generated corpus:** every ability/mode/cardinality/trigger path.
8. **Differential tests:** compare engine output with the rulebook scenario oracle and, where feasible, an independent minimal resolver.
9. **Full replay tests:** isolated/batch/process-history determinism and hash verification.
10. **Policy tests:** legal-surface reachability and tactical calibration.
11. **Statistical tests:** synthetic calibration and reference-package agreement.
12. **Ratification panels:** only after layers 1–11 pass.

### Required invariant suite

- every accepted action is legal; every rejected action is mutation-free;
- every offered action executes or yields a documented pending interaction;
- each card instance is in exactly one zone; no duplicate instance IDs;
- every living battlefield card has HP > 0 after stabilization;
- every attachment has one valid owned target and reverse mapping;
- per-turn values reset exactly once;
- replacement/status/duration usage changes only at its declared boundary;
- all target/choice selections are legal, unique, and cardinality-valid;
- empty draw attempts always produce deckout;
- resolving a complete priority chain leaves no orphan stack item;
- every trigger observes correct LKI and fires correct multiplicity;
- active player, owner, controller, source, and Hero/player IDs stay coherent;
- same clean build + complete manifest + seed yields the same complete trace;
- artifact hashes change when any decisive semantic input changes.

### CI gates

1. Remove `dangerouslyIgnoreUnhandledErrors`; if a narrow worker workaround remains necessary, wrap only the known condition and fail on all other unhandled errors.
2. Establish branch/function/line thresholds only after collecting a baseline; raise gates for changed semantic modules and require explicit reviewed exceptions.
3. Test the canonical manifest plus:
   - all supported legacy manifests;
   - pairwise covering array of compatible switches;
   - every rejected incompatible combination.
4. Quarantine no semantic test. A flaky deterministic test is a release blocker.
5. Save machine-readable gate evidence keyed to finding IDs.

### Acceptance

- all 11 review probes are retained as tests and pass with corrected outcomes;
- fault-injection fixtures prove every terminal/error class fails correctly;
- mutation/property runs meet a predeclared action/state coverage budget;
- rule scenarios are approved by the Rules owner, not generated from production code;
- coverage exceptions have owner and expiry;
- CI has zero ignored unhandled errors;
- the finding ledger can be generated from test/evidence metadata.

## WP-18 — Refactor documentation, module boundaries, and performance safely

**Purpose:** reduce semantic concentration and prevent corrected behavior from becoming unauditable or too costly at simulation scale.

- **Primary findings:** ARCH-04, OPS-05, OPS-08, OPS-09.
- **Primary role:** Engine owner; Release owner.
- **Dependencies:** spans M0–M6; semantic refactors follow tests.

### Deliverables

1. Split monolithic modules along the transition lifecycle, not arbitrary line counts:
   - action canonicalization/validation/declaration/resolution;
   - choice protocol;
   - turn boundary;
   - event envelope/trigger matching/ordering/dispatch;
   - state-based stabilization;
   - stack transactions;
   - simulator setup/run/observe/artifact.
2. Keep a thin public facade with explicit supported APIs.
3. Update `architecture.md`, `dsl-spec.md`, `card-effect-system.md`, `game-rules-summary.md`, and the roadmap to the ratified implementation.
4. Replace compatibility-first comments in current paths with invariant/rule citations. Move historical behavior explanation to legacy adapters and migration notes.
5. Add architecture decision records for:
   - authoritative validation;
   - choice continuation;
   - event/LKI model;
   - simultaneous state-based processing;
   - stack transaction model;
   - current-rules/legacy manifest policy;
   - replay/provenance format;
   - statistical estimand/model.
6. Benchmark aura recomputation, dispatch, rollout steps, trace memory, and large panels before and after refactors.
7. Optimize only behind semantic differential tests; performance work must retain event and replay meaning.

### Acceptance

- no current doc remains a stub or describes v1 as current;
- public API and invariants are documented next to their owners;
- module dependency checks prevent simulator/bot adapters from becoming semantic authorities;
- benchmark budgets and regression thresholds are recorded;
- performance optimizations pass trace-equivalence tests.

## WP-19 — Ratify current rules and restart balance evidence

**Purpose:** prove the whole system from a clean checkout and publish only evidence valid for the declared claim.

- **Primary findings:** all findings through their package gates; especially C-09 and C-10.
- **Primary role:** Release owner; Verification owner; Rules owner; Quantitative owner.
- **Dependencies:** WP-00 through WP-18.

### Deliverables

1. Cut a candidate current-rules manifest with no unratified semantic flags.
2. Run the complete §12 rulebook-faithfulness gate.
3. Run every-card, invariant/property, replay, policy, and synthetic-statistics gates.
4. Rebuild all artifacts from a clean commit; no dirty or untracked semantic input.
5. Ratify a limited diagnostic panel first. Audit every non-win result and replay a stratified trace sample.
6. Ratify the declared balance panel only after diagnostic evidence is clean.
7. Publish:
   - exact claim tier and limitations;
   - complete manifest and hashes;
   - decks, policies, seeds, endpoints, failures;
   - estimates/intervals/multiplicity method;
   - policy and deck sensitivity;
   - signed gate evidence and finding-closure ledger.
8. Archive old v1/v2/v3 results under explicit legacy labels and prevent current dashboards from mixing them.

### Acceptance

- every gate in §12 passes from a clean checkout;
- the 167-row traceability audit has no unmapped, untested, waived-without-owner, or reopened finding;
- all artifacts replay and match hashes;
- no correctness behavior depends on an off-by-default flag;
- report wording is limited to the declared deck/policy/faction population;
- a release rollback restores the prior executable/artifact set without relabeling it as current.

## 7. Critical-summary closure map

The C-series findings summarize overlapping category findings. They close only when every listed package passes; closing one representative defect is insufficient.

| Critical summary | Required packages | Decisive evidence |
|---|---|---|
| C-01 — Direct legality bypass | WP-01, WP-02, WP-11, WP-17 | adversarial all-action matrix returns typed rejection/no mutation; all enumerated actions execute |
| C-02 — `choose_one` no-op | WP-03, WP-12, WP-14, WP-17 | both current modal cards execute every branch through engine and policies |
| C-03 — Turn triggers not dispatched | WP-04, WP-05, WP-12, WP-17 | full turn-loop rule scenarios fire start/end triggers in ratified order |
| C-04 — Per-turn counters do not reset | WP-04, WP-08, WP-17 | multi-turn counter/replacement tests prove one reset per scope |
| C-05 — Hand-size choice stall | WP-03, WP-13, WP-17 | no workaround flag; default and rollout policies resolve visible discard interactions |
| C-06 — “All” targets sequentially | WP-06, WP-09, WP-10, WP-17 | untargeted snapshot batch tests survive storage-order permutations |
| C-07 — Effect draw suppresses deckout | WP-06, WP-12, WP-17 | every draw source shares failed-attempt deckout scenarios |
| C-08 — Trigger identity/granularity | WP-05, WP-06, WP-17 | LKI, two-event multiplicity, recursive Last Breath, ordering, and guard tests pass |
| C-09 — Invalid headline statistics | WP-13, WP-15, WP-16, WP-17 | cluster/schedule-preserving synthetic calibration and independent reference agreement |
| C-10 — Unratified ruleset v3 | WP-00, WP-13, WP-18, WP-19 | clean tracked current manifest is universal, immutable, hashed, and ratified |
| C-11 — Missing state-based deaths | WP-06, WP-10, WP-17 | randomized and directed invariants find no living nonpositive-HP cards |
| C-12 — Nonfaithful response timing | WP-07, WP-11, WP-17 | declaration/counter/rollback rule scenarios prove transaction semantics |

## 8. Finding-by-finding traceability ledger

### How to use this ledger

Each finding has one primary package even when several packages contribute. Closure requires the listed proof to be retained in machine-readable evidence. Status begins as `planned`; implementation should move through:

```text
planned → test-red → implemented → evidence-green → rules/quant review → closed
```

`closed` is invalid if the finding’s source scenario is deleted, weakened, hidden behind a non-current flag, or passed only by a legacy manifest. A waived item remains open and cannot be used to ratify current rules unless the Rules owner records that the source review interpretation was wrong.

### 8.1 Math quality

| Finding | Primary package | Required remediation | Closure evidence |
|---|---|---|---|
| MATH-01 | WP-16 | replace raw-win uniformity with exposure/schedule-aware inference | unequal-exposure null fixture remains calibrated |
| MATH-02 | WP-16 | bootstrap game or declared cluster units | CI width/coverage responds correctly to games and clusters |
| MATH-03 | WP-16 | preserve winner/loser and schedule coupling in null generation | every simulated decided game contributes one win and one loss |
| MATH-04 | WP-16 | use one simultaneous contrast model with correction | selected-worst alert meets predeclared family error rate |
| MATH-05 | WP-13/WP-16 | persist hierarchy IDs and cluster by deck/matchup/seed pair | estimates change appropriately under replicated clusters |
| MATH-06 | WP-16 | implement stable normal survival/log-tail math | extreme-z values match trusted high-precision references and stay positive |
| MATH-07 | WP-16 | use validated Student-t critical values for finite df | small/threshold-df fixtures match reference package |
| MATH-08 | WP-16 | add strict typed domain validation | negative, impossible, non-finite, and bad-confidence inputs reject |
| MATH-09 | WP-16 | relabel static scores as heuristic scenario bands and validate separately | output/schema/docs contain no inferential interval claim |
| MATH-10 | WP-16/WP-19 | gate statistical claims on semantic and experimental validity | invalid-engine fixture suppresses balance conclusion |

### 8.2 Rule adherence

| Finding | Primary package | Required remediation | Closure evidence |
|---|---|---|---|
| RULE-01 | WP-01/WP-02 | enforce full rulebook legality at execution | direct illegal-action matrix rejects without mutation |
| RULE-02 | WP-02/WP-14 | offer ordinary Strategy activation plus explicitly timed Action/response abilities | action reachability and policy-selection scenarios |
| RULE-03 | WP-02/WP-11 | enumerate and execute remove/transfer equipment | positive/negative engine and bot scenarios |
| RULE-04 | WP-06 | centralize all draw attempts and deckout | source-parametrized empty/partial-deck tests |
| RULE-05 | WP-06 | make “All” untargeted and simultaneous | Hexproof plus order-permutation scenarios |
| RULE-06 | WP-08 | replace lower Persistent/Regeneration rather than stack | lower/equal/higher value matrix |
| RULE-07 | WP-08 | use one Stun duration clock | multi-upkeep duration table |
| RULE-08 | WP-08 | represent combat/instant duration faithfully | combat-end and non-persistence scenarios |
| RULE-09 | WP-11 | enforce same-turn Ultimate lockout at execution | direct fabricated Ultimate rejection after transform |
| RULE-10 | WP-04/WP-05 | dispatch start/end events through trigger pipeline | actual state-machine turn scenarios |
| RULE-11 | WP-05 | surface within-owner trigger-order choice | two legal orders produce expected distinct results |
| RULE-12 | WP-11 | distinguish voluntary removal from destruction | destruction watcher stays silent on remove/replace |
| RULE-13 | WP-07 | emit cast at ratified declaration timing | countered-spell cast trigger scenario |
| RULE-14 | WP-00 | make current rule semantics unconditional/default | entry-point manifest equivalence tests |

### 8.3 Play quality

| Finding | Primary package | Required remediation | Closure evidence |
|---|---|---|---|
| PLAY-01 | WP-03/WP-14 | surface optional/modal decisions and remove core auto-first | mode/cardinality policy fixtures |
| PLAY-02 | WP-02/WP-14 | expose every legal action class and X value | coverage instrumentation observes every class |
| PLAY-03 | WP-14 | evaluate all responseable threats | attack/equipment/move/ability/spell reaction suite |
| PLAY-04 | WP-03/WP-14 | make choices utility-based and order-independent | data-order permutation and utility inversion tests |
| PLAY-05 | WP-15 | diversify legal decks/archetypes and scope faction claims | seeded stratified panel manifest |
| PLAY-06 | WP-13 | split gameplay caps from harness failures | terminal-reason fault-injection suite |
| PLAY-07 | WP-14/WP-15 | report and calibrate policy disagreement | puzzle agreement/regret plus policy-sensitivity intervals |
| PLAY-08 | WP-01/WP-13 | separate rejected/failed attempts from resolved actions | lifecycle telemetry assertions |

### 8.4 Fidelity

| Finding | Primary package | Required remediation | Closure evidence |
|---|---|---|---|
| FID-01 | WP-03/WP-04/WP-05/WP-12 | exercise actual printed choices/triggers/counters | every-card scenarios cause intended state/event change |
| FID-02 | WP-12 | encode or register printed fallback clauses | text/DSL exception audit and Biotech fallback scenario |
| FID-03 | WP-09/WP-12 | align Bio-Construct identity/tags and all references | nonempty reachable tag population validation |
| FID-04 | WP-10 | constrain dynamic modifier stat axes | Synthetic Evolution ATK/HP-only test |
| FID-05 | WP-09 | centralize effective-trait lookup | cross-subsystem granted-trait matrix |
| FID-06 | WP-09 | separate player, instance, definition, and ability IDs | same-Hero mirror round-trip test |
| FID-07 | WP-09 | resolve `side: any` across both controllers | friendly/enemy Hero target scenarios |
| FID-08 | WP-09 | add durable exile representation | zone conservation and exile audit tests |
| FID-09 | WP-12 | make hydration lossless/fail-closed | round-trip schema and corrupted-fixture rejection |
| FID-10 | WP-00/WP-13 | distinguish repeatability from semantic ratification | hashes plus rule-scenario gate in artifact status |

### 8.5 Architecture and state integrity

| Finding | Primary package | Required remediation | Closure evidence |
|---|---|---|---|
| ARCH-01 | WP-01 | establish one transition/validation boundary | public API inventory and caller migration tests |
| ARCH-02 | WP-03 | store one authoritative observable interaction | no machine-only choice; default runner resolves hand limit |
| ARCH-03 | WP-05 | remove module-global semantic ID counters | process-history determinism test |
| ARCH-04 | WP-18 | split modules along semantic lifecycle boundaries | dependency/API review and unchanged trace tests |
| ARCH-05 | WP-00 | replace arbitrary boolean semantics with validated manifests | incompatible combination rejection and canonical export |
| ARCH-06 | WP-10 | make derived aura state explicit/invariant-driven | order and usage-state recompute tests |
| ARCH-07 | WP-01 | return typed resolved/pending/rejected/failed results | exhaustive result-handling type and integration tests |

### 8.6 Action legality and API safety

| Finding | Primary package | Required remediation | Closure evidence |
|---|---|---|---|
| LEGAL-01 | WP-01 | validate action against authoritative state/rules/window | fabricated nonmember actions reject |
| LEGAL-02 | WP-02 | enforce Character type, phase, zone, and Elite gate | Spell/upkeep/High-Ground probes reject |
| LEGAL-03 | WP-02 | enforce Spell type and timing | Character-as-spell and wrong-phase probes reject |
| LEGAL-04 | WP-02/WP-11 | enforce equipment type/controller/target ownership | enemy/permanent/mapping adversarial tests |
| LEGAL-05 | WP-02 | enforce controller/readiness/exhaustion/move/adjacency | exhaustive movement predicate matrix |
| LEGAL-06 | WP-02 | use stable ability ID and validate kind/timing/use | bad index/Aura/cooldown/summoning probes reject |
| LEGAL-07 | WP-02/WP-11 | enforce discard-for-energy timing/use/zone/exile | phase, twice-per-turn, stale-card tests |
| LEGAL-08 | WP-02/WP-11 | enforce transform eligibility at executor | fabricated transform matrix |
| LEGAL-09 | WP-03 | validate hand-size count/unique/member/owner | malformed response property tests |
| LEGAL-10 | WP-01/WP-02 | bind reactive action to current offered window | stale/forged window/source/target tests |
| LEGAL-11 | WP-01/WP-13 | replace silent fizzle with typed lifecycle outcome | simulator never counts rejection as resolution |

### 8.7 DSL and effect semantics

| Finding | Primary package | Required remediation | Closure evidence |
|---|---|---|---|
| DSL-01 | WP-03 | consume modal selection and execute branch | current choose-one card branch scenarios |
| DSL-02 | WP-03/WP-09 | revalidate injected selections against interaction/state | forged/stale target rejection tests |
| DSL-03 | WP-03 | key choices by effect path rather than shared array | two-independent-target ability fixture |
| DSL-04 | WP-03 | honor zero minimum | optional zero/one/max scenarios |
| DSL-05 | WP-06 | batch all-target effects from common snapshot | storage-order/dynamic/death scenarios |
| DSL-06 | WP-06 | stabilize deaths after stat transitions | negative-HP probe now destroys and triggers |
| DSL-07 | WP-06 | share draw-attempt deckout | effect/recycle/scheduled draw matrix |
| DSL-08 | WP-08 | map every duration to distinct lifecycle scope | duration compatibility and expiry table |
| DSL-09 | WP-12 | compare triggering cost with authored threshold/operand | operator truth-table and semantic lint |
| DSL-10 | WP-09 | use effective traits/tags in conditions/counts | granted-state query tests |
| DSL-11 | WP-09/WP-12 | encode and validate token full-zone fallback | fallback scenario and missing-branch lint |
| DSL-12 | WP-01 | restrict low-level execution to trusted composition | export/API check and unsafe caller migration |

### 8.8 Timing, priority, stack, and triggers

| Finding | Primary package | Required remediation | Closure evidence |
|---|---|---|---|
| TIME-01 | WP-04 | dispatch turn events rather than log directly | full state-machine trigger test |
| TIME-02 | WP-07 | commit attack declaration state at ratified time | response observation and countered-attack tests |
| TIME-03 | WP-07/WP-11 | defer equipment mutation until resolution | counter leaves attachment state coherent |
| TIME-04 | WP-07 | stack board reactions | counter/Flash/React response-chain test |
| TIME-05 | WP-07 | distinguish cast declaration from resolution | countered-cast event lifecycle test |
| TIME-06 | WP-05 | carry event-card LKI into matching | filtered destroyed/spell identity tests |
| TIME-07 | WP-05 | scope dedupe per trigger/event | two-events-two-firings test |
| TIME-08 | WP-05 | preserve snapshots recursively | trigger-caused Last Breath scenario |
| TIME-09 | WP-05 | add player-owned ordering interaction | APNAP plus within-owner order matrix |
| TIME-10 | WP-05/WP-13 | turn caps into typed failure with pending work | guard fault-injection and artifact failure |
| TIME-11 | WP-04/WP-08/WP-10 | use scoped usage state stable across recompute | normal/aura replacement reset matrix |
| TIME-12 | WP-06/WP-08 | route status damage through shared pipeline | persistent vs direct damage equivalence tests |

### 8.9 Combat, zones, traits, and statuses

| Finding | Primary package | Required remediation | Closure evidence |
|---|---|---|---|
| COMBAT-01 | WP-06 | share state-based/damage semantics beyond combat | combat/effect/status equivalence scenarios |
| COMBAT-02 | WP-08/WP-00 | make correct ARM behavior canonical | current manifest test plus first-instance scenarios |
| COMBAT-03 | WP-09 | use one effective-trait selector | combat/filter/count/trigger consistency table |
| COMBAT-04 | WP-08 | implement status value replacement | lower/equal/higher matrix |
| COMBAT-05 | WP-08 | remove Stun double consumption | owner-upkeep duration property test |
| COMBAT-06 | WP-06 | run state-based destruction after HP reduction | non-damage negative-HP scenario |
| COMBAT-07 | WP-06/WP-10 | stabilize after aura loss | aura source removal death/trigger scenario |
| COMBAT-08 | WP-10 | snapshot/fixed-point dynamic aura evaluation | registry/data-order permutations |
| COMBAT-09 | WP-06 | exclude target protection from “All” membership | Hexproof/Stealth all-effect tests |
| COMBAT-10 | WP-01/WP-02 | share movement/attack legality predicates | enumerate/execute symmetry property |

### 8.10 Resources, costs, equipment, and transformation

| Finding | Primary package | Required remediation | Closure evidence |
|---|---|---|---|
| ECON-01 | WP-11 | preserve typed X resource kind end to end | Mana/Energy/flexible X payment matrix |
| ECON-02 | WP-11/WP-14 | enumerate/evaluate all legal X candidates | affordability boundary and utility tests |
| ECON-03 | WP-11/WP-12 | require explicit resource type | name-change/unknown-type rejection |
| ECON-04 | WP-11 | ratify and implement flexible resource-card payment | payment truth table |
| ECON-05 | WP-00/WP-08/WP-11 | make cost floor/current rules unconditional | zero-cost and manifest tests |
| ECON-06 | WP-07/WP-11 | make equipment resolution transactional | countered-equipment state/ledger test |
| ECON-07 | WP-02/WP-11 | enforce ownership/type/attachment invariants | enemy and malformed mapping tests |
| ECON-08 | WP-11 | share reduction usage across play/transfer | first-per-turn transfer matrix |
| ECON-09 | WP-11 | emit detach/discard rather than destruction | destroyed-trigger negative test |
| ECON-10 | WP-02/WP-11 | validate transformation at execution | all failed eligibility predicates |
| ECON-11 | WP-11 | type Ultimate and store transform-turn lock | same-turn direct activation rejection |
| ECON-12 | WP-11/WP-13 | report real transform state/LP deltas | telemetry fixture with nonzero/zero deltas |

### 8.11 Randomness, determinism, replay, and reproducibility

| Finding | Primary package | Required remediation | Closure evidence |
|---|---|---|---|
| REPRO-01 | WP-13 | derive stable per-matchup replicate streams | panel reorder/addition equivalence |
| REPRO-02 | WP-13 | separate summary/manifest/full-trace hashes | action/event mutation changes trace hash |
| REPRO-03 | WP-05 | eliminate process-global semantic counters | isolated/batch process-history test |
| REPRO-04 | WP-13 | move diagnostics to immutable observer | observer-on/off behavioral trace equivalence |
| REPRO-05 | WP-01/WP-13 | make caught failures typed terminal results | injected exception cannot yield ordinary result |
| REPRO-06 | WP-00/WP-13 | use one complete current manifest in all scripts | entry-point effective-hash audit |
| REPRO-07 | WP-00/WP-19 | track and ratify semantic manifests | clean checkout reconstruction |

### 8.12 Bot and decision quality

| Finding | Primary package | Required remediation | Closure evidence |
|---|---|---|---|
| BOT-01 | WP-02/WP-14 | offer and evaluate action-phase abilities | reachability/choice tests |
| BOT-02 | WP-02/WP-14 | offer and evaluate equipment remove/transfer | tactical equipment scenarios |
| BOT-03 | WP-11/WP-14 | search all legal X and marginal utility | known-optimal X puzzles |
| BOT-04 | WP-14 | make current rollout enumeration complete | current-vs-legacy candidate inventory |
| BOT-05 | WP-14 | score all responseable threat kinds | cross-action reaction suite |
| BOT-06 | WP-03/WP-14 | choose modes/targets strategically | utility and order-permutation tests |
| BOT-07 | WP-14/WP-19 | rebuild calibration only on ratified semantics | engine gate embedded in policy artifact |
| BOT-08 | WP-14 | define uniform-legal random baseline | frequency test on controlled action sets |
| BOT-09 | WP-14 | stable semantic tie-breaking | shuffled-card/action equivalence |
| BOT-10 | WP-14/WP-15 | calibrate against an independently expert-labeled corpus; require human logs for human-skill claims | per-family agreement/regret, policy ladder, and claim-scope gate |

### 8.13 Experimental design and balance inference

| Finding | Primary package | Required remediation | Closure evidence |
|---|---|---|---|
| EXP-01 | WP-00/WP-15 | require one complete study manifest | schema rejects omitted rules/data/deck/policy/seed/build fields |
| EXP-02 | WP-00/WP-13 | migrate scripts to canonical current rules | script inventory reports one current hash |
| EXP-03 | WP-19 | ratify current semantics before balance | clean M6 evidence bundle |
| EXP-04 | WP-15 | scope four-faction evidence; add factions only when valid | report-language gate and population manifest |
| EXP-05 | WP-15 | sample/optimize diverse decks independent of data order | seed/order invariance plus archetype coverage |
| EXP-06 | WP-13/WP-15 | fail unknown deck requests | no-fallback integration test |
| EXP-07 | WP-13/WP-15 | validate every explicit deck | illegal deck blocks run |
| EXP-08 | WP-13/WP-15/WP-16 | block by matchup/seed/seat and preserve pairing | schedule audit and paired estimator fixture |
| EXP-09 | WP-13 | use typed terminal endpoints | denominators exclude infrastructure failures |
| EXP-10 | WP-13/WP-15 | predefine multicomponent leader/comeback model | recomputable time-series fixture |
| EXP-11 | WP-01/WP-13 | separate action attempt/lifecycle states | declared/resolved/countered/rejected counts reconcile |
| EXP-12 | WP-16 | predeclare comparison families and correction | synthetic multiplicity calibration |
| EXP-13 | WP-16 | define practical thresholds and power | study manifest plus decision table |
| EXP-14 | WP-00/WP-16/WP-19 | block sample-size claims on invalid model | validity gate precedes inference |

### 8.14 Card data integrity and validation

| Finding | Primary package | Required remediation | Closure evidence |
|---|---|---|---|
| DATA-01 | WP-12 | extend structural checks to executable semantics | every validation family has failing fixture |
| DATA-02 | WP-03/WP-12 | execute and validate every choose-one branch | generated modal scenario coverage |
| DATA-03 | WP-09/WP-12 | detect empty referenced tag/token populations | Bio-Construct and corrupted reference tests |
| DATA-04 | WP-12 | compare normalized text hints/exception register with DSL | fallback/cardinality/duration audit |
| DATA-05 | WP-08/WP-12 | reject unsupported/degraded durations | compatibility matrix fixtures |
| DATA-06 | WP-09/WP-12 | statically/dynamically check target reachability | `any`, tag, zone, and empty-population tests |
| DATA-07 | WP-12 | detect tautological/impossible conditions | `triggering_card_cost` operator fixtures |
| DATA-08 | WP-12 | enforce IDs, ranges, cardinalities, references, combinations | property and corrupted-pool tests |
| DATA-09 | WP-12 | reject null DSL during hydration | exact card/path load failure |
| DATA-10 | WP-12/WP-19 | make semantic errors fatal to certification | runner refuses report-only-invalid pool |

### 8.15 Testing and reliability engineering

| Finding | Primary package | Required remediation | Closure evidence |
|---|---|---|---|
| TEST-01 | WP-17 | add executor rejection and mutation-free tests | all-action adversarial matrix |
| TEST-02 | WP-17/WP-04 | test triggers through real turn loop | start/end integration scenarios |
| TEST-03 | WP-00/WP-17 | separate legacy pins from correctness oracles | current suite never expects known-wrong behavior |
| TEST-04 | WP-13/WP-17 | combine hashes with semantic scenarios/full trace | deliberate semantic mutation detected |
| TEST-05 | WP-12/WP-17 | generate every-card/mode scenario corpus | coverage manifest has no omissions |
| TEST-06 | WP-17 | run systematic state/action properties | invariant campaign meets run/coverage budget |
| TEST-07 | WP-17 | create independently reviewed rule oracle | differential scenarios agree |
| TEST-08 | WP-17 | fail on unhandled errors | no ignore flag; injected unhandled rejection fails CI |
| TEST-09 | WP-17 | enforce coverage thresholds and changed-code gates | CI report and owned exceptions |
| TEST-10 | WP-00/WP-17 | constrain configs and test compatible combinations | pairwise covering array plus invalid-combo tests |

### 8.16 Configuration, observability, documentation, and maintainability

| Finding | Primary package | Required remediation | Closure evidence |
|---|---|---|---|
| OPS-01 | WP-00 | make correctness current/default | generic setup equals canonical manifest |
| OPS-02 | WP-00 | export one immutable current-rules constructor | import/entry-point contract tests |
| OPS-03 | WP-00/WP-13 | enrich manifests with revision/hashes/constraints/evidence | schema and artifact inspection |
| OPS-04 | WP-00/WP-13 | migrate every balance/sim script | automated script/config inventory |
| OPS-05 | WP-18 | update architecture/DSL/rules/roadmap docs | doc link/content/version checks |
| OPS-06 | WP-01/WP-13 | implement typed rejection/failure/terminal taxonomy | fault-injection summary |
| OPS-07 | WP-13 | embed decisive provenance and trace hashes | clean replay reconstruction |
| OPS-08 | WP-18 | document invariants in current paths, history in legacy paths | code/doc review checklist |
| OPS-09 | WP-10/WP-18 | benchmark/optimize recompute, dispatch, and logs safely | performance budgets plus trace equivalence |
| OPS-10 | WP-00/WP-13/WP-19 | invalidate stale artifacts on hash changes | stale-status integration test |

## 9. Implementation slices

Work should be merged in reviewable vertical slices. Do not keep an XL package on one long-lived branch.

| Slice | Contents | Must be green before next slice |
|---|---|---|
| S0 | evidence bundle, decision register, finding ledger, artifact labels | current baseline reproducible; no balance-certifying label |
| S1 | manifest schema and canonical current constructor | all entry points print same effective hash |
| S2 | typed transition result and no-mutation rejection shell | existing legal behavior plus representative illegal probes |
| S3 | per-action validators and enumeration migration | complete direct-action matrix |
| S4 | unified pending interaction and hand discard | default/rollout no longer require stall workaround |
| S5 | modal/optional/per-effect choice continuation | every choice shape and current modal cards |
| S6 | turn-boundary orchestrator and scope reset | multi-turn counter/replacement and turn-trigger scenarios |
| S7 | event envelope, LKI, trigger multiplicity/recursion/order | all C-08 probes and ordering interactions |
| S8 | state-based loop, simultaneous all-effects, centralized draw | C-06/C-07/C-11 plus invariant tests |
| S9 | stack transaction and cast/equipment/attack lifecycle | response/counter chains |
| S10 | duration/status/damage pipeline | Stun, Persistent, Regeneration, replacement fixtures |
| S11 | identity/effective traits/exile/token fallback | cross-subsystem identity/trait and zone conservation |
| S12 | aura model and performance baseline | order independence and recompute stability |
| S13 | typed costs/X/resources/equipment/transform | full economic contract matrix |
| S14 | strict hydration and semantic validator | corrupted fixtures fail closed |
| S15 | every-card generated corpus | no card/ability/mode omissions |
| S16 | typed simulator outcomes, stable seeds, replay/provenance | fault injection and clean replay |
| S17 | complete bot action/choice/reaction policy | reachability and calibration suite |
| S18 | deck/policy population manifests | legal, diverse, order-independent panels |
| S19 | replacement statistics | synthetic calibration/reference agreement |
| S20 | docs/refactor/performance closure | semantic trace equivalence |
| S21 | clean current-rules ratification | every §12 gate |

## 10. Migration and compatibility strategy

### 10.1 Rulesets

1. Freeze existing v1/v2/v3 files and their known outputs as `legacy-*`; do not mutate them in place.
2. Introduce `current-candidate` while semantic work is incomplete.
3. Promote it to `current` only in WP-19.
4. Require explicit `legacy-*` selection for historical replay.
5. Reject artifact comparisons across different semantic manifest hashes unless the tool is explicitly performing a cross-ruleset experiment.

### 10.2 Public engine API

1. Add the new transition result alongside a temporary adapter for internal callers.
2. Migrate state machine first, then enumerator/bot, simulator, trace tools, and tests.
3. Instrument adapter use and remove it when the repository has zero callers.
4. Do not let the adapter translate typed rejection back into silent unchanged state.
5. Mark low-level effect execution as internal; migrate direct test helpers to explicit trusted harnesses.

### 10.3 Serialized state and replay

1. Version `GameState`, pending interactions, event envelopes, stack items, and replay records.
2. Either provide a deterministic migration for saved fixtures or declare old mid-game snapshots legacy-only; do not deserialize them heuristically.
3. Store the schema version and manifest hash in every snapshot/replay.
4. Reject unknown/newer versions with a typed compatibility error.

### 10.4 Tests and hashes

1. Preserve old pins under a `legacy` test namespace until their artifact-retention period ends.
2. Add corrected semantic tests before changing current expectations.
3. Never update a hash without a decoded semantic diff and linked finding IDs.
4. Replace summary-only pins with full-trace or rule-scenario evidence where correctness is claimed.

### 10.5 Balance artifacts

1. Move existing HTML, ledgers, baselines, and frozen pools into a legacy namespace or add immutable legacy status metadata.
2. Make dashboards default to current-manifest-compatible artifacts only.
3. Invalidate “current” status automatically on engine, rules, card, deck, policy, or seed-schedule hash changes.
4. Require explicit acknowledgement to compare a candidate against a legacy baseline.

### 10.6 Rollback

A rollback restores a complete versioned set:

- engine build;
- current manifest;
- card pool;
- schema;
- bot configuration;
- artifact reader.

It must never mix a prior engine with a newer current manifest or keep a newer ratification label. Legacy reproduction remains available independently.

## 11. Risks and mitigations

| Risk | Likely failure mode | Mitigation | Detection |
|---|---|---|---|
| Rulebook ambiguity | implementation churn or two plausible oracles | WP-00 decision register before code; dual approval | open-decision count blocks affected slice |
| Transition rewrite breadth | widespread caller breakage | staged adapter and vertical slices | compile-time exhaustiveness plus caller inventory |
| Trigger/state-based recursion | loops or changed event order | causal IDs, bounded typed failure, reviewed scenarios | recursion/guard fault injection and trace diff |
| Simultaneous-effect complexity | accidental sequential semantics return | snapshot batch abstraction used by all effects | storage-order permutation properties |
| Current data fails strict validation | pressure to retain silent normalization | explicit owned exception register; fix data/DSL | certification loader fails closed |
| Legacy compatibility dominates design | wrong behavior remains current | current path has no legacy flags; archive adapters | manifest/API review |
| Performance regression | rollouts become impractical | baseline before semantic changes; optimize after correctness | budgets for action latency, memory, panel throughput |
| Bot discontinuity | balance shifts confused with card changes | version/hash policies and publish policy sensitivity | same-engine cross-policy panels |
| Statistical implementation error | new method looks sophisticated but miscalibrates | synthetic fixtures and independent reference implementation | null coverage/type-I/power checks |
| Dirty-tree provenance | results cannot be reconstructed | M0 patch hash; WP-19 clean checkout required | artifact provenance validation |
| Hidden script consumer | one tool stays on v1/default flags | automated entry-point/config inventory | CI searches and executes manifest audit |
| False finding closure | representative test misses full scope | 167-ID ledger and decisive evidence per row | closure audit refuses missing evidence |
| Over-broad claims | fixed-deck bot result called faction/human balance | claim tiers and report-language gate | artifact schema and publication review |
| Test oracle mirrors implementation | green suite preserves same misconception | rules-owner fixtures and differential oracle | provenance metadata for expected outcomes |

## 12. Acceptance gates

Gates are cumulative. A later gate cannot waive an earlier failure.

## G0 — Evidence and governance

**Pass conditions**

- all 167 findings and C-01–C-12 exist in the tracking ledger;
- baseline probes, test/build/lint/validator output, manifests, and decisive hashes are archived;
- every unresolved rule interpretation has an owner;
- current output is visibly diagnostic.

**Failure conditions**

- an untracked semantic manifest or card pool is used;
- a stale artifact is presented as current;
- an affected implementation slice starts with an unresolved rules decision.

## G1 — Manifest, schema, and data load

**Pass conditions**

- canonical current manifest is immutable, complete, schema-valid, and universal;
- incompatible/unknown settings reject;
- card/resource/deck hydration is lossless and fails closed;
- every referenced ID/tag/token exists and every schema range is valid.

**Evidence**

- manifest/card/deck validator reports;
- corrupted fixture suite;
- entry-point effective-hash inventory.

## G2 — Authoritative action contract

**Pass conditions**

- every action kind has a positive and full negative validation matrix;
- every enumerated action validates;
- every fabricated illegal/stale action rejects with no mutation or RNG use;
- typed result handling is exhaustive in all callers.

**Minimum campaign**

- all action types × all phases × both controllers;
- valid/invalid source zones, card kinds, ownership, costs, targets, use limits, and window IDs;
- at least 2,000 seeded adversarial generated submissions in CI, with a larger nightly run.

## G3 — Choice and continuation

**Pass conditions**

- one observable pending-interaction model;
- every choice supports its exact min/max/option semantics;
- per-effect targets are independent;
- hand-size, choose-one, target, trigger-order, and reserve choices work through the same API;
- no stall workaround or core auto-first resolution.

**Evidence**

- current modal-card scenarios;
- optional zero/min/max matrix;
- stale/forged response property tests;
- default and rollout end-phase completion.

## G4 — Turn, event, trigger, and scope integrity

**Pass conditions**

- turn/phase events traverse dispatch;
- counters and scoped effects reset exactly once;
- event LKI, trigger multiplicity, recursive snapshots, APNAP/owner ordering, and guard failure are correct;
- process history cannot change semantic IDs/traces.

**Evidence**

- multi-turn rulebook scenarios;
- all C-03/C-04/C-08 probes;
- isolated-versus-batch replay equality.

## G5 — State-based and effect semantics

**Pass conditions**

- no living battlefield card has nonpositive HP after stabilization;
- every draw source shares deckout;
- “All” is untargeted/snapshot-simultaneous;
- status/damage/replacement/duration semantics are unified;
- effective traits/identities/zones remain coherent.

**Minimum campaign**

- at least 10,000 seeded legal action sequences across diverse constructed states in nightly property runs;
- board/registry/data-order permutations;
- zone conservation and attachment invariants after every accepted transition.

## G6 — Timing, stack, economy, equipment, and transformation

**Pass conditions**

- declaration/cost/commitment/response/resolution timing matches ratified scenarios;
- every stack item reaches a typed disposition;
- board reactions are responseable;
- equipment counter/remove/transfer semantics are coherent;
- X/resource payment and reductions are typed;
- transformation and Ultimate lockout reject direct bypass.

**Evidence**

- mixed hand/board reaction chains;
- countered attack/spell/equipment scenarios;
- payment and transform truth tables.

## G7 — Every-card executable corpus

**Pass conditions**

- 100% of current card definitions, abilities, triggers, choose-one branches, target cardinalities, and fallbacks have scenario IDs;
- every scenario produces the intended state/events or an explicitly ratified no-op;
- no unowned semantic exception;
- semantic validator is fatal in build and certification.

**Evidence**

- generated coverage manifest with no missing rows;
- card-specific impact regression table;
- exact card/ability/effect path in failures.

## G8 — Harness, terminal reasons, replay, and provenance

**Pass conditions**

- every non-gameplay failure has a distinct result and fails certification;
- stable seed streams are panel-order independent;
- same clean inputs reproduce full traces across isolated and batch processes;
- artifacts contain all decisive hashes and exact decks/policies/seeds;
- zero unknown deck fallback.

**Minimum campaign**

- fault injection for every terminal/failure class;
- at least 100 stratified traces replayed across fresh processes;
- at least 10,000-game smoke panel with zero hidden engine/bot/choice/guard failures before balance work.

## G9 — Bot decision surface and calibration

**Pass conditions**

- targeted reachability covers every legal action, target, mode, cardinality, X, trigger order, and response kind;
- current rollout candidate generation is complete;
- uniform-legal random baseline is verified;
- decisions are invariant to JSON order except stable documented ties;
- policy disagreement/calibration is published by scenario family.

**Evidence**

- tactical puzzle suite;
- action-class reachability report;
- cross-policy ladder and sensitivity panel.

## G10 — Experimental and statistical validity

**Pass conditions**

- claim tier, estimand, cluster, deck/policy population, endpoint, practical threshold, multiplicity family, power/stopping rule, and seed/seat design are predeclared;
- synthetic null false-positive behavior and interval coverage meet predeclared Monte Carlo tolerances;
- injected effects are recovered with expected power;
- reference implementation agrees within numerical tolerance;
- old invalid summary fields cannot be emitted as current.

**Suggested initial calibration targets**

- for nominal 95% interval coverage, empirical coverage falls within a predeclared simulation tolerance such as 93%–97%;
- for nominal 5% family/test error, empirical rate stays within a predeclared Monte Carlo bound and never exceeds the approved ceiling;
- extreme-tail results remain finite/nonnegative and match reference calculations;
- results are stable under panel ordering and label-preserving data transformations.

The Quantitative owner must set final tolerances before looking at candidate balance results.

## G11 — Documentation, API, and performance

**Pass conditions**

- current architecture/DSL/rules/operations docs match implementation and manifests;
- public APIs and invariants are explicit;
- legacy behavior is isolated and labeled;
- semantic modules meet reviewed dependency boundaries;
- recomputation, dispatch, rollout, trace-memory, and panel-throughput budgets pass without trace changes.

## G12 — Clean ratification

**Pass conditions**

- G0–G11 pass from a clean tracked commit;
- build, lint, tests, semantic validator, card corpus, properties, replays, policy calibration, and statistical calibration all pass;
- every finding ledger row is `closed` with evidence;
- no correctness flag defaults off;
- no infrastructure failures are hidden in gameplay outcomes;
- candidate artifacts reconstruct from exact manifests and match hashes;
- Rules, Verification, Release, and Quantitative owners approve their domains.

Only after G12 may a new balance result be labeled decision-grade for its declared claim tier.

## 13. Tracking and review mechanics

### 13.1 Finding record

Each finding should have a machine-readable record with:

```yaml
id: DSL-01
source_review: docs/simulation-engine-deep-review-2026-07-26.md
critical_summaries: [C-02]
work_package: WP-03
status: planned
rules_decision: ADR-or-rulebook-anchor
implementation_changes: []
tests: []
invariants: []
evidence_artifacts: []
manifest_versions: []
owner: role-or-person
reviewers: []
closed_at: null
```

### 13.2 Change review checklist

- [ ] Finding IDs and critical summaries are listed.
- [ ] Rulebook/decision-register anchor is explicit.
- [ ] Test failed for the intended reason before the change.
- [ ] Positive, negative, integration, and invariant coverage is proportionate.
- [ ] Typed errors/events/telemetry remain meaningful.
- [ ] Current behavior is not hidden behind a default-off fix flag.
- [ ] Legacy behavior, if retained, is isolated and labeled.
- [ ] Card/data/schema/replay migration is addressed.
- [ ] Documentation and manifest effects are updated.
- [ ] Hash changes have a decoded semantic explanation.
- [ ] No unrelated card-balance change is included.
- [ ] Machine-readable finding evidence is updated.

### 13.3 Rules decision template

Every ambiguous decision should record:

- question and affected finding IDs;
- exact rulebook text/version;
- competing interpretations;
- selected observable semantics;
- declaration/resolution/event order;
- edge cases and examples;
- expected state/event trace;
- affected cards;
- approval and date;
- scenario IDs that enforce the decision.

### 13.4 Statistical analysis-plan template

Every decision-grade study should record before execution:

- claim tier and target population;
- primary/secondary estimands;
- exact current manifest and build/data/bot hashes;
- deck/archetype and policy sampling;
- matchup/seat/seed blocking;
- gameplay endpoint and exclusion/failure rules;
- clustering and inference model;
- interval and multiplicity method;
- minimally important effect and acceptable envelope;
- power/sample/stopping rule;
- sensitivity analyses;
- publication wording and forbidden overclaims.

### 13.5 Closure audit

The release pipeline should automatically:

1. parse the source review for all finding IDs;
2. parse the finding ledger/evidence records;
3. fail on missing, duplicate, unknown, or nonclosed IDs;
4. verify referenced tests and artifacts exist;
5. verify evidence hashes match the candidate commit/manifest;
6. verify each C-series closure map has all package gates;
7. render a human-readable closure report for approval.

## 14. Recommended starting sequence

The first implementation cycle should do only the following, in order:

1. Approve the stop-the-line labels and capture M0 evidence.
2. Resolve the rules decisions that block WP-01 through WP-08.
3. Add machine-readable finding records and turn the 11 focused probes into retained red tests.
4. Land the canonical manifest schema/constructor and migrate one representative entry point.
5. Land the typed transition result with deploy/cast rejection as the first vertical action slice.
6. Expand the shared validator across all actions before changing bots.
7. Unify pending interaction and remove the hand-size stall workaround.
8. Repair modal/optional/per-effect choices.
9. Land turn-boundary dispatch/reset, then trigger LKI/multiplicity/recursion.
10. Land state-based stabilization, draw/deckout, and simultaneous “All.”

At that point, rerun G0–G5 and reassess package estimates. Do not begin new balance ratification or statistical interpretation while those gates are red.

## 15. Final program outcome

This plan deliberately fixes semantic authority before improving play policy or statistical sophistication. The intended end state is not merely “all tests pass.” It is:

> Every game is a validated execution of one declared ruleset; every card and decision is reachable; every terminal result is truthful; every trace is reconstructible; and every balance claim is limited to an experiment whose dependence structure and uncertainty are valid.

That is the threshold at which Aetherion Simulator can move from a useful deterministic experiment to a rulebook-faithful and decision-grade simulation system.
