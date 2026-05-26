import * as v from "valibot";
import {
  badRequest,
  IdSchema,
  notFound,
  validatedPost,
} from "./middleware.ts";
import {
  CommentActionBadRequestError,
  CommentActionNotFoundError,
  performCommentAction,
} from "../domain/comment-action.ts";

const CommentActionBodySchema = v.object({
  canonicalCommentId: IdSchema,
  action: v.picklist([
    "accept_projection",
    "reanchor",
    "mark_resolved",
    "mark_wontfix",
    "reopen",
  ]),
  targetVersionId: v.optional(v.nullable(IdSchema)),
});

/**
 * POST /api/extension/comment-action — reconciliation actions on a single
 * canonical comment (SPEC §12 Phase 4). Body:
 *   { canonicalCommentId, action, targetVersionId? }
 *
 * `action` is one of `accept_projection`, `reanchor`, `mark_resolved`,
 * `mark_wontfix`, `reopen`. `targetVersionId` is required for the projection-
 * scoped actions (`accept_projection`, `reanchor`) and ignored for the
 * canonical-status actions.
 *
 * Owner-scoped: 404 when the comment is missing OR the caller isn't the
 * project owner — matches `version-comments`'s no-info-leak posture. Audit
 * log entries are written inside the domain layer.
 */
export function handleCommentActionPost(req: Request): Promise<Response> {
  return validatedPost(req, CommentActionBodySchema, async ({ auth, body }) => {
    try {
      return await performCommentAction({
        userId: auth.userId,
        canonicalCommentId: body.canonicalCommentId,
        action: body.action,
        targetVersionId: body.targetVersionId ?? null,
      });
    } catch (err) {
      if (err instanceof CommentActionNotFoundError) return notFound(err.message);
      if (err instanceof CommentActionBadRequestError) return badRequest(err.message);
      throw err;
    }
  });
}
