import * as v from "valibot";
import {
  authenticateBearer,
  badRequest,
  IdSchema,
  jsonOk,
  notFound,
  readAndParseJson,
  unauthorized,
} from "./middleware.ts";
import { renameOwnedProject } from "../domain/project.ts";

const MAX_BODY_BYTES = 4 * 1024;
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
export async function handleProjectRenamePost(req: Request): Promise<Response> {
  const auth = await authenticateBearer(req);
  if (!auth) return unauthorized();

  const parsed = await readAndParseJson(req, MAX_BODY_BYTES, ProjectRenameBodySchema);
  if (parsed instanceof Response) return parsed;

  if (parsed.name.trim().length === 0) {
    return badRequest("name cannot be empty");
  }

  const proj = await renameOwnedProject(parsed.projectId, auth.userId, parsed.name);
  if (!proj) return notFound();
  return jsonOk({ projectId: proj.id, name: proj.name });
}
