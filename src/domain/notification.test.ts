import { beforeEach, describe, expect, test } from "bun:test";
import { cleanDb, seedUser } from "../../test/db.ts";
import {
  countUnreadNotifications,
  createNotification,
  listNotificationsForUser,
  markAllNotificationsRead,
  markNotificationsRead,
} from "./notification.ts";

beforeEach(cleanDb);

describe("notification", () => {
  test("create + list (newest first)", async () => {
    const u = await seedUser();
    const a = await createNotification({
      userId: u.id,
      kind: "review_completed",
      payload: { projectName: "First" },
    });
    // Force a 2ms gap so the newer createdAt strictly dominates.
    await new Promise((r) => setTimeout(r, 2));
    const b = await createNotification({
      userId: u.id,
      kind: "review_completed",
      payload: { projectName: "Second" },
    });
    const list = await listNotificationsForUser(u.id);
    expect(list.map((n) => n.id)).toEqual([b.id, a.id]);
    expect(list[0]!.readAt).toBeNull();
  });

  test("isolates per user", async () => {
    const a = await seedUser({ email: "a@example.com" });
    const b = await seedUser({ email: "b@example.com" });
    await createNotification({
      userId: a.id,
      kind: "review_completed",
      payload: {},
    });
    expect((await listNotificationsForUser(a.id)).length).toBe(1);
    expect((await listNotificationsForUser(b.id)).length).toBe(0);
  });

  test("unread count drops as rows are marked read", async () => {
    const u = await seedUser();
    const a = await createNotification({
      userId: u.id,
      kind: "review_completed",
      payload: {},
    });
    const b = await createNotification({
      userId: u.id,
      kind: "review_completed",
      payload: {},
    });
    expect(await countUnreadNotifications(u.id)).toBe(2);
    const n = await markNotificationsRead(u.id, [a.id]);
    expect(n).toBe(1);
    expect(await countUnreadNotifications(u.id)).toBe(1);
    expect(await markNotificationsRead(u.id, [a.id])).toBe(0);
    void b;
  });

  test("markAll clears every unread row", async () => {
    const u = await seedUser();
    await createNotification({ userId: u.id, kind: "review_completed", payload: {} });
    await createNotification({ userId: u.id, kind: "review_completed", payload: {} });
    const n = await markAllNotificationsRead(u.id);
    expect(n).toBe(2);
    expect(await countUnreadNotifications(u.id)).toBe(0);
  });

  test("markNotificationsRead is scoped by user (no cross-tenant updates)", async () => {
    const a = await seedUser({ email: "a@example.com" });
    const b = await seedUser({ email: "b@example.com" });
    const aNote = await createNotification({
      userId: a.id,
      kind: "review_completed",
      payload: {},
    });
    const updated = await markNotificationsRead(b.id, [aNote.id]);
    expect(updated).toBe(0);
    expect(await countUnreadNotifications(a.id)).toBe(1);
  });
});
