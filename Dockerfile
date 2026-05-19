# syntax=docker/dockerfile:1.7

# Backend runtime + tests + CLI all run on Deno (see deno.jsonc tasks).
# The styles stage still uses Node — `@tailwindcss/cli` is a Node tool.

FROM denoland/deno:alpine AS deps
WORKDIR /app
COPY deno.jsonc deno.lock package.json bun.lock ./
# `deno install` reads package.json deps + the deno.jsonc imports map and
# materializes everything into node_modules (nodeModulesDir: "auto").
RUN deno install

FROM node:24-alpine AS styles
WORKDIR /app
COPY package.json bun.lock ./
RUN npm install --no-audit --no-fund --ignore-scripts
COPY src ./src
COPY tokens.css ./
RUN npx -y @tailwindcss/cli -i src/api/styles/input.css -o dist/backend.css --minify

FROM denoland/deno:alpine
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY deno.jsonc deno.lock package.json bun.lock tsconfig.json ./
COPY src ./src
COPY test ./test
COPY drizzle ./drizzle
COPY --from=styles /app/dist ./dist

ENV NODE_ENV=production
ENV PORT=8787
ENV MARGIN_DB_PATH=/data/margin.db

EXPOSE 8787

# `deno task serve` would re-evaluate deno.jsonc per start; invoking the
# entrypoint directly with explicit permissions is the leaner shape for
# a production container. The CMD migrates then serves, matching the
# pre-Deno contract.
CMD ["sh", "-c", "deno run --allow-env --allow-read --allow-write --allow-sys src/db/migrate.ts && deno run --allow-env --allow-read --allow-write --allow-net --allow-sys src/cli/index.ts serve"]
