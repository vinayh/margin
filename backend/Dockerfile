# syntax=docker/dockerfile:1.7

# Backend runtime + tests + CLI all run on Deno (see deno.jsonc tasks).
# `@tailwindcss/cli` is a Node-targeted package but runs cleanly under
# Deno's npm compat, so the styles stage stays on the same toolchain.
#
# Build context: repo root (not backend/). The styles stage needs both
# backend/src and shared/tokens.css, and the @import path inside
# src/api/styles/input.css points up four levels into shared/. Mirroring
# the host layout under /app keeps that relative path identical.
# Invoke as `flyctl deploy --config backend/fly.toml` from the repo root.

FROM denoland/deno:alpine AS deps
WORKDIR /app/backend
COPY backend/deno.jsonc backend/deno.lock backend/package.json ./
# `deno ci` materializes node_modules strictly from deno.lock (analogous to
# `npm ci`): clears any prior node_modules, installs only what the lockfile
# pins, errors if the lockfile is out of date with package.json. Better for
# reproducible builds than `deno install --frozen`, which only checks drift.
# Deno 2.x blocks npm lifecycle scripts by default (the primary shai-hulud-
# class attack vector); opt-in via --allow-scripts.
RUN deno ci

FROM denoland/deno:alpine AS styles
WORKDIR /app/backend
# Native bindings pulled in by @tailwindcss/cli need two alpine-runtime
# shims that denoland/deno:alpine doesn't ship:
#   - libstdc++ for @parcel/watcher's C++ runtime
#   - musl-dev for the bare `libc.so` symlink that Tailwind Oxide's
#     napi-rs binding dlopen()s at startup (alpine only ships the
#     versioned `libc.musl-x86_64.so.1`)
RUN apk add --no-cache libstdc++ musl-dev
COPY --from=deps /app/backend/node_modules ./node_modules
COPY backend/deno.jsonc backend/deno.lock backend/package.json ./
COPY backend/src ./src
COPY shared/tokens.css /app/shared/tokens.css
RUN deno run -A npm:@tailwindcss/cli -i src/api/styles/input.css -o dist/backend.css --minify

FROM denoland/deno:alpine
WORKDIR /app/backend
COPY --from=deps /app/backend/node_modules ./node_modules
COPY backend/deno.jsonc backend/deno.lock backend/package.json backend/tsconfig.json ./
COPY backend/src ./src
COPY backend/drizzle ./drizzle
COPY --from=styles /app/backend/dist ./dist

ENV NODE_ENV=production
ENV PORT=8787
ENV MARGIN_DB_PATH=/data/margin.db

EXPOSE 8787

# Scoped runtime permissions. A compromised dep in the import tree can
# only reach the env vars, network hosts, and syscalls listed below.
#   --allow-env=<list>  Margin's own vars + every env name Better Auth's
#                       core/logger/telemetry and drizzle probe at module
#                       load. Better Auth's central registry scans for
#                       ~50 OAuth provider + deployment-platform env vars
#                       unconditionally (AUTH0_*, OKTA_*, KEYCLOAK_*,
#                       VERCEL_URL, NETLIFY_URL, AWS_LAMBDA_*, etc.) even
#                       when we only configure Google; they're harmless
#                       to allow (we don't set them) but must appear in
#                       the list or `name in process.env` throws.
#   --allow-net         outbound + bind allow-list.
#   --deny-net          defense-in-depth: block IMDS / Fly metadata.
#   --allow-sys         not scoping: node:sqlite + libc shims poke misc.
# --allow-read/--allow-write are left broad pending a path inventory
# (tracked in docs/spec.md §14.1).
#
# Migrate runs first as a one-shot and does NOT get --allow-net.
CMD ["sh", "-c", "\
deno run \
  --allow-env=MARGIN_DB_PATH,NODE_ENV \
  --allow-read --allow-write --allow-sys \
  src/db/migrate.ts && \
deno run \
  --allow-env=GOOGLE_CLIENT_ID,GOOGLE_CLIENT_SECRET,GOOGLE_API_KEY,GOOGLE_PROJECT_NUMBER,MARGIN_MASTER_KEY,MARGIN_DB_PATH,MARGIN_PUBLIC_BASE_URL,MARGIN_RUN_BACKGROUND_LOOPS,MARGIN_TRUST_PROXY,MARGIN_SLACK_WEBHOOK_URL,MARGIN_EMAIL_TRANSPORT,MARGIN_EMAIL_FROM,RESEND_API_KEY,PORT,DEBUG,NODE_ENV,LANG,TEST,BETTER_AUTH_SECRET,BETTER_AUTH_SECRETS,BETTER_AUTH_URL,BETTER_AUTH_TRUSTED_ORIGINS,BETTER_AUTH_TELEMETRY,BETTER_AUTH_TELEMETRY_DEBUG,BETTER_AUTH_TELEMETRY_ID,BETTER_AUTH_TELEMETRY_ENDPOINT,AUTH_SECRET,BASE_URL,DATABASE_URL,DATABASE_HOST,DATABASE_PASSWORD,DATABASE_USERNAME,NETLIFY_URL,NETLIFY_DB_DRIVER,NETLIFY_DB_URL,VERCEL_URL,RENDER_URL,AWS_LAMBDA_FUNCTION_NAME,AZURE_FUNCTION_NAME,GOOGLE_CLOUD_FUNCTION_NAME,NEXT_PUBLIC_AUTH_URL,NEXT_PUBLIC_BETTER_AUTH_URL,NEXTAUTH_URL,NUXT_PUBLIC_AUTH_URL,NUXT_PUBLIC_BETTER_AUTH_URL,PUBLIC_BETTER_AUTH_URL,AUTH0_CLIENT_ID,AUTH0_CLIENT_SECRET,AUTH0_DOMAIN,GUMROAD_CLIENT_ID,GUMROAD_CLIENT_SECRET,HUBSPOT_CLIENT_ID,HUBSPOT_CLIENT_SECRET,KEYCLOAK_CLIENT_ID,KEYCLOAK_CLIENT_SECRET,KEYCLOAK_ISSUER,LINE_JP_CLIENT_ID,LINE_JP_CLIENT_SECRET,LINE_TH_CLIENT_ID,LINE_TH_CLIENT_SECRET,LINE_TW_CLIENT_ID,LINE_TW_CLIENT_SECRET,MS_APP_ID,MS_CLIENT_SECRET,MS_TENANT_ID,OKTA_CLIENT_ID,OKTA_CLIENT_SECRET,OKTA_ISSUER,PATREON_CLIENT_ID,PATREON_CLIENT_SECRET,SLACK_CLIENT_ID,SLACK_CLIENT_SECRET,CI,CI_NAME,CONTINUOUS_INTEGRATION,TF_BUILD,AGENT_NAME,APPVEYOR,BUILDKITE,CIRCLECI,DRONE,GITEA_ACTIONS,GITHUB_ACTIONS,GITLAB_CI,TRAVIS,TEAMCITY_VERSION,BUILD_ID,BUILD_NUMBER,CI_APP_ID,CI_BUILD_ID,CI_BUILD_NUMBER,RUN_ID,PACKAGE_VERSION,COLORTERM,TERM,TERM_PROGRAM,TERM_PROGRAM_VERSION,TMUX,FORCE_COLOR,NO_COLOR,NODE_DISABLE_COLORS,npm_config_user_agent \
  --allow-read --allow-write --allow-sys \
  --allow-net=oauth2.googleapis.com:443,www.googleapis.com:443,docs.googleapis.com:443,content.googleapis.com:443,api.resend.com:443,hooks.slack.com:443,0.0.0.0:8787 \
  --deny-net=169.254.169.254,[fd00:ec2::254],metadata.google.internal,_metadata.flyio.internal \
  src/cli/index.ts serve\
"]
