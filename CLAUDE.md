# Aetherion Simulator — Claude Code Project Guide

## Project Overview
Real-time game simulator for the Aetherion TCG. Separate from the CMS/card management platform (CustomTCG). Turborepo + pnpm monorepo with a pure TypeScript game engine and React 19 client.

## Monorepo Structure
```
AetherionSimulator/
  packages/
    config/      — Shared tsconfigs, ESLint, Vitest, Prettier configs
    engine/      — Pure game engine (XState, zero DOM deps)
    cards/       — Card data types + DB-to-JSON generator
    ui/          — Shared React UI components (Gilded Ink design system)
  apps/
    client/      — React 19 + Vite + Tailwind v4 game client
  docs/          — Architecture and DSL documentation
  Documentation/ — Git submodule (sparse: game/ only) for Rulebook
```

## Essential Commands
```bash
pnpm dev              # Start Vite dev server (client)
pnpm build            # Build all packages + client
pnpm test             # Run all tests
pnpm lint             # Lint all packages
pnpm generate:cards   # Generate card JSON from PostgreSQL (requires Docker)
pnpm format           # Format all files with Prettier
```

## Critical Rules

### Engine = Zero DOM
The engine package (`packages/engine/`) has NO DOM lib in its tsconfig. It is a pure state machine: `(state, action) => newState`. Immer lives in the client's Zustand store, not in the engine.

### Card Data = Build-Time JSON
Card data is generated from the shared PostgreSQL database (same DB as CustomTCG). Run `pnpm generate:cards` with Docker containers running. The `generate:cards` task is NOT part of the `build` pipeline — it's a manual step.

### Named Exports Only
No default exports anywhere. Use named exports for all modules.

### Strict TypeScript
- `strict: true`, `noUncheckedIndexedAccess: true`
- No `any` types — use `unknown` and narrow
- Discriminated unions with exhaustive `switch` + `never`

### Tailwind v4 @theme
Custom colors used as utility classes (`bg-accent`, `text-alignment-crimson`) MUST be registered in `@theme` block in `apps/client/src/index.css`. CSS variables in `aetherion-tokens.css` alone do NOT generate utility classes.

### Gilded Ink Design System
- No pure black (#000) or pure white (#fff)
- Accent gold < 10% of screen
- Alignment colors: 3-tier (`alignment-{name}[-light|-dark]`)
- Three fonts: Playfair Display (display), DM Sans (body), JetBrains Mono (stats)

## Package Dependencies
```
client -> engine, cards, ui
ui     -> engine (types only)
engine -> (standalone)
cards  -> (standalone)
config -> (consumed via extends/exports)
```

## Documentation Submodule
`Documentation/` is a sparse-checkout git submodule of AetherionDocs. Only `game/` is materialized (Rulebook, card design docs). To update: `git submodule update --remote`.

@import Documentation/game/Rulebook.md
