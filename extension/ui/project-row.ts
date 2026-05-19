import type { ProjectListEntry } from "../utils/types.ts";
import { formatRelative } from "./format-time.ts";

// Shared visual + text shape for project-list rows. Options renders DOM
// directly; the side-panel picker renders Preact JSX. A component can't be
// shared across that boundary, so we share the class strings + meta
// formatter and let each surface lay out the row in its native idiom.

export const PROJECT_LIST_CLASS = "list-none p-0 m-0 flex flex-col gap-[0.4rem]";

export const PROJECT_ROW_CONTAINER_CLASS =
  "flex items-baseline gap-3 px-[0.7rem] py-[0.55rem] border border-rule rounded bg-cream";

export const PROJECT_ROW_NAME_CLASS =
  "flex-1 min-w-0 font-medium [overflow-wrap:anywhere]";

export const PROJECT_ROW_META_CLASS =
  "text-muted font-mono text-[11px] whitespace-nowrap";

export const PROJECT_ROW_UNTITLED_LABEL = "Untitled project";

export function projectRowLabel(p: ProjectListEntry): string {
  return p.name ?? PROJECT_ROW_UNTITLED_LABEL;
}

export function formatProjectMeta(p: ProjectListEntry): string {
  const versions =
    p.versionCount === 1 ? "1 version" : `${p.versionCount} versions`;
  return `${versions} · last sync ${formatRelative(p.lastSyncedAt)}`;
}

export function sortProjectsByLastSync(
  projects: ProjectListEntry[],
): ProjectListEntry[] {
  return [...projects].sort(
    (a, b) => (b.lastSyncedAt ?? -1) - (a.lastSyncedAt ?? -1),
  );
}
