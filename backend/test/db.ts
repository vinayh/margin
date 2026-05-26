/**
 * Helpers for tests that read/write the DB. The DB itself is provisioned by
 * `test/setup.ts` (imported at the top of every test file under Deno) —
 * PGlite + pglite-socket on an ephemeral port, with migrations already
 * applied, and `DATABASE_URL` set so `src/db/client.ts`'s lazy pool
 * connects to it on first query.
 *
 * Test isolation: every `deno test` process gets one shared DB. Tests
 * that need a clean slate call `cleanDb()` in `beforeEach` — there's no
 * cross-process state, so this is sufficient even with parallel test files.
 */
import { sql } from "drizzle-orm";
import { db } from "../src/db/client.ts";
import {
  canonicalComment,
  type CanonicalCommentKind,
  type CommentAnchor,
  commentProjection,
  derivative,
  driveWatchChannel,
  overlay,
  project,
  type ProjectionStatus,
  reviewRequest,
  type ReviewRequestStatus,
  user,
  version,
} from "../src/db/schema.ts";

/**
 * Truncate every table. CASCADE lets us list them in any order; the
 * non-deferred FKs would otherwise force a strict child-before-parent order
 * on every schema change.
 */
export async function cleanDb(): Promise<void> {
  await db.execute(sql`
    TRUNCATE TABLE
      audit_log, notification, review_action_token, review_assignment,
      review_request, comment_projection, canonical_comment, derivative,
      overlay_operation, overlay, drive_watch_channel, version, project,
      session, account, verification, "user"
    RESTART IDENTITY CASCADE
  `);
}

/**
 * Run `fn` with FK checks suppressed. Postgres has no per-session `PRAGMA
 * foreign_keys = OFF`; the supported escape hatch is `session_replication_role
 * = replica`, which skips both FK and trigger work for the rest of the
 * session. Used by tests that want to construct "stranded child row"
 * scenarios that the live schema would CASCADE away.
 */
export async function withFkChecksDisabled<T>(fn: () => Promise<T>): Promise<T> {
  await db.execute(sql`SET session_replication_role = replica`);
  try {
    return await fn();
  } finally {
    await db.execute(sql`SET session_replication_role = DEFAULT`);
  }
}

export async function seedUser(opts?: {
  email?: string;
  name?: string;
}): Promise<typeof user.$inferSelect> {
  const inserted = await db
    .insert(user)
    .values({
      email: opts?.email ?? `user-${crypto.randomUUID()}@example.com`,
      name: opts?.name ?? "Test User",
    })
    .returning();
  return inserted[0]!;
}

export async function seedProject(opts: {
  ownerUserId: string;
  parentDocId?: string;
  name?: string | null;
}): Promise<typeof project.$inferSelect> {
  const inserted = await db
    .insert(project)
    .values({
      ownerUserId: opts.ownerUserId,
      parentDocId: opts.parentDocId ?? `doc-${crypto.randomUUID()}`,
      name: opts.name ?? null,
      settings: {},
    })
    .returning();
  return inserted[0]!;
}

export async function seedVersion(opts: {
  projectId: string;
  createdByUserId: string;
  label?: string;
  googleDocId?: string;
  name?: string | null;
  parentVersionId?: string | null;
  lastSyncedAt?: Date | null;
}): Promise<typeof version.$inferSelect> {
  // Default to a unique label per call so tests that seed multiple versions
  // in the same project don't collide on the `(project_id, label)` unique
  // index. Tests that care about a specific label pass `label` explicitly.
  const inserted = await db
    .insert(version)
    .values({
      projectId: opts.projectId,
      googleDocId: opts.googleDocId ?? `doc-${crypto.randomUUID()}`,
      name: opts.name ?? null,
      label: opts.label ?? `v-${crypto.randomUUID().slice(0, 8)}`,
      createdByUserId: opts.createdByUserId,
      parentVersionId: opts.parentVersionId ?? null,
      status: "active",
      lastSyncedAt: opts.lastSyncedAt ?? null,
    })
    .returning();
  return inserted[0]!;
}

export async function seedOverlay(opts: {
  projectId: string;
  name?: string;
}): Promise<typeof overlay.$inferSelect> {
  const inserted = await db
    .insert(overlay)
    .values({
      projectId: opts.projectId,
      name: opts.name ?? "test overlay",
    })
    .returning();
  return inserted[0]!;
}

export async function seedDerivative(opts: {
  projectId: string;
  versionId: string;
  overlayId: string;
  googleDocId?: string;
  audienceLabel?: string | null;
}): Promise<typeof derivative.$inferSelect> {
  const inserted = await db
    .insert(derivative)
    .values({
      projectId: opts.projectId,
      versionId: opts.versionId,
      overlayId: opts.overlayId,
      googleDocId: opts.googleDocId ?? `doc-${crypto.randomUUID()}`,
      audienceLabel: opts.audienceLabel ?? null,
    })
    .returning();
  return inserted[0]!;
}

export async function seedReviewRequest(opts: {
  projectId: string;
  versionId: string;
  createdByUserId: string;
  status?: ReviewRequestStatus;
  deadline?: Date | null;
}): Promise<typeof reviewRequest.$inferSelect> {
  const inserted = await db
    .insert(reviewRequest)
    .values({
      projectId: opts.projectId,
      versionId: opts.versionId,
      createdByUserId: opts.createdByUserId,
      status: opts.status ?? "open",
      deadline: opts.deadline ?? null,
    })
    .returning();
  return inserted[0]!;
}

export async function seedCommentProjection(opts: {
  canonicalCommentId: string;
  versionId: string;
  projectionStatus?: ProjectionStatus;
  lastSyncedAt?: Date;
  googleCommentId?: string | null;
  anchorMatchConfidence?: number | null;
}): Promise<typeof commentProjection.$inferSelect> {
  const inserted = await db
    .insert(commentProjection)
    .values({
      canonicalCommentId: opts.canonicalCommentId,
      versionId: opts.versionId,
      googleCommentId: opts.googleCommentId ?? null,
      anchorMatchConfidence: opts.anchorMatchConfidence ?? null,
      projectionStatus: opts.projectionStatus ?? "clean",
      lastSyncedAt: opts.lastSyncedAt ?? new Date(),
    })
    .returning();
  return inserted[0]!;
}

export async function seedDriveWatchChannel(opts: {
  versionId: string;
  channelId?: string;
  resourceId?: string;
  token?: string | null;
  expiration?: Date | null;
}): Promise<typeof driveWatchChannel.$inferSelect> {
  const inserted = await db
    .insert(driveWatchChannel)
    .values({
      versionId: opts.versionId,
      channelId: opts.channelId ?? `channel-${crypto.randomUUID()}`,
      resourceId: opts.resourceId ?? `resource-${crypto.randomUUID()}`,
      token: opts.token === undefined ? `token-${crypto.randomUUID()}` : opts.token,
      address: "https://example.com/webhooks/drive",
      expiration: opts.expiration === undefined
        ? new Date(Date.now() + 86_400_000)
        : opts.expiration,
    })
    .returning();
  return inserted[0]!;
}

export async function seedCanonicalComment(opts: {
  projectId: string;
  originVersionId: string;
  body?: string;
  kind?: CanonicalCommentKind;
  anchor?: CommentAnchor;
}): Promise<typeof canonicalComment.$inferSelect> {
  const inserted = await db
    .insert(canonicalComment)
    .values({
      projectId: opts.projectId,
      originVersionId: opts.originVersionId,
      originTimestamp: new Date(),
      body: opts.body ?? "test comment",
      kind: opts.kind ?? "comment",
      anchor: opts.anchor ?? { quotedText: "" },
    })
    .returning();
  return inserted[0]!;
}
