# Codebase scan: 2026-07-18

Full-repo audit (backend API/auth, backend domain/db/google/cli, extension,
site/shared/CI/tests) run after the previous cleanup pass in `d155d8d`. Every
finding below was verified against the source at scan time; spot-checks
confirmed the top items. Check off items as they're fixed; delete this file when
it's drained.

Suggested order of attack: the four "Fix first" items, then the comment-pipeline
cluster (silently corrupts core data), then extension state bugs, then
hardening + docs in one sweep.

## Fix first

- [ ] **[HIGH, security] Extension session fixation via auth-fragment handoff.**
      `extension/entrypoints/background.ts:404` (`handleAuthFragment`) accepts
      any tab URL matching `<backend>/api/auth/ext/success#token=...` and
      unconditionally stores the fragment token
      (`patchSettings({ sessionToken: token })`, line 421). Nothing binds the
      handoff to a user-initiated sign-in, and the listener runs on Chromium
      too, not just Firefox. Any web page can navigate the victim there and
      silently swap the stored session for an attacker's account (or sign the
      victim out with garbage). The backend's single-use nonce only protects the
      server-rendered page, not the SW's URL match. Fix: mint a one-time state
      value in the SW when sign-in launches, persist it short-TTL in storage,
      pass it through `launch-tab`, require it in the fragment, clear on first
      use; apply the same check in `handleExternal`.

- [ ] **[HIGH, bug] `deno task serve` cannot reach Postgres.**
      `backend/deno.jsonc:30`: the serve task's `--allow-net` list has only
      Google/Resend/Slack hosts plus `0.0.0.0:8787` / `127.0.0.1:8787`; no DB
      host/port, and no `--env-file=.env`. List predates the sqlite→postgres
      migration, so boot-time migrate dies with `NotCapable`. Prod unaffected
      (Dockerfile keeps `--allow-net` broad deliberately). Fix: mirror the
      Dockerfile (broad allow-net + existing IMDS `--deny-net` list) and add
      `--env-file=.env`.

- [ ] **[HIGH, security/CI] Fly deploy uses a third-party action at a mutable
      branch with `FLY_API_TOKEN` in scope.** `.github/workflows/ci.yml:95`:
      `superfly/flyctl-actions/setup-flyctl@master`; the following steps hold
      `FLY_API_TOKEN`. Pin to a commit SHA.

- [ ] **[MEDIUM-HIGH, security] Review-request response leaks reviewers'
      redeemable magic-link tokens to the requester.**
      `backend/src/domain/review.ts:245` builds `links[].url` containing the
      plaintext token; `POST /api/extension/review/request`
      (`backend/src/api/review-request.ts:73`) returns it verbatim. Redeem needs
      only the token, so the requester can forge any reviewer's
      `mark_reviewed`/`decline`. The email log transport redacts these; the HTTP
      response does not. Fix: strip `links[].url` from the API response; deliver
      tokens only via email/Slack transport.

## Backend bugs: comment pipeline + domain

- [ ] **Table-anchored comments always orphan on projection.** Docx walker
      counts table-cell paragraphs (`backend/src/google/docx.ts:131`, recurses
      `w:tbl → w:tr → w:tc → w:p`) but the Docs-API walker never recurses into
      `el.table` (`backend/src/google/docs.ts:166`,
      `if (!el.paragraph) continue`). The two sides index different paragraph
      universes: table comments never re-anchor, and body indices skew after any
      table (breaks the pass-2 proximity tiebreak). Fix: recurse into `el.table`
      in docs.ts, or exclude table paragraphs symmetrically in the docx walk.
- [ ] **Upstream comment edits never propagate.**
      `backend/src/domain/comments/upsert.ts:59`: `upsertCanonical`
      short-circuits on existing `(version_id, google_comment_id)` with no
      UPDATE path, so editing a comment body in Google Docs never updates
      `canonical_comment.body`. Only the hash-keyed fallback path reacts (by
      churning a new row). Fix: on the `alreadyPresent` branch, diff and update
      `body` (and optionally anchor).
- [ ] **Suggestion idempotency key churns on unrelated edits + strands reply
      chains.** `backend/src/domain/comments/suggestions.ts:75` hashes
      `paragraphIndex`+`offset` into the key, so edits above a suggestion re-key
      it: old canonical gets reaped (`deleted_at`), while drive-id-keyed replies
      keep `parent_comment_id` pointing at the deleted row (hidden by
      `isNull(deletedAt)` filters). Fix: drop position from the key, or re-point
      reply parents on re-key.
- [ ] **Overlay redact/replace deletes wrong span length.**
      `backend/src/domain/overlay.ts:162`: `translateOp` uses source
      `quotedText.length` instead of the reanchor result's
      `matchedText`/`matchLen`; fuzzy matches cut short or delete trailing text.
      Also assumes one doc index per plaintext char (breaks around inline
      images/footnote refs). Fix: use the reanchor matched-span length; restrict
      overlay ops to clean matches until coordinate mapping handles non-text
      elements.
- [ ] **Notification settings are write-only.** `notifyOnReviewComplete`,
      `notifyOnComment`, `defaultReviewerEmails`, `defaultOverlayId` round-trip
      through settings (`backend/src/domain/settings.ts:15`) but nothing reads
      them; `notifyRequesterOfReviewAction`
      (`backend/src/domain/review-action.ts:212`) notifies unconditionally. Fix:
      gate `createNotification` on the flags, or drop the dead toggles.
- [ ] **Drive-side "resolve" never reaches canonical status.** `COMMENT_FIELDS`
      requests `resolved` + `replies(action)` (+ unused `htmlContent`) at
      `backend/src/google/drive.ts:174` but ingest never consumes them. Fix: map
      `resolved === true` → `status: "addressed"` during ingest, or trim the
      fields with a spec pointer.
- [ ] **Project deletion leaks live watch channels.** `deleteOwnedProject`
      (`backend/src/domain/project.ts:205`) cascade-deletes
      `drive_watch_channel` rows without `stopChannel`; Google keeps POSTing to
      `/webhooks/drive` until TTL (up to 24h). Fix: best-effort `stopChannel`
      the project's channels before delete (same pattern as
      `replaceWatchChannel`).
- [ ] **Case-sensitive email lookup can duplicate users.** `createReviewRequest`
      lowercases assignee emails, but `getUserByEmail`
      (`backend/src/domain/user.ts:77`) does exact `eq` on plain text; a
      mixed-case Better Auth email yields a duplicate lowercase placeholder user
      receiving the assignment. Fix: compare via `lower(email)`, or normalize
      casing in the Better Auth hook.
- [ ] **OOXML `w:sdt` content skews anchor offsets.** `walkContainer`
      (`backend/src/google/docx.ts:287`) doesn't recurse into
      `w:sdtContent`/`w:hyperlink` while `paragraphPlaintext` (line 360) does,
      so comments after an inline sdt get misaligned `startOffset`/`quotedText`.
      Fix: make `walkContainer` recurse into nested containers (and count
      `w:ins`/`w:del`).
- [ ] **Malformed ids 500 instead of 404.**
      `backend/src/api/notifications.ts:20` ids and `acceptProjection`'s
      `targetVersionId` (`backend/src/domain/comment-action.ts:179`) hit uuid
      columns unguarded (Postgres `22P02` → 500); every other lookup
      early-returns on `!isUuid`. Fix: filter/guard with `isUuid` like the
      siblings.
- [ ] **Ext-success burns the nonce before checking the session.**
      `backend/src/api/auth-handler.tsx:159`: `consumeExtNonce` runs before
      `getSession`; a transient session miss permanently invalidates the nonce,
      forcing a full OAuth restart. Fix: verify session first, or preserve the
      nonce on the session-missing branch.
- [ ] **Drive webhook mutates dedup set pre-auth.**
      `backend/src/api/drive-webhook.ts:39`: `rememberEvent` inserts into
      `seenEvents` before the channel-token check inside
      `handleDriveWatchEvent`. Near non-exploitable (channel ids are random
      UUIDs) but flip the ordering.

## Extension bugs

- [ ] **Options sign-in hardcodes `DEFAULT_BACKEND_URL`.**
      `extension/entrypoints/options/main.ts:170` uses the build-time default
      for permission request + launch tab and never persists `backendUrl`, while
      both SW token-acceptance paths compare against the _stored_ URL
      (`background.ts:387`, `:414`). If they diverge (prod build over dev
      profile, failed install seed) sign-in silently never completes and no UI
      remains to edit the stored URL. Fix: read stored URL (fallback default)
      and `patchSettings({ backendUrl })` before launching.
- [ ] **Toolbar toggle-to-close dies after MV3 SW suspend.**
      `panelOpenWindowIds` / `detachedSidepanelWindowId` are module-level SW
      state (`background.ts:179`); the panel connects its lifecycle port once
      and has no `port.onDisconnect` reconnect (`sidepanel/App.tsx:129`). After
      ~30s idle the SW suspends, state resets, next toolbar click reopens
      instead of closing (regresses the d155d8d toggle fix). Fix: panel
      reconnects on disconnect; SW rebuilds state at startup via
      `runtime.getContexts({ contextTypes: ["SIDE_PANEL"] })` + `tabs.query` for
      the detached window.
- [ ] **Side-panel reboots are unscoped; commits bypass the generation guard.**
      `sidepanel/App.tsx:101` `tabs.onUpdated` doesn't check the tab is active
      (fires for all tabs/windows); `boot()` commit unconditionally replaces the
      view; `loadProjectInto`/`onSwitchProject` (lines 285–377) commit outside
      `bootGen`. Background tab loads yank users out of explicitly picked
      projects/views. Fix: filter to active tab, skip auto-reboot in non-root
      views, route all commits through the generation counter.
- [ ] **Detached-window mode always lands on the picker**
      (Edge/Brave/Opera/Arc). `getActiveDocId` queries
      `{ active: true, currentWindow: true }` from inside the popup window,
      resolving to `sidepanel.html` itself (`App.tsx:340`,
      `utils/ui-surfaces.ts:87`). The `?activeDocId=` plumbing already exists
      for e2e. Fix: append originating doc id to the sidepanel URL on the
      detached path.
- [ ] **Sign-out errors report success.** `errorResponseFor` returns
      `{ kind: "auth/sign-out", ok: true, error }` (`background.ts:440`; variant
      type is literal `ok: true` in `utils/messages.ts:138`), and Options checks
      `r.ok` first (`options/main.ts:200`): failed sign-out renders "Signed
      out." with the token still stored. Fix: `ok: boolean`, return false on
      error, branch on `error` first.
- [ ] **Dashboard refresh discarded on subview round-trips.** `refreshAll`
      updates only local state (`views/Dashboard.tsx:43`); App's `view.detail`
      never updates, and
      `onClose={() => setView({ kind: "loaded", detail: view.detail })}` reseeds
      from the stale snapshot (`App.tsx:198`). Fix: lift refresh via
      `onDetailChange` callback, or refetch on return.
- [ ] **Notifications bell blanks every poll.**
      `views/NotificationsBell.tsx:30`: the 60s `reload()` sets
      `{ kind: "loading" }` first, so badge drops to 0 and an open dropdown
      blanks each cycle. Fix: keep previous loaded state during background
      refreshes.
- [ ] **Raw `sendMessage` sites swallow errors** (incomplete d155d8d
      `requestOrThrow` adoption): `Dashboard.tsx:45` (`refreshAll`,
      `syncVersion`) and `NotificationsBell.tsx:59` (`markAllRead`, `clickItem`)
      discard `error`; failed sync/mark-read gives zero feedback. Fix: route
      through `requestOrThrow` + surface like sibling buttons.

## Security hardening

- [ ] **Docker: runtime runs as root; base image unpinned.**
      `backend/Dockerfile:39`: no `USER` directive; `denoland/deno:alpine`
      floats. Add `USER deno`, pin the tag.
- [ ] **Actions at mutable major tags:** `denoland/setup-deno@v2`,
      `codecov/codecov-action@v6` (receives `CODECOV_TOKEN`) in ci.yml:26,34 /
      integration.yml:31,49 / pages.yml:35. Pin to SHAs.
- [ ] **pages.yml over-grants:** workflow-level `pages: write` +
      `id-token: write` reach the build job (`pages.yml:11`); move to the deploy
      job's `permissions:`.
- [ ] **Manifest breadth:** `optional_host_permissions: ["<all_urls>"]` unused
      now that the custom-URL UI is gone, and localhost `externally_connectable`
      entries ship in prod builds (`extension/wxt.config.ts:56,61`). Narrow /
      branch by build mode.
- [ ] **`.mcp.json` runs `chrome-devtools-mcp@latest`** via npx (line 7); pin an
      exact version.
- [ ] **Drive wrappers leak response bodies into `Error.message`:**
      `exportDocx`, `trashFile`, `stopChannel`
      (`backend/src/google/drive.ts:49,117,287`) throw ad-hoc errors with the
      body inline, contradicting the `GoogleApiError` log-hygiene rule
      (api.ts:12). Throw `GoogleApiError` instead.

## CI / test infra

- [ ] **pages.yml path filter omits `shared/**`** (`pages.yml:5`): site imports
      `shared/tokens.css` + `shared/icon-simple.svg`, so token/brand changes
      never redeploy. Add `shared/**`.
- [ ] **`deno task test:integration` runs only the smoke file**
      (`backend/deno.jsonc:40`); `review-cycle.integration.test.ts` is skipped
      locally (CI's glob is fine). Widen to `'test/*.integration.test.ts'`;
      refresh the stale sentence in docs/testing.md:56.
- [ ] **`backend/test/coverage.ts` is dead** since the Bun→Deno migration
      (nothing loads it; the Bun preload was removed in 0439cfa), so lcov omits
      never-imported modules. Re-wire via a `coverage.test.ts` shim or delete
      it.
- [ ] **Dead workflow env vars:** `GOOGLE_REDIRECT_URI` (integration.yml:45),
      `MARGIN_DB_PATH` (ci.yml:81); grep-verified unused. Delete.

## Cleanup / duplication

- [ ] Dead exports: `op.replaceAllText` (`backend/src/google/docs.ts:103`,
      tests-only), `listComments`' `startModifiedTime` option (`drive.ts:185`,
      no caller passes opts), `getSettings` in `extension/ui/sendMessage.ts:42`
      (zero callers).
- [ ] `review_request.status` is a dead state machine: nothing writes
      `closed`/`cancelled` (only the `"open"` insert default, review.ts:100) and
      `redeemReviewActionToken` never checks status. Ship the transition +
      redeem check, or drop the states.
- [ ] Review-request hand-rolls a 429 (`backend/src/api/review-request.ts:60`)
      missing the `x-margin-rate-limit-remaining: 0` header the shared limiter
      sets (`route-wrappers.ts:113`). Factor a shared 429 helper.
- [ ] Options page re-implements the sessionToken storage diff that
      `subscribeSessionTokenChanges` (utils/storage.ts) provides
      (`options/main.ts:187`).
- [ ] `"margin-panel-lifecycle"` port name: literal in `App.tsx:132`, constant
      `PANEL_LIFECYCLE_PORT` in `background.ts:214`. Move to `utils/`.
- [ ] Popup Diagnostics fetches `/healthz` directly
      (`popup/Diagnostics.tsx:54`), bypassing the SW envelope convention. Add a
      `health/check` message or document the exception.

## Docs / copy drift (all verified against code)

- [ ] `docs/spec.md:107` (§6.4) claims no `docs.google.com` host_permissions;
      manifest has one (`wxt.config.ts:55`). Align with §12 Phase 2's phrasing.
- [ ] `site/src/pages/index.astro:101`: Picker copy wrong (backend-hosted tab,
      not sandboxed in popup; register creates a project only; copy/hash/watch
      happen at snapshot).
- [ ] `site/src/pages/index.astro:56`: install tabs claim published store
      listings; listings are unshipped Phase 7 (Edge URL 404s, Chrome redirects
      to store front). Replace with load-unpacked/alpha instructions.
- [ ] `docs/extension-qa.md:131,143`: route is `/r/:token` not
      `/api/review/:token`; tokens are multi-use by design (second click should
      succeed); table is `drive_watch_channel` not `watch_channels`.
- [ ] `extension/README.md:44` + `extension/test/e2e/README.md` (steps B–C):
      describe the removed backend-URL field + "Test connection" button; e2e
      seed uses `apiToken` but code requires `sessionToken`.
- [ ] Broken links: `docs/setup.md:140` anchor should be
      `#92-drivefile-scope-semantics`; `extension/README.md:16` path
      `../../docs/spec.md` escapes the repo root (should be `../docs/spec.md`).
- [ ] AGENTS.md:41 vs extension/README.md:154 disagree on whether `icon.svg` or
      `icon-simple.svg` sources the extension PNGs. Pick the true source, align
      both.
- [ ] `site/src/layouts/Layout.astro:13`: meta description says "Local-first";
      Margin is a hosted service. Drop it.
- [ ] Stale Bun-era text: `.gitignore:20` comment (npm install → deno install),
      `backend/test/fetch.ts:2` (Bun `fetch.preconnect` rationale),
      `docs/testing.md:14,52` (workflow is named `app-integration`; gating is
      the three Google vars, not `MARGIN_MASTER_KEY`).
- [ ] Root `CLAUDE.md` is gitignored (`.gitignore:90`), so fresh clones lack the
      AGENTS.md pointer. Track the one-liner or scope the ignore to nested
      `**/CLAUDE.md`.

## Verified clean (no action)

No committed secrets/keys; no SQL injection (drizzle-parameterized throughout);
owner scoping uniform on all HTTP-reachable reads (`loadOwnedVersion` /
`getOwnedProject` / `loadActionContext` collapse missing-vs-unowned to 404);
review tokens stored hashed; Drive webhook token constant-time compared;
envelope crypto sound; Better Auth limiter active in prod (`NODE_ENV=production`
in Dockerfile + fly.toml); CSRF on cookie-reachable `register-doc` closed via
CORS + content-type gating; shared dep versions aligned across surfaces (preact
10.29.2, tailwindcss 4.3.1, diff 9, valibot 1.4.1); every token utility used is
defined in `shared/tokens.css`; all 59 backend test files import
`test/setup.ts`; both integration files gate via `integrationTest`; Dockerfile
installs lockfile-strict (`deno ci`); site favicon correctly sources
`shared/icon-simple.svg`; `.env.example` matches all `config.ts` getters; the
squashed drizzle migration matches `schema.ts`; `tokenProviderForProject` sugar
used consistently.
