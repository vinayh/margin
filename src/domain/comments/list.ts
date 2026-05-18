import { and, desc, eq, isNotNull, isNull } from "drizzle-orm";
import { db } from "../../db/client.ts";
import { canonicalComment } from "../../db/schema.ts";

export type CanonicalComment = typeof canonicalComment.$inferSelect;

/**
 * Project's active canonical comments — excludes rows whose upstream Drive
 * comment / suggestion has been deleted (those have `canonical_comment.deletedAt`
 * set by `ingestVersionComments`). Use `listDeletedCommentsForProject` to
 * surface the historical / soft-deleted rows for audit views.
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

export async function listDeletedCommentsForProject(
  projectId: string,
): Promise<CanonicalComment[]> {
  return db
    .select()
    .from(canonicalComment)
    .where(
      and(
        eq(canonicalComment.projectId, projectId),
        isNotNull(canonicalComment.deletedAt),
      ),
    )
    .orderBy(desc(canonicalComment.originTimestamp));
}
