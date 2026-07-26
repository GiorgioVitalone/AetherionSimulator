# Lyria redesign candidates — pick one (owner decision)

## Why a redesign is needed

The composition rule is **Hero = exactly 1 Aura + 1 Trigger**, **Transformed = exactly 1 Aura + 1
Trigger + 1 Ultimate**, and per the Rulebook (L446) a `[Trigger]` is an **activated** ability ("pay the
cost and resolve the effect"). Lyria breaks this on both sides:

| | Current | Problem |
|---|---|---|
| **H 135 Arcanist Lyria** | Trigger (Arcane Insight, `on_spell_cast`) + Aura (Knowledge Shield) | Count is legal, but the `[Trigger]` is **event-driven, not activated** — illegal. |
| **T 74 Lyria Archmage Supreme** | 5 abilities: 2 Triggers + 2 Auras + Ultimate | **Count illegal.** Uniquely inherits its base hero's whole kit and stacks 3 more on top — no other transform does this. Both its `[Trigger]`s are event-driven. |

Sapphire currently sits at **46.9%** under the corrected engine (post-W0), so the redesign should be
roughly power-neutral-to-slightly-positive, not a nerf.

Every DSL below is written against the engine's actual schema and uses idioms already present in the
pool (`cost_reduction` with `firstPerTurn`, `draw_cards` with a `count` expression, `bounce` with
`costRelativeTo`, `grant_ability` with `until_end_of_turn`).

---

## Candidate A — "Tempo" (recommended)

Keeps Lyria's identity as a spell-tempo hero. The base hero's payoff moves into the Aura (legal there,
since `[Aura]` may use "when" with no proc limit); the Trigger becomes a genuine activated ability.

### H 135 Arcanist Lyria
- **[Aura] Arcane Insight** — "When you cast your second spell in a turn, draw a card."
  ```json
  {"type":"aura","effects":[{"type":"grant_ability","target":{"type":"hero","side":"allied"},
   "duration":{"type":"while_in_play"},
   "ability":{"trigger":{"type":"on_spell_cast","side":"allied"},
    "effects":[{"type":"draw_cards","count":{"type":"fixed","value":1},"player":"allied"}],
    "condition":{"type":"turn_count","value":2,"action":"spell_cast","comparison":"equal"}}}]}
  ```
  *(Simpler alternative if the grant wrapper is unwanted: keep the existing `triggered` DSL verbatim and
  simply relabel the category to `[Aura]` — the engine reads only the DSL, so this is a one-word change.)*
- **[Trigger] Foresight** — activated, 2 Mana, cooldown 1: "Look at the top 2 cards of your deck. Put one
  in your hand and one on the bottom."
  ```json
  {"type":"triggered","trigger":{"type":"activated","cost":{"mana":2,"energy":0,"flexible":0},"cooldown":1},
   "effects":[{"type":"scry","lookCount":2,
    "action":{"type":"pick_and_remainder","pickCount":1,"pickTo":"hand","remainder":"bottom"}}]}
  ```

### T 74 Lyria Archmage Supreme
- **[Aura] Supreme Intellect** — "The first spell you cast each turn costs 1 less Mana (minimum 1). When
  you cast your second spell in a turn, draw a card." *(folds Arcane Insight in — legal in one Aura slot)*
  ```json
  {"type":"aura","effects":[
   {"type":"cost_reduction","reduction":1,"appliesTo":{"cardType":"S","firstPerTurn":true},
    "duration":{"type":"while_in_play"}},
   {"type":"grant_ability","target":{"type":"hero","side":"allied"},"duration":{"type":"while_in_play"},
    "ability":{"trigger":{"type":"on_spell_cast","side":"allied"},
     "effects":[{"type":"draw_cards","count":{"type":"fixed","value":1},"player":"allied"}],
     "condition":{"type":"turn_count","value":2,"action":"spell_cast","comparison":"equal"}}}]}
  ```
- **[Trigger] Arcane Convergence** — activated, 2 Mana, cooldown 1: "Return target enemy character with
  cost 3 or less to its owner's hand." *(the printed 2 Mana is now actually charged)*
  ```json
  {"type":"triggered","trigger":{"type":"activated","cost":{"mana":2,"energy":0,"flexible":0},"cooldown":1},
   "effects":[{"type":"bounce","target":{"type":"target_character","side":"enemy",
    "filter":{"maxCost":3}}}]}
  ```
- **[Ultimate] Arcane Singularity** — unchanged (5 Mana, cd 3).

**Net effect vs today:** base hero loses nothing (draw moves to the Aura) and gains a real activated
ability. Transformed loses Knowledge Shield (+1 HP aura) but keeps everything else and its bounce
becomes reliably usable (no longer needs a spell cast to trigger). Roughly power-neutral.

---

## Candidate B — "Defensive"

Keeps **Knowledge Shield** as the identity instead of the draw, for a grindier Sapphire.

### H 135
- **[Aura] Knowledge Shield** — "While you have 5 or more cards in hand, allied characters gain +1 HP."
  *(unchanged, existing DSL)*
- **[Trigger] Arcane Insight** — activated, 1 Mana, cooldown 2: "Draw a card."
  ```json
  {"type":"triggered","trigger":{"type":"activated","cost":{"mana":1,"energy":0,"flexible":0},"cooldown":2},
   "effects":[{"type":"draw_cards","count":{"type":"fixed","value":1},"player":"allied"}]}
  ```

### T 74
- **[Aura] Knowledge Shield** — as above.
- **[Trigger] Arcane Convergence** — activated bounce, as in Candidate A.
- **[Ultimate] Arcane Singularity** — unchanged.

**Net effect:** loses the cost reduction entirely; more resilient, less explosive. Probably a small nerf
to Sapphire, which is already the weakest post-W0 — **not recommended** unless the grindy identity is
wanted for design reasons.

---

## Candidate C — "Storm" (most aggressive)

Leans hardest into the spell theme; highest power, use if Sapphire needs a real push.

### H 135
- **[Aura] Supreme Intellect** — "The first spell you cast each turn costs 1 less Mana (minimum 1)."
  *(moves the cost reduction onto the BASE hero — a meaningful buff, since it applies from turn 1)*
- **[Trigger] Foresight** — activated scry, as in Candidate A.

### T 74
- **[Aura] Arcane Insight** — "When you cast a spell, draw a card." *(every spell, not just the second —
  strong; pair with a `oncePerTurn` if it proves oppressive)*
- **[Trigger] Arcane Convergence** — activated bounce, as in Candidate A.
- **[Ultimate] Arcane Singularity** — unchanged.

**Net effect:** clear buff on both sides. Only pick this if the re-derivation shows Sapphire needs more
than a couple of points.

---

## Recommendation

**Candidate A.** It preserves Lyria's existing identity almost exactly, makes both sides legal, charges
the Convergence cost that is currently silently dropped, and is close to power-neutral — which keeps the
upcoming balance re-derivation interpretable. If Sapphire still lags after the re-measure, moving the
cost reduction to the base hero (Candidate C's first change) is the natural single-lever buff.
