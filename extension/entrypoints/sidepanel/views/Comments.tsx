import { useEffect, useState } from "preact/hooks";
import { requestOrThrow } from "../../../ui/sendMessage.ts";
import { formatDateTime } from "../../../ui/format-time.ts";
import type {
  CanonicalCommentKind,
  CanonicalCommentStatus,
  CommentActionKind,
  CommentActionResult,
  ProjectionStatus,
  VersionCommentEntry,
  VersionCommentsPayload,
} from "../../../utils/types.ts";

interface Props {
  versionId: string;
  versionLabel: string;
  onClose: () => void;
}

type State =
  | { kind: "loading" }
  | { kind: "loaded"; payload: VersionCommentsPayload }
  | { kind: "error"; message: string };

/**
 * Side-panel "comments on this version" reconciliation view
 * slice). One row per `comment_projection`, sorted by projection status with
 * `orphaned` / `fuzzy` at top so the reconciliation work surfaces first.
 *
 * Each row exposes the same action set the backend's
 * `/api/extension/comment-action` accepts: `accept_projection` and `reanchor`
 * mutate the projection row; `mark_resolved` / `mark_wontfix` / `reopen`
 * mutate `canonical_comment.status`. The view applies action results in
 * place — no full refetch — so a click stays responsive even on a chunky
 * list.
 */
export function Comments({ versionId, versionLabel, onClose }: Props) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const r = await requestOrThrow({ kind: "version/comments", versionId });
        if (cancelled) return;
        if (!r.payload) {
          setState({ kind: "error", message: "comments unavailable" });
          return;
        }
        setState({ kind: "loaded", payload: r.payload });
      } catch (err) {
        if (cancelled) return;
        setState({
          kind: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [versionId]);

  async function runAction(
    entry: VersionCommentEntry,
    action: CommentActionKind,
  ): Promise<void> {
    setActionError(null);
    setPendingId(entry.canonicalCommentId);
    try {
      const r = await requestOrThrow({
        kind: "comment/action",
        canonicalCommentId: entry.canonicalCommentId,
        action,
        targetVersionId: versionId,
      });
      if (!r.result) throw new Error("no result returned");
      applyResult(setState, r.result);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setPendingId(null);
    }
  }

  if (state.kind === "loading") {
    return (
      <section class="comments-view">
        <CommentsHeader
          title={`Comments on ${versionLabel}`}
          onClose={onClose}
        />
        <ul class="comment-list">
          <SkeletonCommentCard />
          <SkeletonCommentCard />
          <SkeletonCommentCard />
        </ul>
      </section>
    );
  }
  if (state.kind === "error") {
    return (
      <section class="comments-view">
        <CommentsHeader title="Comments" onClose={onClose} />
        <p class="muted error">{state.message}</p>
      </section>
    );
  }

  const ordered = sortForReconciliation(state.payload.comments);
  const summary = summarize(ordered);
  const filtered = filterComments(ordered, filter);

  return (
    <section class="comments-view">
      <CommentsHeader
        title={`Comments on ${state.payload.versionLabel}`}
        onClose={onClose}
      />
      <p class="muted">
        {ordered.length} {ordered.length === 1 ? "comment" : "comments"}
        {summary.fuzzy + summary.orphaned > 0
          ? ` · ${summary.orphaned} orphaned, ${summary.fuzzy} fuzzy`
          : ""}
      </p>
      {actionError ? <p class="muted error">{actionError}</p> : null}
      {ordered.length > 0
        ? (
          <input
            type="search"
            class="filter-input"
            placeholder="Filter comments by body, author, or quoted text…"
            value={filter}
            onInput={(e) => setFilter((e.target as HTMLInputElement).value)}
          />
        )
        : null}
      {ordered.length === 0
        ? (
          <div class="empty-state">
            <p class="empty-state-title">No comments on this version yet.</p>
            <p class="empty-state-body">
              Sync this version to ingest comments and suggestions from the
              Google Doc, or project comments from an earlier version.
            </p>
          </div>
        )
        : filtered.length === 0
        ? <p class="muted">No comments match.</p>
        : (
          <ul class="comment-list">
            {filtered.map((c) => (
              <CommentCard
                key={c.canonicalCommentId}
                entry={c}
                targetVersionLabel={state.payload.versionLabel}
                pending={pendingId === c.canonicalCommentId}
                onAction={(action) => runAction(c, action)}
              />
            ))}
          </ul>
        )}
    </section>
  );
}

function filterComments(
  entries: VersionCommentEntry[],
  q: string,
): VersionCommentEntry[] {
  const trimmed = q.trim().toLowerCase();
  if (trimmed === "") return entries;
  return entries.filter((c) => {
    if (c.body.toLowerCase().includes(trimmed)) return true;
    if (c.anchor.quotedText?.toLowerCase().includes(trimmed)) return true;
    if (c.originUserDisplayName?.toLowerCase().includes(trimmed)) return true;
    if (c.originUserEmail?.toLowerCase().includes(trimmed)) return true;
    return false;
  });
}

function SkeletonCommentCard() {
  return (
    <li class="comment-card">
      <div class="comment-card-head">
        <span class="skeleton skeleton-pill" />
        <span class="skeleton skeleton-pill" />
      </div>
      <p class="comment-meta">
        <span class="skeleton skeleton-line skeleton-line-short" />
      </p>
      <p class="comment-body">
        <span class="skeleton skeleton-line" />
        <span class="skeleton skeleton-line" />
      </p>
    </li>
  );
}

function CommentsHeader({
  title,
  onClose,
}: {
  title: string;
  onClose: () => void;
}) {
  return (
    <div class="comments-header">
      <p class="title">{title}</p>
      <button type="button" onClick={onClose}>
        Close
      </button>
    </div>
  );
}

function CommentCard({
  entry,
  targetVersionLabel,
  pending,
  onAction,
}: {
  entry: VersionCommentEntry;
  targetVersionLabel: string;
  pending: boolean;
  onAction: (action: CommentActionKind) => void;
}) {
  const isOriginVersion = entry.originVersionLabel === targetVersionLabel;
  const author = entry.originUserDisplayName ??
    entry.originUserEmail ??
    "Unknown author";
  return (
    <li class={`comment-card comment-${entry.projection.status}`}>
      <div class="comment-card-head">
        <StatusBadge status={entry.projection.status} />
        <CommentStatusBadge status={entry.status} />
        <KindTag kind={entry.kind} />
        {entry.parentCanonicalCommentId
          ? <span class="comment-tag">reply</span>
          : null}
        {isOriginVersion
          ? null
          : (
            <span class="comment-tag" title="Projected from an earlier version">
              from {entry.originVersionLabel}
            </span>
          )}
      </div>
      <p class="comment-meta">
        <span>{author}</span>
        <span class="muted">· {formatDateTime(entry.originTimestamp)}</span>
        {entry.projection.anchorMatchConfidence !== null
          ? (
            <span class="muted">
              {" "}
              · match {entry.projection.anchorMatchConfidence}%
            </span>
          )
          : null}
      </p>
      {entry.anchor.quotedText
        ? (
          <blockquote class="comment-quote">
            {entry.anchor.quotedText}
          </blockquote>
        )
        : null}
      <p class="comment-body">{entry.body}</p>
      <CommentActions
        entry={entry}
        pending={pending}
        onAction={onAction}
      />
    </li>
  );
}

function CommentActions({
  entry,
  pending,
  onAction,
}: {
  entry: VersionCommentEntry;
  pending: boolean;
  onAction: (action: CommentActionKind) => void;
}) {
  const isOpen = entry.status === "open";
  const needsAnchorWork = entry.projection.status === "fuzzy" ||
    entry.projection.status === "orphaned";
  return (
    <div class="comment-actions">
      {needsAnchorWork
        ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => onAction("accept_projection")}
          >
            Accept anchor
          </button>
        )
        : null}
      <button
        type="button"
        disabled={pending}
        onClick={() => onAction("reanchor")}
      >
        Re-anchor
      </button>
      {isOpen
        ? (
          <>
            <button
              type="button"
              disabled={pending}
              onClick={() => onAction("mark_resolved")}
            >
              Resolve
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => onAction("mark_wontfix")}
            >
              Won't fix
            </button>
          </>
        )
        : (
          <button
            type="button"
            disabled={pending}
            onClick={() => onAction("reopen")}
          >
            Reopen
          </button>
        )}
    </div>
  );
}

function StatusBadge({ status }: { status: ProjectionStatus }) {
  return (
    <span class={`status-badge status-${status}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}

function CommentStatusBadge({ status }: { status: CanonicalCommentStatus }) {
  if (status === "open") return null;
  return (
    <span class={`status-badge status-comment-${status}`}>
      {COMMENT_STATUS_LABEL[status]}
    </span>
  );
}

function KindTag({ kind }: { kind: CanonicalCommentKind }) {
  if (kind === "comment") return null;
  const label = kind === "suggestion_insert"
    ? "suggested insert"
    : "suggested delete";
  return <span class="comment-tag">{label}</span>;
}

const STATUS_LABEL: Record<ProjectionStatus, string> = {
  clean: "Clean",
  fuzzy: "Fuzzy",
  orphaned: "Orphaned",
  manually_resolved: "Resolved",
};

const COMMENT_STATUS_LABEL: Record<CanonicalCommentStatus, string> = {
  open: "Open",
  addressed: "Addressed",
  wontfix: "Won't fix",
  superseded: "Superseded",
};

const STATUS_PRIORITY: Record<ProjectionStatus, number> = {
  orphaned: 0,
  fuzzy: 1,
  clean: 2,
  manually_resolved: 3,
};

/**
 * Surface the actionable rows first: orphaned > fuzzy > clean > resolved.
 * Within a status bucket the API's `desc(originTimestamp)` order is preserved
 * (newer comments above older).
 */
function sortForReconciliation(
  entries: VersionCommentEntry[],
): VersionCommentEntry[] {
  return [...entries].sort((a, b) => {
    const pa = STATUS_PRIORITY[a.projection.status];
    const pb = STATUS_PRIORITY[b.projection.status];
    if (pa !== pb) return pa - pb;
    return b.originTimestamp - a.originTimestamp;
  });
}

function summarize(
  entries: VersionCommentEntry[],
): Record<ProjectionStatus, number> {
  const out: Record<ProjectionStatus, number> = {
    clean: 0,
    fuzzy: 0,
    orphaned: 0,
    manually_resolved: 0,
  };
  for (const e of entries) out[e.projection.status]++;
  return out;
}

function applyResult(
  setState: (updater: (prev: State) => State) => void,
  result: CommentActionResult,
): void {
  setState((prev) => {
    if (prev.kind !== "loaded") return prev;
    const comments = prev.payload.comments.map((c) => {
      if (c.canonicalCommentId !== result.canonicalCommentId) return c;
      return {
        ...c,
        status: result.status,
        projection: result.projection
          ? {
            ...c.projection,
            status: result.projection.status,
            anchorMatchConfidence: result.projection.anchorMatchConfidence,
            lastSyncedAt: Date.now(),
          }
          : c.projection,
      };
    });
    return { kind: "loaded", payload: { ...prev.payload, comments } };
  });
}
