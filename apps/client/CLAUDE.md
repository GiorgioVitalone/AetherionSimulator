# @aetherion-sim/client

React 19 game client for the Aetherion TCG simulator.

## Architecture

### State Management
- **Zustand + Immer** for game state — the engine produces pure state transitions, Zustand applies them with Immer's mutable-style API
- **XState** for UI state machines (menus, phase indicators, animation sequencing)
- Keep stores minimal — one store per domain (game state, UI state, settings)
- Never put derived data in stores — use selectors

### Component Patterns
- Functional components with named exports only
- Feature-based directory structure: `features/{domain}/`
- Presentational components in `@aetherion-sim/ui`, wired components in `features/`
- Use `@/*` path alias for imports

### Styling
- Tailwind CSS v4 with `@import "tailwindcss"` (not `@tailwind` directives)
- Gilded Ink design system — all tokens in `theme/aetherion-tokens.css`
- Custom colors MUST be registered in `@theme` block in `index.css` to generate utility classes
- Alignment colors: `alignment-{name}[-light|-dark]` (3-tier, never numbered shades)
- No pure black (#000) or pure white (#fff) — always warm-toned

### Animation
- Use `motion` (Framer Motion v12) for layout animations, card transitions, combat effects
- Respect `prefers-reduced-motion: reduce` — all animations must collapse to instant
- Keep animation state out of Zustand — use motion's internal state

### Key Files
| File | Purpose |
|------|---------|
| `src/index.css` | Tailwind v4 setup + @theme registration |
| `src/theme/aetherion-tokens.css` | CSS custom properties (Gilded Ink tokens) |
| `src/theme/fonts.css` | @font-face declarations + base typography |
| `src/stores/` | Zustand stores |
| `src/machines/` | XState machine definitions |
| `src/features/` | Feature modules (battlefield, hand, hero, combat, game-log) |
