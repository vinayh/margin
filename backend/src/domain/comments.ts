/**
 * Public surface for the comment-ingest pipeline. Internals live in the
 * `comments/` subfolder — split out of a single 575-line module along the
 * natural seams: Drive author/reply index, suggestion ingest, comment
 * ingest, canonical upsert.
 */
export { ingestVersionComments } from "./comments/ingest.ts";
export {
  listCommentsForProject,
  listDeletedCommentsForProject,
  type CanonicalComment,
} from "./comments/list.ts";
export type { IngestResult } from "./comments/types.ts";
