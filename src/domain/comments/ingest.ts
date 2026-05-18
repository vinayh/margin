import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { db } from "../../db/client.ts";
import {
  canonicalComment,
  commentProjection,
  version,
  type AnchorRange,
  type CommentAnchor,
} from "../../db/schema.ts";
import { listComments, exportDocx } from "../../google/drive.ts";
import {
  parseDocx,
  type DocxComment,
  type DocxRange,
} from "../../google/docx.ts";
import { tokenProviderForProject } from "../project.ts";
import { requireVersion } from "../version.ts";
import { buildAnchor } from "./anchor-build.ts";
import {
  buildAuthorIndex,
  buildDriveIndex,
  driveLookupKey,
  resolveIdentity,
  type AuthorIndex,
  type DriveEntry,
  type DriveIndex,
} from "./drive-index.ts";
import { ingestSuggestions } from "./suggestions.ts";
import { upsertCanonical } from "./upsert.ts";
import { hashShort, type IngestResult } from "./types.ts";

// In-flight ingests per versionId. The webhook can fire concurrently with the
// poller (and other webhook deliveries) for the same version. Two concurrent
// ingests that fetched Drive at slightly different moments will populate their
// own `seenExternalIds` sets from different snapshots, and the later
// `reapDeletedCanonicals` pass can mark live comments deleted (the newer
// ingest sees a comment the older one's fetch missed). Self-healing on the
// next run, but transient deletions are still wrong. Coalesce here so any
// number of concurrent triggers share one ingest.
const inFlight = new Map<string, Promise<IngestResult>>();

/**
 * Pull every annotation from a version's doc and normalize into canonical_comment +
 * comment_projection. Idempotent: existing projections short-circuit via google_comment_id.
 *
 * Source of truth is the .docx export (SPEC §9.8) — it has exact anchors, disjoint multi-range
 * comments, and suggestion author+timestamp that comments.list / documents.get don't expose.
 * comments.list runs in parallel only to (a) recover the author email for `me === true` (OOXML
 * drops it) and (b) reconstruct reply chains (OOXML flattens replies).
 */
export function ingestVersionComments(versionId: string): Promise<IngestResult> {
  const existing = inFlight.get(versionId);
  if (existing) return existing;
  const p = runIngest(versionId).finally(() => {
    // Only clear if we're still the registered run — a paranoid guard in case
    // the same versionId got re-keyed mid-flight.
    if (inFlight.get(versionId) === p) inFlight.delete(versionId);
  });
  inFlight.set(versionId, p);
  return p;
}

async function runIngest(versionId: string): Promise<IngestResult> {
  const ver = await requireVersion(versionId);
  const tp = await tokenProviderForProject(ver.projectId);

  const result: IngestResult = {
    versionId,
    fetched: 0,
    inserted: 0,
    alreadyPresent: 0,
    skippedOrphanMetadata: 0,
    suggestionsInserted: 0,
    markedDeleted: 0,
    restored: 0,
  };

  const [docxBytes, driveComments] = await Promise.all([
    exportDocx(tp, ver.googleDocId),
    listComments(tp, ver.googleDocId),
  ]);
  const annotations = parseDocx(docxBytes);
  const authorIndex = buildAuthorIndex(driveComments);
  const driveIndex = buildDriveIndex(driveComments);

  // Set of external comment / suggestion ids encountered during this ingest.
  // After ingest, any canonical_comment row originating on this version whose
  // projection.googleCommentId is NOT in this set has been removed upstream
  // (Drive delete, suggestion accepted/rejected), and gets marked deleted.
  const seenExternalIds = new Set<string>();

  // Suggestions first — comments that reply on a suggestion's thread point at
  // these canonical rows via `parent_comment_id`, so they need to exist when
  // the comment-ingest phase runs.
  const suggestionByOoxmlId = await ingestSuggestions({
    projectId: ver.projectId,
    versionId,
    suggestions: annotations.suggestions,
    authorIndex,
    result,
    seenExternalIds,
  });

  await ingestComments({
    projectId: ver.projectId,
    versionId,
    comments: annotations.comments,
    suggestionByOoxmlId,
    authorIndex,
    driveIndex,
    result,
    seenExternalIds,
  });

  await reapDeletedCanonicals({
    versionId,
    seenExternalIds,
    result,
  });

  // Stamp the version's last-synced timestamp on every successful ingest, even
  // when zero comments were found — the projection table doesn't grow in that
  // case, so we'd otherwise show "Never" forever for empty docs.
  await db
    .update(version)
    .set({ lastSyncedAt: new Date() })
    .where(eq(version.id, versionId));

  return result;
}

/**
 * Mark canonical_comments originating on this version whose upstream id is
 * absent from this ingest. Symmetric: if an id reappears (rare: Drive
 * undelete, manual re-add), clear `deleted_at`. The projection row stays;
 * we filter on canonical_comment.deletedAt at read time so cross-version
 * projections preserve audit history.
 */
async function reapDeletedCanonicals(args: {
  versionId: string;
  seenExternalIds: Set<string>;
  result: IngestResult;
}): Promise<void> {
  // Pull every projection on this version that carries a googleCommentId —
  // those are the rows whose origin doc IS this version's doc, since
  // `commentProjection.googleCommentId` is only set at upsert time on the
  // origin pair.
  const projections = await db
    .select({
      canonicalId: commentProjection.canonicalCommentId,
      googleCommentId: commentProjection.googleCommentId,
    })
    .from(commentProjection)
    .where(
      and(
        eq(commentProjection.versionId, args.versionId),
        isNotNull(commentProjection.googleCommentId),
      ),
    );

  const missingCanonicalIds: string[] = [];
  const presentCanonicalIds: string[] = [];
  for (const p of projections) {
    if (!p.googleCommentId) continue;
    if (args.seenExternalIds.has(p.googleCommentId)) {
      presentCanonicalIds.push(p.canonicalId);
    } else {
      missingCanonicalIds.push(p.canonicalId);
    }
  }

  if (missingCanonicalIds.length > 0) {
    const stamped = await db
      .update(canonicalComment)
      .set({ deletedAt: new Date() })
      .where(
        and(
          inArray(canonicalComment.id, missingCanonicalIds),
          isNull(canonicalComment.deletedAt),
        ),
      )
      .returning({ id: canonicalComment.id });
    args.result.markedDeleted += stamped.length;
  }

  if (presentCanonicalIds.length > 0) {
    const restored = await db
      .update(canonicalComment)
      .set({ deletedAt: null })
      .where(
        and(
          inArray(canonicalComment.id, presentCanonicalIds),
          isNotNull(canonicalComment.deletedAt),
        ),
      )
      .returning({ id: canonicalComment.id });
    args.result.restored += restored.length;
  }
}

interface CommentIngestArgs {
  projectId: string;
  versionId: string;
  comments: DocxComment[];
  // OOXML w:id of a <w:ins>/<w:del> → canonical_comment.id of the ingested suggestion row.
  suggestionByOoxmlId: Map<string, string>;
  authorIndex: AuthorIndex;
  driveIndex: DriveIndex;
  result: IngestResult;
  seenExternalIds: Set<string>;
}

async function ingestComments(args: CommentIngestArgs): Promise<void> {
  // Two passes so parent_comment_id references resolve: roots first, then replies / suggestion-thread comments.
  const driveIdToCanonical = new Map<string, string>();

  // Phase A: roots.
  for (const c of args.comments) {
    args.result.fetched++;
    const drive = lookupDrive(args.driveIndex, c);
    const isReply = drive?.parentDriveId != null;
    const isSuggestionReply = !!c.overlapsSuggestionId;
    if (isReply || isSuggestionReply) continue;
    const id = await ingestOneComment(args, c, null);
    if (drive && id) driveIdToCanonical.set(drive.driveId, id);
  }

  // Phase B: replies + suggestion-thread comments.
  for (const c of args.comments) {
    const drive = lookupDrive(args.driveIndex, c);
    const isReply = drive?.parentDriveId != null;
    const isSuggestionReply = !!c.overlapsSuggestionId;
    if (!isReply && !isSuggestionReply) continue;
    args.result.fetched++;
    let parentCanonical: string | null = null;
    if (isSuggestionReply) {
      parentCanonical = args.suggestionByOoxmlId.get(c.overlapsSuggestionId!) ?? null;
    } else if (drive?.parentDriveId) {
      parentCanonical = driveIdToCanonical.get(drive.parentDriveId) ?? null;
    }
    const id = await ingestOneComment(args, c, parentCanonical);
    if (drive && id) driveIdToCanonical.set(drive.driveId, id);
  }
}

function lookupDrive(index: DriveIndex, c: DocxComment): DriveEntry | null {
  const key = driveLookupKey(c.author, c.date);
  if (!key) return null;
  return index.byAuthorAndDate.get(key) ?? null;
}

async function ingestOneComment(
  args: CommentIngestArgs,
  c: DocxComment,
  parentCommentId: string | null,
): Promise<string | null> {
  if (c.ranges.length === 0) {
    args.result.skippedOrphanMetadata++;
    args.result.fetched--;
    // null (not "") so the caller's drive-id → canonical-id map skips this orphan.
    return null;
  }
  const drive = lookupDrive(args.driveIndex, c);
  const identity = resolveIdentity(args.authorIndex, c.author);
  const externalId = drive?.driveId ?? commentIdempotencyKey(c);
  return upsertCanonical({
    projectId: args.projectId,
    versionId: args.versionId,
    googleCommentId: externalId,
    kind: "comment",
    authorDisplayName: c.author || null,
    authorEmail: identity.email,
    authorPhotoHash: identity.photoHash,
    createdIso: c.date,
    body: c.body,
    anchor: anchorFromDocxComment(c),
    parentCommentId,
    result: args.result,
    seenExternalIds: args.seenExternalIds,
  });
}

function commentIdempotencyKey(c: DocxComment): string {
  return `mgn:cmt:${hashShort(`${c.author} ${c.date} ${c.body}`)}`;
}

function anchorFromDocxComment(c: DocxComment): CommentAnchor {
  const [primary, ...rest] = c.ranges;
  if (!primary) {
    // Caller already guards on ranges.length > 0 — be defensive anyway.
    return { quotedText: "" };
  }
  const quoted = quotedTextForRange(primary);
  const anchor = buildAnchor({
    quotedText: quoted,
    paragraphText: primary.paragraphTexts[0] ?? "",
    region: primary.region,
    regionId: primary.regionId,
    paragraphIndex: primary.startParagraphIndex,
    offset: primary.startOffset,
    length: quoted.length,
  });
  if (rest.length > 0) {
    anchor.additionalRanges = rest.map(toAnchorRange);
  }
  return anchor;
}

function quotedTextForRange(r: DocxRange): string {
  if (r.startParagraphIndex === r.endParagraphIndex) {
    const text = r.paragraphTexts[0] ?? "";
    return text.slice(r.startOffset, r.endOffset);
  }
  // Multi-paragraph: first slice → middle paragraphs whole → last slice. Joined with \n to
  // match Drive's multi-paragraph quotedFileContent format.
  const out: string[] = [];
  const first = r.paragraphTexts[0] ?? "";
  out.push(first.slice(r.startOffset));
  for (let i = 1; i < r.paragraphTexts.length - 1; i++) {
    out.push(r.paragraphTexts[i] ?? "");
  }
  const last = r.paragraphTexts[r.paragraphTexts.length - 1] ?? "";
  out.push(last.slice(0, r.endOffset));
  return out.join("\n");
}

function toAnchorRange(r: DocxRange): AnchorRange {
  return {
    region: r.region,
    regionId: r.regionId || undefined,
    startParagraphIndex: r.startParagraphIndex,
    startOffset: r.startOffset,
    endParagraphIndex: r.endParagraphIndex,
    endOffset: r.endOffset,
  };
}
