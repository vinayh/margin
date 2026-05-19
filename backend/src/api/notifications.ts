import * as v from "valibot";
import {
  authenticateBearer,
  IdSchema,
  jsonOk,
  readAndParseJson,
  unauthorized,
} from "./middleware.ts";
import {
  countUnreadNotifications,
  listNotificationsForUser,
  markAllNotificationsRead,
  markNotificationsRead,
} from "../domain/notification.ts";

const MAX_BODY_BYTES = 8 * 1024;
const MAX_NOTIFICATION_IDS = 200;

const NotificationsListBodySchema = v.object({
  limit: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(200))),
});

const NotificationsMarkReadBodySchema = v.object({
  // Either an explicit id list, OR all=true to drain the inbox. Mutually
  // exclusive — body that sets both gets the ids semantics (ids wins).
  ids: v.optional(
    v.pipe(v.array(IdSchema), v.maxLength(MAX_NOTIFICATION_IDS)),
  ),
  all: v.optional(v.boolean()),
});

/**
 * POST /api/extension/notifications — returns the user's recent in-app
 * notifications + unread count. Body `{ limit? }`. Caller doesn't supply a
 * cursor; the inbox is small enough that a fixed cap is fine for now.
 */
export async function handleNotificationsPost(req: Request): Promise<Response> {
  const auth = await authenticateBearer(req);
  if (!auth) return unauthorized();

  const parsed = await readAndParseJson(req, MAX_BODY_BYTES, NotificationsListBodySchema);
  if (parsed instanceof Response) return parsed;

  const [items, unread] = await Promise.all([
    listNotificationsForUser(auth.userId, parsed.limit ?? 50),
    countUnreadNotifications(auth.userId),
  ]);
  return jsonOk({ items, unread });
}

/**
 * POST /api/extension/notifications/mark-read — flips `read_at`. Body
 * `{ ids: string[] }` for a targeted ack, or `{ all: true }` to drain the
 * inbox. Returns `{ marked: <n> }`.
 */
export async function handleNotificationsMarkReadPost(
  req: Request,
): Promise<Response> {
  const auth = await authenticateBearer(req);
  if (!auth) return unauthorized();

  const parsed = await readAndParseJson(req, MAX_BODY_BYTES, NotificationsMarkReadBodySchema);
  if (parsed instanceof Response) return parsed;

  let marked = 0;
  if (parsed.ids && parsed.ids.length > 0) {
    marked = await markNotificationsRead(auth.userId, parsed.ids);
  } else if (parsed.all === true) {
    marked = await markAllNotificationsRead(auth.userId);
  }
  return jsonOk({ marked });
}
