# Code Style Rules

## TypeScript
- `strict: true` everywhere — no `any` types, no implicit returns
- Prefer explicit return types on exported functions
- Use `interface` for object shapes, `type` for unions/intersections
- Use discriminated unions with `type` field — handle exhaustively with `switch` + `never`

## Modules
- ESM imports only (`import`/`export`) — no `require()`
- Named exports only — no default exports
- Use `@/*` path alias in the client app
- Group imports: external libs -> workspace packages -> relative imports -> types

## Naming
- `PascalCase`: components, classes, interfaces, types, enums
- `camelCase`: functions, variables, methods, properties
- `UPPER_SNAKE_CASE`: constants
- File names: `PascalCase.tsx` for components, `camelCase.ts` for utilities

## Sizing
- Files under 200 lines
- Functions under 30 lines
- Extract helpers for complex logic — but don't abstract prematurely
- Prefer `const` over `let`; never use `var`
- Prefer early returns over nested conditionals
