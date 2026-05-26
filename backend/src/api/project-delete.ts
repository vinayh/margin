import * as v from "valibot";
import { IdSchema, validatedPost } from "./middleware.ts";
import { deleteOwnedProject } from "../domain/project.ts";

const ProjectDeleteBodySchema = v.object({
  projectId: IdSchema,
});

/**
 * POST /api/extension/project-delete — owner-scoped project removal. Body
 * `{ projectId }`. 200 on success with `{ deleted: true }`; 404 when nothing
 * matched (project missing OR caller isn't the owner — same posture as
 * `project-detail`'s read path).
 *
 * Drive itself isn't touched: this removes the local Margin record only,
 * leaving the user's Google Doc untouched. Reviewer share-grants Margin
 * issued via Drive remain; that's intentional for now, since rewinding them
 * needs a Drive permissions sweep that hasn't been built yet.
 */
export function handleProjectDeletePost(req: Request): Promise<Response> {
  return validatedPost(req, ProjectDeleteBodySchema, async ({ auth, body }) => {
    const deleted = await deleteOwnedProject(body.projectId, auth.userId);
    if (!deleted) return null;
    return { deleted: true };
  });
}
