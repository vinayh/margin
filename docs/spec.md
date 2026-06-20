# Project Spec: Margin (Research Doc Review & Versioning)

**Path conventions.** Source paths shown as `src/...`, `test/...`, `drizzle/...`, `deno.jsonc`, `Dockerfile`, `fly.toml` are relative to the `backend/` workspace. Shared assets sit under `shared/`; the public site lives in `site/` and the extension in `extension/`.

## 1. Objective

Margin helps research teams run structured review of Google Docs across drafts, audiences, and orgs without leaving Docs. It addresses three pain points:

- Forking a doc for an external audience while the original keeps evolving, then integrating comments back.
- Maintaining derivative versions with systematic edits (redactions, audience context) re-applicable as the parent changes.
- Coordinating multi-version, multi-reviewer cycles across orgs with a clear record of who reviewed what.

**Non-goal.** GitHub-style branching/merging on rich text. Semantics are: snapshots, overlays, canonical comments projected across versions, lightweight review-request workflows.

## 2. Core concepts

- **Project.** Long-lived workspace tied to one canonical Google Doc (the *parent*). Owns versions, comments, overlays, reviews.
- **Version (snapshot).** Frozen Drive copy of the parent at a point in time. Real Google Doc + DB row with parent→child link.
- **Overlay.** Named, ordered list of content-addressed edit ops (redact / replace / insert / append) applied to a parent to produce a derivative.
- **Canonical comment.** Margin's own comment-thread representation. Anchored by quoted text + structural context. Projected into Doc versions as native comments. Carries status (open / addressed / wontfix / superseded), origin metadata, history.
- **Review request.** Bundle of frozen version + reviewers + deadline + status + Slack/web thread. The unit users interact with.
- **Participant.** Margin user, authed via Google OAuth (light scope) or other. Distinct from *doc owner* (the participant whose Drive token authorizes Margin's operations on a project).

## 3. Architecture overview

Three layers:

- **Backend.** Single source of truth. Owns DB, reanchoring engine, Drive OAuth tokens, watch/poll loop, REST API.
- **Surfaces.** Read/write views: Slack bot, browser extension (rich UI; in-canvas overlays planned in Phase 6), Workspace add-on (in-doc Cards), web shell (OAuth + Picker + magic links + landing).
- **Google integration layer.** Drive/Docs REST wrappers, OAuth token manager, push-notification subscriptions; lives inside the backend.

**Architectural rule:** *all state lives in the backend.* A comment, version, or overlay is real because the backend says so, not because Google or Slack says so.

## 4. Data model

17 tables (`src/db/schema.ts`):

| Table | Purpose |
|---|---|
| `project` | parent_doc_id, owner_user_id, name (Drive title at register time), settings (default reviewers, default overlay). Project identity is **not** bound to parent_doc_id; the parent can be swapped over a project's lifetime. `createProject`'s "already tracked" pre-check is an application-layer hint, not a DB constraint. |
| `version` | google_doc_id, parent_version_id, label, name (Drive title), snapshot_content_hash, status, last_synced_at. Every project starts with a `label = "main"` row whose `google_doc_id` is the parent doc; subsequent snapshots are v1, v2, … (`pickNextLabel` skips non-`v\d+` labels). |
| `overlay` | name, ordered ops (JSON), project |
| `overlay_operation` | type, anchor (quoted text + context), payload, confidence_threshold |
| `derivative` | version_id, overlay_id, google_doc_id, audience_label |
| `canonical_comment` | origin_version_id, origin_user (+ `origin_photo_hash` for display-name disambiguation, §9.8), kind (`comment` / `suggestion_insert` / `suggestion_delete`), anchor (text + paragraph hash + structural offset + optional `additionalRanges` for disjoint multi-range comments), body, status, parent_comment_id, deleted_at (set when the upstream Drive comment disappears) |
| `comment_projection` | canonical_comment_id, version_id, google_comment_id, anchor_match_confidence, projection_status, last_synced_at |
| `review_request` | project, version, status, deadline, slack_thread_ref |
| `review_assignment` | review_request, user, status, responded_at |
| `user` | email, name, email_verified, image (Better Auth-shaped) |
| `account` | Better Auth's provider-credential row. `provider_id="google"` holds the per-doc-owner Drive refresh token, envelope-encrypted in `refresh_token` |
| `session` | Better Auth session: token (sent as `Authorization: Bearer …` from the extension), userId, expiry |
| `verification` | Better Auth's identifier/value table (unused today; required by the adapter) |
| `drive_watch_channel` | per-version Drive `files.watch` channel + token (renew + dedup state) |
| `review_action_token` | magic-link tokens for review-assignment emails. One row per `(review_request_id, assignee_user_id)`; multi-use until `expires_at`. Action passed at redeem time via `?action=…`. |
| `notification` | per-user inbox of review-lifecycle events (`review_assigned`, `review_completed`, `review_changes_requested`, `review_declined`). Read by the side-panel notifications view; marked read via `/api/extension/notifications/mark-read`. |
| `audit_log` | actor, action, target, before/after for sensitive ops |

The anchor schema is rich enough to resolve to on-screen coordinates without Google's APIs (§9.1).

## 5. Backend services

- **Doc-watcher.** `drive.files.watch` per project + active forks; channel-renewer cron + polling fallback (§9.3). On event, re-export the doc as `.docx` (Drive `files.export`) and parse OOXML for comments, suggestions, and suggestion-thread replies (§9.8). `comments.list` is queried alongside, used only to recover author identity (`me` + `photoLink`) that docx drops.
- **Reanchoring engine.** Given an anchor + target version: exact text match (high), fuzzy within paragraph (medium, edit distance + structural context), or orphan. Returns confidence; thresholds drive auto-project vs. surface-for-review. Margin owns anchoring end-to-end; Google's kix anchor is one input, never authoritative (§9.1).
- **Comment projection.** Native comments authored by Margin are unanchored from Google's view (§9.1). Body is prefixed `Re: "<quoted snippet>": <body>`. The add-on layers named ranges for "comments at this paragraph"; the extension layers on-canvas overlays.
- **Overlay applier.** Translates ops to `documents.batchUpdate` (mapping in §9.7). Anchor-to-index resolution happens upstream. Below-threshold ops surface for review, not silent skip.
- **Review orchestrator.** Lifecycle: create fork, share with reviewers, post Slack thread, notify, aggregate status, close + pull comments back.
- **Notification dispatcher.** Routes events to Slack / add-on / web / email.
- **Auth service.** Better Auth (Google provider + bearer plugin); refresh tokens envelope-encrypted in `account.refresh_token` via a Better Auth `databaseHooks.account` write hook; per-user `TokenProvider` refreshes Drive access tokens directly against Google.

## 6. Surfaces

### 6.1 Slack bot

Primary chat surface for review coordination.

- **Slash commands:** `/review-request <doc-url> @reviewers [--overlay …] [--deadline …] [--audience …]`, `/review-status [project|reviewer]`, `/review-close <id>`.
- **Interactive elements:** review-thread message (version label, reviewer status icons, comment count, deadline, action buttons); home tab ("Reviews waiting on you" / "Your open requests" / activity); DMs for assignment / new comments / reviewer responses.
- **Cross-org.** Slack Connect when both orgs use it; magic-link assignment emails otherwise (comment in the doc, click a link to mark reviewed). Comment content rendered in the Slack thread regardless of authoring path.
- **Drive scope.** Bot must direct user through per-file authorization (add-on or Picker) before backend touches a doc (§9.2).

### 6.2 Workspace add-on

**Deferred.** The popup project surface (§6.4) covers the affordances originally targeted at the add-on (tracked-state lookup, sync trigger, first-time onboarding via Picker). The add-on stays in scope for users who can't install the extension (managed devices, blocked extension installs) but is off the MVP critical path. When it ships, it's a Unified Workspace Add-on (CardService; *not* the legacy Editor add-on) covering:

- **On project parent:** version list + status per version, active reviews, pending reanchorings, buttons (Request review / Checkpoint / Open in extension).
- **On fork:** banner ("This is v2 of [project] for [audience]" or "Author is editing v3 in [link]"), reviewer status, buttons (Mark reviewed / Open Slack thread / Back to parent).
- **On unknown doc:** onboarding card. Granting scope here triggers `onFileScopeGranted`, which gives Margin `drive.file` for that doc (§9.2).
- **Auth.** Apps Script identity token verified backend-side; Drive scope held by Margin OAuth client (per §8).
- **Constraints.** CardService widgets only: no HTML/JS, no selection access (§9.4, §9.5).
- **Comment visualization.** Side panel renders canonical threads + projection status + reply chains. Cross-references named ranges to render per-section comment counts and "jump to next."

### 6.3 Web entry points

Deliberately minimal; the rich UI is in the extension.

- **`/api/auth/**`.** Better Auth's catch-all (sign-in, Google OAuth callback, get-session, sign-out). Extension sign-in opens `/api/auth/ext/launch-tab?ext=<chrome.runtime.id>` in a normal browser tab; after the Google consent flow lands on Better Auth's social callback, `/api/auth/ext/success` hands the session token to the SW (Chromium: `chrome.runtime.sendMessage` gated by `externally_connectable.matches`; Firefox: `location.hash` picked up by `tabs.onUpdated`).
- **`/api/picker/page`.** Backend-hosted Drive Picker. Cookie-authenticated top-level navigation; mints a Drive access token, runs the Picker, POSTs to `/api/picker/register-doc` same-origin on pick, and closes itself.
- **Magic-link handlers.** `/r/<token>?action=<kind>` style, one-click state changes for external reviewers; rendered confirmation page (chooser page when `action` is missing or unrecognized). Distinct from Better Auth sessions: review-action tokens authorize state transitions scoped to one assignment, not an authenticated session. Multi-use until `expires_at` so reviewers can change their response by clicking a different action link.
- **Public landing page.** Marketing/explainer with install CTAs.

Project dashboards, diff viewer, reconciliation UI, overlay editor, and settings live in the extension (§6.4), not on the web.

**Mobile is out of scope.** Slack mobile covers review actions; mobile-authored comments ingest through Drive.

### 6.4 Browser extension

Chrome / Firefox / Edge extension: popup + options + side panel. The extension is a **pure UI surface**. Ingestion happens server-side via docx export (§9.8), so the manifest has no content script and no `host_permissions` on `docs.google.com`. Roles:

- **Project surface (popup).** The popup is the primary "is this doc tracked, what state is it in, sync it now, add it as a new project" surface. Reads `tab.title` (stripped of the locale `" - Google Docs"` suffix), calls backend `/api/extension/doc-state`, branches into onboarding / tracked views. "Add to Margin" opens `/api/picker/page` (§6.3) in a new tab; on pick, the page registers the doc and closes. "Sync now" calls `/api/extension/doc-sync` to re-ingest comments.
- **Rich UI (side panel).** Preact app: project dashboard (versions, derivatives, review history, reviewer participation), structured side-by-side version diff, comment reconciliation list. Talks to backend with the user's Better Auth session token (acquired via §6.3) sent as `Authorization: Bearer …` from the SW.
- **Visualization (Phase 6).** Highlights overlaid on the doc body, gutter markers, hover previews, right-click "comment on selection," native-comment-rail integration. Doc body is `<canvas>` (§9.6), so this needs the accessibility-DOM mirror or selection-event hooks. This is the only future role that touches the doc page; if it ships, it will reintroduce `host_permissions` on `docs.google.com/*` and a content script, but only to read selection events / a11y-mirror coordinates, never comment data.

Implementation detail (popup state machine, tab-based OAuth bridge, backend-hosted Picker mechanics, manifest permissions, cross-browser shim) lives in [`extension/README.md`](../extension/README.md). Conventions for working on this surface: [`AGENTS.md`](../AGENTS.md#browser-extension-extension).

**Out of scope:** mobile / iPad Docs.

## 7. Workflows

### 7.1 Single-org review
1. Author runs `/review-request` (Slack) or sidebar action (add-on).
2. Backend verifies `drive.file` for the doc; if missing, prompt add-on flow or Picker (§9.2).
3. Backend snapshots a version (`files.copy`), applies overlay if any, sets reviewer sharing.
4. Backend creates review request, posts Slack thread, DMs reviewers.
5. Reviewers comment in Docs; doc-watcher ingests → canonical store → projects to version.
6. Slack thread updates as comments arrive (configurable: per-comment vs. batched).
7. Reviewers click "Mark reviewed" (Slack / sidebar / web).
8. Author runs `/review-close` (or auto-close on full reviewer set). Comments project onto current parent via reanchoring engine; clean → auto-sync, ambiguous → reconciliation UI.

### 7.2 Cross-org review
Same as 7.1, with:

- External reviewer accesses via shared Drive doc link.
- Status updated by magic-link email button or Slack Connect.
- Comments still ingested via doc owner's Drive token (external reviewers grant no Drive scope).

### 7.3 Derivative with overlay
1. Author defines overlay ops in extension or add-on.
2. Save + name + assign to project.
3. Run "Create derivative": backend copies parent, applies overlay via `documents.batchUpdate`, records derivative.
4. Share derivative with audience.
5. On parent update, "Refork" re-copies + re-applies; non-matching ops surface for review.

### 7.4 Multi-version review cycle
1. v1 reviewed; canonical comments anchored to v1.
2. Author edits parent.
3. Author requests v2 review. v1 comments project onto v2: clean ("still open from v1"), changed ("likely addressed, confirm?"), or deleted-text ("previous-version context", sidebar only, not a native comment).
4. v2 reviewers comment.
5. Author marks v1 comments addressed. Replies on v2 link to canonical comments by ID, so reply chains compose across versions.
6. v3 review repeats.

## 8. Authentication and authorization

| Role | Mechanism |
|---|---|
| Doc owner | Better Auth Google provider, scope `drive.file` (per-file, §9.2); refresh token envelope-encrypted in `account.refresh_token` |
| Participant | Better Auth Google provider (identity-only), SSO (SAML, OIDC, future), or `review_action_token` magic links for email-only reviewers (scoped to one assignment, multi-use until expiry) |
| Slack identity | Slack OAuth (future Better Auth `genericOAuth` provider) + email match against `user.email` |

**Authorization model.** Project-scoped roles: owner / collaborator / reviewer / observer. External reviewers added per-review-request, scoped to that version.

**Data isolation.** Projects belong to a tenant (org). Cross-org review means inviting users from other tenants to a specific request.

## 9. Google Workspace API constraints

### 9.1 Anchored comments cannot be authored via API
Drive `comments.create` accepts `anchor`, but for Docs editor files anchored comments authored via the API are not supported. Apps Script `DocumentApp` has no comment-creation method. The kix anchor blob is unstable.

**Implications:** Margin owns anchoring. Native comments produced by Margin are unanchored from Google's view; quoted snippet inlined in the body. Reading anchored comments authored in the UI works fully; only the outbound projection path is constrained.

### 9.2 `drive.file` scope semantics
Per-file. Granted only via files Margin created OR explicit Picker / Workspace Add-on file-scope flow. Typing a URL into Slack does not grant access.

**Implications:** Every entry surface needs a "first-time authorization" affordance. Cross-org review depends on the *doc owner's* `drive.file` token; external reviewers grant no Drive scope.

### 9.3 Drive push-notification requirements
- HTTPS endpoint, domain verified in Search Console.
- Channel TTL 1 to 24h (max ~7 days); can drop without notice.
- Push payload is empty (`X-Goog-Resource-State` + channel ID); re-fetch on event.

**Implications:** doc-watcher needs public infra + channel-renewer cron + polling fallback. Only reliable "doc changed" signal; Docs has no `onEdit` analog.

### 9.4 Workspace Add-on UI is Card-only
Unified Workspace Add-on framework renders only via CardService. No arbitrary HTML/CSS/JS. Do not adopt the legacy Editor add-on.

**Implication:** rich UX (diffs, overlay editor, custom rendering) belongs in the extension.

### 9.5 Selection access from the add-on is limited
Unified add-on does not expose selection / cursor. Either ask the user to enter a snippet manually, or defer to the extension.

### 9.6 Canvas-rendered doc body
Docs renders body to `<canvas>`. DOM-overlaying extensions need the accessibility-DOM mirror (Tools → Accessibility) or selection-event hooks.

### 9.7 `documents.batchUpdate` is sufficient for overlays

| Overlay op | Docs API primitive |
|---|---|
| redact  | `deleteContentRange` (or `replaceAllText` for a marker) |
| replace | `replaceAllText` (anchored) or `deleteContentRange` + `insertText` |
| insert  | `insertText` at index |
| append  | `insertText` at end |

Anchor → index resolution happens upstream.

### 9.8 Docx export is the canonical ingest source

Drive `files.export?mimeType=…wordprocessingml.document` returns the doc as OOXML zip. Empirically verified to surface every piece of annotation state we need, several of which the public Drive / Docs APIs do not:

| Signal | `comments.list` | `documents.get` | docx export |
|---|---|---|---|
| Plain comment + body | ✅ | n/a | ✅ |
| Exact anchor coords | ❌ (opaque `kix.*`) | n/a | ✅ via `<w:commentRangeStart/End>` at run boundaries |
| Disjoint multi-range comment | ❌ (only first span) | n/a | ✅ as N `<w:comment>` rows sharing `(w:author, w:date, body)` |
| Multi-paragraph contiguous range | ✅ (quoted spans `\n`) | n/a | ✅ range crosses paragraphs |
| Suggested insert/delete content | n/a | ✅ | ✅ via `<w:ins>` / `<w:del>` |
| Suggestion author + timestamp | n/a | ❌ (deferred to `revisions.list`) | ✅ on `<w:ins>` / `<w:del>` |
| **Suggestion-thread replies** | ❌ | ❌ | ✅ as `<w:comment>` whose range overlaps the `<w:ins>`/`<w:del>` |
| Author identity discriminator | ✅ via `me` + `photoLink` | n/a | ❌ display-name only |
| Parent-reply linkage | ✅ nested `replies[]` | n/a | ❌ flat; reconstruct by same-anchor + `w:date` |

**Implication.** Ingest is docx-driven; `comments.list` is queried alongside purely to recover `me` + `photoLink` for author disambiguation (two users with the same display name are indistinguishable in OOXML). §9.1 still holds: Margin authors unanchored comments outbound; the docx path is inbound only.

**Reply-on-suggestion detection rule.** A `<w:comment>` whose `commentRangeStart`/`End` interval overlaps a `<w:del>` or `<w:ins>` element is a reply on that suggestion's thread. No `paraIdParent` or equivalent in Google's export; linkage is purely positional.

### 9.9 Docx round-trip on Drive upload (V2 validation)

Question: if Margin uploads a `.docx` with anchored comments + tracked-change suggestions and tells Drive to convert it to a Google Doc, do the annotations survive? If yes, the "derivative Doc with materialized comments" path becomes viable for cross-org reviewers and side-steps canvas visualization for that cohort (Phase 6 V2 in §12).

**How to run.** `deno task margin v2-check` uploads a probe doc with three known anchors (start-of-paragraph, mid-paragraph, disjoint multi-range) plus one `<w:ins>` + one `<w:del>` suggestion to the operator's Drive, re-exports the converted Doc as `.docx`, and prints a structured observation report covering: (a) anchors landed at the right positions, (b) `w:author` preserved vs. rewritten, (c) `w:date` preserved vs. rewritten, (d) disjoint multi-range preserved / fragmented / lost, (e) suggestions round-trip as suggesting-mode edits.

**Findings.** Not yet recorded. Operator runs `deno task margin v2-check` against a dev Drive account; once findings land, document them here and re-scope Phase 6 visualization gating accordingly.

## 10. Privacy and security

- Drive refresh tokens encrypted at rest in `account.refresh_token` (envelope encryption: KEK → per-row DEK → ciphertext) via a Better Auth `databaseHooks.account` write hook.
- Audit log on sensitive ops (sharing, version delete, overlay apply, comment projection).
- Doc content fetched on demand; canonical store holds quoted snippets, not full bodies.
- Per-tenant data residency (EU-only deploy option).
- Refuse to operate on docs whose Workspace policy forbids 3rd-party app access.
- Add-on uses minimal scopes; backend never asks participants for broad Drive access.

## 11. Out-of-scope for v1

- Real-time merge of edits across versions (only comments + overlays reconcile).
- Image- / table-anchored comment reanchoring (orphans, manual placement).
- Deep suggesting-mode integration. v1 ingests insert/delete suggestions as `canonical_comment` rows tagged `kind=suggestion_*`, anchored on affected text. Walks all regions (body, headers, footers, footnotes). Style-only suggestions (`suggestedTextStyleChanges`) deferred to Phase 6. Suggestion **author/timestamp** and **suggestion-thread replies** ingest via the docx export path (§9.8).
- Authoring **anchored** native Google Docs comments.
- Native mobile UI / responsive web.
- Public Workspace Marketplace listing (private/domain install only at v1).

## 12. Build sequence

Shipped vs. pending tracked in the [README's Build status section](../README.md#build-status).

### Phase 1: Core engine

Headless backend + CLI. Drizzle schema on Postgres (`pg` driver, native `uuid` / `jsonb` / `timestamptz`); envelope-encrypted refresh tokens stored in `account.refresh_token`; Better Auth Google provider + per-user `TokenProvider`; Drive/Docs REST wrappers; domain primitives (`createProject`, `createVersion`); canonical comment ingest; reanchoring engine with confidence scoring; overlay applier; doc-watcher with channel renewer + polling fallback; `deno task margin <subcommand>` CLI dispatcher.

### Phase 2: Backend HTTP API + minimal web entry points

Fly.io deploy + GitHub Actions auto-deploy on `main`. `deno task serve` HTTP host: `/healthz`, `/api/auth/**` (Better Auth + tab-based OAuth bridge, §6.3), `/webhooks/drive`, `/api/picker/{page,register-doc}` (backend-hosted Drive Picker + register endpoint, §6.3). Better Auth sessions over the bearer plugin (`Authorization: Bearer <sessionToken>`). MV3 extension scaffolded (Chrome / Edge / Firefox). Auto-subscribe of Drive `files.watch` per new version + in-process renew + polling loops, gated on `MARGIN_PUBLIC_BASE_URL` (and `MARGIN_RUN_BACKGROUND_LOOPS != 0` for the loops). Ingest is fully server-side via docx export (§9.8); the extension is a pure UI surface with no content script and no `docs.google.com` host permissions beyond what's needed to read the active tab's URL + title.

### Phase 3: Extension popup as project surface

Replaces the Workspace add-on as the lightweight "I'm in a doc, what does Margin know about it?" surface (§6.4). The Workspace add-on is deferred to Phase 7 as a managed-device fallback.

Routes:

- `POST /api/extension/doc-state`: tracked-state for the open doc. Owner-scoped (cross-user reads return `tracked: false`).
- `POST /api/extension/doc-sync`: "Sync now". Re-runs `ingestVersionComments` and returns refreshed state.
- `POST /api/extension/whoami`: signed-in user's email / name / avatar; powers the Options page identity block.
- `GET /api/picker/page`: backend-hosted Drive Picker (cookie-auth, top-level navigation).
- `POST /api/picker/register-doc`: resolves caller (cookie or bearer) and calls `createProject`.
- CORS allow-list covers Chromium / Firefox extension origins + localhost on `/api/extension/*` and `/api/picker/register-doc`. Requests carrying a non-allow-listed `Origin` are rejected server-side with 403; requests with no `Origin` (curl / CI / cron) pass through, since bearer-token confidentiality is the access boundary there.

Popup state machine + OAuth/Picker mechanics live in [`extension/README.md`](../extension/README.md). The popup never holds the session token; everything routes through the SW.

### Phase 4: Extension rich UI + docx-export ingest + magic-link action handlers

The popup retains the lightweight view; the side panel hosts the rich Preact app. Side panel covers the full §7.4 review cycle end-to-end without dropping to the CLI.

- **Side-panel scaffold + project dashboard** (`POST /api/extension/project`), with "Snapshot new version" on the dashboard (`POST /api/extension/version/create`), a project-picker fallback for when the active tab isn't a tracked Doc (`POST /api/extension/projects`), and project delete + rename (`POST /api/extension/project-delete`, `POST /api/extension/project-rename`).
- **Structured side-by-side version diff** (`POST /api/extension/version-diff`): client renders against `documents.get` structural content. Two-pass: paragraph-level alignment keyed by `(hash(plaintext), namedStyleType)`, then intra-paragraph run diff preserving style boundaries. Style-only changes render distinctly.
- **Comment reconciliation list** (`POST /api/extension/version-comments`) with per-row actions (`POST /api/extension/comment-action`): `accept_projection`, `reanchor`, `mark_resolved`, `mark_wontfix`, `reopen`. Audit-logged. A `POST /api/extension/comment-action/batch` endpoint exists server-side for multi-row actions; the side-panel UI wiring for it is deferred (rows act one at a time today).
- **Docx-export ingest** (§9.8). `ingestVersionComments` exports the doc as `.docx`, parses OOXML via `src/google/docx.ts` (fflate + fast-xml-parser, `preserveOrder: true`), and writes canonical_comment / comment_projection rows. Recovers disjoint multi-range comments (collapsed by `(author, date, body)` onto `anchor.additionalRanges`), exact anchor coordinates, suggestion-thread replies, and suggestion author + timestamp. Walks body, headers, footers, and footnotes. `comments.list` retained alongside only to reconstruct plain-comment reply trees that OOXML flattens and to recover `me` + `photoLink` for author-identity disambig.
- **Per-version "Request review"** (`POST /api/extension/review/request`): mints magic-link tokens, runs Drive `permissions.create`, fans out via the email transport (Resend if `MARGIN_EMAIL_TRANSPORT=resend`, log-only otherwise). Magic links surface inline so they can be redeemed manually when no transport is wired up.
- **Magic-link `/r/<token>` handlers.** `review_action_token` table keyed by `(reviewRequestId, assigneeUserId)`. `GET /r/<token>?action=<kind>` renders an HTML confirmation and transitions the matching `review_assignment.status`; missing or unknown `action` renders a chooser page. Multi-use until `expiresAt` so reviewers can change their response. Actions: `mark_reviewed`, `decline`, `request_changes`, `accept_reconciliation`.
- **In-app notifications.** `notification` table + `POST /api/extension/notifications` (list) and `POST /api/extension/notifications/mark-read`. Writes happen alongside Slack/email fan-out so the side-panel inbox stays consistent regardless of transport.
- **Settings** (`POST /api/extension/settings`, load + patch over `project.settings`). Side-panel Settings view covers notification prefs, default reviewer emails, Slack workspace linking (free-form placeholder until Phase 5 wires the bot). Patches are diff-applied; `audit_log` records before/after JSON.
- **V2 validation tooling.** `deno task margin v2-check` (see [§9.9](#99-docx-round-trip-on-drive-upload-v2-validation)).

The overlay applier + domain helpers stay shipped (§5, `src/domain/overlay.ts`); the editor surface is stretch (§13.3).

**Delivers:** MVP. Cross-org workflows possible via one-click email actions; the extension is purely a UI surface.

### Phase 5: Slack bot

- Event subscriptions, slash commands, interactive payloads.
- Slack OAuth + workspace-linking flow.
- `notification_dispatcher` Slack channel.
- Identity link `user.email` ↔ Slack `user.profile.email`.
- Slack-side drive-scope onboarding affordance for unauthorized docs (§9.2).

**Delivers:** `/review-request`, `/review-status`, `/review-close` (§6.1); per-reviewer DMs; thread updates; home-tab dashboards.

### Phase 6: Cross-org polish + extension visualization

Visualization gated on the two empirical validation tasks below.

- Slack Connect for shared review channels across orgs.
- External-reviewer onboarding via magic-link auth + identity verification (OAuth `sub`/email vs. share list).
- Friendly errors when org policy blocks third-party app access (§10).
- Extension visualization: in-canvas highlights / gutter markers (accessibility-DOM mirror or selection-event hooks; §9.6); hover previews; right-click "comment on selection"; native-comment-rail integration. The content script returns here, but reading selection events / a11y coords, not comment data.

**Pre-work / empirical validation.** Two assumptions underlying the visualization design need a 15-30 minute manual check before code lands; both shape architecture, not detail.

- **V1: a11y-DOM mirror availability without the toggle.** Open a Google Doc in Chrome, DevTools → Elements, search for `aria-label` / `role="paragraph"` / equivalent paragraph-level nodes *before* toggling Tools → Accessibility → "Turn on screen reader support." Toggle on, re-inspect. Scroll. Confirm whether the mirror covers the full visible body or only the caret neighborhood. Outcome decides whether Phase 6 needs an onboarding nudge asking users to enable screen reader support, or whether the default tree is enough for gutter markers.
- **V2: `.docx` upload preserves anchored comments.** Run via `deno task margin v2-check` (§9.9). If anchors survive, this opens a "derivative Doc with materialized comments" path that sidesteps canvas overlay entirely for the review-only cohort (magic-link reviewers, mobile); see [§9.7](#97-documentsbatchupdate-is-sufficient-for-overlays) for the existing derivative infrastructure.

### Phase 7: Workspace add-on, marketplace listings, advanced features

- **Workspace add-on.** Unified Workspace Add-on (CardService UI; §9.4) covering the same affordances as the Phase-3 popup, for users on managed devices or in environments that block extension installs. `onFileScopeGranted` integrates per-file `drive.file` with Margin's token store (§9.2). Apps Script identity-token verification on the backend. Named-range bookkeeping in the overlay applier powers add-on "comments at this paragraph" affordances.
- Workspace Marketplace listing (OAuth verification + security assessment).
- Slack App Directory listing.
- Browser-extension store listings (Chrome Web Store, Firefox Add-ons, Edge Add-ons).
- Advanced overlay primitives: conditional ops, parameterized snippets, overlay composition.
- Style-only suggestion ingestion (`suggestedTextStyleChanges`).
- Automated comment classification ("does this look resolved by the latest edit?").

## 13. Stretch goals

Not scheduled. Listed so they inform schema/API decisions today.

### 13.1 External read API + webhooks
Scoped, versioned, read-mostly HTTPS API over canonical comments + projections + review state. Distinct from internal `/api/extension/*`. Same Better Auth session bearer token (or a dedicated Better Auth `apiKey` plugin scope, if/when we want long-lived integration tokens distinct from user sessions).

- `GET /api/v1/projects`
- `GET /api/v1/projects/:id/comments?version=&status=&since=`
- `GET /api/v1/projects/:id/versions/:vid/diff`: plaintext + comment anchors
- `POST /api/v1/projects/:id/comments/:cid/status`
- Webhooks per project: `comment.created`, `comment.replied`, `projection.resolved`, `review_request.closed`. Stable cursor for downtime backfill.

### 13.2 MCP server
Thin shell over `src/domain/*` exposing canonical state as MCP resources + tools.

- **Resources:** project summary, version diffs, comment threads (one URI per thread, paginated indexes per project).
- **Tools:** `search_comments`, `summarize_review_request`, `mark_comment_addressed`, `create_version_checkpoint`, `request_review`. Side-effects scoped to caller; same authorization model as §8.
- **Auth:** same Better Auth session bearer, exchanged on first MCP handshake.

### 13.3 Overlay editor + derivative UX
Side-panel editor for the existing overlay primitives (`redact` / `replace` / `insert` / `append`, §9.7), with live preview against the current parent rendered through the structured-diff component. The overlay applier + `applyOverlayAsDerivative` already exist in `src/domain/overlay.ts`; this is purely the UI + thin HTTP wrappers.

- Overlay-list left rail per project (CRUD over `overlay` + `overlay_operation`).
- Per-op edit form with anchor picker (paragraph + quoted text, reanchor-confidence hint).
- Preview: backend simulates the planned `batchUpdate` requests in-memory against the parent doc and returns paragraph summaries in the same shape as `version-diff`; client diffs through the existing `alignParagraphs` renderer. No Drive write per keystroke.
- "Apply as derivative" CTA wired to `applyOverlayAsDerivative`.

Phase 7's advanced overlay primitives (conditional ops, parameterized snippets, composition) sit downstream of this.

### 13.4 In-browser AI tools
Extension side-panel chat with the canonical store wired in as live context (via §13.2 MCP, or directly via the Phase-4 React app's API client).

- **Triage assist.** "Which v2 comments are addressed by the v2→v3 diff?"
- **Reply drafting.** LLM drafts a reply grounded in surrounding doc text + prior thread; user edits before posting back as a regular Drive comment.
- **Author co-review.** Flag passages likely to draw the same kinds of comments past reviewers left on this project.
- **"Explain this comment in context".** Pulls parent suggestion + surrounding paragraph + cross-version replies into a single summary.

Privacy: LLM only sees what the calling user can already see. Doc body fetched fresh per turn through Margin's `drive.file`-scoped credentials. Provider choice (Claude / OpenAI / local) in extension settings; default "ask before sending."

## 14. Operational follow-ups

Tracked operational work. The production contract — scoped `--allow-env` + `--allow-net` + `--deny-net` on `serve`/`migrate`, URLPattern hardening, `BETTER_AUTH_TELEMETRY=0`, unique-constraint-error recognition — lives in `backend/deno.jsonc` and `backend/Dockerfile`; this section covers what's still deferred.

### 14.1 Pre-launch hardening

- **Drop container root.** `USER deno` (UID 1993, shipped by `denoland/deno:alpine`) in the final Dockerfile stage. Skipped now because Fly already isolates the container on Firecracker and the Deno permission model is the primary defense; revisit when convenient.
- **Scope `--allow-read` / `--allow-write` to known paths.** Currently broad. Safe scoping needs an inventory of every directory Deno itself touches (cache dir, source maps under `$DENO_DIR`, `/tmp`). Tackle as a single audit pass; cost is mostly investigation, not implementation.
- **Tighten `--allow-net` to the Postgres host.** Today's `serve`/`migrate` allow-net is broad (with `--deny-net` blocking IMDS) because the Postgres host varies per provider; once the deployment is on a fixed host (e.g. a specific Neon endpoint), pin it.
- **Drizzle on 1.0 RC.** `drizzle-orm`/`drizzle-kit` pinned at exact `1.0.0-rc.3`; no stable 1.0 has shipped. Dropping to stable 0.45.x would mean down-migrating the 1.0 migration-directory format, so wait for `1.0.0`.
- **`--allow-env` maintenance.** Today the allow-list enumerates every env name Better Auth's core/logger/telemetry + drizzle probe at module load (~95 names total). It's stable but tied to dep versions; a Better Auth upgrade may add a probe and break boot. Mitigation: a CI step that boots `serve` under the scoped env in `ci.yml`'s `prod-resolve` job would catch new probes before deploy.

### 14.2 Postgres follow-ups

The SQLite → Postgres swap landed (`pg` driver, native `uuid`/`jsonb`/`timestamptz`, regenerated migrations, async transactions, PGlite-backed test rig via `@electric-sql/pglite-socket`). The items below are the multi-machine / production-hardening tail still pending.

- **Background-loop advisory locks.** Once two machines can both run `renewExpiringChannels` + `pollAllActiveVersions`, wrap each pass in `pg_try_advisory_lock(<channel>)` to dedupe. SQLite hid this because there was exactly one writer; today it's still hidden by `min_machines_running = 1`.
- **Move migrations to a Fly `release_command`.** Today `src/cli/serve.ts` calls `migrate(...)` at serve startup against a one-shot direct-URL pool. Acceptable for one machine; becomes a race once two machines boot at once. Move to a `release_command` in `fly.toml` and drop the in-process migrate.
- **`statement_timeout` + `idle_in_transaction_session_timeout`.** Add to the pool so a slow worker can't pin a connection. The pooled URL (PgBouncer transaction mode) ignores `SET LOCAL`; set these via the connection string or as ALTER ROLE defaults on the DB user.
- **TLS pinning.** Neon already enforces TLS on the wire; if the deployment moves to a self-hosted Postgres on Fly's 6PN, pass `ssl: 'verify-full'` to `pg.Pool` and ship the Fly CA in the image.
- **Split background loops onto a separate Fly process group.** Smaller blast radius if a route handler is hijacked; the loops' permission profile (Google + Postgres) is then distinct from the request handler's (Google + Resend + Slack + Postgres). Wire via `[processes]` in `fly.toml`.
