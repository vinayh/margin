# Margin product specification

This document defines Margin's durable product behavior and the Google-side
constraints that shape it. Repository conventions live in
[`AGENTS.md`](../AGENTS.md), shipped and pending work lives in
[`roadmap.md`](./roadmap.md), and operational procedures live in
[`deployment.md`](./deployment.md) and [`testing.md`](./testing.md).

## 1. Objective

Margin helps research teams review Google Docs across drafts, audiences, and
organizations without treating rich text as a Git branch. It addresses:

- freezing a document for review while its live parent continues changing;
- carrying comments and suggestions across versions without losing context;
- generating audience-specific derivatives from reusable edit overlays; and
- coordinating multi-reviewer cycles with a durable record of responses.

Margin does not merge concurrent rich-text edits. Its semantics are snapshots,
overlays, canonical comments, projections, and lightweight review requests.

## 2. Core concepts

- **Project.** A long-lived workspace owned by one Margin user and tied to one
  canonical Google Doc.
- **Version.** A Google Doc plus a database record representing the live `main`
  document or a frozen snapshot.
- **Overlay.** An ordered set of content-addressed redact, replace, insert, or
  append operations used to generate a derivative document.
- **Canonical comment.** Margin's representation of a comment, reply, or
  suggestion, including origin metadata and a text/context anchor.
- **Projection.** The location and confidence with which a canonical comment
  maps onto a particular version.
- **Review request.** A version, reviewer assignments, optional deadline, and
  response state. External reviewers act through scoped email links.

## 3. Architecture and state ownership

The backend is the source of truth. Google Docs, the browser extension, email,
and future surfaces are views or transports; none independently defines whether
a project, version, comment, or review exists.

The current user-facing surfaces are:

- a browser-extension popup for tracked-document state and onboarding;
- an extension side panel for projects, versions, diffs, comments, reviews,
  notifications, and settings;
- backend-hosted Google Picker and OAuth bridge pages; and
- backend-hosted review-action confirmation pages.

Backend HTTP and CLI modules are adapters over domain functions. Google REST
modules remain endpoint-shaped and contain no Margin business policy.

## 4. Product behavior

### 4.1 Document registration and versions

Users authorize documents explicitly through Drive Picker. Registering a
document creates a project and a `main` version pointing at the selected file.
Snapshots are Drive copies linked to their parent version. Margin may subscribe
to Drive push notifications and also polls active versions as a fallback.

### 4.2 Comment and suggestion ingest

The canonical ingest source is the Google-issued `.docx` export. Margin parses
OOXML comment ranges, replies, insertions, and deletions, and combines that data
with `comments.list` identity metadata. Canonical records retain quoted context
and structural information rather than complete document bodies.

Reanchoring returns an exact, fuzzy, or orphaned projection with a confidence
score. Ambiguous projections require explicit user action.

### 4.3 Review requests

Creating a review request shares the selected version with each reviewer and
sends action links through the configured email transport. A review-action URL
is a bearer capability scoped to one assignment. It is never returned to the
requester or exposed in extension UI.

`GET /r/<token>?action=<kind>` displays a chooser or confirmation page. State
changes happen only after the corresponding POST confirmation. Valid links may
record a later response until they expire.

### 4.4 Extension trust boundary

Popup and side-panel requests go through the extension service worker. The
service worker alone reads the Better Auth session token and adds the bearer
header to backend calls.

Extension sign-in is initiated by the service worker. The OAuth result is
accepted only from the configured backend origin when it carries the unexpired,
single-use client state associated with the expected sign-in tab.

The manifest has no content script. Static `docs.google.com` host access is used
only so the extension can read the active tab URL and title. Optional backend
access is limited to the production API and explicit localhost development
origins.

## 5. Authentication and authorization

- Better Auth's Google provider establishes user identity and stores sessions.
- The extension sends the raw Better Auth session token as an Authorization
  bearer through the service worker.
- Project and version API operations are owner-scoped. Missing and unauthorized
  resources intentionally share the same not-found behavior where practical.
- Google operations use the project owner's `drive.file` credentials.
- Review-action tokens authorize only the linked review assignment; they are not
  general Margin sessions.

Organization tenants, collaborator roles, SAML/OIDC, and Slack identity linking
are not part of the current authorization model.

## 6. Privacy and security

- Google refresh tokens are envelope-encrypted before storage.
- The OAuth scope is `drive.file`; Margin cannot enumerate a user's wider Drive.
- Document content is fetched on demand. The database stores metadata, hashes,
  comments, suggestions, and quoted anchor context rather than full document
  bodies.
- The hosted backend necessarily uses its hosting and Postgres providers and
  Google APIs. Resend and Slack are additional transports only when configured.
- Token-bearing pages are non-cacheable and protected by a restrictive CSP.
- Audit coverage is implementation-specific; the presence of `audit_log` does
  not imply that every mutation is currently recorded.

Retention periods, account deletion, regional residency, enterprise policy
enforcement, and multi-tenant isolation require explicit implementation before
they can be offered as product guarantees.

## 7. Current limits

- No real-time or automatic rich-text merge across versions.
- No public API, MCP server, Slack bot, Workspace add-on, or mobile UI.
- No in-document content script, canvas highlights, or selection capture.
- No stable automatic reanchoring guarantee for image- or table-only anchors.
- No authoring of highlighted native Google Docs comments through public APIs.
- Overlay editing and advanced overlay composition do not yet have end-user UI.

Pending product work is tracked in [`roadmap.md`](./roadmap.md).

## 8. Google Workspace API constraints

### 8.1 Anchored comments cannot be authored through the public API

Drive `comments.create` accepts an `anchor`, but Docs editor files do not
support creating normal highlighted comments through that API. Apps Script's
`DocumentApp` also has no comment-creation method, and the editor's `kix.*`
anchor data is not a stable contract.

Margin therefore owns anchoring. It can read comments authored in the Docs UI,
but any future outbound native comment must be unanchored and include quoted
context in its body.

### 8.2 `drive.file` is per-file

Access is granted only to files Margin created or the user explicitly selected
through Picker or a Workspace add-on file-scope flow. Typing or receiving a Doc
URL does not authorize it. Every entry surface must provide an explicit
first-use authorization affordance.

### 8.3 Drive push notifications are hints

Drive watch channels require an HTTPS callback, expire, can be dropped, and
carry no document body. Margin must re-fetch after an event, renew channels, and
retain polling as a fallback.

### 8.4 Workspace add-ons are card-only

Unified Workspace add-ons render CardService UI and do not provide arbitrary
HTML, JavaScript, or reliable selection/cursor access. Rich diff and overlay UX
belongs in the browser extension.

### 8.5 Google Docs renders its body to canvas

In-document highlights or gutter markers would require accessibility-DOM or
selection-event hooks and a content script. They cannot be implemented by
ordinary DOM wrapping of document paragraphs.

### 8.6 `documents.batchUpdate` supports overlay primitives

Redaction and replacement use `deleteContentRange` plus optional `insertText`;
insertion and append use `insertText`. Margin must resolve anchors to valid Docs
structural indices before sending any write.

### 8.7 DOCX export is the canonical annotation source

The exported OOXML contains exact comment-range boundaries, disjoint ranges,
suggestion insert/delete markup, and suggestion-thread replies that the public
Drive and Docs APIs do not expose consistently. `comments.list` remains useful
for stable comment IDs, reply relationships, and author identity metadata.

The parser must traverse body, header, footer, footnote, table, hyperlink, and
content-control structures consistently so its paragraph and offset coordinate
system matches the Docs API representation used for projection.
