/**
 * Shared doc-id helpers. Used by both the backend (`backend/src/`) and the
 * extension (`extension/`). The extension bundle can't import backend
 * sources directly, so keeping these helpers here gives both surfaces a
 * single source of truth instead of the prior hand-mirrored copies.
 *
 * Real Google Doc ids are base64url-ish: `[A-Za-z0-9_-]`, typically 44
 * chars. We require at least 20 — same lower bound for both the
 * embedded-in-URL form and the bare-id form so the parser accepts an id
 * iff it would also accept the same id pasted directly.
 */
const URL_PATTERN = /\/document\/d\/([A-Za-z0-9_-]{20,})/;
const ID_PATTERN = /^[A-Za-z0-9_-]{20,}$/;

/**
 * Throwing parser. Accepts either a full Docs URL or a bare doc id;
 * raises on either malformed shape. Used by the backend CLI + domain
 * where "missing" is not a normal branch.
 */
export function parseGoogleDocId(input: string): string {
  const trimmed = input.trim();
  const m = trimmed.match(URL_PATTERN);
  if (m && m[1]) return m[1];
  if (ID_PATTERN.test(trimmed)) return trimmed;
  throw new Error(`unrecognized Google Doc URL or id: ${input}`);
}

/**
 * URL-only nullable parser. Returns the embedded doc id or null when the
 * URL doesn't reference a Google Doc. Used by the extension where a tab
 * that isn't on docs.google.com is a normal branch.
 */
export function parseDocIdFromUrl(href: string): string | null {
  const m = URL_PATTERN.exec(href);
  return m ? m[1]! : null;
}

export function googleDocUrl(docId: string): string {
  return `https://docs.google.com/document/d/${encodeURIComponent(docId)}/edit`;
}

// TEMPORARY fallback used only when the backend can't supply the canonical
// title — i.e. untracked docs (no `drive.file` grant yet, pre-Picker), and
// legacy tracked rows that pre-date `project.name` / `version.name`. For
// every other case, `DocState.title` from `/api/extension/doc-state` (sourced
// from Drive `files.get`) is the source of truth.
//
// Heuristic: Docs formats `document.title` as `<DocName> - <Localized Google
// Docs>`. The brand "Google" is never translated; only the surrounding
// product noun is ("Docs" / "Documentos" / "ドキュメント" / "文档" /
// "Документы" / …). So we strip the last ` - <suffix>` only when <suffix>
// contains the literal word "Google" — locale-agnostic, and safe against
// user titles like "Foo - Bar" that happen to contain a dash but no Docs
// suffix. Still best-effort; a user title that itself ends with "… - Google
// Something" would mis-strip.
const DOCS_SUFFIX = /\s-\s[^-]*\bGoogle\b[^-]*$/i;

export function cleanDocTitleFallback(
  rawTitle: string | undefined | null,
): string {
  if (!rawTitle) return "";
  const trimmed = rawTitle.trim();
  const stripped = trimmed.replace(DOCS_SUFFIX, "").trim();
  return stripped || trimmed;
}
