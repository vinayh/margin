import { browser } from "wxt/browser";
import type { ActiveDocTab, TrackedState } from "../Popup.tsx";
import {
  openDashboard,
  shouldUseNativeSidebar,
} from "../../../utils/ui-surfaces.ts";
import { formatRelative } from "../../../ui/format-time.ts";

interface Props {
  tab: ActiveDocTab;
  state: TrackedState;
  onSync: () => void;
}

export function Tracked({ tab, state, onSync }: Props) {
  // state.title is the canonical Drive name; tab.title is the locale-stripped
  // fallback for rows that pre-date the name column.
  const heading = state.title || tab.title || "Google Doc";
  const versionLabel = state.version?.label ?? "no versions yet";
  const role = state.role === "parent" ? "Parent" : `Version ${versionLabel}`;
  const ownerLine = state.project.ownerEmail ?? "owner unknown";

  return (
    <>
      <p class="title" title={heading}>
        {heading}
      </p>
      <p class="subtitle">
        {role} · {ownerLine}
      </p>
      <div class="stats">
        <Stat label="Comments" value={String(state.commentCount)} />
        <Stat label="Open reviews" value={String(state.openReviewCount)} />
        <Stat label="Version" value={versionLabel} />
        <Stat label="Last synced" value={formatRelative(state.lastSyncedAt)} />
      </div>
      <div class="actions">
        <button id="sync" type="button" onClick={onSync}>
          Sync now
        </button>
        <button type="button" onClick={() => void openDashboardFromPopup()}>
          Open dashboard
        </button>
      </div>
    </>
  );
}

/**
 * Open the dashboard from the popup's project view. Real Chrome and Firefox
 * get the native sidebar; everything else (Edge, Brave, Opera, Arc, the rest
 * of the long Chromium-derivative tail) gets a detached popup window. The
 * sidebar API call must run inside the user gesture, but the popup stays
 * open across the awaits below so Chrome's gesture chain survives.
 */
async function openDashboardFromPopup(): Promise<void> {
  const useNativeSidebar = await shouldUseNativeSidebar();
  const win = await browser.windows.getCurrent();
  await openDashboard({
    useNativeSidebar,
    windowId: win.id,
  });
  window.close();
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p class="stat-label">{label}</p>
      <p class="stat-value">{value}</p>
    </div>
  );
}

