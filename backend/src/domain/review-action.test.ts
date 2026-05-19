import "../../test/setup.ts";
import { beforeEach, describe, it as test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { and, eq } from "drizzle-orm";
import { cleanDb, seedProject, seedReviewRequest, seedUser, seedVersion } from "../../test/db.ts";
import { db } from "../db/client.ts";
import { notification, reviewAssignment } from "../db/schema.ts";
import { issueReviewActionToken, redeemReviewActionToken } from "./review-action.ts";

beforeEach(cleanDb);

async function seedReviewCycle() {
  const owner = await seedUser({ email: "owner@example.com" });
  const reviewer = await seedUser({ email: "reviewer@example.com" });
  const proj = await seedProject({ ownerUserId: owner.id, name: "Hot Doc" });
  const ver = await seedVersion({ projectId: proj.id, createdByUserId: owner.id });
  const rr = await seedReviewRequest({
    projectId: proj.id,
    versionId: ver.id,
    createdByUserId: owner.id,
  });
  await db.insert(reviewAssignment).values({
    reviewRequestId: rr.id,
    userId: reviewer.id,
    status: "pending",
  });
  const issued = await issueReviewActionToken({
    reviewRequestId: rr.id,
    assigneeUserId: reviewer.id,
  });
  return { owner, reviewer, proj, ver, rr, token: issued.token };
}

describe("redeemReviewActionToken notification side-effect", () => {
  test("creates a review_completed notification for the requester on mark_reviewed", async () => {
    const { owner, proj, token } = await seedReviewCycle();
    const out = await redeemReviewActionToken(token, "mark_reviewed");
    expect(out.ok).toBe(true);

    const rows = await db
      .select()
      .from(notification)
      .where(eq(notification.userId, owner.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.kind).toBe("review_completed");
    expect(rows[0]!.payload.projectId).toBe(proj.id);
    expect(rows[0]!.payload.projectName).toBe("Hot Doc");
    expect(rows[0]!.payload.reviewerEmail).toBe("reviewer@example.com");
  });

  test("decline → review_declined notification", async () => {
    const { owner, token } = await seedReviewCycle();
    await redeemReviewActionToken(token, "decline");
    const rows = await db
      .select()
      .from(notification)
      .where(eq(notification.userId, owner.id));
    expect(rows[0]!.kind).toBe("review_declined");
  });

  test("accept_reconciliation does not create a notification", async () => {
    const { owner, token } = await seedReviewCycle();
    await redeemReviewActionToken(token, "accept_reconciliation");
    const rows = await db
      .select()
      .from(notification)
      .where(eq(notification.userId, owner.id));
    expect(rows).toHaveLength(0);
  });

  test("self-review (requester is also the assignee) does not self-notify", async () => {
    const owner = await seedUser({ email: "owner@example.com" });
    const proj = await seedProject({ ownerUserId: owner.id });
    const ver = await seedVersion({
      projectId: proj.id,
      createdByUserId: owner.id,
    });
    const rr = await seedReviewRequest({
      projectId: proj.id,
      versionId: ver.id,
      createdByUserId: owner.id,
    });
    await db.insert(reviewAssignment).values({
      reviewRequestId: rr.id,
      userId: owner.id,
      status: "pending",
    });
    const issued = await issueReviewActionToken({
      reviewRequestId: rr.id,
      assigneeUserId: owner.id,
    });
    await redeemReviewActionToken(issued.token, "mark_reviewed");

    const rows = await db
      .select()
      .from(notification)
      .where(eq(notification.userId, owner.id));
    expect(rows).toHaveLength(0);

    // Sanity: the assignment did transition.
    const a = await db
      .select()
      .from(reviewAssignment)
      .where(
        and(
          eq(reviewAssignment.reviewRequestId, rr.id),
          eq(reviewAssignment.userId, owner.id),
        ),
      )
      .limit(1);
    expect(a[0]!.status).toBe("reviewed");
  });
});
