import * as v from "valibot";
import {
  authenticateBearer,
  IdSchema,
  jsonOk,
  readAndParseJson,
  unauthorized,
} from "./middleware.ts";
import {
  CommentActionBadRequestError,
  CommentActionNotFoundError,
  type CommentActionResult,
  performCommentAction,
} from "../domain/comment-action.ts";

const MAX_BATCH_SIZE = 64;
const MAX_BODY_BYTES = MAX_BATCH_SIZE * 256;

const BatchItemSchema = v.object({
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
export async function handleCommentActionBatchPost(req: Request): Promise<Response> {
  const auth = await authenticateBearer(req);
  if (!auth) return unauthorized();

  const parsed = await readAndParseJson(req, MAX_BODY_BYTES, BatchBodySchema);
  if (parsed instanceof Response) return parsed;

  const results: BatchItemResult[] = [];
  for (let i = 0; i < parsed.actions.length; i++) {
    const item = parsed.actions[i]!;
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
        results.push({
          index: i,
          ok: false,
          error: {
            code: "internal",
            message: err instanceof Error ? err.message : String(err),
          },
        });
      }
    }
  }

  return jsonOk({ results });
}
