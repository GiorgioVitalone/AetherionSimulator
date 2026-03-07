# Aetherion TCG — Game Simulator Roadmap

## Executive Summary

This document lays out the full plan for building an interactive, browser-based game simulator for Aetherion TCG. The simulator will automate the complete game loop — turn phases, resource management, zone-based movement, combat resolution, and ability execution — so two human players can test games with rules enforcement handled by the engine.

The project is structured in seven phases (0 through 6), each producing a usable deliverable that builds on the last. The architecture cleanly separates a **pure TypeScript game engine** (zero UI dependencies, fully testable in isolation) from a **React + Tailwind CSS client** — organized as a **Turborepo monorepo** optimized for Claude Code-driven development. Card data is generated from the existing PostgreSQL database at build time as typed JSON.

---

## Current State Audit

### What's Ready

| Asset | Status | Notes |
|---|---|---|
| **Rulebook** | ✅ Complete | 16 sections, worked examples, fully specified turn structure, combat, zones, priority chain |
| **Card database** | ✅ 130 cards | 47 Characters, 42 Spells, 31 Equipment, 4 Heroes, 4 Transformations, 2 Resources |
| **Faction coverage** | ⚠️ 4 of 6 | Onyx (32), Radiant (32), Sapphire (32), Verdant (32). Crimson and Amethyst have 0 cards |
| **Deck viability** | ✅ All 4 factions | Each faction has enough cards (with copy limits) to build legal 40–60 card main decks |
| **Hero + Transformation links** | ✅ All 4 linked | Kaelthar→Lich King, Seraphina→Valkyrie, Lyria→Archmage, RIA-09→Vanguard |
| **Ability data** | ⚠️ Needs work | 146 abilities total, all natural language. 5 have null effect text. ~13 spells mistyped as Aura |
| **Traits data** | ⚠️ Mostly empty | Only 13/130 cards have traits populated. 117 cards have empty `traits` arrays |
| **Design system** | ✅ Complete | Gilded Ink visual identity with full design tokens, faction color palette, typography (Playfair Display, DM Sans, JetBrains Mono) |

### Data Issues to Fix Before Building

1. **5 cards with null ability text**: Doomshroud Armor, Arcane Blast, Soulstealer Blade, Carrion Queen, Blessed Sword — all Equipment or Spell Auras with no effect written.

2. **~13 spells with wrong ability type**: One-shot effects (deal damage, draw cards, stat buffs) typed as `"Aura"` instead of `"Cast"`. Examples: Chain Lightning, Enlightenment, Nightshade Blast, Mystic Shield, Grove's Blessing, etc.

3. **117 cards with empty `traits` arrays**: Keywords like Defender, Flying, Haste, Regeneration are either missing entirely or buried inside ability effect text. Only 13 cards have structured trait data (12 Defenders, 1 Flying, 1 Regeneration). Characters like Heavenly Knight (First Strike) and Verdant Druid (Regeneration 1) have these as ability text rather than traits.

4. **Minor inconsistencies**: Some ability types use non-standard labels (`"Passive"` on Seraphina's transformation, `"Sacrifice"` as an ability type on one card, `"Resource"` as ability type on Mana/Energy cards).

---

## Tech Stack & Architecture

### Core Decisions

| Layer | Choice | Rationale |
|---|---|---|
| **Language** | TypeScript (strict mode, `noAny`) | Type safety acts as guardrails for AI generation. Discriminated unions become both spec and runtime safety for the DSL. Claude achieves ~88% accuracy on TS type tasks. |
| **UI Framework** | React 19 | Claude Code defaults to React in ~85% of trials. Every significant browser TCG uses React. Deepest ecosystem for animation (Framer Motion), drag-and-drop (dnd-kit), and state management bindings. |
| **State: Game Flow** | XState v5 | Models the turn state machine as explicit finite states with guarded transitions. Nested statecharts handle sub-phases. Visualizer aids debugging. Prevents illegal state transitions by design. |
| **State: Game Data** | Zustand + Immer middleware | Mutable-style updates producing immutable state. Selector-based subscriptions for surgical re-renders. Devtools integration. Zundo middleware for undo/redo. JSON-serializable for future multiplayer. |
| **Build Tool** | Vite | Sub-2-second cold start, instant HMR, zero-config TypeScript. No SSR/SSG needed for a game SPA. ~42KB bundle vs Next.js ~92KB. |
| **Styling** | Tailwind CSS 4 + CSS custom properties | `@theme` directive maps directly to Gilded Ink design tokens. Dynamic faction theming via `data-faction` attributes swapping CSS variables. Well-understood by Claude Code. |
| **Animation** | Framer Motion (Motion) | `layout` prop auto-animates card zone transitions (FLIP). `AnimatePresence` for draw/destroy. Spring physics. ~12KB. |
| **Testing** | Vitest | Native Vite integration. 4–10× faster than Jest. Jest-compatible API. Pure engine logic tests run in milliseconds without jsdom. |
| **Monorepo** | Turborepo + pnpm workspaces | ~20 lines config vs Nx's 200+. Parallel task execution, excellent caching. Zero architectural opinions. |
| **Card Data** | Build-time JSON generation from PostgreSQL via `pg` (node-postgres) | Pre-build script queries DB → writes typed JSON to `packages/cards/data/`. Uses `pg` (~500KB, raw SQL) over Prisma (~15MB, ORM overhead). Zero runtime server needed. Deploys as pure static files. |

### Why These Choices (Not Others)

**React over SolidJS/Svelte/Vue**: SolidJS has superior raw performance via fine-grained signals but its ecosystem is too small — limited animation libraries, minimal community patterns. Svelte 5's runes are elegant but Claude Code tends to generate Svelte 4 patterns without explicit guidance, and it struggles architecturally in very large applications. Vue offers no advantage over React here.

**XState + Zustand over Redux Toolkit / useReducer**: A TCG has dual state needs — finite flow control (turn phases are a state machine with strict transition rules) and mutable world data (card HP, zone contents, modifier stacks). XState handles the first naturally; Zustand handles the second with Immer-powered nested updates. Redux Toolkit would work but conflates both concerns into one pattern.

**Vite over Next.js**: A card game needs no SSR, no SSG, no API routes, no edge rendering. Next.js's advantages are irrelevant overhead for a client-side game SPA.

**DOM over Canvas/WebGL**: Cards are rich UI elements — text, tooltips, hover states, click handlers — that HTML/CSS handles natively. A TCG displays 20–50 visible cards at most, well within DOM limits. If specific VFX need Canvas later (spell particles), a PixiJS overlay layer can be added for those effects only.

**Build-time JSON over live DB queries**: Card definitions are read-only reference data that changes only when sets are designed. Static generation means zero runtime server, pure static deployment (Vercel/Netlify/S3), and type-safe imports. A lightweight API layer gets added later only for user-specific data (deck saving, matchmaking).

**`pg` over Prisma for card generation**: The generation script runs a handful of read-only SQL queries against a known schema, transforms the results, and writes JSON files. Prisma adds a schema file, a client generation step, and ~15MB of dependencies to avoid writing 4 SQL queries. The script already defines its own leaner `SimCard` output type, so Prisma's auto-generated types would just be mapped to different types anyway.

### Monorepo Structure

```
aetherion-sim/
├── CLAUDE.md                           ← Root: <200 lines, tech stack + commands + universal rules
├── turbo.json                          ← Task pipeline config
├── pnpm-workspace.yaml
├── .env.example                        ← Documents DATABASE_URL, AETHERION_MCP_DB_PATH, CUSTOMTCG_PATH
├── .claude/
│   ├── settings.json                   ← Permissions, hooks (prettier auto-format, .env protection)
│   └── rules/                          ← 6 contextual rule files (loaded based on files being edited)
│       ├── code-style.md               ← TS strict, ESM, named exports, file/function size limits
│       ├── testing.md                  ← Vitest, no jsdom for engine, AAA pattern
│       ├── engine.md                   ← Zero DOM, XState patterns, discriminated unions, pure functions
│       ├── frontend.md                 ← React 19, Tailwind v4, Zustand, Framer Motion, Gilded Ink
│       ├── monorepo.md                 ← @aetherion-sim/* imports, Turborepo pipeline, package boundaries
│       └── game-domain.md              ← 6 factions, dual resources, 3 zones, card types, traits
├── Documentation/                      ← Git submodule (AetherionDocs, sparse checkout: game/ only)
│   └── game/
│       └── Rulebook.md                 ← Full rulebook, @imported by root CLAUDE.md
├── packages/
│   ├── engine/                         ← Pure TS, zero DOM deps
│   │   ├── CLAUDE.md                   ← Engine-specific patterns and domain glossary
│   │   ├── src/
│   │   │   ├── state-machine/          ← XState turn flow definitions
│   │   │   ├── effects/                ← DSL interpreter (typed AST walker)
│   │   │   ├── zones/                  ← Zone management, slot limits, movement validation
│   │   │   ├── combat/                 ← Combat resolver, ARM calc, targeting matrix
│   │   │   ├── events/                 ← Event bus, trigger registration/dispatch
│   │   │   ├── cards/                  ← Card instance factory, stat tracking
│   │   │   └── types/                  ← Shared interfaces, discriminated unions, DSL type stubs
│   │   └── tests/                      ← Vitest, co-located by module
│   ├── cards/                          ← Card data package
│   │   ├── data/                       ← Generated JSON (build artifact, gitignored)
│   │   ├── src/types.ts                ← Simulator-specific card types (leaner than DB schema)
│   │   └── scripts/
│   │       └── generate.ts             ← DB → JSON generation script (pg + tsx)
│   ├── ui/                             ← Shared React components (card display, zone slots)
│   └── config/                         ← Shared tsconfig (base/lib/app), ESLint, Vitest, Prettier
├── apps/
│   └── client/                         ← Vite + React game client
│       ├── CLAUDE.md                   ← Client-specific patterns
│       ├── src/
│       │   ├── features/               ← Feature-based organization
│       │   │   ├── battlefield/        ← Zone rendering, card placement
│       │   │   ├── hand/               ← Hand display, card selection
│       │   │   ├── hero/               ← Hero status, transformation UI
│       │   │   ├── combat/             ← Attack declaration, target selection
│       │   │   └── game-log/           ← Event log display
│       │   ├── stores/                 ← Zustand stores (game state, UI state)
│       │   ├── machines/               ← XState machine instances + React bindings
│       │   └── theme/                  ← Tailwind config, Gilded Ink tokens, fonts.css
│       └── public/
│           └── fonts/                  ← Gilded Ink WOFF2 files (copied from CustomTCG)
└── docs/
    ├── architecture.md                 ← Deep architecture reference
    ├── dsl-spec.md                     ← Full DSL specification
    ├── card-effect-system.md           ← How effects resolve, edge cases
    └── game-rules-summary.md           ← Condensed rulebook for engine context
```

### Claude Code Optimization

The codebase follows six structural principles that maximize Claude Code effectiveness:

1. **Files under 200 lines, functions under 30 lines.** Extract early and often. Claude Code works best with focused, bounded files it can fully comprehend.
2. **Named exports exclusively** (no default exports except route pages). Helps Claude Code trace imports and understand module boundaries.
3. **Contextual `.claude/rules/` files.** Six focused rule files (code-style, testing, engine, frontend, monorepo, game-domain) are loaded contextually based on which files Claude Code is editing — more granular than a single CLAUDE.md per package. A `game-domain.md` rule file gives Claude Code condensed game vocabulary (factions, resources, zones, traits) without loading the full Rulebook.
4. **Documentation submodule with sparse checkout.** The AetherionDocs repo is added as a git submodule with only the `game/` folder materialized. The root CLAUDE.md `@import`s the Rulebook for game rules context. This gives Claude Code direct access to the canonical rules without duplicating them.
5. **Progressive documentation disclosure.** Detailed docs in `docs/` referenced from CLAUDE.md, not inlined. Keeps always-loaded context small while giving Claude Code access to deep documentation when needed.
6. **Post-edit hooks** for auto-formatting (Prettier) on file writes, plus `.env` protection via PreToolUse hooks. Lets Claude Code self-correct style without wasting context.

---

## Phase 0 — Data Cleanup

**Goal**: Get card data into a reliable, consistent state so the engine can trust what it reads.

**Deliverable**: All 130 cards have correct ability types, non-null effect text, and populated traits arrays.

### Tasks

#### 0.1 Write Missing Ability Text
Fill in the 5 null effects. These need creative design decisions — they aren't just data entry.

| Card | Type | Faction | What's Needed |
|---|---|---|---|
| Doomshroud Armor | Equipment | Onyx | Aura effect for dark-themed armor |
| Arcane Blast | Spell | Sapphire | Likely a damage spell — effect text needed |
| Soulstealer Blade | Equipment | Onyx | Aura effect for life-drain weapon |
| Carrion Queen | Character | Onyx | Aura for a legendary-tier undead character |
| Blessed Sword | Equipment | Radiant | Aura effect for holy weapon |

#### 0.2 Fix Mistyped Ability Types
Reclassify ~13 one-shot spell abilities from `"Aura"` to `"Cast"`. These are spells whose effects resolve once and go to the discard pile — they don't persist.

Affected cards (confirmed list):
- Chain Lightning, Nightshade Blast (deal damage)
- Enlightenment, Grove's Blessing, Sacred Duty (draw cards)
- Mystic Shield, Overgrowth, Nature's Resilience, Bone Shatter (stat modification)
- Destroy-effect spells: Tomb Desecration (destroy + life loss)
- Photosynthesis (hero healing), Purify (cleanse + heal)

#### 0.3 Backfill Traits Arrays
Populate the `traits` column for all characters that should have keyword traits. Sources:
- Cards already typed correctly (13 done — Defenders, Flying, Regeneration)
- Traits mentioned in ability effect text (Heavenly Knight → First Strike, Verdant Druid → Regeneration 1, etc.)
- Traits implied by card design but not yet recorded anywhere — this requires a review pass against the rulebook's trait list: Haste, Rush, Defender, Flying, Stealth, Sniper, Elite, Swift, Volatile, Recycle

#### 0.4 Normalize Ability Type Labels
Standardize non-standard types:
- `"Passive"` → `"Aura"` (Seraphina transformation)
- `"Sacrifice"` → reclassify based on actual mechanic
- `"Resource"` on Mana/Energy cards → keep as-is (these are resource cards, the type is valid for their purpose)

### Exit Criteria
- Zero null effect texts
- All spell abilities correctly typed (Cast vs Aura)
- All characters have accurate traits arrays
- Ability type labels match the canonical set: `Deploy`, `Trigger`, `Aura`, `Cast`, `Flash`, `Counter`, `Last Breath`, `Ultimate`, `Resource`

---

## Phase 0.5 — Project Scaffolding

**Goal**: Set up the monorepo structure, toolchain, and Claude Code configuration so all subsequent phases have a solid foundation to build on.

**Deliverable**: A working Turborepo monorepo with all packages stubbed, build pipeline functional, and card data generation script producing typed JSON from the database.

> Full execution plan in `aetherion-sim-scaffolding-plan.md` — this section summarizes the key decisions.

### Settled Decisions

#### TypeScript Configuration: Three-Config Split
- **tsconfig.base.json** — Shared strict settings (`strict`, `noImplicitAny`, `noUncheckedIndexedAccess`, `noUnusedLocals`, `noUnusedParameters`, `isolatedModules`). Target ES2022, module ESNext, moduleResolution bundler. No emit settings.
- **tsconfig.lib.json** — Extends base. Adds `outDir`, `declaration`, `declarationMap`, `composite`. Used by engine, cards, ui packages.
- **tsconfig.app.json** — Extends base. Adds `jsx: "react-jsx"`, `lib: ["ES2022", "DOM", "DOM.Iterable"]`, `noEmit: true`. Used by apps/client.

The engine's tsconfig sets `"lib": ["ES2022"]` with **no DOM** — enforcing the zero-DOM constraint at the compiler level, not just by convention.

#### Card Data Generation: `pg` + `tsx`
- Uses `pg` (node-postgres) — lightweight (~500KB), zero binary dependencies, raw SQL. The script runs a handful of read-only queries against a known schema; an ORM like Prisma would add ~15MB of dependencies and a generation step to avoid writing 4 SQL queries.
- Run via `tsx scripts/generate.ts` — TypeScript execution without a compile step.
- Supports both `DATABASE_URL` (single connection string, preferred) and individual env vars (`DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`) as fallback.
- Requires Docker containers running with port 5432 exposed. Clear error message if DB is unreachable.
- **`generate:cards` is a manual command**, NOT part of the default `build` pipeline. Card data rarely changes and the script requires Docker — running it on every build is wasteful. The Turborepo task has `"cache": false` and `"inputs": []` since output depends on external DB state.
- Outputs per-faction JSON files + combined index + a **`_meta.json`** recording generation timestamp and card counts (so you can tell at a glance whether data is stale).
- A `postinstall` check in `packages/cards/` verifies data files exist and prints a clear warning on fresh clones: "Run `pnpm generate:cards` with Docker running to generate card data."

#### Immer Boundary
The engine produces pure state transitions (input state → output state). Immer-powered mutable-style updates happen in the Zustand store in `apps/client/`. The engine package has zero dependency on Immer.

#### DSL Type Stubs
Phase 0.5 seeds `packages/engine/src/types/effects.ts` with placeholder discriminated unions (`Effect`, `Trigger`, `TargetExpr`, `Duration`, `Condition`) containing a single representative variant each. Phase 1 expands these into the full DSL. This gives the engine package real scaffolding rather than empty files.

#### Documentation Submodule
The AetherionDocs repo is added as a git submodule with sparse checkout limited to the `game/` folder. The root CLAUDE.md `@import`s `Documentation/game/Rulebook.md` for game rules context. Update with `git submodule update --remote`.

#### Font Assets
The 6 Gilded Ink WOFF2 font files (Playfair Display, DM Sans, JetBrains Mono) are copied from CustomTCG into `apps/client/public/fonts/`. A shared fonts package could be extracted later if a third project needs them.

#### Theme Tokens
`aetherion-tokens.css` is copied from CustomTCG and trimmed. **Keep**: core palette, faction palette (6 × 5 variants), rarity colors, resource type colors, typography, spacing, borders & radii, shadows, transitions, z-index. **Drop**: card-frame-specific tokens (`--card-frame-*`), CMS-specific utility classes.

#### MCP Configuration
Two MCP servers: context7 (library docs for XState, Zustand, Framer Motion) and aetherion-db (card data inspection). The aetherion-db path uses an environment variable (`AETHERION_MCP_DB_PATH`) rather than a hardcoded relative path between repos. A wrapper script is the fallback if `.mcp.json` doesn't support env var interpolation.

#### Claude Code Rules
Six contextual rule files in `.claude/rules/` (code-style, testing, engine, frontend, monorepo, game-domain) loaded based on which files are being edited. Settings include Prettier auto-format hooks and `.env` edit protection.

### Exit Criteria
- `pnpm install` → `pnpm build` → `pnpm test` all pass
- Card generation script produces valid typed JSON from the database
- Vite dev server runs with Tailwind + Gilded Ink theme applied (dark background, correct fonts)
- Engine tsconfig rejects DOM imports at compile time
- All CLAUDE.md and `.claude/rules/` files written
- Missing card data prints a clear warning instead of cryptic import errors
- Claude Code can navigate the repo and make targeted edits in any package

---

## Phase 1 — DSL Schema Design

**Goal**: Define a structured, machine-executable schema for card abilities using TypeScript discriminated unions — a typed AST approach where the type system itself is the spec.

**Deliverable**: A formal DSL specification in `packages/engine/src/types/`, plus a reference translation of 15–20 representative abilities proving coverage. Spec documented in `docs/dsl-spec.md`.

### 1.1 Typed AST Approach

Rather than a text-based DSL parsed at runtime, the abilities are modeled as TypeScript discriminated unions. This gives full type checking, IDE autocomplete, JSON serializability, and is directly comprehensible to Claude Code:

```typescript
// packages/engine/src/types/effects.ts

type Effect =
  | { type: 'deal_damage'; amount: number; target: TargetExpr }
  | { type: 'heal'; amount: number; target: TargetExpr }
  | { type: 'modify_stats'; atk: number; hp: number; arm?: number; target: TargetExpr; duration: Duration }
  | { type: 'draw_cards'; count: number; condition?: Condition }
  | { type: 'deploy_token'; name: string; atk: number; hp: number; tags?: string[]; zone: Zone }
  | { type: 'destroy'; target: TargetExpr }
  | { type: 'bounce'; target: TargetExpr }
  | { type: 'choose_one'; options: { label: string; effects: Effect[] }[] }
  | { type: 'for_each'; counting: CountingExpr; effect: Effect }
  | { type: 'gain_effect'; target: TargetExpr; ability: AbilityDSL; duration: Duration }
  | { type: 'composite'; effects: Effect[] }
  // ... (full list: ~20 variants)
```

The interpreter walks this AST tree via a `switch` on `effect.type`. Adding a new mechanic means adding a new union variant and a new case — Claude Code handles this pattern exceptionally well because the types constrain what code it can generate.

### 1.2–1.6 Effect Primitives, Triggers, Selectors, Conditions, Durations

*(Unchanged from prior version — full reference tables for all 20 effect primitives, 19 trigger types, 16 target selectors, 9 condition types, and 5 duration types. See sections 1.2–1.6 in the appendix or `docs/dsl-spec.md`.)*

### 1.7 Coverage Assessment

After analyzing all 146 abilities in the database:

- **~85% map directly** to 1–2 primitives with standard triggers — stat buffs, damage, healing, draw, deploy tokens, destroy, bounce.
- **~10% need compound effects** — sequential operations ("destroy it, then deploy one costing 1 more"), conditional branches ("if it is destroyed, draw a card"), or the `choose_one` modal.
- **~5% are genuinely complex** — scaling effects ("draw cards equal to spells in discard, max 5"), replacement effects ("when would be destroyed, exile instead"), and effects that grant other effects ("equipped character gains 'when it deals lethal damage, draw a card'").

The complex 5% are implementable within this schema using `for_each`, nested `gain_effect` blocks, and replacement effect hooks. Nothing in the current card pool requires Turing-complete scripting — the typed AST is sufficient.

### Exit Criteria
- Full TypeScript type definitions published in `packages/engine/src/types/`
- 15–20 reference translations validated (covering all primitive types and at least 2 compound/complex cases)
- Full list of primitives, triggers, conditions, and selectors finalized
- Edge-case rules documented (e.g., how `while_condition` passives re-evaluate)
- Spec published in `docs/dsl-spec.md`

---

## Phase 2 — Ability Translation

**Goal**: Translate all 146 abilities from natural language to the typed AST schema defined in Phase 1.

**Deliverable**: Every card in the database has a machine-readable DSL representation of its abilities, stored alongside the natural-language text.

### Approach

#### 2.1 Storage Strategy
Add a new `dsl` field inside each ability JSON object in the database's `abilities` JSONB column. No schema migration needed — just a data update. The card generation script (`packages/cards/scripts/generate.ts`) reads the `dsl` field and outputs it with full TypeScript typing.

#### 2.2 Translation Strategy

Work in priority order by ability frequency and engine dependency:

| Priority | Ability Types | Count | Rationale |
|---|---|---|---|
| **P1 — Engine-critical** | Passive stat auras, Deploy effects, basic Trigger (activated) | ~50 | Fire constantly, needed for basic gameplay |
| **P2 — Combat-relevant** | Last Breath, on-kill, on-attack, on-defend, damage reaction | ~20 | Needed for combat to feel correct |
| **P3 — Spell effects** | Cast spells (damage, draw, bounce, destroy, heal) | ~25 | Needed for spell resolution |
| **P4 — Equipment** | Equipment auras, on-equip, granted abilities | ~30 | Can be added after core loop works |
| **P5 — Hero specials** | Hero triggers, transformations, Ultimates | ~16 | Complex but low count |
| **P6 — Edge cases** | Counter, Flash, modal choices, scaling effects | ~5 | Small count, high complexity |

#### 2.3 Semi-Automated Translation
Pattern-matching script drafts DSL for common templates (~60% auto-draftable). Remaining ~40% manual.

#### 2.4 Validation Pass
Vitest suite in `packages/cards/` validates every ability parses against the TypeScript types. Every translated ability checked against natural-language text for semantic equivalence.

### Exit Criteria
- All 146 abilities have `dsl` objects in the database
- Validation suite confirms every ability parses against TypeScript types
- Manual review complete for all P5 and P6 abilities

---

## Phase 3 — Engine Core

**Goal**: Build the rules engine as a pure TypeScript package (`packages/engine/`) with zero UI dependencies. It manages game state and enforces all rules.

**Deliverable**: A headless engine that can run a complete game when given player decisions, producing a full game log. Fully testable with Vitest.

### 3.1 Architecture

```
packages/engine/
├── src/
│   ├── state-machine/
│   │   ├── game-machine.ts        ← XState v5: top-level game flow
│   │   ├── turn-machine.ts        ← Nested: upkeep → strategy → action → end
│   │   ├── combat-machine.ts      ← Nested: declare → response → resolve
│   │   └── stack-machine.ts       ← Priority/reaction chain (LIFO)
│   ├── effects/
│   │   ├── interpreter.ts         ← AST walker: switch on effect.type
│   │   ├── resolver.ts            ← Handles choice pauses + effect sequencing
│   │   └── primitives/            ← One file per effect type
│   ├── zones/
│   │   ├── zone-manager.ts        ← Slot limits, legal paths, transfers
│   │   └── targeting.ts           ← Attack matrix, Defender rules, Flying/Sniper
│   ├── combat/
│   │   ├── combat-resolver.ts     ← 5-step combat sequence
│   │   └── damage-calculator.ts   ← ARM reduction, simultaneous damage
│   ├── events/
│   │   ├── event-bus.ts           ← Pub/sub for game events
│   │   ├── event-types.ts         ← Discriminated union of all game events
│   │   └── trigger-manager.ts     ← Registers/unregisters card triggers
│   ├── cards/
│   │   ├── card-instance.ts       ← Factory for runtime card instances
│   │   └── modifier-stack.ts      ← Stat modifications with duration tracking
│   └── types/                     ← Full type definitions (shared)
└── tests/                         ← Vitest, co-located by module
```

**Key constraint**: Zero DOM dependencies. Never imports React, Zustand, or anything browser-specific. Exports pure functions and type definitions. XState machines are defined here but instantiated in the client. The engine's tsconfig sets `"lib": ["ES2022"]` with no DOM — this is enforced at the compiler level, not just by convention. Immer lives in the client (Zustand store), not the engine — the engine produces pure state transitions.

### 3.2 Game State Model

Single serializable TypeScript interface. Managed by Zustand (in the client) with Immer middleware. The engine produces state transitions — the store applies them.

Core interfaces: `GameState`, `PlayerState`, `CardInstance`, `HeroState` — fully typed with discriminated unions for zones, phases, and status effects.

### 3.3 Turn State Machine (XState v5)

Nested statecharts modeling the full game flow:

```
game-machine
  ├── setup (initial draw, mulligan, coin flip)
  ├── playing
  │   └── turn-machine (nested)
  │       ├── upkeep (auto-steps 1–5)
  │       ├── strategy (free-form player actions)
  │       ├── action (attack declarations + response windows)
  │       │   └── combat-machine (per attack)
  │       │       ├── declare_attack → response_window → resolve_damage
  │       │       └── stack-machine (if reactions played)
  │       └── end (auto cleanup)
  └── game_over
```

XState guards prevent illegal transitions by design — eliminating an entire class of validation bugs.

### 3.4 Effect Executor

AST interpreter. Takes a typed effect object + current game state, returns new state + any pending player choices. Deterministic, choice-aware (pauses for player decisions), event-emitting (feeds the trigger system), and stack-safe (LIFO resolution for Counter/Flash chains).

Each effect primitive in its own file under `effects/primitives/`, keeping implementations focused and under 200 lines.

### 3.5 Event Bus

Type-safe pub/sub using discriminated union events (`GameEvent`). Card abilities register listeners on entry, unregister on exit. Active-player-first (APNAP) ordering for simultaneous triggers.

### 3.6 Combat Resolver

Rulebook's 5-step sequence: validate → response window → simultaneous damage calc (ATK vs ARM) → apply damage → emit events. Special handling for Flying, Sniper, Defender, Empty Board Rule, and First Strike.

### Exit Criteria
- Engine runs a full game via function calls
- All 4 turn phases execute correctly
- Combat resolves with correct damage math including ARM
- Zone movement enforces slot limits and legal paths
- Summoning sickness, Defender targeting, transformation triggers all work
- Game ends correctly on hero LP = 0
- Full game log captures every state change
- Vitest coverage >90% on engine package

---

## Phase 4 — Game Flow Layer

**Goal**: Bridge the pure engine with the React client — deck loading, game setup, Zustand store wiring, and action computation.

**Deliverable**: Complete game flow from deck selection to victory screen, with all legal actions computed and validated.

### 4.1 Card Data Loading
Typed JSON imports from `@aetherion-sim/cards`. Pre-built starter decks per faction for v1. Card instance factory creates runtime objects from static definitions.

### 4.2 Zustand Game Store
Wires engine to React via Zustand + Immer + Zundo (undo/redo) + devtools. Exposes `GameState`, `AvailableActions`, and `dispatch(action)`.

### 4.3 Game Setup Sequence
Hero select → deck load → shuffle → draw 5 → mulligan → random first player → first-player restrictions.

### 4.4 Action Computation
Engine computes full `AvailableActions` at every state — the complete set of legal moves with affordability, targeting, and timing checks. The UI renders these as clickable options. The player never has to guess what's legal.

### Exit Criteria
- Decks load from typed card data package
- Game setup runs end-to-end
- Zustand store wired with Immer + devtools + undo/redo
- Available actions computed correctly for every game state
- Turn handoff works cleanly

---

## Phase 5 — React UI

**Goal**: Build the interactive game interface using React + Tailwind CSS 4 + Framer Motion.

**Deliverable**: A Vite-served client (`apps/client/`) with full battlefield, hot-seat two-player mode, card animations, and game log.

### 5.1 Layout
Mirrored battlefields (opponent top, you bottom). Each side: Reserve (2) + Frontline (3) + High Ground (2). Status bars, hand display, resource bank, phase indicator, game log.

### 5.2 Interaction Model
Click-to-select with highlighted valid targets (faction-colored glow). Phase indicator + "End Phase" button. Opponent's turn grays controls.

### 5.3 Card Display & Animation
Compact battlefield cards (name, stats in JetBrains Mono, faction border). **Framer Motion**: `layout` for zone transitions (FLIP), `AnimatePresence` for draw/deploy/destroy, spring physics, damage pop-up numbers. Full card detail on hover/click.

### 5.4 Faction Theming
Tailwind CSS 4 `@theme` + CSS custom properties. `data-faction` attribute on parent elements swaps all faction colors below — zero JS re-renders. Gilded Ink dark palette as base.

### 5.5 Two-Player Mode
Hot-seat / pass-and-play for v1. UI flips on turn change. Opponent hand hidden. Future: WebSocket sync via Zustand middleware.

### Exit Criteria
- Battlefield renders all zones with correct slot counts
- Cards display stats correctly with faction borders
- All player actions clickable and resolve through engine
- Card transitions animate smoothly
- Game log readable
- Full game playable start to finish

---

## Phase 6 — Polish & Testing

**Goal**: Stress-test and stabilize for actual playtesting.

**Deliverable**: Comprehensive Vitest suites + playtest-validated game balance.

### 6.1 Rule Validation Tests
Every mechanical interaction: summoning sickness + Haste, Defender targeting, zone movement, hero transformation, ARM calc, Empty Board, chain resolution, token removal, simultaneous damage.

### 6.2 DSL Executor Tests
Every effect primitive: passive apply/remove, conditional re-evaluation, cooldown tracking, once-per-turn limits, duration cleanup.

### 6.3 Integration Scenarios
Full board-state replays: "Onyx sacrifice chain with Ghoul Marshal", "Lyria double-spell Arcane Insight trigger", "Seraphina transform ARM→ATK aura", etc.

### 6.4 Playtest Sessions
Onyx vs Radiant, Sapphire vs Verdant, mirror matches. Document ambiguities and balance issues.

### 6.5 Known Future Work (Out of Scope for v1)
- Crimson and Amethyst faction cards
- Network multiplayer (WebSocket sync via Zustand middleware)
- AI opponent
- Deck builder UI
- Game replay / rewind (Zundo foundation exists)
- Text-based DSL parser via Chevrotain (if non-programmers need to author effects)

---

## Milestone Summary

| Phase | Deliverable | Dependency | Effort |
|---|---|---|---|
| **Phase 0** | Clean card data | None | Light |
| **Phase 0.5** | Monorepo scaffold + toolchain + CLAUDE.md | None (parallel with Phase 0) | Medium (see `aetherion-sim-scaffolding-plan.md` for execution details) |
| **Phase 1** | Typed AST DSL schema + reference translations | Phase 0 | Medium |
| **Phase 2** | All 146 abilities translated | Phase 1 | Medium-Heavy |
| **Phase 3** | Headless game engine (pure TS) | Phase 1 (reference set sufficient) | Heavy (~2000–3000 lines) |
| **Phase 4** | Game flow + Zustand store | Phase 3 + Phase 0.5 | Medium |
| **Phase 5** | React + Tailwind + Framer Motion UI | Phase 4 | Medium-Heavy |
| **Phase 6** | Testing + polish | Phase 5 | Ongoing |

**Critical path**: (Phase 0 + Phase 0.5 in parallel) → Phase 1 → (Phase 2 + Phase 3 in parallel) → Phase 4 → Phase 5 → Phase 6

---

## Open Questions for Your Review

1. **Phase 0 — Null abilities**: The 5 cards with missing effect text need creative design. Should we write these together, or do you have drafts?

2. **Phase 0 — Traits audit**: Beyond parsing ability text, should we do a full design review of which characters *should* have traits like Haste, Stealth, Elite, etc. that aren't mentioned anywhere currently?

3. **Phase 1 — DSL granularity**: Some equipment abilities grant complex sub-abilities (e.g., "Equipped character gains 'When it deals lethal damage, draw a card'"). Should these be nested AST objects via `gain_effect`, or simplified for v1?

4. **Phase 5 — Scope**: Should the UI include a basic deck builder, or just preset starter decks per faction for v1?

### Settled

- **~~DSL Storage~~**: `dsl` field inside existing `abilities` JSONB — least-invasive, no schema migration. Card generation script reads and types it.
- **~~Naming~~**: `aetherion-sim` confirmed as monorepo name.
- **~~DB client~~**: `pg` (node-postgres) over Prisma — lightweight, raw SQL, no ORM overhead for a build-time script.
- **~~Font handling~~**: Copy from CustomTCG for now; shared package extracted later if a third project needs them.
- **~~MCP path~~**: Environment variable (`AETHERION_MCP_DB_PATH`) rather than hardcoded relative path.
