# Effect DSL Specification

This is the maintained authoring contract for card definitions consumed by the
current engine. The TypeScript unions under `packages/engine/src/types` are the
executable schema; this document explains their semantics. Card data must also
pass `validate-cards.mjs` and the every-card execution corpus.

Status: **diagnostic candidate**, bound to the current rules manifest.

## Ability forms

Every ability has exactly one top-level shape:

```ts
type AbilityDSL =
  | { type: 'triggered'; trigger: Trigger; effects: Effect[]; condition?: Condition }
  | { type: 'aura'; effects: Effect[]; condition?: Condition }
  | { type: 'stat_grant'; modifier: StatModifier; dynamicModifier?: DynamicStatSource };
```

- `triggered` abilities run after a matching event or through an explicit
  activated/counter/flash declaration.
- `aura` abilities contribute continuous derived state while their source and
  condition remain valid.
- `stat_grant` is equipment’s continuous printed stat contribution.

Triggered abilities may declare `cooldown`, `oncePerTurn`, `xCostResource`,
`abilityKind`, and `react`. React abilities exhaust their non-hero source when
accepted and cannot fire while exhausted.

## Effects

The discriminant is always `effect.type`. Supported families are:

| Family | Types |
|---|---|
| Damage and recovery | `deal_damage`, `heal`, `cleanse` |
| Stats and traits | `modify_stats`, `grant_trait`, `grant_ability`, `apply_status` |
| Cards and zones | `draw_cards`, `scry`, `discard`, `bounce`, `exile`, `destroy`, `sacrifice`, `return_from_discard`, `search_deck`, `shuffle_into_deck`, `copy_card`, `deploy_from_deck` |
| Board creation/mutation | `deploy_token`, `move`, `attach_as_equipment` |
| Resources and costs | `gain_resource`, `cost_reduction` |
| Stack and timing | `counter_spell`, `replacement`, `scheduled` |
| Composition | `choose_one`, `conditional`, `composite` |

Unknown effect types are data errors. They may not silently resolve as no-ops in
the current profile.

### Atomic and simultaneous semantics

`composite.effects` resolve in authored sequence. A target expression beginning
with `all_` resolves its complete target snapshot before changes are applied.
Damage/death caused by that snapshot is observed as one atomic batch, followed
by state-based stabilization. `choose_one` creates an explicit continuation;
the engine never selects a branch implicitly.

`draw_cards` attempts each draw through the draw service. Drawing from an empty
main deck is an immediate typed loss under current rules.

## Targets

Targets are structural expressions, not instance IDs embedded in card data.
Supported selectors include:

- `self`, `source_character`, `equipped_character`, and `owner_hero`;
- allied/enemy `hero`, `target_character`, and `target_equipment`;
- `all_characters`, `all_characters_in_zone`, and `up_to`;
- `adjacent_to_self`;
- `target_card_in_discard`, `target_spell`, and `player`;
- `random`, `copy_of`, and `each_player`.

Filters can constrain trait, cost, HP, ATK, card type, tag, self-exclusion, or
cost relative to the triggering context.

Target protection applies to explicit targeting. Current manifest semantics do
not apply target protection to simultaneous `all` effects. Resolve targets from
a state snapshot; do not retain live object references.

## Amount expressions

Numeric fields accepting `AmountExpr` support literal numbers plus the
discriminated counting/dynamic forms in `types/common.ts`. Dynamic amounts are
evaluated from the effect context and the pre-effect snapshot. X costs are typed
by their printed resource component and use the payment recorded at
declaration.

## Conditions

Conditions are pure boolean expressions over state, source, player, and event
context. They include:

- HP/stat/cost/resource comparisons;
- zone, card-count, trait, and card-type checks;
- turn counters and transformation state;
- board-control and opponent comparisons;
- triggering-event context;
- `and`, `or`, and `not` composition.

An aura condition is reevaluated during derivation. A triggered condition is
evaluated against the matching event context. A malformed or contextless
condition is a validation failure, not `false` by convenience.

## Triggers

Trigger kinds cover deploy, destroy/die/leave, turn boundaries, attacks,
damage, lethal damage, blocks, allied lifecycle, spell casts, sacrifice,
healing/overhealing, equipment, resources, stat changes, activated abilities,
counter, and flash.

Lifecycle terms are distinct:

- `on_dies`: combat-caused death;
- `on_destroy`: destruction by any applicable means, including combat;
- `on_leaves_battlefield`: destroy, exile, bounce, or return.

Matching uses immutable event envelopes and last-known source/card snapshots.
Registration is source-owned; leaving the relevant zone unregisters live
triggers without erasing already-created event facts.

## Durations and statuses

Durations are `instant`, `until_end_of_turn`, `until_next_upkeep`, `permanent`,
`for_combat`, and `while_in_play`. Expiry is centralized in the duration
lifecycle and turn-boundary owners.

Statuses are `persistent`, `regeneration`, `slowed`, `stunned`, `hexproof`, and
`anti_redirect`. Reapplying persistent or regeneration values retains the
higher value. Persistent damage uses the ordinary damage pipeline. Stun ticks
once at its controller’s upkeep.

## Choices and continuations

Effects requiring player input return a `PendingChoice` with a unique
interaction ID, legal responder, typed choice kind, options, and continuation.
A response must repeat that ID and responder. Stale, malformed, duplicate, or
out-of-range responses reject without changing state. Accepted responses resume
the stored effect/turn continuation exactly once.

## Authoring validation

Before a card can support current correctness claims:

1. its JSON shape must match the DSL unions;
2. semantic validation must find no unexplained unknown/stub/no-op behavior;
3. its required scenario inventory must be populated;
4. the every-card corpus must execute each printed ability/effect path;
5. any temporary exception must have a narrow owner, reason, and expiry.

The authoritative sources are:

- `src/types/ability.ts`, `effects.ts`, `targets.ts`, `conditions.ts`,
  `triggers.ts`, and `durations.ts`;
- `src/effects/interpreter.ts` and specialized handlers;
- `src/sim/card-data-validator.ts`;
- `sim-data/card-semantic-exceptions.json`.
