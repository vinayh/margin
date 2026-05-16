import type { ProjectListEntry } from "../utils/types.ts";

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
  return `${versions} · last sync ${formatProjectLastSync(p.lastSyncedAt)}`;
}

export function formatProjectLastSync(ts: number | null): string {
  if (!ts) return "never";
  const diff = Date.now() - ts;
  if (diff < 0) return "just now";
  const sec = Math.round(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  return `${day}d ago`;
}

export function sortProjectsByLastSync(
  projects: ProjectListEntry[],
): ProjectListEntry[] {
  return [...projects].sort(
    (a, b) => (b.lastSyncedAt ?? -1) - (a.lastSyncedAt ?? -1),
  );
}
