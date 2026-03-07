# Frontend Rules

## React 19
- Functional components only, named exports
- Use React 19 features where appropriate (use, Actions)
- Keep components focused — presentational vs container separation

## Styling — Tailwind CSS v4 + Gilded Ink
- `@import "tailwindcss"` (not `@tailwind` directives)
- Custom colors used in utilities (`bg-*`, `text-*`, `border-*`) MUST be in `@theme` block
- CSS variables in `aetherion-tokens.css` alone do NOT generate utility classes
- Alignment colors: `alignment-{name}[-light|-dark]` — never numbered shades
- No pure black (#000) or pure white (#fff) — all warm-toned
- Accent gold (`#be9438`) < 10% of any screen
- Default `border` uses warm `var(--color-border)` via base layer override

## Font Inheritance Gotcha
- `fonts.css` sets `h1-h3` globally to Playfair Display
- UI-label headings using `<h2>`/`<h3>` must add `font-body` class to override

## Zustand Conventions
- One store per domain (game, ui, settings)
- Use Immer middleware for mutable-style updates
- Derive computed values with selectors, never store derived data
- Keep store actions colocated with the store definition

## Animation (Motion / Framer Motion v12)
- Use `motion` package for layout animations and transitions
- Respect `prefers-reduced-motion: reduce`
- Keep animation state out of Zustand — use motion's internal state
