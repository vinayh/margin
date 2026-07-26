import * as v from "valibot";
import { IdSchema, validatedPost } from "./middleware.ts";
import { getDocState } from "../domain/doc-state.ts";

export const DocIdBodySchema = v.object({
  docId: IdSchema,
});

/**
 * POST /api/extension/doc-state — drives the popup's "is this doc tracked?"
 * UI. Body: `{ docId }`. Response is the discriminated `DocStateResponse`
 * union (see `src/domain/doc-state.ts`); the popup branches on `tracked`.
 *
 * POST instead of GET because the doc id is mildly sensitive — keeping it
 * out of the URL means it doesn't end up in proxy / browser history. Also
 * keeps the route table consistent with the rest of `/api/extension/*`,
 * which is all POST.
 */
export function handleDocStatePost(req: Request): Promise<Response> {
  return validatedPost(
    req,
    DocIdBodySchema,
    ({ auth, body }) => getDocState({ docId: body.docId, userId: auth.userId }),
  );
}
