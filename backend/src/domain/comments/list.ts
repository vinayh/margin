import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "../../db/client.ts";
import { canonicalComment } from "../../db/schema.ts";

export type CanonicalComment = typeof canonicalComment.$inferSelect;

/**
 * Project's active canonical comments — excludes rows whose upstream Drive
 * comment / suggestion has been deleted (those have `canonical_comment.deletedAt`
 * set by `ingestVersionComments`).
 */
export async function listCommentsForProject(
  projectId: string,
): Promise<CanonicalComment[]> {
  return db
    .select()
    .from(canonicalComment)
    .where(
      and(
        eq(canonicalComment.projectId, projectId),
        isNull(canonicalComment.deletedAt),
      ),
    )
    .orderBy(desc(canonicalComment.originTimestamp));
}
