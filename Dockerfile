# =============================================================================
# Aetherion Simulator — Multi-stage Docker build
#
# Stage 1 (build): pnpm install + turbo build
# Stage 2 (runtime): nginx serves the static SPA
#
# Prerequisites:
#   Card data must be generated before building:
#     DATABASE_URL="..." pnpm generate:cards
#   The generated packages/cards/data/cards.json is included via COPY.
# =============================================================================

# ── Stage 1: Build ──────────────────────────────────────────────────────────

FROM node:22-alpine AS build

RUN corepack enable && corepack prepare pnpm@10.30.3 --activate

WORKDIR /app

COPY . .

# Ensure cards data dir exists (postinstall reads it)
RUN mkdir -p packages/cards/data

RUN pnpm install --frozen-lockfile && pnpm build

# ── Stage 2: Runtime ────────────────────────────────────────────────────────

FROM nginx:1.27-alpine AS runtime

RUN rm /etc/nginx/conf.d/default.conf

COPY nginx.conf /etc/nginx/conf.d/default.conf

COPY --from=build /app/apps/client/dist /usr/share/nginx/html

COPY --from=build /app/apps/client/public/fonts /usr/share/nginx/html/fonts

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
