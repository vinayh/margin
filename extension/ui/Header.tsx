import type { ComponentChildren } from "preact";
import { openOptions } from "../utils/ui-surfaces.ts";

/**
 * Title bar shared by the popup and the side panel. Same shape, same
 * "Options" button — pulled out when the side-panel landed (Phase 4) so
 * both surfaces stay in sync. When `email` is provided, the signed-in
 * user's identity sits between the brand and the Options button. The
 * optional `slot` lets surface code drop in a side-panel-only widget
 * (e.g. the in-app notifications bell) without forking the component.
 */
export function Header({
  email,
  slot,
}: {
  email?: string | null;
  slot?: ComponentChildren;
}) {
  return (
    <header>
      <strong>Margin</strong>
      {email ? <span class="muted header-email">{email}</span> : null}
      {slot}
      <button type="button" onClick={() => void openOptions()}>
        Options
      </button>
    </header>
  );
}
