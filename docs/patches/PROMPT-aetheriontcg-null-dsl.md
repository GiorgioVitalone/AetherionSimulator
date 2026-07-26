# Prompt for the AetherionTCG agent — author missing ability DSL

**TASK:** Two cards in the live Aetherion card database have abilities with `dsl: null`. The game
engine executes the machine-readable `dsl`, not the prose `effect` text, so these abilities **do
nothing in game**. Author the DSL for them in the DB. Work in the CustomTCG repo at
`/Users/gvitalone/Projects/personal/AetherionTCG` (the card DB owner).

## Why this matters (measured, not theoretical)

Card 74 is the Sapphire hero's **transformed side**. With its three abilities inert, Sapphire's win
rate collapses. Measured on the simulator, same rules and decks, only difference being whether
these abilities work:

| Pool | Spread | Sapphire |
|---|---|---|
| abilities working | 1.9 | 49.2% |
| abilities `dsl: null` (current live DB) | 14.9 | **39.1%** |

So the live DB currently plays ~10 points off balance for Sapphire purely because of this gap. The
card stats themselves are correct (the balance SQL patch applied cleanly and is verified).

## The affected cards

- **id 74 — Lyria Archmage Supreme** (Sapphire hero, transformed side): 3/3 abilities `dsl: null`.
  The abilities were redesigned in the DB (Arcane Convergence / Supreme Intellect / Arcane
  Singularity) but the DSL was never authored.
- **id 145 — Twilight Prism Warden** (Character, Sapphire/Amethyst): 1/1 ability `dsl: null`.
  Currently in no starter deck, so harmless today — fix it before it enters one.

## CRITICAL design constraint — do not "simplify" the optional ability

Arcane Convergence reads *"you **may** pay 2 Mana to…"*. It **must** be modelled as a player
choice, using `choose_one` with a real decline option. Do **not** model it as an ability that
always fires, and do not leave it inert.

**Reason:** an always-fires model inflates the card, and an inert model deflates it — *both falsify
the balance measurement*. Modelled as `choose_one`, the piloting bot evaluates whether paying is
worth it in each spot, which is what the balance simulation is designed to measure. This is the
single most important instruction in this task.

## The DSL to author

Validated against the engine's DSL schema (`packages/engine/src/types/{effects,targets,triggers,
durations}.ts` in the AetherionSimulator repo) and against existing card idioms.

### Card 74, ability 1 — Arcane Convergence (Trigger, printed cost 2 Mana, cooldown 1)
> "When you cast a spell, you may pay 2 Mana to return target enemy character with cost ≤ that
> spell's cost to its owner's hand."

```json
{
  "type": "triggered",
  "trigger": { "type": "on_spell_cast", "side": "allied" },
  "cooldown": 1,
  "effects": [
    {
      "type": "choose_one",
      "options": [
        {
          "label": "Pay 2 Mana: bounce an enemy character of equal or lower cost",
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
        },
        { "label": "Decline", "effects": [] }
      ]
    }
  ]
}
```

### Card 74, ability 2 — Supreme Intellect (Aura)
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
The "(minimum 1)" clause needs no DSL — it is enforced globally by the `costFloor` rule.

### Card 74, ability 3 — Arcane Singularity (Ultimate, 5 Mana, cooldown 3)
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

### Card 145 — Twilight Prism Warden (Deploy)
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

## How to apply

The abilities live in the `cards.abilities` **jsonb array** column (table is lowercase `cards`;
verify before writing). Each element has a `dsl` key currently set to `null`. Set the `dsl` of
element *i* for the given card id, e.g.:

```sql
UPDATE cards SET abilities = jsonb_set(abilities, '{0,dsl}', '<json>'::jsonb) WHERE id = 74;
```

Steps:
1. **Verify the schema first** — confirm the table name, that `abilities` is jsonb, and the array
   order matches the ability order above (ability 1 = index 0). Do not assume.
2. **Back up first:** `pg_dump --no-owner -t public.cards "$DATABASE_URL" > backup-pre-dsl-$(date +%Y%m%d).sql`
3. Apply the four `jsonb_set` updates (3 for card 74, 1 for card 145) in a transaction.
4. **Verify:** re-query both cards and confirm no ability has a null `dsl`:
   ```sql
   SELECT id, name, jsonb_array_length(abilities) AS n,
          (SELECT count(*) FROM jsonb_array_elements(abilities) e WHERE e->>'dsl' IS NULL) AS nulls
   FROM cards WHERE id IN (74, 145);
   ```
   Both rows must show `nulls = 0`.
5. Re-sync whatever card export/JSON artifact the repo keeps (e.g. the root `aetherion-cards.json`).

## Also worth checking (audit)

Run the same null-DSL check across the **whole** table, not just these two — if other cards were
authored as prose without DSL, they are silently inert too:
```sql
SELECT id, name FROM cards
WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(abilities) e WHERE e->>'dsl' IS NULL);
```
Report anything else it finds.

## Expected outcome — and an important caveat

Authoring this DSL **fixes the inert-ability bug** (that part is certain and verified: the engine
accepts and executes the DSL). It does **not** necessarily restore Sapphire to the balanced state.

Measured on the simulator at matched settings (r8d3, gpp 60):

| Pool | Sapphire | Spread |
|---|---|---|
| balance-validated frozen pool | 49.4% | 3.9 |
| live DB with `dsl: null` (today) | ~39% | ~15 |
| live DB with this DSL authored | 44.4% | 11.7 |

Sapphire recovers most of the deficit but stays ~5 points light. The likely reason: **Lyria's
abilities were redesigned in the DB after the balance pass** (Arcane Convergence / Supreme
Intellect / Arcane Singularity replaced Arcane Insight / Knowledge Shield / a bounce), and the new
set appears weaker in play than the set the balance was validated against. Modelling the "may" as a
genuine choice (rather than always-firing) also legitimately costs some power — which is correct
behaviour, not a bug.

So: **author the DSL** (it is the faithful implementation of the printed cards), then treat
Sapphire's balance as an open question for a follow-up pass in the simulator repo. Do not "fix" the
gap by strengthening the DSL beyond what the cards say.

## Report back

What you applied, the schema you verified, the verification query output, anything else the
whole-table audit surfaced, and any DSL above that the engine rejected (if the schema has drifted).

## Known engine gap (not your task — for the record)

The printed text "you **may pay** 2 Mana" is modelled above as `choose_one`, which makes the
*effect* optional. The engine has no way to model an optional **cost payment** on a triggered
ability. That is a real gap worth an engine ticket — until then, `choose_one` is the faithful
approximation.
