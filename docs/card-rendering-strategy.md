# Card Rendering Strategy

## Decision: Reimplement, Don't Reuse Export Templates

The CMS export templates (`CustomTCG/Templates/`) are Handlebars + static CSS designed for Puppeteer PDF output at physical dimensions (63.5mm x 88.9mm). The simulator needs interactive React components. Same visual language, different medium.

## What to Carry Over (Visual Spec)

Use the export templates as the **reference design** for these decisions:

### Card Anatomy (structure)
Art window -> name line with cost badges -> stat badges -> ability text -> traits footer -> rarity dot + card code. This layout is the game's visual identity.

### Faction Tinting (color logic)
- Surface gradient: `faction-color` at 4% top to 10% bottom over `--color-surface`
- Border: `faction-color` at 40% mixed with `--color-border-strong`
- Name line background: `faction-color` at 12%
- Text area background: `faction-color` at 10% mixed with `--color-surface-alt`
- Art window inner glow: radial gradient of `faction-color` at 16%

### Cost Badge Shapes
- **Mana**: circle, blue radial gradient (`#6aaed6` -> `--color-mana`)
- **Energy**: capsule (rounded rect with tab), gold radial gradient (`#e0c062` -> `--color-energy`)
- **Flexible**: diamond (rotated square), blue-to-gold linear gradient
- Heroes show small resource indicator dots instead of cost badges

### Stat Badge Colors
- ATK: crimson gradient (`#e63946` -> `#c1121f`)
- HP: verdant gradient (`#52b788` -> `#2d6a4f`)
- ARM: onyx gradient (`#6c6c6c` -> `#444444`)

### Copy-Tight Scaling
Cards with more abilities shrink text. Export template scales:
- 3 abilities: 0.94x
- 4 abilities: 0.86x
- 5 abilities: 0.78x
- With flavor text present, scale harder (subtract ~0.06 per tier)

In React, derive scale from `abilities.length` as a prop, not `:has()` selectors.

### Gold Accent Rules
- Top edge: 1.5px gold gradient (transparent -> accent -> transparent), 80% opacity
- Below top: 2px faction-color gradient at 85% opacity
- Bottom edge: faction+gold mixed gradient at 50% opacity

## What Does NOT Translate

| Export Template | Simulator Component |
|----------------|-------------------|
| Handlebars partials | React components with typed props |
| `mm` units (print) | `rem`/`px` with `aspect-ratio` |
| Static CSS | Tailwind utilities + dynamic faction theming via style prop |
| Print media queries | Animation states, hover, drag feedback |
| `--copy-scale` via `:has()` | Computed scale from `abilities.length` prop |
| No interactivity | Click, drag, hover, flip, glow on target |

## Implementation Plan

Build a `<CardFrame>` component in `packages/ui/` that:
1. Accepts typed `SimCard` data as props
2. Renders the same visual anatomy as the export templates
3. Uses Gilded Ink tokens (already in `apps/client/src/theme/`)
4. Supports size variants (hand-size, battlefield-size, inspect-size)
5. Exposes interaction hooks (onClick, onDrag, onHover)
6. Integrates with Framer Motion for animations

### Source Files to Reference
- `CustomTCG/Templates/card-frame.css` — complete visual spec (569 lines)
- `CustomTCG/Templates/handlebars/layouts/card-standard.hbs` — standard layout structure
- `CustomTCG/Templates/handlebars/layouts/card-fullart.hbs` — full-art variant
- `CustomTCG/Templates/handlebars/partials/` — cost-badges, stat-pips, abilities, traits, rarity
- `CustomTCG/Templates/handlebars/helpers.js` — ability formatting logic
