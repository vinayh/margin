# Margin: project conventions

Phased build plan in [`docs/spec.md` §12](./docs/spec.md#12-build-sequence); shipped vs. pending is tracked in the [README Build status list](./README.md#build-status).

## Repo layout

Top-level deliverables (`backend/`, `site/`, `extension/`) are siblings; `shared/` holds cross-surface assets. Path references elsewhere in this doc that start with `src/`, `test/`, `drizzle/`, etc. are relative to `backend/` unless prefixed.

```
backend/             Deno backend (runtime + tests + CLI). Run `deno task ...`
                     from inside this dir; everything below is relative to it.
  src/
    config.ts        lazy env-var getters; importing it doesn't require any env var
    db/              drizzle schema (SPEC §4) + node-postgres client + migrator
    auth/            Better Auth server config (Google provider + bearer plugin),
                     envelope encryption, TokenProvider, test-only session helper
    google/          endpoint-shaped REST wrappers (drive/docs/docx + token-refresh
                     helper). No domain logic.
    domain/          business logic composing db/google/auth. No HTTP, no CLI.
    cli/             thin parse-and-call shells dispatched by index.ts
                     (`deno task margin <cmd>`)
    api/             Deno.serve HTTP host. server.ts owns the route table;
                     background.ts owns the renew/poll loops; one module per route.
                     router.ts is the URLPattern-based dispatcher;
                     middleware.ts + cors.ts hold bearer-auth + CORS helpers;
                     route-wrappers.ts wraps handlers with CSP + rate limit.
                     pages/ holds Preact-rendered HTML pages (picker, auth bridge,
                     review-action chooser/confirm).
    notify/          transport abstraction for outbound notifications
                     (email.ts, slack.ts)
  test/              test suite (Deno BDD; see Tests section below)
  drizzle/           generated migration directories (one per migration)
  deno.jsonc         tasks + import map (margin, migrate, serve, test, …)
  Dockerfile         multi-stage Deno-on-Alpine image; runs migrate then serve.
                     Styles stage runs `npm:@tailwindcss/cli` under Deno's npm compat.
  fly.toml           Fly.io app config (see docs/deployment.md)
shared/              cross-surface assets shared between backend, site, and
                     extension. `tokens.css` (Tailwind v4 @theme) and
                     `doc-id.ts` (Google Doc id/URL helpers used by both
                     backend domain/CLI and the extension popup/SW).
extension/           MV3 extension (Chrome / Edge / Firefox), WXT-driven.
                     See extension/README.md
site/                Astro + Preact public site; deploys to GitHub Pages
docs/                internal markdown. Public README + contributor guide
                     stay at root.
.github/workflows/   ci.yml: deno check + deno test + codecov + fly-deploy on main.
                     integration.yml: nightly live-Google suite. pages.yml:
                     site/ → Pages
```

- **Surface** is user-facing UX. **Client** is any other API caller. Per SPEC §3, all state lives in the backend; surfaces are views.
- Don't put logic in `src/cli/`: it's a parse-and-call shell over `src/domain/`.
- Don't put logic in `src/api/`: same rule. Routes delegate into `src/domain/`. Auth lives in Better Auth (`src/auth/server.ts`), not in route modules.

## CLI

- Single dispatcher: `deno task margin <subcommand>` (`src/cli/index.ts`).
- Each subcommand exports `async function run(args: string[])` and is registered in `index.ts`.
- Subcommands with multiple verbs (`comments {ingest,list}`, `watcher {subscribe,...}`) use `dispatchSubcommands(args, USAGE, table)` from `cli/util.ts`.
- Use `parseArgs` from `node:util`.
- Exit codes: `usage(text)` exits 2 (Unix convention for misuse); `fatal(text)` exits 1 (runtime failure).

## Domain conventions

- **Not-found pairs.** Each domain entity has a nullable getter (`getProject`, `getVersion`, `getOverlay`, `getUserByEmail`, `firstUser`) and a throwing partner (`requireProject`, `requireVersion`, …). Most call sites want the throwing variant; reach for the nullable one only when "missing" is a normal branch. Don't inline `(await db.select()…)[0]; if (!x) throw …`: use the helper.
- **Token-provider sugar.** Sites whose only reason to fetch a project is to get the owner's `userId` should call `tokenProviderForProject(projectId)`. Sites that need other project fields call `requireProject` and pass `proj.ownerUserId` to `tokenProviderForUser` themselves.

## HTTP API

- `deno task serve` runs the API host (`Deno.serve`, in `src/api/server.ts`). The Fly container runs the same command; deployment lives in [`docs/deployment.md`](./docs/deployment.md).
- **Route table.** Register new routes in `server.ts`'s table; never branch `pathname` inline. Each route is its own module under `src/api/` and is a thin shell that delegates into `src/domain/`. The dispatcher in `router.ts` matches by `URLPattern` in insertion order — register exact paths BEFORE their `*` parent so the wildcard doesn't swallow a more-specific match.
- **Auth.** Better Auth (`src/auth/server.ts`) owns the `/api/auth/**` route tree plus the `user`, `session`, `account`, and `verification` tables. `authenticateBearer` in `src/api/middleware.ts` wraps `auth.api.getSession({ headers })` and returns `{ userId, sessionId }`; the bearer plugin accepts the raw `session.token` as `Authorization: Bearer …`. Google refresh tokens are envelope-encrypted in `account.refreshToken` via a `databaseHooks.account` write hook; `TokenProvider` in `src/auth/credentials.ts` decrypts them and refreshes Drive access tokens against Google directly. `GET /api/picker/page` authenticates via the session cookie (top-level navigation, not a CORS XHR).
- **Extension sign-in.** `GET /api/auth/ext/launch-tab?ext=<chrome.runtime.id>` kicks off Google OAuth via Better Auth's `signInSocial`; the inner `callbackURL` points at `/api/auth/ext/success`, which renders an HTML bridge page that hands the session token to the SW. Chromium uses `chrome.runtime.sendMessage` gated by `externally_connectable.matches`; Firefox parks the token in `location.hash` for the SW's `tabs.onUpdated` to pick up. The SW persists it in `chrome.storage.local`. The `ext` parameter is allow-listed against Chromium/Firefox id formats.
- **CORS.** Allow-list (extension + localhost origins) on cross-origin routes; see `src/api/cors.ts`.
- **Background loops.** `startBackgroundLoops` (`src/api/background.ts`) launches `renewExpiringChannels` (~30 min) and `pollAllActiveVersions` (~10 min) timers in-process when `MARGIN_PUBLIC_BASE_URL` is set and `MARGIN_RUN_BACKGROUND_LOOPS != 0`. `createVersion` also auto-subscribes a Drive `files.watch` channel best-effort. Pass `{ backgroundLoops: false }` to `startServer` in tests.
- **Webhooks.** `POST /webhooks/drive` always responds 200 OK so Google stops retrying; channel-level errors get logged.

## Frontend stack

- Astro for the public site (`site/`), WXT for the extension. Preact is the shared component layer. Extension-only UI lives in `extension/ui/`.
- **Tailwind v4** via `@tailwindcss/vite` in both `site/astro.config.mjs` and `extension/wxt.config.ts`. Design tokens (colors, fonts, spacing) live in `shared/tokens.css` as a `@theme` block. Prefer token utilities (`text-ink`, `bg-cream-2`, `border-rule`) over raw `black/N`-style classes.

## Browser extension (`extension/`)

Build pipeline, popup state machine, Picker mechanics, and toolbar-icon routing live in [`extension/README.md`](./extension/README.md). Conventions to know when working on this surface:

- **Don't build by hand.** Always go through the WXT tasks from `extension/`: `deno task build`, `build:firefox`, `dev`. Run `deno task prepare` after edits that affect TypeScript so `.wxt/wxt.d.ts` regenerates. (Deno is the package manager + task runner; WXT itself executes under Node via the bin's `#!/usr/bin/env node` shebang.)
- **Cross-browser API.** Import `{ browser }` from `wxt/browser`; WXT ships its own promisified shim. Don't add `webextension-polyfill` (30 KB) or hand-roll a `chrome ?? browser` picker.
- **No content script.** Ingest is server-side (`.docx` export, SPEC §9.8); the extension is a pure UI surface (popup, options, side panel). The Drive Picker is hosted on the backend at `/api/picker/page` and opens as a new tab from the popup's *Add to Margin* button.
- **Preact only in the popup + side panel.** Options + SW stay plain TS.
- **Backend calls go through the SW.** All popup → backend traffic uses the `Message` envelope in `utils/messages.ts`. The popup never touches the API token directly. The backend-hosted picker page calls `/api/picker/register-doc` itself with the session cookie.
- **E2E rig via `chrome-devtools-mcp`** (`.mcp.json` at repo root). Persistent Chrome profile at `.margin-test-chrome/` (gitignored), pre-warmed with the test Google account. Use `--categoryExtensions` + the `install_extension` MCP tool against `extension/dist/chrome-mv3` (Puppeteer-launched Chrome silently ignores `--load-extension`). After install, pre-populate settings via `chrome.storage.local.set` in the SW context, then drive a real click on the Options page's *Test connection* button to grant `http://localhost:8787/*` (Chrome rejects programmatic `permissions.request` without a user gesture).

## Schema migrations

- Edit `src/db/schema.ts`, then `node node_modules/drizzle-kit/bin.cjs generate`, then `deno task migrate`. (Use `node` directly, not `deno run npm:drizzle-kit` — Deno's npm compat layer trips the drizzle-kit 1.0-rc internal version check and exits silently.)
- Migrations apply at runtime via `drizzle-orm/node-postgres/migrator`. The drizzle 1.0 format stores each migration as a directory under `drizzle/<timestamp>_<name>/` containing `migration.sql` + `snapshot.json`.
- `drizzle.config.ts` runs under Node (drizzle-kit), so it uses `process.env`, not `Deno.env`.
- The migrator uses `DATABASE_URL_DIRECT` (unpooled) — PgBouncer transaction mode can't host a session-bound migrator. The app uses `DATABASE_URL` (pooled) for ordinary queries.
- The migrator silently skips a migration file whose journal `when` is `≤ MAX(created_at)` in `__drizzle_migrations`. If a new migration appears not to run, bump its `when` past the checkpoint.

## Config

- `src/config.ts` uses lazy getters; importing it doesn't require any env var. Only accessing a missing getter throws. Reflect new env vars in `.env.example`.

## Google integration

- Only `drive.file` for active doc operations. It's per-file (SPEC §9.2): the backend only sees docs Margin created, the user opened with the Workspace Add-on, or the user picked via Drive Picker. Every entry surface needs a "first time you reference a doc, here's how to authorize it" affordance.
- Never pass raw access tokens around. Build `tokenProviderForUser(userId)` and pass it to `authedFetch` / `authedJson<T>`; refresh-on-401 is automatic.
- New Drive/Docs endpoints go in `src/google/{drive,docs}.ts` as endpoint-shaped wrappers, not domain-shaped.
- The Google OAuth URL builder + code-exchange path lives inside Better Auth's Google provider (`src/auth/server.ts`). `src/google/oauth.ts` is just the token-refresh helper.
- Before re-litigating a Workspace API limitation, read SPEC §9. The constraints there are settled.

## Secrets

- Long-lived secrets (refresh tokens, etc.) round-trip through `encryptWithMaster` / `decryptWithMaster`; never store plaintext. The Google `account.refresh_token` is handled by the `databaseHooks.account.{create,update}.before` hook in `src/auth/server.ts`. New fields that need at-rest encryption should attach a similar hook rather than encrypting inside domain code.

## Tests

- `deno task test` runs the suite; `deno task typecheck` runs `deno check src/ test/`.
- Co-locate `*.test.ts` next to the module under test. Unit-test pure logic; exercise live Google APIs through CLI smoke commands rather than mocking `fetch`.
- Every test file starts with `import "<…>/test/setup.ts";` — Deno has no preload hook, so each test imports the setup module for its side effects (env defaults + PGlite-backed Postgres on a per-process socket via `@electric-sql/pglite-socket`, with migrations applied before any test runs).
- Test framework: `@std/testing/bdd` for `describe` / hooks plus `@std/expect` for Jest-compatible `expect`. We alias `it as test` so the body reads like Jest/Vitest.
- Coverage today spans envelope encryption, anchor + OOXML docx parse, CORS allow-list + preflight, route auth/owner-scope + state transitions, settings round-trip, magic-link review-action redeem, and email transport. Better Auth's sign-in / session / OAuth flows are covered by the upstream package's tests; Margin tests use `issueTestSession` (`test/session.ts`) to bypass the OAuth dance for route tests.
- `test/*.integration.test.ts` files run against live Google. Gated on `GOOGLE_CI_REFRESH_TOKEN` + client vars via `integrationTest` (`test/integration.ts`); tests skip cleanly when secrets aren't set. They run nightly via `.github/workflows/integration.yml`.

---

# Runtimes

This is a dual-runtime repo:

- **Backend (`backend/src/`, `backend/test/`) runs on Deno** (see `backend/deno.jsonc` for tasks + import map). Run `deno task …` from inside `backend/`. Permissions are scoped per task — a compromised dep can't reach env vars / hosts / paths outside the allow-list.
  - Postgres via `pg` (node-postgres) + drizzle adapter `drizzle-orm/node-postgres`. Prod points at Neon (or any Postgres-compatible host) via `DATABASE_URL` / `DATABASE_URL_DIRECT`; tests use an in-process PGlite instance fronted by a TCP socket server so the same code path runs locally without external infra.
  - HTTP via `Deno.serve` + the URLPattern-based dispatcher in `src/api/router.ts`.
  - Crypto via `node:crypto` (sync SHA-256 etc.) and Web Crypto where async is fine.
  - File I/O: `Deno.open` / `Deno.readTextFile` / `Deno.readFile`. For Node-API parity (`Buffer`, `Stream`) import explicitly: `import { Buffer } from "node:buffer"`.
  - Env: `Deno.env.get/set/delete`. `.env` is loaded via `--env-file=.env` if you wire it into a task; tests rely on per-process defaults set in `test/setup.ts`.
- **WXT extension (`extension/`) and Astro site (`site/`) use Deno as the package manager + task runner, Node as the actual runtime.** Each has its own `package.json` + `deno.json` + `deno.lock` and is independent of `backend/`. From inside the workspace dir: `deno install` to populate `node_modules/`, then `deno task build` / `deno task dev` (which shell out to `node ./node_modules/.bin/<astro|wxt>`). `backend/package.json` carries only backend npm deps (Deno consumes them via `nodeModulesDir: "auto"`; same pattern in `site/` and `extension/`).
- `backend/drizzle.config.ts` runs under Node (drizzle-kit invokes it), so it uses `process.env`.
