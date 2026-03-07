# Monorepo Rules

## Package Structure
- `packages/*` — shared libraries (engine, cards, ui, config)
- `apps/*` — deployable applications (client)
- All internal packages use `@aetherion-sim/*` scope

## Dependency Rules
- Workspace packages referenced as `workspace:*` in package.json
- No circular dependencies between packages
- Engine has zero DOM dependencies — enforced by tsconfig
- UI package uses React as a peer dependency

## Turborepo Pipeline
- `build` depends on `^build` (builds dependencies first)
- `test` depends on `build` (type-checked before testing)
- `dev` is not cached (persistent process)
- `generate:cards` is manual, not part of `build` pipeline

## Import Boundaries
- Client can import from engine, cards, ui
- UI can import from engine (for types)
- Engine imports from nothing except cards types
- Cards is standalone (no workspace deps)
- Config is consumed via `extends` / `exports` only
