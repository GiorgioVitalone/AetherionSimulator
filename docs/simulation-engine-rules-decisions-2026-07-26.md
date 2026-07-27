# Simulation Engine Rules Decision Register

- Authority: `Documentation/game/Rulebook.md`
- Rulebook SHA-256: `42f52afe6dad19f447355fe805233ac3206471d6848aa05b76d1dcbd17730f7c`
- Current profile: `packages/engine/sim-data/ruleset-current.json`
- Profile status: **diagnostic**

This register records the semantic decisions required by WP-00. “Ratified” means
the current rulebook is explicit enough to serve as the oracle. “Provisional”
means the named owner must approve the listed interpretation before the dependent
implementation slice can pass its gate.

| ID | Topic | Disposition | Authority / rationale | Owner | Status | Blocks |
|---|---|---|---|---|---|---|
| RD-01 | Attack declaration | Exhaust and commit the attacker at declaration; targets are checked again at resolution and may fizzle | Rulebook §§12, 14; declaration must be observable before responses | Rules owner | Ratified | WP-07 |
| RD-02 | Spell declaration | Pay costs and emit cast observation at declaration; a counter prevents effects, not the fact of casting | Rulebook §§10, 14 | Rules owner | Ratified | WP-07 |
| RD-03 | Equipment declaration | Pay at declaration, but do not attach/remove/replace until resolution; a countered equip leaves attachments unchanged | Rulebook §§13–14 | Rules owner | Ratified | WP-07, WP-11 |
| RD-04 | Move declaration | Exhaust/commit movement at declaration; perform the zone move at resolution if still legal | Rulebook §§11, 14 | Rules owner | Ratified | WP-07 |
| RD-05 | Activated-ability declaration | Pay costs and exhaust required sources at declaration; countering prevents effects but does not refund declared costs | Rulebook §§9, 14 | Rules owner | Ratified | WP-07 |
| RD-06 | “All” semantics | Snapshot the complete affected set before resolution; Hexproof/Stealth target restrictions do not apply; resolve state consequences after the atomic batch | Rulebook vocabulary and §15 | Rules owner | Ratified | WP-06 |
| RD-07 | Simultaneous trigger ordering | Active player orders their triggers, then non-active player orders theirs; each owner’s explicit choice is authoritative | Rulebook §14 APNAP | Rules owner | Ratified | WP-05 |
| RD-08 | Persistent | A higher value replaces a lower value; damage uses the ordinary effect-damage pipeline; decrement once after its controller’s Upkeep application | Rulebook glossary | Rules owner | Ratified | WP-08 |
| RD-09 | Regeneration | A higher value replaces a lower value; heal during controller Upkeep, then decrement once | Rulebook glossary | Rules owner | Ratified | WP-08 |
| RD-10 | Stun | Consume one duration unit at the afflicted card controller’s Upkeep refresh boundary and suppress that refresh once; do not decrement elsewhere | Rulebook glossary | Rules owner | Ratified | WP-08 |
| RD-11 | X costs | X augments the printed cost component identified by schema; it is not implicitly flexible | Typed-cost requirement from review; card schema must carry the component; approved by Giorgio Vitalone on 2026-07-26 | DSL/data owner | Ratified | WP-11, WP-12 |
| RD-12 | Flexible resources | The paying player chooses the Mana/Energy split; a deterministic policy may choose for a bot but the engine exposes the choice | Rulebook §6 | Rules owner | Ratified | WP-03, WP-11 |
| RD-13 | Equipment remove/replace | Voluntary removal and replacement put equipment in discard and emit equipment-specific removal/detach observations, never character destruction | Rulebook §13 | Rules owner | Ratified | WP-11 |
| RD-14 | Equipment transfer | Transfer is a declared action; the source stays attached until resolution; the destination slot rule is the same as attach/replace | Rulebook §§13–14 | Rules owner | Ratified | WP-07, WP-11 |
| RD-15 | Transformation | Start-of-turn timing after Upkeep and before Strategy; once per game; requires one of the three printed predicates; Ultimate is unavailable on the transform turn | Rulebook §12 Hero Transformation and Ultimate Abilities | Rules owner | Ratified | WP-02, WP-11 |
| RD-16 | Effect-driven deckout | Every attempted Main Deck draw, including effect and Recycle draws, loses immediately when no card is available | Rulebook §16 Deck Out | Rules owner | Ratified | WP-06 |
| RD-17 | Exile | Exile is a durable per-player zone in state and replay; exiled cards are unavailable to discard retrieval | Rulebook glossary | Rules owner | Ratified | WP-09 |
| RD-18 | Token fallback | A missing token definition is a semantic data error; no generic substitute token is permitted in current rules | Fail-closed data policy; printed identity and tags are observable; approved by Giorgio Vitalone on 2026-07-26 | DSL/data owner | Ratified | WP-09, WP-12 |
| RD-19 | Card-text corrections | Text/DSL mismatches require an explicit exception record or corrected DSL; silent parser fallback is forbidden | Card data is executable rules content; approved by Giorgio Vitalone on 2026-07-26 | DSL/data owner | Ratified | WP-12 |
| RD-20 | Resource deck exhaustion | Empty Resource Deck skips the draw and is one transformation predicate; it does not itself lose the game | Rulebook §§8, 16 | Rules owner | Ratified | WP-04, WP-11 |
| RD-21 | First-player rules | Random winner chooses first player; first player skips the first Main Deck draw and cannot attack; no compensatory card is granted | Rulebook §§7–8 | Rules owner | Ratified | WP-00, WP-13 |
| RD-22 | Reserve Energy timing | The active player may exhaust zero or more eligible Reserve characters only during Upkeep step 4; each chosen character generates one typed resource and takes one strain damage before start-of-turn triggers | Rulebook §§8–9 | Rules owner | Ratified | WP-02, WP-04, WP-11 |

## Approval mechanics

- A provisional row must be changed to Ratified with an authority citation and
  approval identity before its blocking package can pass.
- Changing a ratified row requires a rulebook revision, a new rulebook hash, a
  current-manifest semantic-version change, and invalidation of affected evidence.
- Legacy manifests reproduce historical behavior only. They cannot override this
  register for a current-rules artifact.

## DSL/data decision evidence and approval

- RD-11: `xCostResource` is schema-validated and exercised by the X-cost payment
  truth tables and every-card corpus.
- RD-18: the fatal semantic validator checks token-definition references and the
  current committed catalogue reports zero errors/warnings.
- RD-19: every current card/ability/effect path has an executable scenario or an
  owned exception; the current exception catalogue is empty.

Giorgio Vitalone approved RD-11, RD-18, and RD-19 as written in the authenticated
project thread at `2026-07-26T16:46:41Z`. This approval resolves the three
provisional DSL/data decisions without changing their implemented semantics.
It does not substitute for the separate independent rules, verification,
quantitative, policy-expert, or release approvals required for G12.
