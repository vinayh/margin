import * as v from "valibot";
import { badRequest, notFound, UuidSchema, validatedPost } from "./middleware.ts";
import { checkRateLimit } from "./rate-limit.ts";
import {
  createReviewRequest,
  ReviewRequestBadRequestError,
  ReviewRequestNotFoundError,
} from "../domain/review.ts";

const MAX_BODY_BYTES = 16 * 1024;
// Matches src/domain/settings.ts and extension/utils/messages.ts —
// the default-reviewers field feeds review requests, so the ceiling has to
// be the same on all three layers.
const MAX_EMAILS = 64;
const MAX_EMAIL_LEN = 254;

// Each request fans out one Drive share + one email per assignee (up to
// MAX_EMAILS) and materializes a user row per address. The generic 120/min
// limiter is far too loose for that amplification (120 × 64 ≈ 7.7k emails/min),
// so review requests get a dedicated, much tighter per-user cap.
const REVIEW_REQUEST_LIMIT_PER_MIN = 10;

const ReviewRequestBodySchema = v.object({
  versionId: UuidSchema,
  assigneeEmails: v.pipe(
    v.array(v.pipe(v.string(), v.email(), v.maxLength(MAX_EMAIL_LEN))),
    v.minLength(1, "at least one assignee required"),
    v.maxLength(MAX_EMAILS),
  ),
  deadline: v.optional(v.union([v.null(), v.pipe(v.number(), v.integer())])),
});

/**
 * POST /api/extension/review/request — create a review request for a version
 * and mint magic-link tokens. Body:
 *   { versionId, assigneeEmails: string[], deadline?: number | null }
 *
 * Owner-scoped via `loadOwnedVersion`: 404 when the version doesn't exist or
 * the caller isn't the project owner.
 *
 * Redeemable action URLs are sent only through the email transport. The
 * requester-facing response contains per-assignee share and delivery status,
 * never the bearer capabilities themselves.
 */
export function handleReviewRequestPost(req: Request): Promise<Response> {
  return validatedPost(
    req,
    ReviewRequestBodySchema,
    async ({ auth, body }) => {
      const gate = checkRateLimit(
        `review-request:u:${auth.userId}`,
        REVIEW_REQUEST_LIMIT_PER_MIN,
      );
      if (!gate.allowed) {
        return new Response(
          JSON.stringify({ error: "rate_limited", scope: "review_request" }),
          {
            status: 429,
            headers: {
              "content-type": "application/json",
              "retry-after": String(gate.resetSeconds),
              "x-margin-rate-limit-remaining": "0",
            },
          },
        );
      }
      try {
        return await createReviewRequest({
          versionId: body.versionId,
          ownerUserId: auth.userId,
          assigneeEmails: body.assigneeEmails,
          // `!= null` (not truthy): the schema admits deadline=0, which is a
          // valid (if unusual) timestamp — truthy-check would silently drop it.
          deadline: body.deadline != null ? new Date(body.deadline) : null,
        });
      } catch (err) {
        if (err instanceof ReviewRequestNotFoundError) return notFound(err.message);
        if (err instanceof ReviewRequestBadRequestError) return badRequest(err.message);
        throw err;
      }
    },
    { maxBytes: MAX_BODY_BYTES },
  );
}
