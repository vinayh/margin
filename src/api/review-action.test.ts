import { beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { cleanDb, seedProject, seedUser, seedVersion, seedReviewRequest } from "../../test/db.ts";
import { db } from "../db/client.ts";
import { reviewAssignment } from "../db/schema.ts";
import { issueReviewActionToken } from "../domain/review-action.ts";
import {
  handleReviewActionGet,
  handleReviewActionPost,
} from "./review-action.tsx";

beforeEach(cleanDb);

function get(path: string): Request {
  return new Request(`http://localhost${path}`, { method: "GET" });
}

function postForm(path: string, body: Record<string, string>): Request {
  const params = new URLSearchParams(body);
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
}

async function seedAssignmentWorld() {
  const owner = await seedUser({ email: "owner@example.com" });
  const reviewer = await seedUser({ email: "reviewer@example.com" });
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
  await db
    .insert(reviewAssignment)
    .values({ reviewRequestId: rr.id, userId: reviewer.id, status: "pending" });
  return { owner, reviewer, proj, ver, rr };
}

async function reviewerStatus(reviewerId: string): Promise<string> {
  const rows = await db
    .select()
    .from(reviewAssignment)
    .where(eq(reviewAssignment.userId, reviewerId))
    .limit(1);
  return rows[0]!.status;
}

describe("handleReviewActionGet (renders only; never mutates)", () => {
  test("renders confirm page for unknown token (validation deferred to POST)", async () => {
    const res = await handleReviewActionGet(get("/r/mra_unknown?action=mark_reviewed"));
    // GET is pure render; "unknown token" is discovered on submit.
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
  });

  test("404 for a path that doesn't carry a token", async () => {
    const res = await handleReviewActionGet(get("/r/?action=mark_reviewed"));
    expect(res.status).toBe(404);
  });

  test("404 from POST for an unknown token", async () => {
    const res = await handleReviewActionPost(
      postForm("/r/mra_unknown", { action: "mark_reviewed" }),
    );
    expect(res.status).toBe(404);
  });

  test("renders chooser page (200) when ?action= is absent", async () => {
    const world = await seedAssignmentWorld();
    const { token } = await issueReviewActionToken({
      reviewRequestId: world.rr.id,
      assigneeUserId: world.reviewer.id,
    });
    const res = await handleReviewActionGet(get(`/r/${token}`));
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("Choose a review action");
    // Action submits as a POST form, not a GET link.
    expect(body).toContain('method="POST"');
    expect(body).toContain('value="mark_reviewed"');
    expect(body).toContain('value="decline"');
  });

  test("renders chooser with 400 when ?action= is unrecognized", async () => {
    const world = await seedAssignmentWorld();
    const { token } = await issueReviewActionToken({
      reviewRequestId: world.rr.id,
      assigneeUserId: world.reviewer.id,
    });
    const res = await handleReviewActionGet(get(`/r/${token}?action=bogus`));
    expect(res.status).toBe(400);
    const body = await res.text();
    expect(body).toContain("bogus");
  });

  test("?action=<known> renders confirm page (200) without mutating state", async () => {
    const world = await seedAssignmentWorld();
    const { token } = await issueReviewActionToken({
      reviewRequestId: world.rr.id,
      assigneeUserId: world.reviewer.id,
    });
    const res = await handleReviewActionGet(get(`/r/${token}?action=mark_reviewed`));
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("Confirm");
    expect(body).toContain('method="POST"');
    // Assignment is still pending — GET must not mutate.
    expect(await reviewerStatus(world.reviewer.id)).toBe("pending");
  });
});

describe("handleReviewActionPost (mutates)", () => {
  test("mark_reviewed transitions assignment; replay is idempotent", async () => {
    const world = await seedAssignmentWorld();
    const { token } = await issueReviewActionToken({
      reviewRequestId: world.rr.id,
      assigneeUserId: world.reviewer.id,
    });

    const first = await handleReviewActionPost(
      postForm(`/r/${token}`, { action: "mark_reviewed" }),
    );
    expect(first.status).toBe(200);
    expect(await reviewerStatus(world.reviewer.id)).toBe("reviewed");

    const replay = await handleReviewActionPost(
      postForm(`/r/${token}`, { action: "mark_reviewed" }),
    );
    expect(replay.status).toBe(200);
    expect(await reviewerStatus(world.reviewer.id)).toBe("reviewed");
  });

  test("reviewer can change response by submitting a different action", async () => {
    const world = await seedAssignmentWorld();
    const { token } = await issueReviewActionToken({
      reviewRequestId: world.rr.id,
      assigneeUserId: world.reviewer.id,
    });

    await handleReviewActionPost(
      postForm(`/r/${token}`, { action: "mark_reviewed" }),
    );
    expect(await reviewerStatus(world.reviewer.id)).toBe("reviewed");

    const flipped = await handleReviewActionPost(
      postForm(`/r/${token}`, { action: "request_changes" }),
    );
    expect(flipped.status).toBe(200);
    expect(await reviewerStatus(world.reviewer.id)).toBe("changes_requested");
  });

  test("decline marks the assignment declined", async () => {
    const world = await seedAssignmentWorld();
    const { token } = await issueReviewActionToken({
      reviewRequestId: world.rr.id,
      assigneeUserId: world.reviewer.id,
    });
    const res = await handleReviewActionPost(
      postForm(`/r/${token}`, { action: "decline" }),
    );
    expect(res.status).toBe(200);
    expect(await reviewerStatus(world.reviewer.id)).toBe("declined");
  });

  test("expired token returns 404", async () => {
    const world = await seedAssignmentWorld();
    const { token } = await issueReviewActionToken({
      reviewRequestId: world.rr.id,
      assigneeUserId: world.reviewer.id,
      ttlMs: -1,
    });
    const res = await handleReviewActionPost(
      postForm(`/r/${token}`, { action: "mark_reviewed" }),
    );
    expect(res.status).toBe(404);
  });

  test("rejects non-form content-type by re-rendering chooser (no mutation)", async () => {
    const world = await seedAssignmentWorld();
    const { token } = await issueReviewActionToken({
      reviewRequestId: world.rr.id,
      assigneeUserId: world.reviewer.id,
    });
    const req = new Request(`http://localhost/r/${token}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "mark_reviewed" }),
    });
    const res = await handleReviewActionPost(req);
    expect(res.status).toBe(200);
    expect(await reviewerStatus(world.reviewer.id)).toBe("pending");
  });

  test("unknown action in form body re-renders chooser without mutating", async () => {
    const world = await seedAssignmentWorld();
    const { token } = await issueReviewActionToken({
      reviewRequestId: world.rr.id,
      assigneeUserId: world.reviewer.id,
    });
    const res = await handleReviewActionPost(
      postForm(`/r/${token}`, { action: "bogus" }),
    );
    expect(res.status).toBe(400);
    expect(await reviewerStatus(world.reviewer.id)).toBe("pending");
  });
});
