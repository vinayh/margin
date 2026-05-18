import { beforeEach, describe, expect, test } from "bun:test";
import {
  cleanDb,
  seedCanonicalComment,
  seedCommentProjection,
  seedProject,
  seedUser,
  seedVersion,
} from "../../test/db.ts";
import { issueTestSession } from "../../test/session.ts";
import { postJsonRequest } from "../../test/fetch.ts";
import { handleCommentActionBatchPost } from "./comment-action-batch.ts";
import { db } from "../db/client.ts";
import { canonicalComment } from "../db/schema.ts";
import { eq } from "drizzle-orm";

beforeEach(cleanDb);

const post = (body: unknown, opts?: { auth?: string }) =>
  postJsonRequest("/api/extension/comment-action/batch", body, opts);

async function seedTwoComments() {
  const owner = await seedUser({ email: "owner@example.com" });
  const proj = await seedProject({ ownerUserId: owner.id });
  const ver = await seedVersion({
    projectId: proj.id,
    createdByUserId: owner.id,
  });
  const cc1 = await seedCanonicalComment({
    projectId: proj.id,
    originVersionId: ver.id,
    anchor: { quotedText: "one", structuralPosition: { paragraphIndex: 0, offset: 0 } },
  });
  const cc2 = await seedCanonicalComment({
    projectId: proj.id,
    originVersionId: ver.id,
    anchor: { quotedText: "two", structuralPosition: { paragraphIndex: 1, offset: 0 } },
  });
  await seedCommentProjection({
    canonicalCommentId: cc1.id,
    versionId: ver.id,
    projectionStatus: "clean",
    anchorMatchConfidence: 100,
  });
  await seedCommentProjection({
    canonicalCommentId: cc2.id,
    versionId: ver.id,
    projectionStatus: "clean",
    anchorMatchConfidence: 100,
  });
  const { token } = await issueTestSession({ userId: owner.id });
  return { owner, proj, ver, cc1, cc2, token };
}

describe("handleCommentActionBatchPost", () => {
  test("401 without bearer", async () => {
    const res = await handleCommentActionBatchPost(
      post({ actions: [{ canonicalCommentId: "x", action: "reopen" }] }),
    );
    expect(res.status).toBe(401);
  });

  test("400 on empty array", async () => {
    const u = await seedUser();
    const { token } = await issueTestSession({ userId: u.id });
    const res = await handleCommentActionBatchPost(
      post({ actions: [] }, { auth: `Bearer ${token}` }),
    );
    expect(res.status).toBe(400);
  });

  test("400 on bad action shape", async () => {
    const u = await seedUser();
    const { token } = await issueTestSession({ userId: u.id });
    const res = await handleCommentActionBatchPost(
      post(
        { actions: [{ canonicalCommentId: "x", action: "nope" }] },
        { auth: `Bearer ${token}` },
      ),
    );
    expect(res.status).toBe(400);
  });

  test("applies multiple resolves and returns per-item results", async () => {
    const { cc1, cc2, token } = await seedTwoComments();
    const res = await handleCommentActionBatchPost(
      post(
        {
          actions: [
            { canonicalCommentId: cc1.id, action: "mark_resolved" },
            { canonicalCommentId: cc2.id, action: "mark_wontfix" },
          ],
        },
        { auth: `Bearer ${token}` },
      ),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { results: { ok: boolean; result?: { status: string } }[] };
    expect(body.results).toHaveLength(2);
    expect(body.results[0]!.ok).toBe(true);
    expect(body.results[0]!.result!.status).toBe("addressed");
    expect(body.results[1]!.ok).toBe(true);
    expect(body.results[1]!.result!.status).toBe("wontfix");

    const fresh1 = await db
      .select()
      .from(canonicalComment)
      .where(eq(canonicalComment.id, cc1.id))
      .limit(1);
    expect(fresh1[0]!.status).toBe("addressed");
  });

  test("one item failing doesn't abort the batch", async () => {
    const { cc1, token } = await seedTwoComments();
    const res = await handleCommentActionBatchPost(
      post(
        {
          actions: [
            // accept_projection requires targetVersionId → bad_request
            { canonicalCommentId: cc1.id, action: "accept_projection" },
            { canonicalCommentId: cc1.id, action: "mark_resolved" },
          ],
        },
        { auth: `Bearer ${token}` },
      ),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      results: { ok: boolean; error?: { code: string } }[];
    };
    expect(body.results[0]!.ok).toBe(false);
    expect(body.results[0]!.error!.code).toBe("bad_request");
    expect(body.results[1]!.ok).toBe(true);
  });
});
