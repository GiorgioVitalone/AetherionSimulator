# Sapphire Starter Deck — Card-by-Card Redesign Proposal

**Deck:** Starter Deck Sapphire - Lyria's Convergence (hero: **Arcanist Lyria**, 30 LP)
**Scope:** all 16 distinct cards in the Sapphire starter (40 cards total). Card data lives in
the shared PostgreSQL DB (CMS is the source of truth); `packages/engine/sim-data/aetherion-cards.json`
is only a generated mirror consumed by the sim/balance tooling. **This document is the thing to
hand-transcribe into the CMS — nothing here was written back to the committed JSON.**

## Why

Sapphire was assembled but never got the individual card-by-card design pass the other 3
starters received. Comparing the 4 starters surfaced four structural gaps unique to Sapphire:
no early play (cheapest creature was cost 2), an ATK ceiling capped at 2 across all 7 creatures,
zero reach/face-damage anywhere in the 40-card deck, and 10 of 16 distinct cards emitting the
identical generic "draw/look at cards" signal (vs. 5-8 distinct effect verbs in the other three
factions). The rarity skeleton (9 Common / 4 Ethereal / 2 Mythic / 1 Legendary) was already
correct and is untouched here — every redesign stays inside the card's existing rarity slot.

Two cards were already well-designed and are explicitly **not touched**: **Sapphire Sentinel**
and **Crystal Golem** (a matched Defender + self-damage-reduction wall pair at cost 2 / cost 3).

## What changed, at a glance

**9 of 16 cards redesigned**, 2 given a light numeric-only tweak, 5 kept as-is (including the 2
untouchable walls). Net result:

- **New 1-drop:** Arcane Scholar becomes a real cost-1 creature (was cost 2).
- **New attacker/pressure payoff:** Master Archivist's ATK goes 2→4 (first Sapphire creature
  ever to break ATK 3), and Spellbound Adept becomes a permanent-growth combat threat that
  snowballs off spells cast, instead of just drawing more cards.
- **New reach, twice over:** Arcane Storm (the cost-8 top-end slot) now deals face damage scaled
  by spells cast that turn on top of its board bounce; Lens of Foresight becomes a cheap arcane
  weapon that pings the enemy Hero on every hit. Reach signal count: 0 → 2 distinct sources.
- **card_flow redundancy cut from 10/16 (62%) to 5/16 (31%)** — in line with the other factions'
  spread (Onyx sits at 8/16, for reference) — by diversifying into removal (Wizard's Focus),
  a hand-size stat payoff (Mystic Librarian), and two combat-growth effects (Scholar, Spellbound
  Adept), while leaving genuine "draw faction" redundancy where it's thematically load-bearing
  (Glimpse the Future / Time Reversal / Arcane Echoes remain distinct draw *sub-verbs*: loot,
  graveyard recursion, and spell-copy, respectively).
- **Rarity skeleton unchanged** (verified programmatically): 9 Common / 4 Ethereal / 2 Mythic /
  1 Legendary, same as before and same as the other 3 starters.

## Validation

All numbers below come from the engine's own first-principles formula
(`packages/engine/dist/balance/index.js` — `computeCardPower` / `computeDeckValue`), run against
a scratch-patched copy of the card pool (Sapphire changed, Onyx/Radiant/Verdant left at
baseline), plus a directional sim-runner pass. No source under `packages/engine/src/` was
touched, and the committed `sim-data/aetherion-cards.json` was never edited — only read.

### Deck-value model (`computeDeckValue`)

| Faction | Baseline value | Patched value | Δ |
|---|---|---|---|
| Onyx (untouched) | 192.76 | 192.76 | — |
| Radiant (untouched) | 293.22 | 293.22 | — |
| **Sapphire** | **198.45** | **226.17** | **+27.72 (+14.0%)** |
| Verdant (untouched) | 206.28 | 206.28 | — |

Sapphire moves from second-worst (barely ahead of Onyx, well behind Verdant) to solidly ahead
of both Onyx and Verdant, while staying well below Radiant — i.e. it closes the gap without
leapfrogging into the "new top dog" problem the diagnosis explicitly warned about.
`acceleration` (the model's cost-aware ramp/early-tempo term, which structurally can't see a
cost-free per-card score) goes from **0 → 5.42**, directly reflecting the new 1-drop — this
sub-metric was Sapphire's single starkest outlier before ("no early play" wasn't just a read of
the curve, the model's own deck-level accelerant term was flatly zero).

### Per-card power vs. same-cost/rarity peers in other factions

Every redesigned card was checked with `computeCardPower` against real peers at the identical
cost+rarity slot elsewhere in the 130-card pool (not just other Sapphire cards), per the
session's calibration method. Notable checks:

- **Master Archivist** (c6 Mythic, now 4/5/0): its only two true peers in the whole pool at
  cost 6 Mythic are Ancient Treant (Verdant, 4/7/0) and Archon's Guardian (Radiant, 3/3/0 +aura).
  ATK 4 matches Ancient Treant exactly; total stats (9) sits between the two peers. Power 10.44,
  up from a baseline 8.44 that was suspiciously identical to a cost-**5** Common (Zombie Horde,
  Onyx) — i.e. the old Archivist was pricing like a cheaper, lower-rarity card.
- **Arcane Echoes** (c5 Mythic): the whole-pool linear budget model flags the baseline (1.20) as
  "-7.90 under expected," but that expectation is dominated by big creature bodies at that
  cost/rarity slot — the correct peer cluster is other **spells/equipment** at c5 Mythic (Plague
  Burst 2.0, Tech Bloom 3.0, Celestial Aegis 1.54, Holy Avenger 2.6). The redesign (3.6) sits
  at the top of that real cluster, not the inflated mixed-type one.
- **Arcane Scholar** (new 1-drop, on-spell-cast self-buff): power 3.92, an exact match for
  Radiant's actual printed 1-drop, Blessed Squire (also 3.92, near-identical shape).
- **Spellbound Adept** (permanent self-buff on spell cast): power 5.92, identical to its own
  baseline (a coincidence of the formula, confirmed by direct calculation) — i.e. a strictly
  better, on-theme redesign at unchanged, already-fair power.
- **Mana Leak**: `counter_spell`'s formula value is a flat constant regardless of the `unlessPay`
  amount (confirmed identical, 0.45, on the pool's other `unlessPay`-free Counterspell card) —
  a known modeling gap, not a real card weakness. Left as a light numeric-only tweak rather than
  a full redesign; see its entry below.

**Formula caveat applied throughout:** the score is cost-free by design, and the effect-sum cap
(12, pre-recurrence) means some additions — notably Arcane Storm's added reach clause — don't
move the card's own `power` number at all despite adding real value, because the card was
already at the cap. Where this applies it's called out per-card below; the fix is confirmed to
land correctly in the `provides` signal list regardless (this is what deck-level `interSynergy`
and future demand-matching actually consume), and the sim-level result (next section) confirms
the change matters in play even where the static number can't move.

### Sim-runner directional check

Ran `sim-runner.mjs --reachDiscard true --exileDiscardForEnergy true --valuePilot true
--gamesPerPairing 120` against the patched pool (`AETHERION_CARDS` override) and, for a clean
apples-to-apples comparison, against the unpatched baseline pool under the identical flags:

| | Onyx | Radiant | **Sapphire** | Verdant |
|---|---|---|---|---|
| Baseline (this flag set) | 50.6% | 66.5% | **25.2%** | 47.3% |
| Patched (Sapphire only) | 45.5% | 63.8% | **44.3%** | 45.3% |

Sapphire moves **+19.1 points** (25.2% → 44.3%), toward the ~50% parity line, while Radiant
softens slightly (66.5% → 63.8%, expected — Sapphire's redesign only gets tougher for other
decks to beat, it isn't a Radiant nerf) and the two untouched factions stay within normal
run-to-run noise of their own baselines. A repeat run with a different seed base landed Sapphire
at 43.4%, confirming the result is stable (~1 pt spread), not a lucky seed. This is a directional
check, not a target — the goal per the brief was "moves up toward parity without blowing past
Radiant," which it does on both counts.

---

## Per-card entries

Sorted by cost, matching the printed curve. `cardCode` included for CMS lookup.

### Arcane Scholar (`CORE1-C-S-067`) — REDESIGN

- **Current:** Cost 2 Mana, Common, Character, 1 ATK / 2 HP / 0 ARM. *"When deployed, if you
  have an Arcane spell in hand, draw a card."* Weakest cost-2 body in the entire 130-card pool.
- **Proposed:** Cost **1** Mana, Common, Character, **1 ATK / 1 HP / 0 ARM**. New ability:
  *"Whenever you cast a spell, this character gains +1/+1 until end of turn."* DSL: `triggered`,
  trigger `{ type: "on_spell_cast", side: "allied" }`, effect `modify_stats` on `self`,
  `duration: until_end_of_turn`, `modifier: { atk: 1, hp: 1 }` (mirrors Radiant's Blessed Squire
  shape exactly, minus its Radiant-tag filter — kept unfiltered here so it triggers off *any*
  spell, fitting Lyria's broad spell-density payoff rather than a narrower tribal gate).
- **Rationale:** This is the deck's missing 1-drop. The old conditional-draw ability was
  low-impact filler at a body that was already the pool's weakest cost-2 creature; moving it to
  cost 1 with a spell-reactive combat buff turns it into a real early play that also plugs
  straight into the hero's `spell_density` identity instead of adding an 11th instance of "draw
  more cards."

### Sapphire Sentinel (`CORE1-C-S-068`) — KEEP (do not touch)

- **Current:** Cost 2 Mana, Common, Character, 1 ATK / 2 HP / 0 ARM, Defender. *"The first
  damage this would take each turn is reduced by 1."*
- **Rationale:** Confirmed well-designed — a Defender + self-damage-reduction wall, one of only
  two cards in the deck already scoring competitively against cross-faction peers. Explicitly
  excluded from this pass. No changes of any kind.

### Mana Leak (`CORE1-S-S-078`) — REDESIGN (light, numeric only)

- **Current:** Cost 2 Mana, Common, Spell. *"Counter target spell unless its controller pays
  2."* Trigger `on_flash`.
- **Proposed:** Cost 2 Mana, Common, Spell. *"Counter target spell unless its controller pays
  3."* Same DSL shape, only `unlessPay.mana` changes from `2` to `3`.
- **Rationale:** A distinct, already-fine verb (soft/negotiable counter, deliberately weaker
  than the pool's separate hard Counterspell card) — the formula scores all `counter_spell`
  effects at a flat constant regardless of the pay-cost escape hatch, so its low static number
  (0.45) is a modeling gap, not a real weakness (confirmed identical on the pool's other
  `counter_spell` cards). The one real lever the formula can't see — raising the pay threshold
  — makes the card genuinely harder to play around without touching its identity or adding a
  rider that would reintroduce a redundant signal.

### Wizard's Focus (`CORE1-S-S-080`) — REDESIGN

- **Current:** Cost 2 Mana, Common, Spell. *"Draw a card. If you control an Arcane character,
  draw an additional card."* Trigger `on_cast`.
- **Proposed:** Cost 2 Mana, Common, Spell, renamed to **Arcane Bolt**. *"Deal 2 damage to
  target enemy character."* DSL: `triggered`, trigger `on_cast`, effect `deal_damage`,
  `amount: { type: "fixed", value: 2 }`, `target: { side: "enemy", type: "target_character" }`.
- **Rationale:** One of the four most generic card_flow instances in the deck, effectively a
  cheaper duplicate of Glimpse the Future's role. The deck has bounce-based removal (Aether
  Bounce, Arcane Storm) but nothing that just kills a small creature outright; this fills that
  gap and swaps a `card_flow` signal for `removal`. Power 1.92 → 2.00 (near-identical, correctly
  calibrated — not a buff in disguise, a lateral verb swap). Distinct from the pool's existing
  Arcane Blast (non-starter Sapphire card, 3 dmg to *any* character) — this is a smaller,
  enemy-only variant, no naming or functional collision.

### Wizard's Robe (`CORE1-E-S-091`) — KEEP

- **Current:** Cost 2 Mana, Common, Equipment. *"Arcane spells you cast cost 1 less Mana."*
- **Rationale:** Power 2.60, matching its cross-faction peer cluster almost exactly (Radiant
  Shield, Cursed Relic, Necro Shroud all also 2.60 at the same cost/rarity). Distinct verb (cost
  reduction, not draw). No changes.

### Crystal Golem (`CORE1-C-S-072`) — KEEP (do not touch)

- **Current:** Cost 3 Mana, Ethereal, Character, 1 ATK / 3 HP / 0 ARM, Defender. *"Ward 1 (first
  damage to it each turn is reduced by 1)."*
- **Rationale:** The second half of the Defender + self-sustain wall pair with Sapphire
  Sentinel. Already well-designed and competitively scored. Explicitly excluded from this pass.
  No changes of any kind.

### Illusionist Adept (`CORE1-C-S-073`) — KEEP

- **Current:** Cost 3 Mana, Ethereal, Character, 2 ATK / 2 HP / 0 ARM. *"Tap: Counter target
  spell."* Once-per-turn free activation.
- **Rationale:** Not a card_flow clone — a hard counterspell stapled to a body, a genuinely
  distinct verb from everything else in the deck. Power 4.80 sits reasonably against its c3
  Ethereal peers. Fine as-is; no changes.

### Spellbound Adept (`CORE1-C-S-070`) — REDESIGN

- **Current:** Cost 3 Mana, Common, Character, 2 ATK / 2 HP / 0 ARM. *"Whenever you cast a
  spell, draw a card."* Trigger `on_spell_cast` (allied).
- **Proposed:** Cost 3 Mana, Common, Character, 2 ATK / 2 HP / 0 ARM (unchanged stats). New
  ability: *"Whenever you cast a spell, this character gains +1/+1 permanently."* DSL:
  `triggered`, trigger `{ type: "on_spell_cast", side: "allied" }`, effect `modify_stats` on
  `self`, `duration: permanent`, `modifier: { atk: 1, hp: 1 }`.
- **Rationale:** Already had the right shape (a spell-payoff body) but the payoff was "more of
  the deck's single most oversupplied signal." Converting it to permanent combat growth turns it
  into the deck's snowballing pressure threat — in a spell-dense game it can become a 5/5, 6/6
  or bigger by mid-game, finally giving Sapphire a body that outgrows the ATK-2 ceiling through
  play rather than printed stats alone. Power unchanged at 5.92 (confirmed by direct
  calculation) — a strictly better redesign at identical, already-fair cost.

### Aether Bounce (`CORE1-S-S-077`) — KEEP

- **Current:** Cost 3 Mana, Common, Spell. *"Return target enemy character with cost 4 or less
  to its owner's hand."*
- **Rationale:** Fine, distinct verb (single-target bounce removal), explicitly called out in
  the diagnosis as one to leave alone. No changes.

### Glimpse the Future (`CORE1-S-S-082`) — REDESIGN (numeric)

- **Current:** Cost 3 Mana, Common, Spell. *"Draw 2 cards, then discard 1."*
- **Proposed:** Cost 3 Mana, Common, Spell. *"Draw 3 cards, then discard 1."* Only the
  `draw_cards.count` fixed value changes, `2` → `3`.
- **Rationale:** Kept as the deck's "loot" sub-verb (distinct from Time Reversal's graveyard
  recursion and Arcane Echoes' spell-copy) — some card_flow redundancy is fine and thematic for
  a draw faction; this is one of the three instances deliberately kept. Its real-pool c3-Common
  spell peers span a wide 0.7–6.2 power band; the baseline (2.4) sat in the lower-middle, and
  the bump to power 3.6 nudges it toward the middle of that real cluster without approaching the
  top (Angelic Strike 6.2, Tomb Desecration 5.5 — both of which also carry removal).

### Lens of Foresight (`CORE1-E-S-095`) — REDESIGN

- **Current:** Cost 3 Mana, Ethereal, Equipment. *"Once per turn, look at the top 3 cards of
  your deck and rearrange them."*
- **Proposed:** Cost 3 Mana, Ethereal, Equipment, renamed to **Arcane Focus Blade**. *"Equipped
  character gains +1/+0. When equipped character deals damage, deal 1 damage to the enemy
  Hero."* DSL: `aura` with two effects — `modify_stats` on `equipped_character`,
  `duration: while_in_play`, `modifier: { atk: 1 }`; and `grant_ability` on
  `equipped_character`, granting a `triggered` ability with `trigger: { type: "on_deal_damage" }`
  and effect `deal_damage`, `amount: { type: "fixed", value: 1 }`,
  `target: { side: "enemy", type: "hero" }`, `duration: while_in_play`.
- **Rationale:** The most vanilla of the deck's remaining card_flow instances (a once-per-turn
  scry-3 with no other purpose), and the equipment slot wasn't providing any ATK anywhere in the
  deck. Converts it into the deck's second, cheaper reach source — every attack from the
  equipped creature chips the enemy Hero, independent of Arcane Storm's spell-scaled top-end
  burst — giving Sapphire an accessible, early/mid-game closing tool instead of only a
  cost-8 one. Power 1.44 → 4.56, in the neighborhood of (though below) the closest cross-faction
  peer shape, Onyx's Soulstealer Blade (c3 Ethereal, +2 ATK aura + on-hit rider, power 6.52) —
  intentionally kept a notch below that peer since this rider is reach rather than sustain.

### Mystic Librarian (`CORE1-C-S-071`) — REDESIGN

- **Current:** Cost 4 Mana, Common, Character, 2 ATK / 4 HP / 0 ARM. *"When deployed, draw two
  cards."*
- **Proposed:** Cost 4 Mana, Common, Character, 2 ATK / **4 HP / 0 ARM** (stats unchanged). New
  ability: *"When deployed, this character gains permanent +0/+X HP, where X is the number of
  cards in your hand."* DSL: `triggered`, trigger `on_deploy`, effect `modify_stats` on `self`,
  `duration: permanent`, `modifier: { atk: 0, hp: 0 }`, `dynamicModifier: { type: "per_count",
  stat: "hp", counting: { type: "cards_in_zone", zone: "hand", side: "allied" },
  valuePerCount: 1 }`.
- **Rationale:** A flagged outlier in the whole-pool fair-budget check (baseline was
  numerically *over*-budget at +2.40 despite being described as "redundant... a fairly vanilla
  body" in the diagnosis — a power/flavor mismatch, not a power problem). Removing its draw
  entirely and converting it into a payoff that *rewards* the deck's other card-flow effects —
  deploy it after a big draw turn and it becomes a genuine 8-9 HP wall — trades a straight
  card_flow instance for a distinct `large_hand` payoff that also plugs directly into Lyria's
  own hero passive (allies get +1 HP once your hand hits 5+). The static formula undervalues
  this (its dynamic-count term assumes a conservative average of 2 cards, not a realistic
  post-draw hand of 5+), so its true in-play ceiling is meaningfully higher than the reported
  power (6.20 at a stricter base, or the recommended 7.20 at 2/4/0 base — both listed for
  transparency; go with 7.20/2/4/0/+1HP-per-card as specified above).

### Time Reversal (`CORE1-S-S-085`) — REDESIGN (numeric)

- **Current:** Cost 4 Mana, Ethereal, Spell. *"Shuffle your discard pile into your deck, then
  draw 3 cards."*
- **Proposed:** Cost 4 Mana, Ethereal, Spell. *"Shuffle your discard pile into your deck, then
  draw 4 cards."* Only `draw_cards.count` changes, `3` → `4`.
- **Rationale:** Kept as the deck's graveyard-recursion sub-verb (distinct mechanically from
  Glimpse's loot and Arcane Echoes' targeted copy). No same-cost-and-rarity peer exists
  anywhere else in the 130-card pool to cross-check directly, so the bump is deliberately modest
  (power 4.60 → 5.80) rather than aggressive.

### Arcane Echoes (`CORE1-S-S-088`) — REDESIGN

- **Current:** Cost 5 Mana, Mythic, Spell. *"Choose an Arcane spell in your discard; add a copy
  of it to your hand."*
- **Proposed:** Cost 5 Mana, Mythic, Spell. *"Choose an Arcane spell in your discard; add a copy
  of it to your hand. Draw 2 cards."* Adds one `draw_cards` effect,
  `count: { type: "fixed", value: 2 }`, `player: "allied"`, alongside the existing `copy_card`
  effect, same trigger (`on_cast`).
- **Rationale:** Badly underpriced relative to its correct peer cluster — other **spells and
  equipment** (not creatures) at cost 5 Mythic elsewhere in the pool run 1.5–3.0 power (Plague
  Burst 2.0, Tech Bloom 3.0, Celestial Aegis 1.54, Holy Avenger 2.6); the baseline (1.20) sat
  below all of them. Added draw brings it to 3.6, at the top of that real cluster, appropriate
  for a Mythic-tier "recur your best spell" payoff. Kept as a card_flow instance deliberately —
  it's the deck's spell-copy sub-verb, distinct from the other two draw-adjacent cards kept.

### Master Archivist (`CORE1-C-S-074`) — REDESIGN

- **Current:** Cost 6 Mana, Mythic, Character, 2 ATK / 5 HP / 0 ARM. *"Search for an Arcane
  Spell in your deck and draw it. If it's 1 cost or less, you may cast it for free as part of
  this ability."*
- **Proposed:** Cost 6 Mana, Mythic, Character, **4 ATK** / 5 HP / 0 ARM. Ability text and DSL
  unchanged — only `stats.atk` changes, `2` → `4`.
- **Rationale:** The clearest single fix in this pass. At baseline, Master Archivist's stats and
  power (2/5/0, power 8.44) were nearly identical to a cost-**5 Common** elsewhere in the pool
  (Zombie Horde, Onyx, also 2/5/0, also power 8.44) — i.e. it was pricing a full rarity tier and
  a cost point below where it sat. Its only two true peers at cost 6 Mythic in the whole pool —
  Ancient Treant (Verdant, 4/7/0) and Archon's Guardian (Radiant, 3/3/0 + a strong aura) — both
  run ATK 3-4; matching Ancient Treant's ATK 4 exactly makes this the first Sapphire creature to
  break the deck's ATK-2 ceiling with real, printed stat presence, while keeping the targeted
  Arcane-spell tutor as a coherent, thematic (not generic) payoff appropriate for the rarity.

### Arcane Storm (`CORE1-S-S-089`) — REDESIGN

- **Current:** Cost 8 Mana, Legendary, Spell. *"Return all enemy characters to their owners'
  hands. Draw a card for each character returned this way."*
- **Proposed:** Cost 8 Mana, Legendary, Spell. *"Return all enemy characters to their owners'
  hands. Draw a card for each character returned this way. Deal damage to the enemy Hero equal
  to the number of spells you've cast this turn (max 6)."* Adds one `deal_damage` effect,
  `amount: { type: "count", counting: { type: "spells_cast_this_turn" }, max: 6 }`,
  `target: { side: "enemy", type: "hero" }`, alongside the existing bounce and draw effects,
  same trigger (`on_cast`).
- **Rationale:** This is the deck's top-end slot, and every other faction's cost-7/8 top card is
  a real stat payoff (Radiant's Uriel 4/4, Verdant's Guardian Spirit 5/5, Onyx's Morgath 4/4) —
  Sapphire's was a pure spell with zero closing power. Rather than turning the card itself into
  a creature (which would fight its established board-wipe identity), it gets a reach clause
  tied directly to the hero's spell-density plan: on a turn where you've chained several cheap
  spells (Wizard's Robe's cost reduction makes this realistic) before landing Arcane Storm, it
  both resets the enemy board and hits their Hero directly — finally giving Sapphire a way to
  close a game instead of only stalling one. Note: the card's static `power` number does not
  move (stays 12.00) because its ability was already at the formula's per-ability effect-sum cap
  before this addition — a known formula ceiling, not a sign the addition is valueless; the
  `reach` signal is correctly added to the card's `provides` list, and the sim-level pass (see
  Validation) confirms the deck-wide effect is real and substantial in actual play.

---

## Summary table

| Card | Cost | Rarity | Verdict | Change |
|---|---|---|---|---|
| Arcane Scholar | 2→**1** | Common | REDESIGN | New 1-drop; on-spell-cast self-buff |
| Sapphire Sentinel | 2 | Common | **KEEP — untouched** | — |
| Mana Leak | 2 | Common | REDESIGN (light) | `unlessPay` 2→3 |
| Wizard's Focus | 2 | Common | REDESIGN | Draw effect → 2 dmg to enemy character |
| Wizard's Robe | 2 | Common | KEEP | — |
| Crystal Golem | 3 | Ethereal | **KEEP — untouched** | — |
| Illusionist Adept | 3 | Ethereal | KEEP | — |
| Spellbound Adept | 3 | Common | REDESIGN | Draw-on-cast → permanent +1/+1 on cast |
| Aether Bounce | 3 | Common | KEEP | — |
| Glimpse the Future | 3 | Common | REDESIGN (numeric) | Draw 2→3 |
| Lens of Foresight | 3 | Ethereal | REDESIGN | Scry → +1 ATK weapon, on-hit reach |
| Mystic Librarian | 4 | Common | REDESIGN | Draw 2 → hand-size HP payoff |
| Time Reversal | 4 | Ethereal | REDESIGN (numeric) | Draw 3→4 |
| Arcane Echoes | 5 | Mythic | REDESIGN | Adds draw 2 alongside copy |
| Master Archivist | 6 | Mythic | REDESIGN | ATK 2→4 |
| Arcane Storm | 8 | Legendary | REDESIGN | Adds spell-scaled reach to enemy Hero |

Rarity skeleton confirmed unchanged: 9 Common / 4 Ethereal / 2 Mythic / 1 Legendary.
