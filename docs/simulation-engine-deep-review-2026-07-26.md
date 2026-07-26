# Aetherion Simulator — Deep Engine Review

**Review date:** 2026-07-26
**Reviewed revision:** working tree based on commit `524d648`
**Scope:** simulation engine, game-state machine, effect DSL/interpreter, combat, triggers, cards, bots, simulation runner, statistics, validation, tests, and supporting documentation
**Mode:** review only; no engine or card implementation was changed

## Executive verdict

The engine has a promising, unusually well-tested foundation, but the current working tree is **not yet a rules-faithful or statistically trustworthy basis for balance certification**.

The strongest parts are its immutable-state style, centralized combat calculations, deterministic seeded simulation, broad unit-test suite, and substantial effort to encode rule fixes behind explicit configuration flags. Those are meaningful assets. The principal weakness is that the project currently has multiple partially overlapping definitions of legality and semantics:

1. the rulebook;
2. action enumeration;
3. direct action execution;
4. the state machine;
5. the effect interpreter;
6. simulator-specific adapters and defaults; and
7. versioned ruleset JSON files.

Those layers do not consistently agree. In particular:

- direct action execution trusts callers and permits actions that the enumerator correctly omits;
- several printed trigger timings are registered but never dispatched by the game loop;
- `choose_one` effects never execute their selected branch;
- card/effect choices are silently auto-resolved by taking the first option;
- “all” effects incorrectly respect targeted-protection traits and resolve sequentially rather than simultaneously;
- effect-driven deck exhaustion does not lose the game;
- per-turn counters and replacement-effect lifetimes are not actually per turn;
- the default simulator can stall on hand-size choices and record the result as a timeout;
- the intended `ruleset-v3` materially changes the game but is untracked, unratified, and not used by most balance workflows;
- the statistical summary applies tests and bootstraps to quantities that do not satisfy their assumptions.

The most serious implication is not merely that a few cards behave incorrectly. It is that the simulation can produce deterministic, reproducible, fully green results for a game different from the one described by the rulebook. Reproducibility is good, but it cannot compensate for semantic mismatch.

### Overall assessment

**4.1 / 10 — strong engineering substrate, currently low rules and balance-decision validity.**

This is an engineering-readiness score, not a product score. It reflects the current working tree and weights every requested review category equally. A score near 4 does **not** mean that 40% of the rules work; it means that valuable foundations coexist with several correctness failures at authoritative boundaries.

### Decision guidance

| Intended use | Assessment |
|---|---|
| Local engine experimentation | Suitable with careful knowledge of flags and known semantic gaps |
| Regression testing of currently encoded behavior | Generally suitable |
| Producing reproducible bot-vs-bot traces | Suitable, with timeout/error caveats |
| Measuring relative changes under the exact same encoded semantics | Provisionally useful |
| Certifying rulebook adherence | Not suitable |
| Declaring faction or card balance | Not suitable yet |
| Comparing human play quality or metagame health | Not suitable yet |
| Shipping as a hostile-input authoritative game server | Not suitable |

## Scope and evidence

This review treated the supplied working tree as authoritative. The tree was already substantially modified and included untracked engine files, tests, tools, and `packages/engine/sim-data/ruleset-v3.json`. No attempt was made to reset, normalize, or distinguish those changes by author.

The review covered:

- approximately **19,232 lines** under `packages/engine/src`;
- approximately **26,539 test lines**;
- **130 card definitions** in the simulator card pool;
- the rulebook and existing rulebook/balance audit documentation;
- turn setup, phase transitions, action declaration and execution;
- resources, costs, movement, combat, equipment, transformation, and hand limits;
- effect target resolution and every major effect family;
- printed and runtime trigger registration and dispatch;
- bot action selection, rollout action generation, deck construction, and match running;
- statistics and static balance-power calculations;
- versioned ruleset flags and the scripts that select them;
- test, type-check/build, lint, and data-validator behavior.

### Verification performed

| Check | Result |
|---|---|
| Engine test suite | **142 files passed; 1,232 tests passed** |
| Build/type-check | Passed |
| Lint | Passed |
| Card-data validator | 0 errors, 0 warnings |
| Focused semantic probes | Reproduced the critical failures described below |

The Vitest result needs one qualification: `packages/engine/vitest.config.ts` sets `dangerouslyIgnoreUnhandledErrors: true`. Test assertion failures still fail, but run-level unhandled errors may be printed without failing the suite.

### Diagnostic simulation probe

A small deterministic matrix was used only to test harness behavior, not balance:

- six non-mirror faction matchups;
- 40 games per matchup;
- seat alternation;
- heuristic policy;
- seed `424242`;
- `ruleset-v3`.

| Hand-size stall workaround | Decided | Timeout | Reported faction spread |
|---|---:|---:|---:|
| Off | 87.1% | 12.9% | 75.9 pp |
| On | 100.0% | 0.0% | 75.0 pp |

The point is that a simulator control-flow flag changed timeout classification by 12.9 percentage points. The spread is deliberately **not** interpreted as a balance estimate: the sample is small, decks and policies are narrow, and the underlying statistical methodology has defects discussed later.

## Sixteen-category scorecard

The first four categories are the requested categories. The remaining twelve were devised for this review.

| # | Category | Score | Confidence | Core judgment |
|---:|---|---:|---|---|
| 1 | Math quality | 4/10 | High | Several formulas are sound, but headline inference uses invalid sampling units and independence assumptions |
| 2 | Rule adherence | 3/10 | High | Major turn, trigger, targeting, draw-loss, status, and response semantics diverge |
| 3 | Play quality | 4/10 | Medium-high | Tactical combat work is useful; choices, abilities, deck variety, and reactions are materially underplayed |
| 4 | Fidelity | 3/10 | High | The simulated game can differ substantially from printed text while remaining deterministic and green |
| 5 | Architecture and state integrity | 6/10 | High | Good immutable decomposition, weakened by duplicated state, globals, large modules, and non-authoritative boundaries |
| 6 | Action legality and API safety | 2/10 | High | Executors permit illegal phase, type, owner, target, zone, and timing combinations |
| 7 | DSL and effect semantics | 3/10 | High | Broad vocabulary, but choice, simultaneity, target, duration, and state-based semantics are incomplete |
| 8 | Timing, priority, stack, and triggers | 2/10 | High | Several declaration timings, trigger sources, ordering rules, and stack interactions are wrong or absent |
| 9 | Combat, zones, traits, and statuses | 6/10 | High | Core combat is one of the best areas; status duration and granted-trait handling remain unsafe |
| 10 | Resources, costs, equipment, and transformation | 4/10 | High | Core payment works, but X costs, direct legality, equipment countering, and Ultimate lockout do not |
| 11 | Randomness, determinism, replay, and reproducibility | 6/10 | Medium-high | Seeded runs are stable, but global counters, panel-dependent seeds, weak hashes, and masked failures limit replay claims |
| 12 | Bot and decision quality | 5/10 | High | Thoughtful heuristics and combat search, but action-space coverage and reaction/choice policy are incomplete |
| 13 | Experimental design and balance inference | 3/10 | High | Repeated deterministic decks and coupled outcomes are treated too much like independent samples |
| 14 | Card data integrity and validation | 4/10 | High | Structural validation exists; semantic reachability and text-to-DSL agreement are largely unchecked |
| 15 | Testing and reliability engineering | 7/10 | High | Broad, fast, deterministic suite; lacks adversarial boundary, invariant, oracle, and every-card semantic coverage |
| 16 | Configuration, observability, documentation, and maintainability | 3/10 | High | Too many opt-in correctness flags, stale evidence, ambiguous defaults, and coarse timeout/error telemetry |

## Severity model

- **Critical:** can invalidate match outcomes, rules certification, or broad balance conclusions.
- **High:** materially changes legal play, card behavior, turn flow, or reported evidence.
- **Medium:** produces narrower semantic, AI, diagnostic, or maintainability errors.
- **Low:** limited impact, clarity issue, or latent risk under uncommon inputs.
- **Strength:** working design worth retaining.

## Highest-priority findings

### C-01 — Direct actions bypass authoritative legality

**Severity: Critical**

`executePlayerAction` snapshots triggers, calls `resolvePlayerAction`, dispatches events, and recomputes auras. It never proves that the submitted action is present in `computeAvailableActions`, nor does it independently enforce the full phase/type/ownership contract.

The state machine accepts `PLAYER_ACTION` across broad states, so this is not merely an internal testing convenience. A client or alternate bot can submit actions the enumerator never offers.

Examples confirmed in the source or by focused probes:

- a Spell card can be deployed as a character;
- a card can be deployed during upkeep;
- a non-Elite can be placed directly in High Ground without an Elite gate;
- a Character can be cast as a spell;
- equipment can target an opposing character;
- movement does not comprehensively enforce controller, readiness, exhaustion, and once-per-turn movement;
- an Aura can be submitted through the activated-ability path;
- invalid ability indices can still create action-level observations;
- discard-for-energy can be invoked without phase, once-per-turn, or exile-rule enforcement;
- transformation can be invoked without checking its rulebook eligibility;
- Ultimate use after transformation is not blocked.

Focused probe:

```text
illegal_deploy S upkeep
```

Here `S` was a Spell, and the engine placed it onto the battlefield during upkeep.

**Consequence:** enumerator tests are not security or rules tests. Any caller that constructs `PlayerAction` directly can create impossible states and misleading telemetry.

### C-02 — `choose_one` is a no-op for current cards

**Severity: Critical**

`executeChooseOne` always returns a new `PendingChoice`. It does not inspect `context.selectedTargets` and therefore does not execute the chosen option when called a second time by `runAbilityEffects`.

Focused probe:

```text
choose_one_reentry choose_one 0
```

The second interpreter pass still requested `choose_one`, and zero branch events were produced.

Current affected definitions include:

- `RIA-09 Bloom Assembly`;
- `Verdant Vanguard — Overgrowth Protocol`.

Because the runtime auto-choice layer assumes the interpreter will consume the selected option on re-entry, these effects appear to resolve but do nothing.

### C-03 — Printed turn-boundary triggers are logged, not dispatched

**Severity: Critical**

The trigger registry and matcher understand `on_turn_start` and `on_turn_end`. The state machine’s turn transition appends `TURN_END` and `TURN_START` directly to the log but does not run those events through `dispatchTriggers`.

Scheduled effects are a separate mechanism and do not repair general printed-trigger behavior.

**Consequence:** a card can be correctly parsed, registered under `ruleset-v3`, visible to registry tests, and still never fire in an actual game.

### C-04 — Per-turn counters do not reset

**Severity: Critical**

`passTurn` resets a few flags, resources, and combat charges but does not reset `turnCounters`. `abilitiesActivated` is also not consistently incremented.

Focused probe:

```text
counters_after_pass {
  spellsCast: 3,
  equipmentPlayed: 2,
  charactersDeployed: 4,
  abilitiesActivated: 0
}
```

This has direct card impact. Lyria’s transformed `Supreme Intellect` condition for “the second spell each turn” becomes the second spell of the game, not of each turn. Any `turn_count` condition involving activated abilities is permanently false if that counter remains zero.

### C-05 — The default simulator can stall on hand-size choices

**Severity: Critical**

The state machine stores hand-size discard choice in machine context, while the simulator’s normal bot loop inspects game state. The runner itself comments that the default bot cannot see the choice and can spin until its step cap unless `fixHandSizeStall` is enabled.

That workaround is not part of the ruleset manifests, including `ruleset-v3`, and defaults off.

**Consequence:** valid games can be classified as timeouts for a simulator plumbing defect. Any balance run without the workaround mixes gameplay outcome with harness failure.

### C-06 — “All” is implemented as repeated targeting

**Severity: Critical**

Rulebook vocabulary distinguishes “Target” from “All.” The target resolver routes `all_characters` and zone-wide selections through a helper that excludes untargetable cards. It then executes effects sequentially.

Focused probe:

```text
aoe_hexproof_hp [3, 2]
```

A Hexproof character remained at 3 HP while the ordinary character fell to 2 HP under the same “all characters” damage.

This causes two independent mismatches:

1. Hexproof/Stealth can evade effects that do not target.
2. deaths and dynamic values are observed one target at a time rather than from a common pre-effect state, contrary to the rulebook’s simultaneous “All” rule.

### C-07 — Effect-driven empty-deck draws do not lose

**Severity: Critical**

The main upkeep draw handles deck exhaustion. `executeDrawCards` instead caps the number drawn to the deck size and returns unchanged when the deck is empty. Recycling draw follows the same pattern.

Therefore:

- “draw 1” from an empty deck does not lose;
- “draw 2” from a one-card deck draws one and never attempts the losing second draw.

**Consequence:** card draw is strategically safer than the rulebook and can alter late-game wins.

### C-08 — Trigger dispatch loses identity and granularity

**Severity: Critical**

Several defects combine:

- trigger lookup only sees cards currently on the battlefield;
- filtered triggers whose event card has already left play may receive `null`;
- the matcher treats missing card information permissively;
- one `firedTriggerIds` set is reused across the whole input event batch;
- recursive trigger dispatch does not preserve the original trigger snapshot.

Focused probes:

```text
destroyed_filter_missing_card [mana1]
two_deaths_trigger_gain [mana1]
recursive_last_breath_gain [] [DAMAGE_DEALT, CARD_DESTROYED]
```

Interpretation:

- a tag-filtered destroyed trigger fired for a missing nonmatching card;
- two deaths produced one non-rate-limited trigger gain;
- a victim destroyed by a trigger effect failed to produce its Last Breath reward.

These are not cosmetic event-log issues. They change resources, deaths, and match outcomes.

### C-09 — The headline balance statistics use invalid sampling models

**Severity: Critical for balance conclusions**

The statistical helpers are deterministic and several primitives are individually correct. The composition in `summarize-stats.ts` is not.

- The G-test receives faction win counts only and tests whether the counts are uniform. It ignores each faction’s number of games. Unequal exposure is therefore indistinguishable from imbalance.
- The “bootstrap confidence interval” resamples the four faction rate point estimates as if those four values were independent observations. It does not resample games or paired matchup units and largely ignores sample size.
- Expected null spread independently draws faction binomials even though each game contributes coupled winner/loser observations and matchup schedules share decks and opponents.
- The worst-offender z-test compares one faction with the pooled remainder as if the samples were independent, then selects the maximum absolute result without multiple-testing correction.
- Repeated games using the same deterministic decks and bot policy are closer to repeated trials within fixed clusters than independent samples from a broad population of legal decks and players.

The diagnostic probe produced a raw spread of 75.9 percentage points with a reported bootstrap interval extending down to approximately 2.8 points. That interval reflects resampling four faction estimates, not uncertainty from the 240 games, and should not be presented as a game-level confidence interval.

### C-10 — `ruleset-v3` is behaviorally material but not a ratified default

**Severity: Critical for provenance**

The current rulesets layer corrections incrementally:

- v1: ARM first-instance behavior, transform termination, cost floor, reserve choice/strain, discard-for-energy exile, resource-deck size, compensatory card, APNAP;
- v2: end/start ordering, transform timing, Hero once-per-game behavior, compensation timing, Flash, board reactions, response windows for all actions;
- v3: printed-trigger registration, equipment triggers, React, activation after deploy, Hero auras.

Most balance scripts still hardcode `ruleset-v1`. `ruleset-v3` is untracked in the reviewed tree. The base runner defaults many accuracy flags off.

A small probe found v1 and v2 identical in that particular setup, while v3 changed decision/timeout and faction-spread behavior substantially. This is not evidence that v3 is balanced or imbalanced; it is evidence that v1 ratification artifacts cannot validate v3 semantics.

### C-11 — State-based deaths after stat changes are missing

**Severity: Critical**

`modify_stats` can reduce current HP to zero or below and emits only `STAT_MODIFIED`. It does not destroy the card or run death consequences. Aura removal and modifier expiry can produce the same invalid state.

Focused probe:

```text
negative_hp_survives -1 [STAT_MODIFIED]
```

The card remained on the battlefield at -1 HP.

**Consequence:** debuffs, aura loss, transformations, and dynamic stat changes can leave impossible living cards and skip Last Breath/destruction triggers.

### C-12 — Equipment and attack response timing do not model declaration faithfully

**Severity: Critical**

Under response-to-all-actions mode:

- attack exhaustion and combat happen at resolution rather than declaration, so responders see the attacker ready; a countered attack leaves it ready;
- equipment is attached, replacement equipment is removed, and events can be emitted before the response window;
- countering the equipment action cancels deferred effects but does not restore the pre-declaration equipment state;
- board Counter/Flash abilities resolve immediately instead of becoming responseable stack links.

This makes the “counter the base action” abstraction non-transactional. Some state is committed before priority and some after it.

## Detailed findings by category

## 1. Math quality — 4/10

## Strengths

- Wilson score intervals are a sensible marginal interval for a single binomial rate.
- Seeded bootstrap/random routines are deterministic, aiding reproduction.
- Combat damage, ARM, resource payment, and many static-power calculations are factored into testable helpers.
- Statistical output distinguishes point estimates and intervals in the type model.
- The code usually avoids accidental use of simulation stats in the hashed match path.

## Findings

### MATH-01 — G-test ignores denominators

**Severity: High**

`summarizeStats` passes only `w` values to `gTestUniform`. The hypothesis tested is “the faction win counts are equal,” not “the faction win rates are equal after accounting for exposure.” If one faction plays twice as many games, equal skill would imply twice as many wins and the test would call that imbalance.

### MATH-02 — Spread bootstrap uses factions as the sampling units

**Severity: Critical**

`bootstrapCI(rates, spreadOf, ...)` receives one rate per faction. A bootstrap sample therefore contains four draws when four factions are active. It cannot express the binomial uncertainty contributed by hundreds or thousands of games. It is a bootstrap over labels/point estimates, not game outcomes.

### MATH-03 — Null-spread simulation breaks game coupling

**Severity: High**

The null model samples each faction’s wins independently from `Binomial(n_f, p_pool)`. In a two-player zero-sum match, one participant’s win is the other participant’s loss. Matchups, seats, decks, and common opponents introduce additional structure. Independent faction binomials misstate the null spread distribution.

### MATH-04 — Worst-offender z-test has overlapping samples

**Severity: High**

“Faction versus pooled rest” overlaps the same matchup network and is not an independent two-sample experiment. Selecting the most extreme faction adds a winner’s-curse/multiple-testing problem. The unadjusted p-value is anti-conservative as an alert.

### MATH-05 — No clustering by deck, seed pair, or matchup

**Severity: High**

The true observation hierarchy is approximately:

```text
ruleset
  └─ policy pair
      └─ deck pair / matchup
          └─ seat-swapped seed pair
              └─ game result
```

The summary collapses that hierarchy to faction wins/games. Repeated games from the same fixed deck pair do not measure uncertainty over legal deck construction, pilot diversity, or human strategy.

### MATH-06 — Normal-tail calculation underflows/cancels

**Severity: Medium**

The normal two-sided p-value computes `2 * (1 - CDF(|z|))`. At large `|z|`, subtracting a CDF rounded to 1 loses precision. A probe around `z = -8.96` returned exactly zero rather than a small positive tail probability.

### MATH-07 — Small-sample t interval switches to normal too early

**Severity: Medium**

The interval helper uses a normal critical value above a fixed degree-of-freedom threshold. Near that threshold the normal interval is still narrower than the corresponding Student-t interval. This is smaller than the sampling-unit defects but should not be called an exact t interval.

### MATH-08 — Input-domain validation is weak

**Severity: Medium**

Stats helpers do not consistently reject negative trials, wins greater than trials, non-finite inputs, or invalid confidence levels. Returning a number for impossible data makes pipeline bugs harder to detect.

### MATH-09 — Static power scores are judgments, not estimates

**Severity: Medium**

The card-power subsystem uses hand-tuned effect values, contextual constants, scenario bands, copy-decay curves, and clamps. Those can be useful design heuristics, but the resulting “ranges” are not confidence intervals.

Specific limitations:

- raw card power intentionally excludes cost;
- negative ability contribution is clamped, so a drawback cannot lower raw ability power;
- dynamic effects are evaluated at assumed board states;
- deck aggregation and copy decay are chosen formulas, not learned or validated parameters;
- empty/unknown deck inputs can silently produce weak or non-finite summaries.

### MATH-10 — Statistical significance is not decision validity

**Severity: High**

Even corrected p-values would only describe the encoded bot/deck/ruleset distribution. They cannot validate human balance while choice, action-space, trigger, and fidelity defects remain. Engine correctness is an upstream assumption of every balance statistic.

## 2. Rule adherence — 3/10

## Areas that align reasonably well

- setup concepts, resource/main deck separation, mulligan shape, and first-player restrictions are represented;
- zone capacity and adjacent movement exist;
- Defender, Flying, Sniper, First Strike, and core simultaneous combat damage are substantially encoded;
- resource payment order and reduction consumption are centralized;
- transformation preserves relevant Hero state in common paths;
- end-of-turn cleanup and hand-size concepts exist;
- priority windows and LIFO stack resolution exist as first-class state.

## Material divergences

### RULE-01 — Rulebook legality is not enforced at execution

See C-01. This affects phase permissions, card types, ownership, zones, activation timing, discard-for-energy, and transformation.

### RULE-02 — Action-phase ability activation is missing from offered actions

The rulebook permits attacks and ability activation in the Action phase. `computeAvailableActions` primarily offers attacks there, with limited Flash handling. Ordinary activated abilities are therefore strategically unavailable through the canonical action list even though direct execution may accept them.

### RULE-03 — Equipment removal and transfer are not generally enumerable

The rulebook defines removal and transfer. The action types/executors have partial support, but the standard available-action and rollout enumeration surfaces do not expose the full actions. A legal rule exists without a complete player path.

### RULE-04 — Empty-deck loss is limited to one draw path

See C-07.

### RULE-05 — “All” is not simultaneous and is blocked by target protection

See C-06.

### RULE-06 — Status replacement is implemented as stacking

The rulebook says a higher Persistent or Regeneration value replaces a lower value and does not stack. `executeApplyStatus` appends a new status. Subsequent tick behavior can therefore apply multiple instances.

### RULE-07 — Stun duration is consumed twice

A Stunned card is processed during refresh and again by the status tick path. A two-turn Stun lost one duration at refresh and the remaining duration during the same upkeep probe:

```text
after refresh: remainingTurns = 1
after status tick: no Stunned status
```

### RULE-08 — Combat-only and instant trait durations are wrong

The interpreter maps `for_combat` trait grants to end of turn, and an instant trait grant can become permanent. This changes counterplay and creates persistent keyword state that printed text did not grant.

### RULE-09 — Transform-to-Ultimate lockout is absent

The rulebook bars a Hero from using its Ultimate on the same turn it transforms. The executor and ability representation do not provide a reliable enforcement boundary for that label/timing combination.

### RULE-10 — Turn start/end triggers do not fire

See C-03.

### RULE-11 — Active-player trigger ordering is fixed, not chosen

APNAP ordering is partially represented, but simultaneous triggers within a player’s own set resolve in registry order. The player cannot choose their trigger order as required.

### RULE-12 — Voluntary equipment removal is classified as destruction

Replacing/removing equipment emits destruction semantics in paths where the rulebook describes discard/removal. This can incorrectly trigger “destroyed” watchers.

### RULE-13 — Countering a spell changes when “cast” is observed

`SPELL_CAST` is emitted on resolution, so a countered spell may never count as cast for triggers, even though resources were paid, the card left hand, and the rulebook describes negating the effect. This is also internally inconsistent with `spellsCast`, which increments at declaration.

### RULE-14 — First-player and rules fixes depend on opt-in configuration

The base game path does not embody a single authoritative rulebook version. Correct ARM, response, ordering, transformation, and trigger behavior depends on selecting a manifest with the right flags.

## 3. Play quality — 4/10

## Strengths

- The heuristic bot evaluates attacks using the engine’s combat model.
- It considers gang attacks, target values, lethal lines, tempo, and faction-specific game plans.
- Deterministic tie-breaking supports reproducible comparisons.
- Spell and deployment scoring is richer than a purely random baseline.
- The engine includes seat alternation and multiple policies.

## Findings

### PLAY-01 — Mandatory first-option choices distort card identity

The effect runner picks from the front of each choice list and forces at least one selection. Optional “up to” choices are not optional. Modal cards always choose their first mode once `choose_one` is repaired unless a richer choice controller is introduced.

### PLAY-02 — Entire legal action classes are absent from bot play

The normal heuristic action phase does not broadly activate abilities. Equipment removal/transfer is not enumerated. X ranges are not enumerated. The rollout generator’s legacy mode deliberately uses only a subset of slots, targets, movements, and actions.

### PLAY-03 — Reaction policy is spell-centric

The bot reaction chooser focuses on enemy spells. Under response-to-all-actions rules, attacks, equipment, movement, and other action types can open windows, but the policy does not evaluate the full set as meaningful threats.

### PLAY-04 — Choice policy is positional, not strategic

Target lists and modes inherit data/enumerator order. The bot does not compare branch utility, optionality, future board space, trigger sequencing, or hidden information. Ordering changes in JSON can change win rates without a game-design change.

### PLAY-05 — Deck diversity is insufficient

Automatic decks use a narrow construction heuristic and fixed card ordering. Four simulator factions are represented; Crimson and Amethyst are not included in the main faction list. Repeating games with the same few decks measures mastery of those lists, not faction robustness.

### PLAY-06 — Timeouts include non-play causes

Turn cap, step cap, hand-choice stalls, loops, and swallowed engine/bot errors all converge on coarse timeout/end-phase behavior. A reported slow or drawn-out matchup may actually be a harness defect.

### PLAY-07 — Heuristic-vs-rollout disagreement is unresolved evidence

Existing balance documentation records policy disagreement and pilot miscalibration. That is valuable honesty, but it means no one policy can be treated as a stable proxy for player skill without external calibration.

### PLAY-08 — Hidden action failure teaches the bot the wrong game

Some simulator telemetry records an attempted action before its execution succeeds. Invalid or silently fizzled actions can therefore be counted as play. The bot may appear active while producing no state change.

## 4. Fidelity — 3/10

Fidelity here means “does a simulated trace preserve the observable meaning of printed cards and rulebook actions,” not merely “does it terminate deterministically.”

### FID-01 — Current printed cards can be registered yet inert

`choose_one`, turn-start/end dispatch, turn counters, and tag-filtered trigger lookup affect cards in the current pool, not hypothetical future content.

### FID-02 — Text/DSL fallback clauses are missing

For example, Biotech Harvest’s printed fallback when Reserve is full is not represented by the encoded deploy effect. The engine cannot honor prose that was never modeled.

### FID-03 — Token identity does not match printed tag references

Effects create a “Bio-Construct” token, but the token definitions do not provide the `Bio-Construct` tag expected by filters. No printed pool card was found with that tag. Effects that count or select Bio-Constructs therefore see an empty population.

### FID-04 — Dynamic modifiers can modify unintended stats

Synthetic Evolution’s dynamic multiplication can apply to ARM even where printed text names only ATK/HP, depending on the dynamic value structure.

### FID-05 — Granted traits are inconsistently visible

Several filters, counters, and trigger matchers inspect printed traits only. A card dynamically granted a trait may behave as if it has the trait in combat but not for “count,” “if,” targeting, or triggered effects.

### FID-06 — Hero target identity is inconsistent

Some target resolution uses seat-based pseudo IDs while Hero action sources use definition-based IDs. This creates ambiguous or non-round-trippable target identity, especially if both players use the same Hero definition.

### FID-07 — `side: any` Hero/player targeting resolves allied only

The resolver does not consistently include both controllers for generic Hero/player targets. Effects authored as “any” can silently narrow to friendly.

### FID-08 — Exile has no durable zone representation

Discard-for-energy removes a card from normal zones, but there is no explicit exile-zone trace suitable for later inspection, replay accounting, or exile-sensitive effects.

### FID-09 — Simulator hydration can lose card schema detail

The simulator’s card adapter uses a reduced definition and inferred values. Resource type is inferred from resource-card name, invalid IDs can silently become Mana, and null DSL entries can be filtered rather than failing closed.

### FID-10 — “Green” regression hashes may preserve an inaccurate game

Hash pins are useful only relative to intended semantics. Optional rule-fix flags and legacy paths mean a stable hash can certify the continuation of a known rule mismatch.

## 5. Architecture and state integrity — 6/10

## Strengths

- Most engine operations return new states rather than mutating shared game state.
- Combat, targets, effects, actions, triggers, auras, bots, and statistics are separated into modules.
- Event production provides a useful audit surface.
- Types model many domain concepts explicitly.
- Versioned configuration allows controlled comparisons.

## Findings

### ARCH-01 — There is no single authoritative transition boundary

Legality is computed in one layer and partially reimplemented in executors. The state machine dispatches broad events without checking enumerator membership. Effects expose a lower-level interpreter that can bypass action contracts.

### ARCH-02 — Pending choice exists in two state domains

Machine context and `GameState` both have choice concepts. Hand-size discard is stored only in machine context, while the simulator normally observes game state. This split directly caused C-05.

### ARCH-03 — Module-level trigger counters violate pure/reentrant expectations

Trigger and Hero registration use module-global counters. Not all have reset paths. Two otherwise identical games created after different process history can receive different internal IDs. Even if outcomes remain the same today, serialized traces and replay hashes are history-dependent.

### ARCH-04 — Monolithic modules concentrate semantic risk

`actions.ts` is about 1,332 lines, `game-state.ts` about 1,252, `interpreter.ts` about 1,156, and the runner about 2,002. Large files are not automatically bad, but these combine validation, payment, declaration, resolution, telemetry, and compatibility behavior, making invariants difficult to audit.

### ARCH-05 — Configuration is becoming an alternate type system

Dozens of booleans decide which rules exist. Many comments promise “byte-identical” legacy behavior. That supports experiments but makes arbitrary flag combinations possible even when no coherent rulebook corresponds to them.

### ARCH-06 — Aura recomputation is a global repair pass

Every action can strip and rebuild continuous effects over the board. This simplifies some callers, but it also lets aura order, replacement rebuilding, and state-based death omissions leak across unrelated actions.

### ARCH-07 — Error semantics are mostly “unchanged state”

Executors often return no events rather than a typed illegality result. Callers cannot reliably distinguish:

- legal no-op;
- illegal phase;
- unaffordable cost;
- invalid target;
- missing source;
- stale action;
- interpreter defect.

That weakens clients, bots, diagnostics, and test assertions simultaneously.

## 6. Action legality and API safety — 2/10

### LEGAL-01 — No membership validation

See C-01.

### LEGAL-02 — Deploy omits card type and zone gate

`executeDeploy` checks hand membership and cost, then calls the zone placement helper. It applies an Elite surcharge when a deployed card has Elite but does not prove that only Elite cards may deploy directly to High Ground.

### LEGAL-03 — Spell cast omits card type and normal timing

The normal cast executor accepts a hand card and pays its cost. It does not itself prove the card is a Spell or that the phase/timing permits casting.

### LEGAL-04 — Equipment target ownership/type is incomplete

Battlefield lookup is global. Direct calls can target an enemy permanent. Updating equipment mappings for only one controller can create a phantom or inconsistent attachment.

### LEGAL-05 — Movement validation is incomplete

The executor relies on zone mechanics and a subset of status checks. Controller, readiness, exhausted state, movement count, and complete adjacency/action timing are not all enforced at the final boundary.

### LEGAL-06 — Ability activation trusts index and kind

Direct activation can bypass enumerated timing, once/cooldown state, summoning state, exhaustion, and ability-kind rules. Aura/static abilities can be submitted as if activated.

### LEGAL-07 — Discard-for-energy trusts caller timing

Phase, once-per-turn use, eligible source zone, and exile semantics are not comprehensively enforced by the executor.

### LEGAL-08 — Transform executor trusts eligibility

The three rulebook transform conditions and timing window live largely outside final execution. A fabricated transform action can succeed whenever data permits.

### LEGAL-09 — Hand-size response validation is weak

Discard selection is not consistently checked for exact required count, uniqueness, current membership, and ownership at the authoritative response boundary.

### LEGAL-10 — Reactive actions trust shape

Reactive activation/cast code has local guards, but the boundary does not consistently validate that the exact source/ability/targets were offered for the current pending window.

### LEGAL-11 — Silent fizzle hides stale/illegal action bugs

Many violations return unchanged state and no events. The simulator can proceed, count the attempt, and attribute a gameplay decision where the engine rejected it.

## 7. DSL and effect semantics — 3/10

## Strengths

- The DSL covers damage, healing, draw, stat changes, statuses, tokens, resources, zones, traits, conditions, scheduling, choices, counters, and transformations.
- Effects are strongly typed and separately testable.
- Dynamic amounts and filters provide substantial authoring power.

## Findings

### DSL-01 — `choose_one` never consumes the choice

See C-02.

### DSL-02 — Injected selected targets are not fully revalidated

At the low-level resolver, caller-provided target IDs can bypass target generation. `runAbilityEffects` checks option membership for one choice layer, but direct interpreter usage and reused target arrays remain unsafe.

### DSL-03 — One target list is reused across multiple effects

`chosenTargets` is passed to each effect in an ability. An ability with two independent target prompts cannot reliably represent two different selections.

### DSL-04 — Optional selection is forced

Choice code computes at least one wanted target even when `minSelections` is zero. “Up to N” becomes “choose at least one if possible.”

### DSL-05 — All-target resolution is sequential

See C-06.

### DSL-06 — State-based death is absent after stat changes

See C-11.

### DSL-07 — Effect draws suppress deck loss

See C-07.

### DSL-08 — Duration mapping loses semantic distinctions

`for_combat`, instant, permanent, while-in-play, until-turn-end, and until-next-upkeep are not all represented by distinct lifecycle machinery.

### DSL-09 — `triggering_card_cost` compares a card to itself

The source-condition evaluator can derive both sides of the comparison from the same triggering card cost, making several operators tautological or impossible rather than comparing against an authored threshold.

### DSL-10 — Dynamic trait/tag queries ignore granted state

The DSL’s count/filter behavior is not consistently aligned with the combat layer’s effective-trait behavior.

### DSL-11 — Token fallback behavior is under-specified

Deploy-token effects do not generally encode printed fallback clauses for full zones. Failure can silently become a no-op.

### DSL-12 — Public low-level execution is unsafe by construction

`executeEffect` is valuable for tests and composition, but it accepts a context powerful enough to inject source, controller, selected targets, and trigger depth. It should not be treated as an authoritative public game action.

## 8. Timing, priority, stack, and triggers — 2/10

### TIME-01 — Turn events bypass trigger dispatch

See C-03.

### TIME-02 — Attack state is committed too late

When attacks open a response window, the declaration is represented on the stack without exhausting/marking the attacker. Countering the attack restores more capability than the rulebook declaration model implies.

### TIME-03 — Equipment state is committed too early

See C-12.

### TIME-04 — Board reactions resolve outside the stack

The code explicitly resolves a board Counter/Flash immediately. It flips priority afterward, but opponents cannot respond to that ability before its effect happens.

### TIME-05 — Cast triggers happen at resolution

See RULE-13.

### TIME-06 — Destroyed/spell identity is lost before filtered matching

See C-08.

### TIME-07 — Event-batch trigger deduplication is too broad

A trigger without once-per-event limits can fire only once for multiple matching events in the same batch because `firedTriggerIds` spans the batch.

### TIME-08 — Recursive trigger snapshots are incomplete

A trigger-created death can lose the destroyed permanent’s Last Breath because the original snapshot is not threaded through recursive dispatch.

### TIME-09 — Simultaneous trigger order is not player-controlled

See RULE-11.

### TIME-10 — Depth and stack guards silently truncate

Trigger recursion and stack resolution have hard caps. Exceeding them drops or leaves work without a first-class error/result, making an invalid trace look like a completed game.

### TIME-11 — Replacement-effect lifetime is inconsistent

Focused probes found opposite errors:

```text
replacement_after_pass true
aura_replacement_recompute false
```

- a normal “once per turn” replacement remained used after passing the turn;
- an aura-derived replacement lost its used state after aura recomputation, allowing reuse during the same turn.

### TIME-12 — Persistent damage bypasses ordinary damage replacement

Status ticks do not consistently travel through the same damage/replacement pipeline as other damage, so immunity, shields, or replacement effects can behave differently based on damage source.

## 9. Combat, zones, traits, and statuses — 6/10

## Strengths

- Target matrices and lane/zone relationships are centralized.
- Defender, Flying, Sniper, First Strike, and ARM are represented.
- Combat uses a pre-damage snapshot for simultaneous attacker/defender damage.
- Gang-attack evaluation is integrated with the bot.
- Zone capacities constrain board size and bound many algorithms.
- Recharge paths exist for ARM/shield-style once-per-turn mitigation.

## Findings

### COMBAT-01 — Core combat quality is higher than effect damage quality

Direct combat has better snapshot and death handling than `modify_stats`, status ticks, and “all” effects. Players can observe different death/replacement semantics for mechanically similar damage outcomes.

### COMBAT-02 — ARM rule accuracy is flag-dependent

The rulebook’s first combat-damage instance behavior is not the unconditional default. A run without the correct ruleset can use legacy ARM semantics.

### COMBAT-03 — Granted traits are not universally effective traits

Combat helpers may honor granted Flying/Defender/etc., while DSL filters and triggers inspect printed traits. The same card can simultaneously “have” and “not have” a trait.

### COMBAT-04 — Status replacement/stacking is wrong

See RULE-06.

### COMBAT-05 — Stun duration is wrong

See RULE-07.

### COMBAT-06 — Non-damage HP reduction leaves impossible bodies

See C-11.

### COMBAT-07 — Aura loss can avoid destruction

When an HP aura disappears, recomputation can reduce current HP to zero without running the destruction pipeline.

### COMBAT-08 — Dynamic aura evaluation is order-sensitive

Aura recomputation evaluates and applies effects sequentially. A dynamic aura can observe earlier auras in registry/scan order, causing data order to determine stats.

### COMBAT-09 — “All” protection is wrong

See C-06.

### COMBAT-10 — Movement and attack legality are not symmetric

The enumerator may correctly exclude an action that the executor accepts. This makes combat correctness dependent on caller discipline.

## 10. Resources, costs, equipment, and transformation — 4/10

## Strengths

- Mana, Energy, flexible costs, temporary resources, and reductions are represented separately.
- Payment order is centralized.
- Cost-floor behavior exists.
- Elite High Ground surcharge exists.
- Resource-deck mechanics and reserve strain have explicit ruleset controls.
- Transformation tracks once-per-game state.

## Findings

### ECON-01 — X cost is always added as flexible

`addXCost` does not preserve whether a printed X should be Mana or Energy. The simulator adapter also drops some authored X-resource flags. Cards with typed X costs can pay with the wrong resource mix.

### ECON-02 — X choices are not properly enumerated

The action surface does not generate a principled legal range of X values. Bot handling depends partly on tags/names and narrow heuristics.

### ECON-03 — Resource cards are inferred by name

Setup derives resource type from card names in simulator data. Invalid resource IDs/types can silently fall back to Mana instead of failing validation.

### ECON-04 — Flexible resource-card semantics are incomplete

The model distinguishes flexible action costs but does not consistently treat resource-card types as satisfying all specific payment cases described by card data/rules.

### ECON-05 — Cost correctness depends on flags

Minimum-cost floor and other corrections are optional. Arbitrary configuration can permit a rules-illegal zero cost.

### ECON-06 — Equipment countering is non-transactional

See C-12.

### ECON-07 — Equipment ownership/type checks are weak

See LEGAL-04.

### ECON-08 — Equipment transfer may reuse first-per-turn reductions

Transfer/removal paths do not consistently consume the same first-per-turn reduction state as initial play.

### ECON-09 — Voluntary equipment removal emits death-like semantics

See RULE-12.

### ECON-10 — Transformation eligibility is enumerator-only

See LEGAL-08.

### ECON-11 — Ultimate-on-transform-turn is not enforceable from label data

See RULE-09.

### ECON-12 — Transform telemetry adapter records no meaningful LP delta

The simulator’s transform adapter reports `lpDelta` as zero, limiting diagnostic fidelity for transform timing and comeback analysis.

## 11. Randomness, determinism, replay, and reproducibility — 6/10

## Strengths

- Simulation uses explicit seeds.
- Deterministic tests and stable run hashes exist.
- Seat alternation is supported.
- Balance artifacts record configuration and summary information.
- Paired comparison tooling exists.

## Findings

### REPRO-01 — Seed streams depend on panel composition/order

Pairing index participates in seed derivation. Adding, removing, or reordering other matchups can change a given matchup’s random stream, making cross-panel comparisons less controlled.

### REPRO-02 — Run hash is not a replay hash

The hash covers selected configuration/outcome/deck labels, not the full trajectory, every random draw, action result, engine version, diagnostics, and all card definitions. Matching hashes do not prove identical event histories.

### REPRO-03 — Module globals introduce process-history dependence

See ARCH-03.

### REPRO-04 — Mutable diagnostic configuration weakens purity

The runner can attach mutable diagnostic state to otherwise declarative config. Behavior may remain deterministic in current paths, but the boundary does not guarantee referential transparency.

### REPRO-05 — Silent error recovery is reproducible but not valid

The runner catches bot/engine exceptions and often advances or ends a phase without a structured error outcome. The same defect can reproduce perfectly and still be absent from headline results.

### REPRO-06 — Ruleset version is not universally authoritative

Scripts hardcode different versions or rely on defaults. A balance artifact must be traced to every flag, card-pool hash, deck list, bot version, and build—not just a filename containing `ruleset-v1`.

### REPRO-07 — Untracked v3 undermines artifact provenance

The reviewed `ruleset-v3.json` is not part of the Git index. Its results cannot be reconstructed from commit `524d648` alone.

## 12. Bot and decision quality — 5/10

## Strengths

- Heuristic scoring is decomposed by attack, spell, deployment, and game plan.
- Combat simulation is more sophisticated than simple attack-value comparison.
- Gang attacks and lethal pressure are considered.
- Deterministic tie resolution makes experiments reproducible.
- A rollout policy exists for deeper evaluation.

## Findings

### BOT-01 — Action-phase activated abilities are broadly ignored

The heuristic cannot choose what the enumerator does not provide, and its action-phase policy focuses on attacks.

### BOT-02 — Remove/transfer equipment are absent

These rulebook decisions are not part of standard bot action generation.

### BOT-03 — X search is incomplete

The bot does not compare all affordable X values and their marginal utility.

### BOT-04 — Legacy rollout generation is intentionally partial

Comments acknowledge using first slots/targets/moves and excluding discard-for-energy in legacy mode. Full enumeration is optional and still inherits missing action classes.

### BOT-05 — Reaction threat evaluation is incomplete

See PLAY-03.

### BOT-06 — Choice selection is first-option

See PLAY-01 and PLAY-04.

### BOT-07 — Bot evaluation inherits engine defects

Rollouts use the same target, trigger, choice, counter, and status implementation. Search cannot discover the rulebook-optimal move when its internal forward model is wrong.

### BOT-08 — Random policy is not a strong neutral baseline

The random agent takes an action only probabilistically and otherwise advances. In reaction windows it often takes the first option. It measures a particular pass-heavy policy, not uniform legal play.

### BOT-09 — Game plans are vulnerable to data-order leakage

Hardcoded ordering and first-match selection can make card JSON order a strategic input.

### BOT-10 — No external skill calibration

There is no evidence that heuristic tiers correspond to human ranks, optimality gaps, or stable Elo differences across decks/rulesets.

## 13. Experimental design and balance inference — 3/10

### EXP-01 — Balance subject is underspecified

A balance statement must specify:

- exact ruleset flags;
- exact card pool;
- exact deck population;
- exact policy population;
- mulligan/choice/reaction policy;
- seat and seed design;
- termination definition;
- engine build and data hashes.

Current scripts and documents do not enforce one canonical manifest containing all of these.

### EXP-02 — Most scripts still use v1

Current correctness additions in v2/v3 are absent from many verification, panel, ladder, and stage scripts. Old results answer a legacy-semantics question.

### EXP-03 — v3 has not been ratified

No comparable locked v3 evidence was found. Yet v3 enables printed triggers, equipment triggers, React, activation-after-deploy, and Hero auras—large semantic additions.

### EXP-04 — Four factions do not establish full-game balance

The simulator’s primary faction list omits Crimson and Amethyst. Four-faction spread is not a full Aetherion metagame statement.

### EXP-05 — Automatic decks are narrow and order-dependent

The builder uses simple quotas and first matching aligned cards. It does not sample the legal deck space or optimize archetypes.

### EXP-06 — Invalid/unknown deck specs can silently fall back

Explicit lookup failures may produce auto decks rather than hard errors. A report can be labeled as one deck request while using another constructed deck.

### EXP-07 — Explicit decks are not always validated

The runner does not consistently run the authoritative deck-legality validator over externally selected lists.

### EXP-08 — Seat alternation is necessary but not sufficient

It reduces first-player bias but does not pair every stochastic decision under common random numbers, and seed construction can vary with panel ordering.

### EXP-09 — Timeout is a mixed endpoint

See PLAY-06.

### EXP-10 — Snowball/comeback telemetry is too coarse

Leader identification is largely LP-based, while board, resources, hand, deck exhaustion, transformation, and tempo can dominate. “Comeback” therefore lacks a stable game-theoretic definition.

### EXP-11 — Outcome attempts and successful actions can be conflated

Telemetry may count an action before the state confirms it resolved. Invalid or countered/fizzled actions need separate declaration/resolution/counter/error fields.

### EXP-12 — No multiplicity plan

Faction, matchup, card, seat, policy, and scenario panels generate many comparisons. Selecting worst offenders without false-discovery/family-wise control inflates alerts.

### EXP-13 — Effect size thresholds are not tied to design decisions

P-values and spread thresholds are not accompanied by a documented minimally important effect, acceptable matchup envelope, or power analysis.

### EXP-14 — Model validity dominates sample size

Running more games under v1, first-choice selection, missing triggers, or stalled hand-size logic reduces Monte Carlo noise around the wrong model. It does not improve rulebook validity.

## 14. Card data integrity and validation — 4/10

## Current pool summary

The reviewed simulator pool contains **130 definitions**:

| Type | Count |
|---|---:|
| Character | 47 |
| Equipment | 31 |
| Hero | 4 |
| Resource | 2 |
| Spell | 42 |
| Token | 4 |

The ability corpus includes Aura, Cast, Deploy, Trigger, React, Flash, Ultimate, and other ability kinds. This breadth makes semantic validation important: the engine is no longer testing only a small, uniform card vocabulary.

## Findings

### DATA-01 — Validator coverage is structural, not semantic

The validator currently reports no problems, but its check families are narrow: null DSL, Hero counts, activated-ability mismatch, React structure, costs, and selected regressions. It does not prove that the interpreter executes the card’s intent.

### DATA-02 — `choose_one` cards pass validation while doing nothing

See C-02.

### DATA-03 — Empty tag populations are not detected

No printed card/token with a `Bio-Construct` tag was found, despite filters referring to it.

### DATA-04 — Printed fallback clauses are not compared to DSL

The validator does not compare normalized rules text with required DSL branches, full-zone fallbacks, durations, target cardinality, or cost types.

### DATA-05 — Unsupported or degraded durations pass

`for_combat` and instant trait-duration mismatches are not rejected.

### DATA-06 — Target reachability is not validated

An “any,” tag-filtered, or zone-filtered target may resolve to a narrower or empty population without warning.

### DATA-07 — Condition tautologies are not detected

Self-comparing `triggering_card_cost` conditions can pass schema checks.

### DATA-08 — Duplicate IDs and range invariants need stronger guarantees

The review did not find a comprehensive validation contract covering unique definition IDs, unique stable slugs, nonnegative stats/costs, legal min/max selections, supported ability/effect combinations, and references to existing cards/tokens.

### DATA-09 — Null DSL can be silently filtered by hydration

Filtering falsy DSL entries permits the simulation adapter to continue with fewer abilities rather than failing closed and identifying the specific card.

### DATA-10 — Report-only tools can normalize known violations

Validator comments and workflow posture emphasize reporting. For balance certification, semantic errors should invalidate the run manifest rather than merely emit optional diagnostics.

## Current card-specific impact table

| Card/effect | Observed risk |
|---|---|
| RIA-09 — Bloom Assembly | `choose_one` does not execute a branch |
| Verdant Vanguard — Overgrowth Protocol | `choose_one` no-op; Bio-Construct tag population absent |
| Verdant Vanguard token synergies | Named token and queried trait/tag are inconsistent |
| Lyria transformed — Supreme Intellect | “Second spell each turn” uses counters that do not reset |
| Any on-turn-start/on-turn-end printed trigger | Registered/matched but not dispatched by turn transition |
| Any filtered death/spell trigger | Missing source lookup can make filters permissive |
| Any Last Breath caused by another trigger | Recursive dispatch can lose the victim’s trigger snapshot |
| Any Persistent/Regeneration upgrade | May stack rather than replace |
| Any multi-turn Stun | Can decrement twice in one upkeep |
| Any HP-lowering stat effect/aura expiry | Can leave a living card at zero/negative HP |
| Any typed X-cost card | X payment becomes flexible |
| Any modal/optional targeted card | First-option/forced-target behavior |

## 15. Testing and reliability engineering — 7/10

## Strengths

- **1,232 passing tests across 142 files** is substantial coverage for a project of this size.
- Tests cover combat, actions, effects, triggers, simulation determinism, stats, ruleset locks, card validation, Hero auras, equipment triggers, and React.
- Build and lint are clean.
- Deterministic seed/hash tests make regressions visible.
- Several rule fixes have focused pin tests.
- The card validator currently returns cleanly.

## Why the suite can be green despite the findings

### TEST-01 — Enumerator legality is tested more than executor rejection

Tests often prove that an illegal action is absent from offered actions. They do not submit that action directly and assert a typed rejection/no state mutation.

### TEST-02 — Unit trigger tests do not prove game-loop dispatch

Registry/matcher tests can pass while the state machine never sends turn-boundary events through dispatch.

### TEST-03 — Legacy pins intentionally preserve inaccurate behavior

Flag-lock tests prove that absent flags are byte-identical. That is useful for experiments but can treat known rule mismatches as protected behavior.

### TEST-04 — Hash tests are semantic-blind

A stable hash proves repeatability, not agreement with the rulebook.

### TEST-05 — No every-card execution corpus

There is no evident generated test that instantiates every printed ability, reaches its trigger, exercises each choice/mode/target cardinality, and asserts a meaningful state change or explicit no-op.

### TEST-06 — No systematic invariant/property suite

High-value invariants not comprehensively swept include:

- no battlefield card at `currentHp <= 0`;
- hand/deck/discard/exile conservation;
- no duplicated instance IDs across zones;
- every attached equipment has one valid controller/target mapping;
- legal actions always execute;
- illegal actions never mutate;
- per-turn values reset exactly once;
- all target selections are valid and unique;
- resolving a full priority window leaves an empty stack;
- same seed+manifest yields same complete trace;
- active-player/owner/source IDs remain coherent.

### TEST-07 — No differential rules oracle

There is no independent reference implementation or declarative rule oracle against which random games are compared. Most expected values come from the same semantic assumptions as the implementation.

### TEST-08 — Unhandled errors are ignored at runner level

`dangerouslyIgnoreUnhandledErrors` was introduced for CI worker behavior. It also means the green suite needs log inspection to exclude ignored run-level errors.

### TEST-09 — No enforced coverage threshold was identified

Line counts and test quantity are healthy, but no branch/function coverage gate demonstrates that error paths and flag combinations are executed.

### TEST-10 — Configuration combinatorics are largely untested

Dozens of booleans permit incoherent combinations. Version manifest tests do not cover every arbitrary mix a caller can construct.

## Suggested verification hierarchy

This is a recommendation, not an implementation action:

1. schema validation;
2. per-effect semantic golden tests;
3. authoritative action contract tests;
4. state invariants/property tests;
5. rulebook scenario corpus;
6. every-card generated execution tests;
7. deterministic full-game replay tests;
8. bot policy calibration;
9. only then, balance inference.

## 16. Configuration, observability, documentation, and maintainability — 3/10

### OPS-01 — Correctness flags default off

The generic runner path can omit rulebook fixes. A caller must know which manifest to merge and which scripts already hardcode an older manifest.

### OPS-02 — No canonical “current rules” constructor

The system needs one exported, immutable, versioned configuration that represents the rulebook under review. Experimental ablations should derive from it rather than assembling independent booleans.

### OPS-03 — Ruleset files are additive but not self-explanatory enough

A manifest lists values but does not embed rulebook revision, engine/card hashes, incompatible combinations, validation status, or ratification evidence.

### OPS-04 — Balance scripts disagree on ruleset

Verification, panel, ladder, stage, tie-audit, and paired comparison tools use different fixed/optional versions.

### OPS-05 — Documentation is stale or skeletal

Some architecture/DSL summary documents are link stubs rather than maintained explanations. The roadmap and earlier rulebook audit characterize v1-era behavior and do not account for current untracked v3 changes.

### OPS-06 — Error telemetry is too coarse

The runner should distinguish at least:

- normal win;
- deck-exhaustion loss;
- concession;
- turn-cap draw;
- step-cap loop;
- unresolved choice;
- stack/trigger guard exceeded;
- illegal action;
- bot exception;
- engine exception;
- data/config invalidity.

Today several of these become timeout, silent pass, or unchanged state.

### OPS-07 — Run artifacts omit decisive provenance

A certification artifact should include:

- commit and dirty-tree patch hash;
- card-pool content hash;
- complete deck contents;
- ruleset manifest content hash;
- bot implementation/config hash;
- seed schedule;
- engine build identifier;
- validation/test status;
- failure counts by typed reason;
- full or sampled trace hashes.

### OPS-08 — Comments describe compatibility more often than invariants

Many comments document that a flag preserves “byte-identical” legacy behavior. Fewer comments declare the invariant every path must satisfy. Compatibility intent is valuable, but it should not obscure which behavior is correct.

### OPS-09 — Global recomputation and unbounded logs affect scale

Aura recomputation scans/rebuilds board state after actions, trigger dispatch scans registered sources, and game logs grow for the entire game. Board capacity keeps single games manageable, but rollout and large-panel costs multiply these choices.

### OPS-10 — Stale evidence can look current

Existing ratification filenames and balance HTML/ledger artifacts can remain present after card, bot, and ruleset changes. Without enforced manifest hashes, readers can apply old conclusions to a new engine.

## Rulebook compliance matrix

| Rule area | Status | Evidence/qualification |
|---|---|---|
| Deck setup and zones | Partial | Core structures exist; simulator decks/factions and external validation are incomplete |
| Mulligan / compensation | Partial-to-good under flags | Timing/behavior depends on ruleset version |
| First-player restrictions | Partial | Represented, but authoritative executor checks are weak |
| Upkeep refresh/resource/main draw | Partial | Main draw deckout works; effect draw deckout does not |
| Reserve tap and strain | Partial-to-good under flags | Correctness is versioned rather than default |
| Strategy phase actions | Partial | Direct execution permits illegal types/timings |
| Action phase attacks | Good core | Combat math strong; declaration/response timing flawed |
| Action phase abilities | Poor | Not comprehensively offered to callers/bots |
| End phase / hand limit | Partial | Ordering flags exist; pending-choice split stalls runner |
| Movement | Partial | Zone logic exists; final executor legality incomplete |
| Combat targeting | Good with caveats | Defender/Flying/Sniper centralized; effective traits inconsistent |
| Simultaneous combat damage | Good | One of the stronger semantic areas |
| ARM | Partial-to-good under flag | Correct first-instance behavior is not unconditional |
| Discard for Energy | Partial | Payment concept exists; direct legality/exile trace weak |
| Cost floor and reductions | Partial-to-good under flags | X typing and flexible-resource semantics incomplete |
| Equipment | Poor-to-partial | Play works; ownership, response rollback, remove/transfer surface flawed |
| Priority / LIFO stack | Partial | Basic chain exists; declaration state and board reactions differ |
| Counter / Flash | Partial | Hand reactions better than board reaction stacking |
| Trigger registration | Partial | v3 adds sources; global identity and snapshot issues remain |
| Trigger resolution/order | Poor | turn events not dispatched, batch dedupe, recursive snapshot, no owner ordering |
| “All” | Poor | Uses targetability and sequential application |
| Persistent / Regeneration | Poor | Appends rather than higher-value replacement |
| Stunned | Poor | Double duration consumption |
| Transformation | Partial | State transition exists; eligibility and same-turn Ultimate boundary weak |
| Deck exhaustion | Partial | Only selected draw paths lose |
| Hero/card identity | Partial | Multiple pseudo-ID conventions |

## State and invariant audit

| Invariant | Current assessment |
|---|---|
| Every executed player action was legal in the current state | **Not guaranteed** |
| Every offered legal action can be executed successfully | Not guaranteed; stale/partial action shapes may fizzle |
| Every living battlefield card has HP > 0 | **Violated** |
| Per-turn counters reset at turn boundary | **Violated** |
| Once-per-turn replacements reset exactly once | **Violated in both directions** |
| A card instance exists in exactly one game zone | Not comprehensively enforced/proved |
| Equipment mappings reference valid owned permanents | Not guaranteed |
| Every trigger sees the event card’s last-known information | **Violated** |
| Every matching event causes the allowed number of trigger firings | **Violated** |
| All simultaneous effects use one shared pre-effect state | **Violated** |
| Optional choices may select zero | **Violated** |
| Every pending choice is externally visible and resolvable | **Violated** |
| Empty-deck draw attempts lose regardless of source | **Violated** |
| Same ruleset name means same complete semantics in every script | **Violated** |
| Match timeout means gameplay reached a documented cap | **Violated** |
| A clean validator result implies printed cards are executable | **Violated** |

## Focused runtime probe record

These probes were temporary read-only executions against the built engine; no probe files were added to the repository.

| Probe | Result | Meaning |
|---|---|---|
| Deploy Spell during upkeep | `illegal_deploy S upkeep` | Direct executor bypasses phase/type legality |
| Re-enter `choose_one` with selection | `choose_one_reentry choose_one 0` | Choice remains pending; branch emits nothing |
| Pass turn after nonzero counters | Counters unchanged | Turn conditions accumulate across game |
| “All characters” vs Hexproof + ordinary | HP `[3, 2]` | Hexproof incorrectly avoids untargeted all-effect |
| Apply -4 HP modifier to 3 HP body | HP `-1`, only `STAT_MODIFIED` | State-based destruction absent |
| Use replacement then pass | Still used | Once-per-turn replacement never resets |
| Use aura replacement then recompute | No longer used | Same-turn aura replacement re-enables |
| Two-turn Stun through one upkeep | Removed | Duration consumed twice |
| Filtered destroyed trigger with missing card | Resource gained | Missing last-known info makes filter permissive |
| Two matching deaths in one batch | One gain | Trigger deduplication spans events |
| Trigger effect destroys Last Breath source | No Last Breath gain | Recursive dispatch loses snapshot |

## Positive engineering observations

The critical findings should not obscure what is worth preserving.

1. **Combat decomposition is solid.** Attack legality, target traits, damage, First Strike, ARM, and gang evaluation are substantially more coherent than many early-stage card engines.
2. **Immutable state is the default style.** This makes focused replay, test fixtures, and eventual invariant checking much easier.
3. **The event model is a useful observability substrate.** The problem is dispatch completeness and event meaning, not the absence of events.
4. **The test suite is unusually broad for the project size.** The gap is oracle quality and boundary selection, not developer indifference to testing.
5. **Ruleset manifests make semantic experiments reproducible.** They need consolidation into an authoritative version, not removal.
6. **Bots already contain meaningful domain reasoning.** Once the legal action and choice surfaces are complete, the heuristic is a useful baseline to refine.
7. **Balance tools acknowledge uncertainty.** Wilson intervals, seat alternation, paired tools, and diagnostic documents are steps in the right direction even where current composition is unsound.
8. **Data validation exists and is extensible.** It is a suitable place to add semantic reachability and generated card scenarios.
9. **The current working tree is actively closing gaps.** v3 additions for printed triggers, React, equipment triggers, activation-after-deploy, and Hero auras show correct problem recognition, though not yet complete integration.

## Recommended remediation order

These are review recommendations only. No remediation was performed.

### P0 — Establish authoritative semantics before further balance claims

1. Define one canonical, versioned current-rules manifest and make every normal engine/simulator entry point use it.
2. Make action execution prove legality, preferably by sharing one validation function with enumeration and returning typed rejection reasons.
3. Unify pending choice into one observable state model; make every choice explicitly resolvable by a player/policy.
4. Repair `choose_one`, optional selection, and per-effect target choice.
5. Dispatch turn/phase events through the same trigger pipeline as action events.
6. preserve last-known event-card information and trigger snapshots through recursive dispatch.
7. reset all per-turn counters/replacements exactly at the defined boundary.
8. add state-based destruction after every stat/aura/status transition.
9. centralize draw attempts so every failed draw loses consistently.
10. make “All” untargeted and simultaneous.

### P1 — Repair response, equipment, status, and transformation contracts

1. Split action declaration from resolution with transactional/cancellable state.
2. Put every responseable board ability on the same stack.
3. define exactly when “cast,” “played,” “attacked,” exhaustion, payment, and countering occur.
4. enforce equipment ownership/type and expose remove/transfer in all action surfaces.
5. unify effective traits for combat, filters, counts, and triggers.
6. implement Persistent/Regeneration replacement and one status-duration clock.
7. enforce transform eligibility and same-turn Ultimate lockout at execution.
8. preserve typed X cost through card data, enumeration, bot evaluation, and payment.

### P2 — Make simulations diagnostically valid

1. Fail closed on invalid deck/card/ruleset data.
2. distinguish every terminal/error reason.
3. record declared, accepted, resolved, countered, fizzled, and rejected actions separately.
4. remove panel-index dependence from per-matchup seed streams.
5. hash complete manifests and event traces.
6. ratify v3 only after rules scenarios and every-card semantic tests pass.

### P3 — Replace headline statistical inference

1. Treat seat-swapped seed pairs and deck matchups as explicit experimental units.
2. use paired/blocked estimates for matchup and seat effects.
3. use a binomial or hierarchical model with deck, matchup, seat, and policy structure.
4. bootstrap games or clusters, never the four faction point estimates.
5. correct for multiple comparisons and predeclare decision thresholds.
6. report effect sizes and practical intervals before p-values.
7. separate conclusions about fixed decks/bots from conclusions about factions or human play.

### P4 — Expand play-quality evidence

1. enumerate every legal action class and X value;
2. make choice selection strategic;
3. calibrate policies against puzzle suites, known tactical positions, and ideally human decisions;
4. sample or optimize diverse legal decks per faction/archetype;
5. report policy sensitivity as a first-class uncertainty dimension.

## Proposed acceptance gates

Before calling the engine rulebook-faithful:

- all rulebook compliance rows above are “good” without experimental flags;
- every direct illegal-action probe returns a typed rejection and no mutation;
- every printed card has a generated execution scenario;
- the invariant suite passes over randomized legal games;
- every choice is surfaced and can choose zero where allowed;
- trigger last-known information, multiplicity, recursion, and ordering have scenario tests;
- no living card can have nonpositive HP;
- all draw paths share deckout behavior;
- the current ruleset is tracked, immutable, and embedded in artifacts.

Before calling a balance result decision-grade:

- the engine gates above pass;
- zero unresolved-choice, engine-error, and step-loop games are hidden in timeout;
- decks cover declared archetypes and are legal;
- policies cover the legal action space;
- seed pairing and seat blocking are fixed;
- inference operates on games/clusters with valid dependence assumptions;
- practical thresholds and multiplicity handling are documented;
- the complete run is reconstructible from a clean commit and manifest hashes.

## Source evidence index

Line numbers refer to the reviewed working tree and may move after edits.

| Topic | Primary source |
|---|---|
| Direct execution boundary | `packages/engine/src/state-machine/actions.ts:325-334` |
| Board reactions resolve immediately | `packages/engine/src/state-machine/actions.ts:370-377` |
| Deploy validation and placement | `packages/engine/src/state-machine/actions.ts:642-726` |
| Cast validation and declaration | `packages/engine/src/state-machine/actions.ts:729-760` |
| Pass-turn reset set | `packages/engine/src/state-machine/actions.ts:1230-1296` |
| Hand-size choice stored in machine context | `packages/engine/src/state-machine/game-machine.ts:218-256` |
| Auto-choice forces a selection | `packages/engine/src/effects/effect-runner.ts:11-35` |
| One chosen-target array reused | `packages/engine/src/effects/effect-runner.ts:38-64` |
| Stat modifier lacks death check | `packages/engine/src/effects/interpreter.ts:367-427` |
| Effect draw caps rather than loses | `packages/engine/src/effects/interpreter.ts:441-467` |
| `choose_one` always returns pending | `packages/engine/src/effects/interpreter.ts:1116-1135` |
| Trigger batch/recursion behavior | `packages/engine/src/runtime/dispatch.ts` |
| Missing-card matcher behavior | `packages/engine/src/events/trigger-matcher.ts` |
| Aura replacement rebuilding | `packages/engine/src/runtime/aura-nonstat.ts` |
| Action enumeration limitations | `packages/engine/src/actions/enumerate-actions.ts` |
| Stats composition | `packages/engine/src/sim/summarize-stats.ts:88-215` |
| Ruleset v1 | `packages/engine/sim-data/ruleset-v1.json` |
| Ruleset v2 | `packages/engine/sim-data/ruleset-v2.json` |
| Ruleset v3 | `packages/engine/sim-data/ruleset-v3.json` |
| Simulator defaults and hand stall | `packages/engine/sim-runner.mjs` |
| Ignored unhandled errors | `packages/engine/vitest.config.ts` |
| Printed rulebook | `Documentation/game/Rulebook.md` |

## Limitations of this review

- This is a review of a dirty working tree, not a clean release or solely commit `524d648`.
- `ruleset-v3.json` and several current tests/tools were untracked.
- External production databases and any official deck service were not treated as available evidence; local simulator card data was reviewed.
- The small matrix run was a diagnostic control-flow comparison only.
- No human playtest corpus or expert action labels were available, so play-quality conclusions are based on action-space and policy inspection rather than human correlation.
- No full branch-coverage report was generated.
- The review did not modify engine, card, test, ruleset, or balance artifacts.

## Final conclusion

Aetherion Simulator is closer to a capable experimental engine than its current balance evidence suggests, but farther from an authoritative rules engine than its green suite suggests.

The core engineering direction is credible: immutable transitions, a typed DSL, centralized combat, seeded simulations, event logs, bots, validators, and extensive tests. The blocking issue is semantic authority. Legal actions, printed effects, turn triggers, choices, response timing, and ruleset selection must all converge on one enforceable model.

Until that convergence occurs, the safest interpretation of simulator output is:

> “This is the result of these decks and bots under this exact engine build and flag set.”

It should not yet be elevated to:

> “This is how Aetherion’s rulebook game behaves,” or “this proves the factions/cards are balanced.”
