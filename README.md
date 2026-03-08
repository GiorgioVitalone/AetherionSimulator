# Aetherion Simulator

Aetherion Simulator is a real-time game simulator for the Aetherion TCG. It is separate from the CustomTCG CMS/card-management platform and focuses on two areas:

- a pure TypeScript game engine with zero DOM dependencies
- a React 19 client for playing and testing game flows in the browser

This repository is a Turborepo monorepo managed with pnpm workspaces.

## Monorepo structure

```text
AetherionSimulator/
├── apps/
│   └── client/      # React 19 + Vite + Tailwind v4 game client
├── packages/
│   ├── cards/       # Card data types + DB-to-JSON generator
│   ├── config/      # Shared TypeScript, ESLint, Vitest, and Prettier config
│   ├── engine/      # Pure game engine (XState, zero DOM deps)
│   └── ui/          # Shared React UI components
├── docs/            # Architecture and DSL documentation
└── Documentation/   # Git submodule (game/ only) with the Rulebook
```

## Getting started

### Prerequisites

- Node.js 24+
- Corepack enabled

### Install dependencies

```bash
corepack enable
pnpm install
```

## Available commands

```bash
pnpm dev              # Start the client development server
pnpm build            # Build all packages and the client
pnpm test             # Run the test suite
pnpm lint             # Run lint checks
pnpm generate:cards   # Generate card JSON from PostgreSQL (requires Docker)
pnpm format           # Format supported files with Prettier
```

## Important project constraints

### Engine = zero DOM

`packages/engine` is a pure state machine layer with no DOM libraries in its TypeScript configuration.

### Card data = build-time JSON

Card data is generated from the shared PostgreSQL database used by CustomTCG. Run `pnpm generate:cards` with Docker running when card data needs to be refreshed. This step is manual and is not part of the default build pipeline.

### TypeScript conventions

- named exports only
- strict TypeScript with `noUncheckedIndexedAccess: true`
- no `any`; prefer `unknown` and explicit narrowing
- use discriminated unions with exhaustive `switch` handling

### Styling conventions

- Tailwind v4 custom utility colors must be registered in the `@theme` block in `apps/client/src/index.css`
- the Gilded Ink design system avoids pure black and pure white

## Documentation

- `docs/architecture.md`
- `docs/dsl-spec.md`
- `docs/card-effect-system.md`
- `docs/game-rules-summary.md`
- `Documentation/game/Rulebook.md`
