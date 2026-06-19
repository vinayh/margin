import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { countWhere, db } from "../db/client.ts";
import { notification, type NotificationKind, type NotificationPayload } from "../db/schema.ts";

type Notification = typeof notification.$inferSelect;

export interface NotificationView {
  id: string;
  kind: NotificationKind;
  payload: NotificationPayload;
  createdAt: number;
  readAt: number | null;
}

/**
 * Persist a single notification for one user. Caller-supplied payload is
 * stored verbatim — keep it small + flat (the JSON column is the seam, not
 * an audit log). Returns the inserted row so callers that want the id can
 * use it (e.g. for analytics or cleanup).
 */
export async function createNotification(opts: {
  userId: string;
  kind: NotificationKind;
  payload: NotificationPayload;
}): Promise<Notification> {
  const rows = await db
    .insert(notification)
    .values({
      userId: opts.userId,
      kind: opts.kind,
      payload: opts.payload,
    })
    .returning();
  return rows[0]!;
}

/**
 * Most-recent first, capped at `limit` (default 50). Both read and unread —
 * the side-panel UI surfaces both with a bold-vs-muted treatment.
 */
export async function listNotificationsForUser(
  userId: string,
  limit = 50,
): Promise<NotificationView[]> {
  const rows = await db
    .select()
    .from(notification)
    .where(eq(notification.userId, userId))
    .orderBy(desc(notification.createdAt))
    .limit(limit);
  return rows.map(toView);
}

export async function countUnreadNotifications(userId: string): Promise<number> {
  return countWhere(
    notification,
    and(eq(notification.userId, userId), isNull(notification.readAt)),
  );
}

/**
 * Owner-scoped mark-read. Returns the count of rows actually updated (rows
 * already-read or owned by a different user are silently ignored). Empty
 * `ids` is a no-op.
 */
export async function markNotificationsRead(
  userId: string,
  ids: string[],
): Promise<number> {
  if (ids.length === 0) return 0;
  const rows = await db
    .update(notification)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notification.userId, userId),
        inArray(notification.id, ids),
        isNull(notification.readAt),
      ),
    )
    .returning({ id: notification.id });
  return rows.length;
}

export async function markAllNotificationsRead(userId: string): Promise<number> {
  const rows = await db
    .update(notification)
    .set({ readAt: new Date() })
    .where(and(eq(notification.userId, userId), isNull(notification.readAt)))
    .returning({ id: notification.id });
  return rows.length;
}

function toView(n: Notification): NotificationView {
  return {
    id: n.id,
    kind: n.kind,
    payload: n.payload,
    createdAt: n.createdAt.getTime(),
    readAt: n.readAt?.getTime() ?? null,
  };
}
