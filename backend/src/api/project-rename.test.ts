import "../../test/setup.ts";
import { beforeEach, describe, it as test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { cleanDb, seedProject, seedUser } from "../../test/db.ts";
import { issueTestSession } from "../../test/session.ts";
import { postJsonRequest } from "../../test/fetch.ts";
import { handleProjectRenamePost } from "./project-rename.ts";
import { db } from "../db/client.ts";
import { project } from "../db/schema.ts";
import { eq } from "drizzle-orm";

beforeEach(cleanDb);

const postRename = (body: unknown, opts?: { auth?: string }) =>
  postJsonRequest("/api/extension/project-rename", body, opts);

describe("handleProjectRenamePost", () => {
  test("401 without bearer", async () => {
    const res = await handleProjectRenamePost(
      postRename({ projectId: "abc", name: "x" }),
    );
    expect(res.status).toBe(401);
  });

  test("400 when name is empty after trim", async () => {
    const u = await seedUser();
    const proj = await seedProject({ ownerUserId: u.id });
    const { token } = await issueTestSession({ userId: u.id });
    const res = await handleProjectRenamePost(
      postRename({ projectId: proj.id, name: "   " }, { auth: `Bearer ${token}` }),
    );
    expect(res.status).toBe(400);
  });

  test("404 when caller isn't the owner", async () => {
    const owner = await seedUser({ email: "owner@example.com" });
    const stranger = await seedUser({ email: "b@example.com" });
    const proj = await seedProject({ ownerUserId: owner.id, name: "Original" });
    const { token } = await issueTestSession({ userId: stranger.id });
    const res = await handleProjectRenamePost(
      postRename(
        { projectId: proj.id, name: "Hacked" },
        { auth: `Bearer ${token}` },
      ),
    );
    expect(res.status).toBe(404);
    const fresh = await db
      .select()
      .from(project)
      .where(eq(project.id, proj.id))
      .limit(1);
    expect(fresh[0]!.name).toBe("Original");
  });

  test("200 + persists trimmed name for owner", async () => {
    const u = await seedUser();
    const proj = await seedProject({ ownerUserId: u.id, name: "old" });
    const { token } = await issueTestSession({ userId: u.id });
    const res = await handleProjectRenamePost(
      postRename(
        { projectId: proj.id, name: "  Fresh Name  " },
        { auth: `Bearer ${token}` },
      ),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { projectId: string; name: string };
    expect(body.name).toBe("Fresh Name");

    const fresh = await db
      .select()
      .from(project)
      .where(eq(project.id, proj.id))
      .limit(1);
    expect(fresh[0]!.name).toBe("Fresh Name");
  });
});
