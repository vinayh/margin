import * as v from "valibot";
import { badRequest, IdSchema, validatedPost } from "./middleware.ts";
import { renameOwnedProject } from "../domain/project.ts";

const MAX_NAME_LEN = 256;

const ProjectRenameBodySchema = v.object({
  projectId: IdSchema,
  name: v.pipe(v.string(), v.minLength(1), v.maxLength(MAX_NAME_LEN)),
});

/**
 * POST /api/extension/project-rename — owner-scoped rename. Body
 * `{ projectId, name }`. The new name is trimmed; an all-whitespace name is
 * a 400. 404 when nothing matched (project missing OR caller isn't the
 * owner). Does NOT propagate to Drive — `project.name` is just the display
 * label for the dashboard.
 */
export function handleProjectRenamePost(req: Request): Promise<Response> {
  return validatedPost(req, ProjectRenameBodySchema, async ({ auth, body }) => {
    if (body.name.trim().length === 0) return badRequest("name cannot be empty");
    const proj = await renameOwnedProject(body.projectId, auth.userId, body.name);
    if (!proj) return null;
    return { projectId: proj.id, name: proj.name };
  });
}
