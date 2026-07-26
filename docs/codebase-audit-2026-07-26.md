# Codebase audit — 2026-07-26

This audit covers the backend, extension, site, CI/deployment configuration,
tests, and project documentation. It records both changes made in the security
and cleanup pass and domain-level findings intentionally deferred for a focused
follow-up.

## Scope and validation baseline

Before changes, backend typechecking and lint passed; 82 backend tests passed
and two live-Google tests skipped without credentials. The extension's 10 tests
and Chrome MV3 build passed. The site built, but its Google font provider
silently emitted no fonts when network metadata was unavailable. Format checks
reported eight backend and six extension files.

The earlier `docs/codebase-scan-2026-07-18.md` remains as the original scan
checklist; this document is the consolidated audit and disposition record.

## Security and authorization

### Addressed in this pass

- **Review capability disclosure.** Review-action URLs were returned to the
  requester and rendered in the dashboard. The response now carries only
  assignee and delivery status; bearer URLs remain internal to email delivery.
- **Extension session fixation.** OAuth result delivery was origin-checked but
  not bound to a service-worker-initiated flow. Sign-in now uses a random,
  expiring client state bound to the expected tab and required by both the
  Chromium message and Firefox fragment path.
- **OAuth nonce usability.** The backend no longer consumes its one-time OAuth
  nonce before confirming that a valid session and token exist.
- **Database ID validation.** API fields backed by Postgres UUID columns now use
  a UUID schema instead of accepting any bounded string and failing with a
  database 500.
- **Extension host access.** Optional host permissions were narrowed from
  `<all_urls>` to the production API. A separate local build adds only localhost
  origins for the E2E rig.
- **Webhook deduplication authentication.** Drive channel tokens are now
  verified before an event can reserve its deduplication key.
- **Provider error log hygiene.** Drive, Resend, and Slack response bodies no
  longer appear in ordinary exception messages or logs.
- **Supply-chain mutability.** GitHub Actions were pinned to reviewed commit
  hashes; the DevTools MCP package was pinned to an exact version; the Deno
  container base was pinned to a release and the runtime now drops root.

### Deferred security and abuse hardening

- Review creation is not idempotent across a partial share/email/database
  failure. Add a request idempotency key, transaction/outbox, bounded fan-out,
  persisted delivery state, and retries.
- Review requests allow a large recipient fan-out. Add per-recipient/account
  quotas, bounce/suppression handling, and abuse monitoring before public use.
- The in-memory rate limiter is process-local and does not enforce a hard cap
  when every entry is still active. Replace it before horizontal scaling.
- OAuth server nonces and background-loop ownership are process-local. Use a
  shared store/advisory locks before running multiple machines.
- Define retention and deletion policy for notifications, comments, quoted
  anchor context, and audit records.

## Data correctness and domain behavior — deferred

These findings require product/domain decisions and were intentionally not mixed
into the security/usability cleanup:

1. Existing Drive comments are treated as already present and their edited body,
   anchor, and author metadata never update. Current tests preserve this stale
   behavior.
2. DOCX traversal counts paragraphs inside tables while Docs API extraction
   skips table cells, so table comments and comments after tables can use
   incompatible paragraph indices.
3. Nested OOXML content controls, hyperlinks, and tracked-change containers do
   not share one recursive cursor walker with plaintext extraction, allowing
   anchor offsets to drift.
4. Suggestion idempotency includes paragraph index and offset. Edits above a
   suggestion create a fresh canonical row and can leave replies attached to a
   deleted parent.
5. Overlay application uses the original quoted-text length after fuzzy
   reanchoring and assumes plaintext offsets equal Docs structural indices.
   Destructive fuzzy writes can affect the wrong range.
6. Drive `resolved`, reply `action`, and modified-content fields are fetched but
   do not update canonical status/body.
7. Deleting a project removes local watch rows without stopping the active Drive
   channels; push events continue until channel expiry.
8. Email identity lookup is case-sensitive while reviewer creation lowercases
   addresses. Normalize auth and review emails and enforce uniqueness on the
   normalized value, including concurrent get-or-create handling.
9. Review request `closed`/`cancelled`, version `archived`, comment
   `superseded`, and several stored settings have no effective lifecycle.
10. `accept_reconciliation` is not scoped to a comment/projection and records no
    reconciliation change. Remove it until a target-bearing flow exists.
11. Project identity allows racing duplicate owner/parent rows based on an
    unimplemented future parent-swap feature. Implement the swap or restore a
    database uniqueness constraint.
12. Project and initial `main` version creation are not atomic after Drive
    validation and can leave a partial project if version insertion fails.
13. Review deadlines accept arbitrary integers; validate representable dates,
    reasonable horizons, and whether past deadlines are allowed.
14. Audit coverage is narrower than previously claimed and project deletion's
    code comment incorrectly said audit rows cascade.

## Extension usability and organization

### Addressed in this pass

- Sign-in now runs through the service worker, uses the persisted backend URL,
  and reports genuine sign-out failures instead of returning `ok: true` with an
  error.
- Detached side-panel windows receive the originating document ID.
- Panel lifecycle ports reconnect after worker suspension and share one port
  name constant with the service worker.
- Dashboard refreshes update the parent navigation state, preventing a close
  from restoring stale project details.
- Version sync and notification mutation errors use the checked message helper;
  polling preserves already-loaded notification content.
- Popup health checks now run through the service worker, preserving the rule
  that extension UI does not call backend APIs directly.

### Still recommended

- Split the large service worker into auth bridge, toolbar/sidebar routing, and
  backend-message dispatch modules. Split Dashboard and App by state/navigation
  responsibility.
- Move wire DTOs and shared validation to a cross-surface API module instead of
  manually mirroring backend shapes in the extension.
- Add tests for OAuth state acceptance, service-worker cold starts, toolbar
  toggling, detached-window context, navigation races, and error responses.
- Filter side-panel tab events against the host window as well as active-tab
  state if multi-window behavior still causes context jumps.
- Replace settings controls that only round-trip data with implemented behavior
  or remove them until their roadmap phase.

## Site and deployment

### Addressed in this pass

- Site fonts are bundled from Fontsource instead of fetched from Google during
  the build. An Astro check task was added.
- Shared asset changes now trigger the Pages workflow, and Pages write/OIDC
  permissions are scoped to the deploy job.
- Privacy copy now describes hosting/Postgres and optional Resend/Slack calls;
  the hosted service is no longer described as local-first.
- Stable backend CSS no longer receives a year-long immutable cache policy.
- Workflow actions, DevTools MCP, and the container runtime were pinned; the
  production process runs as the Deno user.
- Firefox builds declare their required data categories through the built-in
  consent manifest and require a browser version that supports that prompt.

Per the implementation request, site copy that advertises not-yet-shipped store
listings or product behavior was deliberately left unchanged.

### Still recommended

- Add automated link and accessibility checks after `astro check`.
- Add an Open Graph image or use a non-image Twitter card.
- Verify the non-root image in Fly's remote builder and keep the Deno image
  release pin updated deliberately.

## Redundancy and documentation cleanup

### Addressed in this pass

- Test-only PGlite and `@types/pg` dependencies moved to dev dependencies.
- The dead, never-imported coverage bootstrap and test-only `replaceAllText`
  production helper were removed.
- The local integration task now runs all `*.integration.test.ts` files.
- Unused workflow variables and the unused extension UI settings wrapper were
  removed; stale Bun/npm comments were corrected.
- Review-specific rate-limit responses now expose the same remaining-budget
  header as the shared limiter, and the root `CLAUDE.md` pointer is trackable.
- CI now enforces backend/extension formatting and linting, builds both browser
  targets, and checks the Astro site before deployment.
- The specification was reduced to durable behavior and Google constraints.
  Pending product work moved to `roadmap.md`; operational follow-ups moved to
  deployment documentation.
- README, contributor, extension, testing, setup, and E2E references were
  updated to match the current structure and sign-in flow.

### Follow-up cleanup candidates

- Decide whether unused schema states and settings should be implemented or
  removed through migrations rather than left as inert product vocabulary.
- Keep generated wire types or a shared API package as the single source of
  truth before the extension/backend contract grows further.

## Validation after changes

- Backend: full suite passed with 82 suites / 585 steps; two live-Google cases
  skipped without credentials. The final security follow-up suite passed six
  suites / 79 steps. Typecheck, lint, and format checks pass.
- Extension: 10 unit tests pass; lint and format checks pass; Chrome, Firefox,
  and localhost development builds complete. Production manifests exclude
  localhost, and the Firefox manifest emits no data-consent warning.
- Site: Astro check reports zero errors, warnings, or hints; the static build
  produces all three pages; formatting passes.
