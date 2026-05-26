import { validatedPost } from "./middleware.ts";
import { DocIdBodySchema } from "./doc-state.ts";
import { getDocState } from "../domain/doc-state.ts";
import { ingestVersionComments } from "../domain/comments.ts";

/**
 * POST /api/extension/doc-sync — popup "Sync now" handler. Body: `{ docId }`.
 * Looks up the user's project for that doc, ingests comments for the relevant
 * version (the one tied to the open doc, or the latest active version when
 * the user is viewing the parent), then returns refreshed state.
 *
 * Returns 200 with `{ tracked: false }` when the doc isn't a known project —
 * the popup uses that to render the onboarding affordance instead of an
 * error. 500 only on infrastructure failures (Drive API down, credentials
 * missing); idempotent so the popup can retry safely.
 */
export function handleDocSyncPost(req: Request): Promise<Response> {
  return validatedPost(req, DocIdBodySchema, async ({ auth, body }) => {
    const before = await getDocState({ docId: body.docId, userId: auth.userId });
    if (!before.tracked || !before.version) return before;

    // Domain errors here (Drive 5xx, missing credentials) propagate to
    // `corsRoute`'s wrapper, which renders them as a structured 500. Re-fetch
    // state after a successful ingest so the popup reflects updated counts
    // and lastSyncedAt without a second round-trip.
    await ingestVersionComments(before.version.id);
    return getDocState({ docId: body.docId, userId: auth.userId });
  });
}
