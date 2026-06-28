# Card-Power & Deck-Value Valuation

A pure, first-principles model that assigns a scalar **power** to each card and a **value** to
each deck (cards + inter-card synergy + hero synergy). It is design/balance **tooling** — a
deterministic analysis layer over the card DSL, not wired into gameplay. Implementation lives in
`packages/engine/src/balance/`; the report is `packages/engine/balance-card-values.mjs`.

## Design decisions (locked)
1. **Raw power score only** — no cost anchoring. The card score never reads `cost`; it is intrinsic
   power. We "work backwards": build the score, then *correlate* it against measured win rates.
2. **Pure first-principles weights** — every number is anchored to design reasoning or to the
   engine's own constants (`src/bot/spell-eval.ts`, `src/bot/combat-plan.ts`, gameplan NEUTRAL).
   Weights are **never fitted** to the win rates. The correlation is a post-hoc *diagnostic*.
3. **General interaction matrix** for synergy — not a hand-curated registry. Each card emits
   **Signals** (what it offers) and **Demands** (what it wants); synergy is the sum of signal↔demand
   matches through a sparse coefficient matrix `W`. The same mechanism covers intra-card, inter-card,
   and hero synergy.

## Input — `StaticCard`
The core is context-free (no `GameState`/`CardInstance`). The harness adapts raw `SimCard` JSON into
`StaticCard`, running `normalizeTraits` (engine traits + `rushValue`/`recycleValue`/regen) and casting
each `ability.dsl` to `AbilityDSL` at the trust boundary — exactly as `sim-runner.mjs` does. Heroes
become a `HeroInput` (lp, abilities, optional transform with `lpDelta = transformHP − heroHP`).

## Card power
`power = base × synergyMultiplier`, where `base = statBase + traitValue + abilityValue` (additive,
each element once) and the intra-card synergy is a bounded multiplier on top.

**statBase** (characters only; 0 for S/E/H/T/R): `atk×1.0 + hp×1.0 + arm×1.3`. atk/hp anchor to
spell-eval `bodyValue = atk+hp`; ARM at 1.3 (mitigates ≥1 combat damage per instance and persists).

**traitValue** (`trait-scaling.ts`) — keyword value scales with the stat it leverages:

| trait | value | trait | value |
|---|---|---|---|
| defender | `0.6·(hp+arm)` | stealth | `0.25·(atk+hp)` |
| flying | `0.5·atk` | elite | `0.5` |
| first_strike | `0.35·atk` | swift | `0.4` |
| haste | `0.30·atk` | recycle N | `0.6·N` |
| rush N | `0.12·N·atk` | volatile | `−0.35·hp` |
| sniper | `0.3·atk` | regeneration N | `min(0.8·N, 0.8·hp)` |

**abilityValue** = `Σ_abilities clamp(Σ effectStaticValue, 0, 12) × recurrence`. Effects are valued by
`effect-value.ts`, the static analog of spell-eval (same coefficients, expected targets):

| effect | static value | effect | static value |
|---|---|---|---|
| destroy/sacrifice enemy | `5.5` (removal) | draw N | `1.2·N` |
| bounce enemy | `5.5·0.7` (removal) | heal N | `0.7·N` |
| deal N enemy body | kill `5.5` if N≥3 else chip `min(N,3)` | gain_resource N | `N·(0.5 temp / 1.0 perm)` |
| deal N enemy hero | `1.5·N` | deploy_token | `(stats)·n·0.5` |
| AoE variants | `× 2.5` width | return / search / copy | `1.2–1.8 / 1.44–4 / 1.2` |
| modify_stats allied | `Σgain · bodies · 0.6` | composite / conditional / choose_one | sum / `0.6·ifTrue+0.4·ifFalse` / max |
| counter_spell / deploy_from_deck | `0.5 / 4` | 10 hard-to-value effects | `1.0` |

`recurrence` (how often an ability lands over a game) multiplies the effect-sum: aura/`while` 2.6,
`on_turn_start` 2.4, one-shot (`on_deploy`/`on_cast`) 1.0, last-breath/flash 0.9, `activated` 2.0
(÷ by cooldown, oncePerTurn 1.6, oncePerGame 0.7), board-event triggers (`on_ally_destroyed`,
`on_spell_cast`, …) 1.2–1.6, an extra ability-level Condition ×0.7. Board-event triggers carry only a
conservative baseline here — their deck-density upside lives in the synergy term (avoids double-count).

**Intra-card synergy** = `intraSynergy(provides, demands)` over the card's own signals, restricted to
**different sources within the card** (so a single ability can't self-satisfy).
`synergyMultiplier = 1 + min(0.5, intraSynergy / base)`; `power = base × multiplier`. Example: a
Defender (provides `wall`, demands `wall_to_sustain`) with a self-heal ability (provides `sustain`)
matches `W[sustain][wall_to_sustain] = 0.9` across sources → multiplier > 1 (Sunlit Guardian scores
~1.38× a vanilla Defender of equal stats).

## Synergy — signals, demands, and the matrix
A **Signal** is what a card offers; a **Demand** is what it wants. The core primitive is
`pairSynergy(P, D) = Σ W[p.kind][d.kind] · min(p.weight, d.weight)` (tag-keyed wants additionally
require tag equality). `min(weight)` keeps units in stat-value space and stops a tiny provider
inflating a big demand.

Provide kinds: `wall, body, wide_bodies, sustain, removal, reach, card_flow, ramp, buff, spell_cast,
equipment, death_trigger, tag`. Want kinds: `wall_to_sustain, bodies_to_buff, wide_to_sacrifice,
spell_density, large_hand, equipment_count, death_of_tag, tag_tribal, frontline_arm, temp_resource,
attach_target`. The matrix `W` is **sparse**; key cells:

| provide → want | W | provide → want | W |
|---|---|---|---|
| sustain → wall_to_sustain | 0.9 | tag → tag_tribal (tag-gated) | 0.9 |
| spell_cast → spell_density | 0.9 | death_trigger → death_of_tag (tag-gated) | 0.85 |
| equipment → equipment_count | 0.9 | wide_bodies → wide_to_sacrifice | 0.8 |
| card_flow → large_hand | 0.8 | ramp → temp_resource | 0.7 |
| body → attach_target | 0.7 | wide_bodies → bodies_to_buff | 0.7 |

**`removal` and `reach` are all-zero provider rows** — their value lives only in card power, so the
synergy term can never re-count it. This is the central double-count guard.

## Deck value
`value = cardPowerSum + consistency + acceleration + interSynergy.capped + heroSynergy`.
- **cardPowerSum** — `computeCardPower` per distinct card; the k-th copy worth `power·0.9^(k-1)`
  (diminishing returns on redundant draws).
- **consistency** (additive, modest) — `−12·Σ|frac_b − ideal_b|` over cost buckets (a fixed
  first-principles curve template — uses the cost *distribution* for deck quality, not a per-card cost
  budget) `+ 8·(onColorFrac − 0.5)` (off-color cards cast less reliably).
- **acceleration** (ramp / snowball) — `min(earlyTempo, payoffReach)`, where `earlyTempo =
  Σ ramp·copyFactor·1.5 + Σ_{cost≤1} copyFactor·2` (resource ramp + cheap development) and
  `payoffReach = Σ_{cost≥5} power·copyFactor` (the finishers it deploys ahead of curve). The per-card
  score is **cost-free** by design (decision #1), so it values a 0-cost enabler at ~0 — structurally
  blind to the ramp/snowball archetype (cheap development + acceleration now, an oversized threat
  later). This deck-level term restores that tempo, using cost (fair game at the deck level, as
  `consistency` already does). The `min` gate keeps both halves honest — cheap junk with no payoff, or
  a clunky top-heavy curve with no acceleration, earns nothing — and the payoff is only a *gate*, never
  re-counted as power (it is already in `cardPowerSum`). Anchored to resource→tempo conversion, never
  fitted; it lifts ramp decks (Verdant) without touching decks that lack the curve (Sapphire → 0).
- **interSynergy** — `pairSynergy` over distinct card pairs × presence (`min(copies,3)/3` each);
  per-pair cap 4; **per-card saturation** (a card spends a free quota of 2 edges, then its k-th extra
  edge decays by `0.6^(k−1)`); global cap `0.4 × cardPowerSum` (synergy is a bounded amplifier, never
  dominant). Saturation models throughput — one card is one card on the board: a hub wired into many
  partners (a lone sac outlet fed by ten bodies, one shield for the whole board) cannot fire them all
  at once. It distinguishes a **redundant wide web** (8–10 edges/card — Onyx's aristocrats) from a
  **coherent package** (3–4 — Radiant's walls+equipment), where the old flat sum over-credited the
  former; Radiant is unaffected at the ranking level (it was already global-cap-bound).
- **heroSynergy** — `6 (floor) + (lp−30)·0.6 + heroEngineValue + min(heroDemandMatch, 0.5·engine) +
  transform`. The hero's demands (Kaelthar → `death_of_tag{Undead}`, Lyria → `spell_density` +
  `large_hand`, Seraphina → `equipment_count` + `frontline_arm`, RIA-09 → `temp_resource`) are matched
  against the deck's aggregated provides.

## Validation — diagnostic, never calibration
The harness reports the **correlation** of the 4 starters' deck values with measured win rates
(Spearman ρ is the headline; n=4 makes Pearson noisy). The **headline reference is the adopted
standard pilot** (reach+exile+value) measured on the *same baseline cards the formula scores*:
`[Radiant 83.7, Verdant 49.8, Onyx 27.2, Sapphire 39.3]` — the reference the dashboard uses. The fair
rollout `[78, 69, 44, 8]` and heuristic are kept as secondary lenses (they disagree in the middle; the
fair rollout's Sapphire 8 is a stale outlier vs the standard pilot's 39.3). Weights are **not**
adjusted to improve any of them — the terms below are anchored to game dynamics and the ρ is reported
post-hoc.

**First run (2026-06-27):** the score ranked `Radiant > Onyx > Sapphire > Verdant`
(values 351 / 224 / 212 / 206), Spearman ρ = **0.20** vs the standard pilot. It nailed Radiant #1 but
**inverted Onyx and Verdant**: it ranked Verdant *last* (the standard pilot has it 2nd) and Onyx 2nd
(it wins last). Two structural blind spots: a cost-free score cannot see Verdant's **ramp/snowball**
(cheap bodies + acceleration look weak card-by-card), and the flat synergy sum over-credited Onyx's
**redundant aristocrats web** (a lone sac outlet counted as fed by all ten bodies at once).

**Second run (2026-06-28) — after the `acceleration` term + synergy `saturation`:** the score ranks
`Radiant > Verdant > Sapphire > Onyx` (values 293 / 206 / 198 / 193), **Spearman ρ = 1.00** vs the
standard pilot (Pearson 0.96), 1.00 vs the heuristic, 0.80 vs the fair rollout (its Sapphire-8 outlier
is the only disagreement). Both inversions are resolved by the two principled terms — *not* by fitting:
acceleration lifts Verdant by modelling tempo the cost-free score omits; saturation tempers Onyx's web
by modelling sacrifice throughput. **Caveat — n = 4.** A perfect rank match on four decks is
encouraging, not proof; a parameter sweep shows the Verdant lift is insensitive to the exact constants
while the Onyx<Sapphire ordering is the delicate one (it holds across the defensible saturation range
but ties at the gentlest setting). The real test is more decks/archetypes (the tier-2 gauntlet) — the
score stays a *diagnostic read alongside simulation*, never a replacement for it.

## Caveats
- The score is **intrinsic card power** plus modest deck-level corrections, not a win-rate predictor.
  The `acceleration` term now captures *some* of the ramp/snowball tempo a pure static model misses, and
  `saturation` discounts redundant synergy — but both are coarse deck-level proxies for emergent,
  turn-by-turn dynamics. Read the score alongside simulation; it is a fast first-pass drift gauge, not a
  substitute for the gauntlet/full sim.
- **Double-counting** is guarded structurally: the WANT axis holds only payoffs that need *other*
  cards; removal/reach are zero provider rows (counted once, in card power); intra-synergy requires
  cross-source pairs and is a bounded multiplier, inter-synergy iterates distinct ids and is a
  separately-capped additive term.
- Most exotic traits (volatile, sniper, elite, rush, swift, recycle) are near-inert on the 130-card
  pool — their formulas are defined for completeness and covered by synthetic unit tests.

## Files & usage
`src/balance/{types,weights,interaction-matrix,effect-value,trait-scaling,signal-extract,signals,
card-power,synergy,deck-value,index}.ts`; `src/stats/correlation.ts`; tests under `tests/balance/` and
`tests/stats/correlation.test.ts`. The harness/report code (`balance-data.mjs` is the shared loader)
runs after `pnpm --filter @aetherion-sim/engine build`:

```bash
cd packages/engine
node balance-card-values.mjs    # text report (per-card table, deck values, correlation)
node balance-dashboard.mjs      # writes balance-dashboard.html — open it in any browser
node balance-suggestions.mjs    # writes docs/balance-suggestions.md — draft fixes for out-of-window cards
node balance-compare.mjs        # writes balance-compare.html — before/after of applying those fixes
node balance-rebalance.mjs      # compares function-preserving balance vectors; writes a pool + a SIM-confirm command
```

The budget model (`a + b·cost + rarity bonus`, ±RMSE window) lives in `balance-data.mjs`
(`budgetModel` + `RARITY_BONUS`), shared by the dashboard and the suggestions generator so they stay
in lockstep. `balance-suggestions.mjs` lists every card outside its window and proposes, per card, a
stat/keyword edit (**re-scored through the formula** to verify it lands back inside), a cost re-cost,
and — when the ability drives the score — an ability note. See `docs/balance-suggestions.md`.

### HTML analytics dashboard
`balance-dashboard.mjs` emits a **self-contained** `balance-dashboard.html` (inline SVG charts +
vanilla JS, no CDN, works offline), focused on the 64 distinct cards in the 4 starter decks:
overview KPIs; deck-value panels + ranking; card-value **spread** (stacked-by-faction histogram,
per-faction box plots, spread-metric table); **value vs cost** (power-vs-cost scatter with the
mean-power-per-cost curve, power/cost efficiency rankings, cost-curve residuals — the cost lens the
raw score itself omits); a **cost-budget window** with a delta view — the expected power is
`a + b·cost + rarity bonus` (a least-squares cost line shifted UP per rarity tier, so higher-rarity
cards are allowed more power), widened into a ±RMSE tolerance band (a window, not a strict value);
each card gets a Δ vs that rarity-adjusted expected and an under/within/over status, shown as a delta
scatter plus **per-faction and per-rarity** status/mean-Δ breakdowns that surface systematic
mispricing (Radiant runs above budget; Ethereal/Mythic cards under-deliver on their rarity). Then
per-deck cost curves; stat/trait/ability **value drivers**; intra-card synergy multipliers +
inter-card pairs; and a sortable/filterable card table (filterable by budget status). The budget
constants — `RARITY_BONUS`, `RMSE_MULT`, `MIN_TOL` — are tunable at the top of the budget block.
