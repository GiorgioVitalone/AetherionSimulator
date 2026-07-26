# Null-DSL card authoring — Lyria Archmage Supreme (74) + Twilight Prism Warden (145)

The live DB has 4 abilities with `dsl: null` across 2 cards. The engine executes the DSL, not the
prose `effect` text, so these abilities **do nothing in game**. Card 74 is the Sapphire hero's
transformed side; its missing DSL costs Sapphire ~10 percentage points of win rate (measured:
live-DB pool spread 14.9 with Sapphire at 39.1%, vs 1.9 with all four starters at 49–51% when the
abilities are present).

Drafted below from each ability's printed text, using the engine's existing DSL vocabulary
(`src/types/effects.ts`, `targets.ts`, `triggers.ts`, `durations.ts`). Reviewed idioms against
existing cards (Kaelthar's Ultimate for the activated-trigger shape; Witchstone / Soulstealer Blade
for `grant_ability`).

---

## Card 74 — Lyria Archmage Supreme (Sapphire hero, transformed side)

### 1. Arcane Convergence — Trigger, cost 2 Mana, cooldown 1
> "When you cast a spell, you may pay 2 Mana to return target enemy character with cost ≤ that
> spell's cost to its owner's hand."

```json
{
  "type": "triggered",
  "trigger": { "type": "on_spell_cast", "side": "allied" },
  "cooldown": 1,
  "effects": [
    {
      "type": "bounce",
      "target": {
        "type": "target_character",
        "side": "enemy",
        "filter": { "costRelativeTo": { "reference": "cast_spell", "offset": 0 } }
      }
    }
  ]
}
```
`costRelativeTo.reference: "cast_spell"` with `offset: 0` is exactly "cost ≤ the cast spell's cost".
The 2-Mana payment stays on the ability's printed `cost` field. **Open nuance:** the printed text
says *"you may pay"* (optional); the engine's triggered abilities fire automatically, so this is
modelled as mandatory-on-trigger. If optionality matters, it needs an `optional` flag on the
trigger (does not currently exist) — flagged for the card owner rather than silently changed.

### 2. Supreme Intellect — Aura
> "The first spell you cast each turn costs 1 less Mana (minimum 1)."

```json
{
  "type": "aura",
  "effects": [
    {
      "type": "cost_reduction",
      "reduction": 1,
      "appliesTo": { "cardType": "S", "firstPerTurn": true },
      "duration": { "type": "while_in_play" }
    }
  ]
}
```
`CostReductionFilter.firstPerTurn` models "the first spell each turn" directly. The "(minimum 1)"
clause is already enforced globally by the `costFloor` rule (on in ruleset-v2).

### 3. Arcane Singularity — Ultimate, cost 5 Mana, cooldown 3
> "Draw cards equal to the number of spells in your discard pile (maximum 5). Until end of turn,
> your spells deal 1 damage to all enemy characters when cast."

```json
{
  "type": "triggered",
  "trigger": { "type": "activated", "cost": { "mana": 5, "energy": 0, "flexible": 0 }, "cooldown": 3 },
  "effects": [
    {
      "type": "draw_cards",
      "player": "allied",
      "count": {
        "type": "count",
        "counting": { "type": "cards_in_zone", "zone": "discard", "side": "allied", "filter": { "cardType": "S" } },
        "max": 5
      }
    },
    {
      "type": "grant_ability",
      "target": { "type": "hero", "side": "allied" },
      "duration": { "type": "until_end_of_turn" },
      "ability": {
        "trigger": { "type": "on_spell_cast", "side": "allied" },
        "effects": [
          { "type": "deal_damage", "amount": { "type": "fixed", "value": 1 }, "target": { "type": "all_characters", "side": "enemy" } }
        ]
      }
    }
  ]
}
```
The second clause is a temporary triggered ability — `grant_ability` on the hero with
`until_end_of_turn`, mirroring the Witchstone/Soulstealer idiom.

---

## Card 145 — Twilight Prism Warden (Character, Sapphire/Amethyst)

### Deploy
> "Look at the top 2 cards of your deck. Put one in your hand and one on the bottom."

```json
{
  "type": "triggered",
  "trigger": { "type": "on_deploy" },
  "effects": [
    {
      "type": "scry",
      "lookCount": 2,
      "action": { "type": "pick_and_remainder", "pickCount": 1, "pickTo": "hand", "remainder": "bottom" }
    }
  ]
}
```
`ScryAction.pick_and_remainder` maps the text one-to-one.

---

## Applying

These belong in the DB's `abilities[].dsl` column for cards 74 and 145 (the balance SQL patch only
touched `stats`/`cost`). After authoring, re-run the live-DB measure — Sapphire should return to
~49% and the four starters to a ~2-point spread.
