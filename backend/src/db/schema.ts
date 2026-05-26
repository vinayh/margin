import {
  boolean,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const ts = (name: string) => timestamp(name, { mode: "date", withTimezone: true });

// user/session/account/verification are Better Auth tables. Column names follow its expectations.
// Better Auth supplies ids itself (configured to `crypto.randomUUID` in src/auth/server.ts);
// `defaultRandom` is a safety net if a path ever omits the id.
export const user = pgTable("user", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const session = pgTable(
  "session",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(),
    expiresAt: ts("expires_at").notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [index("session_user_idx").on(t.userId)],
);

export const account = pgTable(
  "account",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    providerId: text("provider_id").notNull(),
    accountId: text("account_id").notNull(),
    accessToken: text("access_token"),
    // Envelope-encrypted on write; decrypted by tokenProviderForUser.
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: ts("access_token_expires_at"),
    refreshTokenExpiresAt: ts("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("account_user_idx").on(t.userId),
    uniqueIndex("account_provider_account_unique").on(t.providerId, t.accountId),
  ],
);

export const verification = pgTable(
  "verification",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: ts("expires_at").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [index("verification_identifier_idx").on(t.identifier)],
);

// JSON blob on project.settings. Read via loadProjectSettings; unset fields fall back to defaults.
export type ProjectSettings = {
  defaultReviewerEmails?: string[];
  defaultOverlayId?: string;
  notifyOnComment?: boolean;
  notifyOnReviewComplete?: boolean;
  // Free-form for now; Phase 5 will write a structured { teamId, channelId } here.
  slackWorkspaceRef?: string;
};

export const project = pgTable(
  "project",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    parentDocId: text("parent_doc_id").notNull(),
    // Drive `files.get` name at registration time. Nullable for pre-migration
    // rows; refreshed on next doc-sync. Authoritative source for the doc
    // title shown in the popup / side panel — the extension's tab-title
    // fallback is locale-fragile.
    name: text("name"),
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    settings: jsonb("settings").$type<ProjectSettings>().notNull().default({}),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  // Note: project identity is intentionally NOT bound to parent_doc_id — the
  // parent doc URL can be swapped over a project's lifetime. createProject's
  // "this doc is already tracked" pre-check is enforced at the application
  // layer (DuplicateProjectError) so the picker UX can still surface it.
  (t) => [
    index("project_parent_doc_idx").on(t.parentDocId),
    index("project_owner_idx").on(t.ownerUserId),
  ],
);

export type VersionStatus = "active" | "archived";

export const version = pgTable(
  "version",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    googleDocId: text("google_doc_id").notNull(),
    // Drive `files.get` name for the version copy. Same nullable + fallback
    // semantics as `project.name`. Typically `[Margin <label>] <parent name>`.
    name: text("name"),
    parentVersionId: uuid("parent_version_id"),
    label: text("label").notNull(),
    createdByUserId: uuid("created_by_user_id")
      .notNull()
      .references(() => user.id),
    snapshotContentHash: text("snapshot_content_hash"),
    status: text("status").$type<VersionStatus>().notNull().default("active"),
    createdAt: ts("created_at").notNull().defaultNow(),
    // Stamped at the tail of every successful ingestVersionComments run, even
    // when zero comments were found. Single source of truth for "when did
    // Margin last refresh this version" — previously inferred from the max of
    // commentProjection.lastSyncedAt and driveWatchChannel.lastSyncedAt, which
    // returned null forever on docs with no comments.
    lastSyncedAt: ts("last_synced_at"),
  },
  (t) => [
    index("version_project_idx").on(t.projectId),
    index("version_google_doc_idx").on(t.googleDocId),
    // Pairs with nextAutoLabel's MAX+1 so a race surfaces as a conflict instead of dup labels.
    uniqueIndex("version_project_label_unique").on(t.projectId, t.label),
    foreignKey({ columns: [t.parentVersionId], foreignColumns: [t.id] }),
  ],
);

export const overlay = pgTable(
  "overlay",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("overlay_project_idx").on(t.projectId)],
);

export type OverlayOpType = "redact" | "replace" | "insert" | "append";

export type OverlayAnchor = {
  quotedText: string;
  contextBefore?: string;
  contextAfter?: string;
  paragraphHash?: string;
};

export const overlayOperation = pgTable(
  "overlay_operation",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    overlayId: uuid("overlay_id")
      .notNull()
      .references(() => overlay.id, { onDelete: "cascade" }),
    orderIndex: integer("order_index").notNull(),
    type: text("type").$type<OverlayOpType>().notNull(),
    anchor: jsonb("anchor").$type<OverlayAnchor>().notNull(),
    payload: text("payload"),
    confidenceThreshold: integer("confidence_threshold"),
  },
  (t) => [index("overlay_op_overlay_idx").on(t.overlayId, t.orderIndex)],
);

export const derivative = pgTable("derivative", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => project.id, { onDelete: "cascade" }),
  versionId: uuid("version_id")
    .notNull()
    .references(() => version.id),
  overlayId: uuid("overlay_id")
    .notNull()
    .references(() => overlay.id),
  googleDocId: text("google_doc_id").notNull(),
  audienceLabel: text("audience_label"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export type DocRegion = "body" | "header" | "footer" | "footnote";

// One additional range of a multi-range comment. The primary lives on structuralPosition.
export type AnchorRange = {
  region: DocRegion;
  regionId?: string;
  startParagraphIndex: number;
  startOffset: number;
  endParagraphIndex: number;
  endOffset: number;
};

export type CommentAnchor = {
  quotedText: string;
  contextBefore?: string;
  contextAfter?: string;
  paragraphHash?: string;
  structuralPosition?: {
    // Omitted region defaults to "body" (back-compat).
    region?: DocRegion;
    // Required when region != "body".
    regionId?: string;
    paragraphIndex: number;
    offset: number;
  };
  // Sorted in document order (region, regionId, paragraphIndex, startOffset).
  additionalRanges?: AnchorRange[];
};

export type CanonicalCommentStatus = "open" | "addressed" | "wontfix" | "superseded";

/**
 * What kind of doc annotation produced this canonical_comment.
 * - `comment`: Drive comment thread or reply. Author/timestamp from the API.
 * - `suggestion_insert` / `suggestion_delete`: a tracked-change suggestion. Author/timestamp
 *   aren't surfaced by `documents.get`; resolving via the Drive revisions API is deferred
 *   (SPEC Phase 6). Reply threads on a suggestion are stored internally by Google and not
 *   exposed by any public API (verified empirically). Use `deno task margin inspect <url>` to confirm.
 */
export type CanonicalCommentKind = "comment" | "suggestion_insert" | "suggestion_delete";

export const canonicalComment = pgTable(
  "canonical_comment",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    originVersionId: uuid("origin_version_id")
      .notNull()
      .references(() => version.id),
    originUserId: uuid("origin_user_id").references(() => user.id),
    originUserEmail: text("origin_user_email"),
    originUserDisplayName: text("origin_user_display_name"),
    // Short SHA-256 of Drive photoLink; disambiguates reviewers sharing a display name.
    originPhotoHash: text("origin_photo_hash"),
    originTimestamp: ts("origin_timestamp").notNull(),
    kind: text("kind").$type<CanonicalCommentKind>().notNull().default("comment"),
    anchor: jsonb("anchor").$type<CommentAnchor>().notNull(),
    body: text("body").notNull(),
    status: text("status").$type<CanonicalCommentStatus>().notNull().default("open"),
    parentCommentId: uuid("parent_comment_id"),
    createdAt: ts("created_at").notNull().defaultNow(),
    // Stamped when the next ingest of `originVersionId` no longer sees the
    // upstream Drive comment / suggestion. The row stays for history (audit
    // trail, projections onto other versions remain referenceable) but is
    // filtered out of the reconciliation view. Cleared if the same external
    // id reappears in a later ingest (rare: Drive undelete, manual re-add).
    deletedAt: ts("deleted_at"),
  },
  (t) => [
    index("canonical_comment_project_idx").on(t.projectId),
    foreignKey({ columns: [t.parentCommentId], foreignColumns: [t.id] }),
  ],
);

export type ProjectionStatus = "clean" | "fuzzy" | "orphaned" | "manually_resolved";

export const commentProjection = pgTable(
  "comment_projection",
  {
    canonicalCommentId: uuid("canonical_comment_id")
      .notNull()
      .references(() => canonicalComment.id, { onDelete: "cascade" }),
    versionId: uuid("version_id")
      .notNull()
      .references(() => version.id, { onDelete: "cascade" }),
    googleCommentId: text("google_comment_id"),
    anchorMatchConfidence: integer("anchor_match_confidence"),
    projectionStatus: text("projection_status").$type<ProjectionStatus>().notNull(),
    lastSyncedAt: ts("last_synced_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.canonicalCommentId, t.versionId] }),
    // Lets upsertCanonical detect a concurrent-ingest race and fall back to the existing row.
    uniqueIndex("comment_projection_version_google_unique").on(
      t.versionId,
      t.googleCommentId,
    ),
  ],
);

export type ReviewRequestStatus = "open" | "closed" | "cancelled";

export const reviewRequest = pgTable("review_request", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => project.id, { onDelete: "cascade" }),
  versionId: uuid("version_id")
    .notNull()
    .references(() => version.id),
  status: text("status").$type<ReviewRequestStatus>().notNull().default("open"),
  deadline: ts("deadline"),
  slackThreadRef: text("slack_thread_ref"),
  createdByUserId: uuid("created_by_user_id")
    .notNull()
    .references(() => user.id),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export type ReviewAssignmentStatus = "pending" | "reviewed" | "changes_requested" | "declined";

export const reviewAssignment = pgTable(
  "review_assignment",
  {
    reviewRequestId: uuid("review_request_id")
      .notNull()
      .references(() => reviewRequest.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id),
    status: text("status")
      .$type<ReviewAssignmentStatus>()
      .notNull()
      .default("pending"),
    respondedAt: ts("responded_at"),
  },
  (t) => [
    primaryKey({ columns: [t.reviewRequestId, t.userId] }),
    index("review_assignment_user_idx").on(t.userId),
  ],
);

// Tracks active Drive files.watch channels so the watcher can renew and map push → version.
export const driveWatchChannel = pgTable(
  "drive_watch_channel",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    versionId: uuid("version_id")
      .notNull()
      .references(() => version.id, { onDelete: "cascade" }),
    channelId: text("channel_id").notNull().unique(),
    resourceId: text("resource_id").notNull(),
    // Echoed back as X-Goog-Channel-Token.
    token: text("token"),
    address: text("address").notNull(),
    expiration: ts("expiration"),
    createdAt: ts("created_at").notNull().defaultNow(),
    lastEventAt: ts("last_event_at"),
  },
  (t) => [index("drive_watch_version_idx").on(t.versionId)],
);

/**
 * Magic-link review actions. The first three are review_assignment state transitions;
 * `accept_reconciliation` covers the cross-version "yes, this v1 comment is still open
 * on v2" confirmation (SPEC §7.4 step 5).
 */
export type ReviewActionKind =
  | "mark_reviewed"
  | "decline"
  | "request_changes"
  | "accept_reconciliation";

// Magic-link token. Stored as sha256. One row per (reviewRequestId, assigneeUserId);
// reusable until expiry — the action is passed as a query param at redeem time, so
// reviewers can change their response (e.g. mark_reviewed → request_changes) without
// the requester re-issuing a link.
export const reviewActionToken = pgTable(
  "review_action_token",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tokenHash: text("token_hash").notNull().unique(),
    // Denormalized (review_request_id, user_id) because assignment has no single-column id.
    reviewRequestId: uuid("review_request_id")
      .notNull()
      .references(() => reviewRequest.id, { onDelete: "cascade" }),
    assigneeUserId: uuid("assignee_user_id")
      .notNull()
      .references(() => user.id),
    issuedAt: ts("issued_at").notNull().defaultNow(),
    expiresAt: ts("expires_at").notNull(),
    // Set on every successful redeem; null until first use.
    lastUsedAt: ts("last_used_at"),
  },
  (t) => [
    uniqueIndex("review_action_token_assignment_idx").on(
      t.reviewRequestId,
      t.assigneeUserId,
    ),
  ],
);

export type NotificationKind =
  | "review_assigned"
  | "review_completed"
  | "review_changes_requested"
  | "review_declined";

/**
 * Notification payload shape varies by kind. Stored as opaque JSON so the
 * domain layer can rev the shape per kind without a migration.
 *
 * - `review_assigned`           : { reviewRequestId, projectId, projectName, requesterEmail }
 * - `review_completed`          : { reviewRequestId, projectId, projectName, reviewerEmail }
 * - `review_changes_requested`  : same as review_completed
 * - `review_declined`           : same as review_completed
 */
export type NotificationPayload = {
  reviewRequestId?: string;
  projectId?: string;
  projectName?: string | null;
  requesterEmail?: string | null;
  reviewerEmail?: string | null;
};

export const notification = pgTable(
  "notification",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    kind: text("kind").$type<NotificationKind>().notNull(),
    payload: jsonb("payload").$type<NotificationPayload>().notNull().default({}),
    readAt: ts("read_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("notification_user_idx").on(t.userId, t.createdAt),
    // Partial-equivalent: queries for "unread for this user" scan the user
    // index then filter on read_at IS NULL; with the typical low-N inbox
    // size that's cheap. Keep one index, not two.
  ],
);

export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorUserId: uuid("actor_user_id"),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id"),
    before: jsonb("before").$type<Record<string, unknown>>(),
    after: jsonb("after").$type<Record<string, unknown>>(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("audit_target_idx").on(t.targetType, t.targetId),
    index("audit_actor_idx").on(t.actorUserId),
  ],
);
