# Current Game Rules Summary

This is an engine-facing quick reference. The complete source is
[`Documentation/game/Rulebook.md`](../Documentation/game/Rulebook.md); exact
machine settings are in
[`ruleset-current.json`](../packages/engine/sim-data/ruleset-current.json).

Status: **diagnostic candidate**, semantic version `4.0.0-diagnostic.3`.
External rules ratification is still required before decision-grade balance
claims.

## Setup

- Each player has a Hero, main deck, and 12-card resource deck.
- The selected first player skips their first main-deck draw and cannot attack
  on their first turn.
- Mulligans and first-player selection are explicit interactions.
- Current games must be created with `createCurrentGame` or an equivalent
  manifest-bound setup.

## Turn sequence

1. **Upkeep:** refresh eligible cards, draw Resource and Main Deck cards when
   required, expose optional Reserve generation as step 4, then resolve
   start-of-turn triggers. The exclusive transformation window follows Upkeep
   and precedes Strategy.
2. **Strategy:** deploy characters, cast legal spells/equipment, move cards,
    activate legal abilities, and pass.
3. **Action:** declare attacks and other timing-permitted actions. All
   declarations can open response windows.
4. **End:** emit turn-end observations, resolve scheduled work, remove temporary
   resources, expire end-of-turn effects, enforce hand size through an explicit
   continuation, reset scoped counters, change active player, and emit the next
   turn start.

The turn boundary is resumable: a hand-limit or trigger-order choice pauses and
continues the same boundary rather than starting a second one.

## Zones and movement

Battlefield zones are Reserve, Frontline, and High Ground. Legal movement and
attack targets come from canonical zone/trait selectors. Exile is a durable
zone. Discarding a card for energy sends it to exile. Removed equipment goes to
discard and emits `equipment_removed`.

A card instance has one owner and one location. Equipment ownership remains the
printed owner even while attached.

## Costs and resources

- Costs have mana, energy, and flexible components.
- Flexible payment is a player choice recorded at declaration.
- Cost reductions cannot reduce a payable cost below 1.
- X is tied to its printed resource component and the amount actually paid.
- Reserve generation is an optional strain choice exposed only during Upkeep
  step 4.
- Resource kinds come from schema data, not card-name inference.

Rejected declarations do not spend resources, exhaust sources, increment
counters, or alter zones.

## Timing, priority, and stack

Casting, attacking, equipping, moving, transforming, and activating are
authoritatively validated. Flash is legal at its printed timing. Every accepted
declaration may expose a priority window. Reactive links resolve last-in,
first-out after both players pass.

Spell-cast observation occurs at declaration. Attack exhaustion also commits at
declaration. Equipment attaches at resolution. A countered declaration keeps
its paid/declaration facts but does not apply its resolution effect.

## Combat

Attack legality uses effective traits and zones. Defender, Flying, Sniper,
readiness, summoning sickness, and first-turn restrictions are enforced at the
transition boundary. Combat declaration is transactional.

Combat damage is calculated from a simultaneous snapshot. Replacements and ARM
apply through the combat pipeline. Combat-caused death, general destruction,
and leaving the battlefield are separate event categories.

## Effects and choices

All explicit choices carry an interaction ID, responder, legal options, and a
serializable continuation. Stale or invalid responses reject atomically.

Effects targeting `all` snapshot their entire target set and apply as one
batch. Current rules do not apply explicit-target protection to those
simultaneous sets. State-based deaths run after each atomic transition.

Drawing from an empty main deck is an immediate loss, including draws caused by
effects.

## Triggers and continuous effects

Events carry monotonic sequence and last-known source/card information. Trigger
dispatch uses active-player/non-active-player ordering; each owner chooses the
order of simultaneous triggers they control.

Auras from cards, equipment, and heroes are recomputed from live sources.
Derived stats, traits, replacements, triggers, statuses, and reductions must
match the recorded aura derivation at every stable boundary.

## Status and duration rules

- Reapplying persistent or regeneration retains the higher value.
- Persistent damage uses ordinary effect-damage replacements and observations.
- Stun ticks once during its controller’s upkeep.
- Combat traits expire after combat.
- Instant traits expire after the atomic transition.
- End-of-turn, next-upkeep, while-in-play, and permanent durations expire only
  at their named semantic boundary.

## Transformation and game end

Transformation is declared only at the start of the active player’s turn, after
Upkeep and before Strategy. Hero activated abilities are once per turn unless
printed otherwise, and an ultimate cannot be used on the turn its Hero
transforms.

Terminal gameplay reasons are normal win, concession, and deck exhaustion.
Turn-cap draw is an explicit simulation endpoint. Step-cap loops, unresolved
choices, guard exhaustion, illegal actions, bot exceptions, engine exceptions,
and invalid data/configuration are infrastructure failures, not gameplay wins
or draws.

## Evidence status

The current manifest is hash-bound to its rulebook revision, engine schema,
card schema, and replay schema. The primary-study manifest additionally binds
the card pool, engine build, decks, policy, seeds, endpoints, and validity
gates. Until its required independent approvals are present, generated results
must remain labeled diagnostic.
