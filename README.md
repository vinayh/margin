# Margin

[![codecov](https://codecov.io/gh/vinayh/margin/graph/badge.svg?token=V4MG527SMV)](https://codecov.io/gh/vinayh/margin)

Structured review of Google Docs across drafts, audiences, and orgs. Snapshot a doc as a versioned project, capture every comment and suggestion against a version, project comments across versions, and generate audience-specific copies with reusable edit recipes. Surfaces today: browser extension (popup + side panel). Slack bot and Workspace Add-on are planned.

## Build status

- [x] [Phase 1: Core engine](./docs/spec.md#phase-1-core-engine) — backend primitives + CLI
- [x] [Phase 2: Backend HTTP API + minimal web entry points](./docs/spec.md#phase-2-backend-http-api--minimal-web-entry-points) — `deno task serve`, Better Auth, watcher loops
- [x] [Phase 3: Extension popup as project surface](./docs/spec.md#phase-3-extension-popup-as-project-surface) — tracked-state lookup + Drive Picker
- [x] [Phase 4: Extension rich UI + docx-export ingest + magic-link action handlers](./docs/spec.md#phase-4-extension-rich-ui--docx-export-ingest--magic-link-action-handlers) — MVP
- [ ] [Phase 5: Slack bot](./docs/spec.md#phase-5-slack-bot)
- [ ] [Phase 6: Cross-org polish + extension visualization](./docs/spec.md#phase-6-cross-org-polish--extension-visualization) — gated on V1/V2 validation
- [ ] [Phase 7: Workspace add-on, marketplace listings, advanced features](./docs/spec.md#phase-7-workspace-add-on-marketplace-listings-advanced-features)

See [`docs/spec.md` §12](./docs/spec.md#12-build-sequence) for per-phase details.

## Example workflows

- **Author shares a draft with execs while iterating.** Freeze a snapshot, send it for review, keep editing the live doc; when execs comment on the snapshot, their feedback lands in the right spot on the latest version.
- **Researcher publishes a redacted version to an external partner.** Define a "redact sensitive bits" recipe once, generate a clean copy to share, and have any comments the partner leaves flow back to the original.
- **Coordinating a multi-reviewer cycle across orgs.** Kick off a review in Slack with a deadline and reviewer list; everyone gets pinged in their own thread (or an email link if they're outside your Slack), and status rolls up in one place.
- **Reconciling comments after a major rewrite.** When the doc shifts a lot, Margin flags the comments it isn't sure where to put anymore so you can place them by hand instead of losing them.
- **Audience-specific drafts maintained over time.** Keep an "investor version" and a "board version" of the same doc; when the original changes, regenerate both without redoing your edits.
- **Closing the loop on a review.** Mark a review done and all the feedback collected during it gets folded back into the master doc, with the review archived.
- **Onboarding a new doc.** Open a doc Margin hasn't seen, click "Add to Margin," grant access to just that file, and you're set up to track it.

## What works, and what doesn't

For the underlying Google-side constraints that drive these limits, see [`docs/spec.md` §9](./docs/spec.md#9-google-workspace-api-constraints).

**Works today:**

- **Version snapshots.** Freeze a doc at any point and keep the snapshot alongside the live version, fingerprinted so identical content is recognized.
- **Comment + suggestion capture with exact location.** Plain comments, multi-paragraph ranges, disjoint multi-range comments, suggestion inserts and deletes (with author and timestamp), and replies on suggestion threads are all captured with their original anchors preserved.
- **Reply trees and author identity.** Threaded replies stay nested; authors are disambiguated even when display names collide.
- **Cross-version comment projection.** A comment made on v1 follows the same text into v3, with a confidence score. Ambiguous matches surface for review rather than getting silently dropped.
- **Audience-specific derivatives.** Reusable edit recipes (redact, replace, insert, append) apply on top of a version to produce a derivative copy.
- **Push-driven change notifications.** Margin gets notified when a tracked doc changes, with a polling fallback so nothing is missed.
- **Side-by-side version diff.** Structural diff between any two versions in the extension side panel.
- **Per-file authorization.** Track docs you create through Margin, open through the Workspace Add-on (planned), or pick via the Drive Picker.

**Doesn't work (Google-side limits, not bugs):**

- **Posting anchored comments back to Docs.** Google's API doesn't let third parties create highlighted/anchored comments on Docs editor files, so Margin's outbound comments prefix the quoted snippet inline instead. Reading anchored comments authored in the UI works fully.
- **Tracking a doc by URL alone.** Google requires per-file authorization through the Picker or the Workspace Add-on; you can't paste a URL and have Margin pick it up.
- **In-canvas highlight overlays.** Google Docs renders the body in a canvas element, so on-page highlights and gutter markers need accessibility-DOM hooks (planned for a later phase). The current extension is popup + options + side panel only.
- **Selection / cursor data from inside a Workspace Add-on.** Not exposed by Google; rich UX (diff viewer, overlay editor) lives in the browser extension instead.
- **Merging rich-text edits across versions.** Margin reconciles comments and overlay ops, not the prose itself. Image- and table-anchored comments fall back to manual placement when the surrounding text changes too much.

## Stack

Deno runtime with scoped per-task permissions, Postgres via `pg` + Drizzle (native `uuid` / `jsonb` / `timestamptz`; tests run against an in-process PGlite socket server so there's no external dependency), `Deno.serve` over a URLPattern-based dispatcher for HTTP, Better Auth (Google provider + bearer plugin), WebCrypto AES-GCM envelope encryption for refresh tokens, `deno test` (JSR `@std/testing/bdd` + `@std/expect`). Backend lives in `backend/`; the public site (Astro) is in `site/` and the browser extension (WXT, MV3) in `extension/`. Cross-surface design tokens and Google-Doc-id helpers in `shared/`.

## Contributing

See [`docs/CONTRIBUTING.md`](./docs/CONTRIBUTING.md) to get a local dev environment running. Project conventions, repo layout, and the schema-migration workflow live in [`AGENTS.md`](./AGENTS.md). Long-form design, per-phase build plan, and Google-side constraints live in [`docs/spec.md`](./docs/spec.md).
