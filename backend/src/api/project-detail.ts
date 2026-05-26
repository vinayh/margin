import * as v from "valibot";
import { IdSchema, validatedPost } from "./middleware.ts";
import { getProjectDetail } from "../domain/project-detail.ts";

const ProjectDetailBodySchema = v.object({
  projectId: IdSchema,
});

/**
 * POST /api/extension/project — dashboard payload for one project.
 *
 * Body: `{ projectId }`. Returns the composed `ProjectDetail` view (project
 * header, versions with per-version comment count + last-synced, derivatives,
 * open review requests).
 *
 * Owner-scoped: returns 404 when the project doesn't exist OR the caller
 * isn't the owner — matching `doc-state`'s no-info-leak posture. The 404
 * answer is "from your perspective there is no such project," not "this
 * project exists but you can't see it."
 *
 * POST instead of GET to keep the route table consistent with the rest of
 * `/api/extension/*` (and to keep the project id out of URLs / proxy logs).
 */
export function handleProjectDetailPost(req: Request): Promise<Response> {
  return validatedPost(req, ProjectDetailBodySchema, ({ auth, body }) =>
    getProjectDetail({ projectId: body.projectId, userId: auth.userId }));
}
