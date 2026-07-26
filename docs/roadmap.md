# Margin roadmap

Shipped behavior is summarized in the
[README build status](../README.md#build-status). This document holds pending
product work that should not be represented as a current product guarantee in
the specification.

## Shipped foundation

- Backend domain engine, Postgres schema, CLI, OAuth credentials, Google REST
  wrappers, comment ingest/reanchoring, overlays, watches, and polling.
- HTTP API, backend-hosted OAuth bridge and Picker, Fly deployment, and CI.
- Chrome/Edge/Firefox extension popup and side panel.
- Project dashboards, snapshots, structural diffs, reconciliation actions,
  review requests, email actions, notifications, and project settings storage.

## Next: review lifecycle and correctness

- Close, cancel, and auto-close review requests; enforce request state during
  token redemption.
- Add idempotent review creation, bounded delivery fan-out, persisted delivery
  status, resend controls, and an outbox/retry path.
- Reconcile edited and moved upstream comments/suggestions without losing
  canonical identity or reply parents.
- Unify OOXML and Docs API traversal for tables and nested containers.
- Make overlay writes consume exact matched structural ranges.
- Finish settings behavior or remove controls that do not affect runtime policy.

## Slack coordination

- Slack OAuth and workspace linking.
- Slash commands for requesting, viewing, and closing reviews.
- Assignment DMs, review-thread status updates, and a home dashboard.
- Slack Connect behavior and per-file Drive authorization guidance.

## Extension visualization

- Validate accessibility-DOM availability and coverage in Google Docs.
- If viable, add a narrowly scoped content script for selection events,
  highlights, gutter markers, and comment context—not for ingest.
- Record the existing `v2-check` DOCX conversion experiment before choosing a
  materialized-comment derivative path.

## Workspace add-on and listings

- Unified CardService add-on for managed environments where extensions are
  unavailable.
- OAuth verification and browser/Workspace marketplace listings.
- Apps Script identity-token verification and file-scope onboarding.

## Later product work

- Overlay editor, preview, CRUD, and advanced overlay composition.
- Public versioned API and project webhooks.
- MCP resources/tools over the same domain authorization model.
- Optional AI-assisted triage and drafting with explicit data-send consent.
- Style-only suggestion ingestion, automated comment classification, and
  account-level retention/deletion controls.
