import * as v from "valibot";
import { badRequest, UuidSchema, validatedPost } from "./middleware.ts";
import { getVersionDiffPayload } from "../domain/version-diff.ts";

const VersionDiffBodySchema = v.object({
  fromVersionId: UuidSchema,
  toVersionId: UuidSchema,
});

/**
 * POST /api/extension/version-diff — structured side-by-side diff payload
 * for two versions of the same project. Body:
 * `{ fromVersionId, toVersionId }`. Returns the summarized paragraphs for
 * both sides; the side-panel runs the actual diff render client-side
 * used by the side-panel structured diff.
 *
 * Owner-scoped on both versions, and refuses cross-project diffs — both
 * conditions collapse to 404 so the caller can't probe for the existence
 * of versions they shouldn't see.
 */
export function handleVersionDiffPost(req: Request): Promise<Response> {
  return validatedPost(req, VersionDiffBodySchema, ({ auth, body }) => {
    if (body.fromVersionId === body.toVersionId) {
      return Promise.resolve(badRequest("fromVersionId and toVersionId must differ"));
    }
    return getVersionDiffPayload({
      fromVersionId: body.fromVersionId,
      toVersionId: body.toVersionId,
      userId: auth.userId,
    });
  });
}
