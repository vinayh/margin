import * as v from "valibot";
import { UuidSchema, validatedPost } from "./middleware.ts";
import { getOwnedProject } from "../domain/project.ts";
import { createVersion } from "../domain/version.ts";

const MAX_LABEL_LEN = 64;

const VersionCreateBodySchema = v.object({
  projectId: UuidSchema,
  label: v.optional(
    v.pipe(v.string(), v.minLength(1), v.maxLength(MAX_LABEL_LEN)),
  ),
});

/**
 * POST /api/extension/version/create — snapshot a new version of the parent
 * doc. Body: `{ projectId, label? }`. Owner-scoped: 404 when the project is
 * missing or not owned by the caller (same no-info-leak posture as project-
 * detail). Returns the inserted row's id + label so the panel can refresh
 * without a second round-trip.
 */
export function handleVersionCreatePost(req: Request): Promise<Response> {
  return validatedPost(req, VersionCreateBodySchema, async ({ auth, body }) => {
    const proj = await getOwnedProject(body.projectId, auth.userId);
    if (!proj) return null;
    const ver = await createVersion({
      projectId: proj.id,
      createdByUserId: auth.userId,
      label: body.label,
    });
    return { versionId: ver.id, label: ver.label, googleDocId: ver.googleDocId };
  });
}
