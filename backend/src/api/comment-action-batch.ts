import * as v from "valibot";
import { UuidSchema, validatedPost } from "./middleware.ts";
import {
  CommentActionBadRequestError,
  CommentActionNotFoundError,
  type CommentActionResult,
  performCommentAction,
} from "../domain/comment-action.ts";

const MAX_BATCH_SIZE = 64;
const MAX_BODY_BYTES = MAX_BATCH_SIZE * 256;

const BatchItemSchema = v.object({
  canonicalCommentId: UuidSchema,
  action: v.picklist([
    "accept_projection",
    "reanchor",
    "mark_resolved",
    "mark_wontfix",
    "reopen",
  ]),
  targetVersionId: v.optional(v.nullable(UuidSchema)),
});

const BatchBodySchema = v.object({
  actions: v.pipe(
    v.array(BatchItemSchema),
    v.minLength(1),
    v.maxLength(MAX_BATCH_SIZE),
  ),
});

export interface BatchItemResult {
  index: number;
  ok: boolean;
  result?: CommentActionResult;
  error?: { code: "not_found" | "bad_request" | "internal"; message: string };
}

/**
 * POST /api/extension/comment-action/batch — run several reconciliation
 * actions in one round-trip. Items are executed sequentially; a failure on
 * one item is recorded in `results[i].error` but doesn't abort the batch,
 * so callers can resolve 15 comments with a single request and surface
 * per-item failures inline.
 */
export function handleCommentActionBatchPost(req: Request): Promise<Response> {
  return validatedPost(
    req,
    BatchBodySchema,
    async ({ auth, body }) => {
      const results: BatchItemResult[] = [];
      for (let i = 0; i < body.actions.length; i++) {
        const item = body.actions[i]!;
        try {
          const result = await performCommentAction({
            userId: auth.userId,
            canonicalCommentId: item.canonicalCommentId,
            action: item.action,
            targetVersionId: item.targetVersionId ?? null,
          });
          results.push({ index: i, ok: true, result });
        } catch (err) {
          if (err instanceof CommentActionNotFoundError) {
            results.push({
              index: i,
              ok: false,
              error: { code: "not_found", message: err.message },
            });
          } else if (err instanceof CommentActionBadRequestError) {
            results.push({
              index: i,
              ok: false,
              error: { code: "bad_request", message: err.message },
            });
          } else {
            // Static message — driver errors leak SQL / OAuth diagnostics
            // (see middleware.internalError for the same policy).
            console.error(`[comment-action/batch] item ${i} failed:`, err);
            results.push({
              index: i,
              ok: false,
              error: { code: "internal", message: "internal error" },
            });
          }
        }
      }
      return { results };
    },
    { maxBytes: MAX_BODY_BYTES },
  );
}
