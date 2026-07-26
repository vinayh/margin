import * as v from "valibot";
import { UuidSchema, validatedPost } from "./middleware.ts";
import { getVersionCommentsPayload } from "../domain/version-comments.ts";

const VersionCommentsBodySchema = v.object({
  versionId: UuidSchema,
});

/**
 * POST /api/extension/version-comments — canonical comments + their
 * projection state onto a single version for the comment-
 * reconciliation slice). Body: `{ versionId }`. Returns one entry per
 * `comment_projection` row for this version, joined with the canonical
 * comment metadata + origin-version label so the side panel can render
 * "(from v1)" attribution and surface fuzzy / orphan rows for action.
 *
 * Owner-scoped: 404 when the version doesn't exist OR the caller isn't
 * the project owner — matching `version-diff`'s no-info-leak posture.
 */
export function handleVersionCommentsPost(req: Request): Promise<Response> {
  return validatedPost(
    req,
    VersionCommentsBodySchema,
    ({ auth, body }) =>
      getVersionCommentsPayload({ versionId: body.versionId, userId: auth.userId }),
  );
}
