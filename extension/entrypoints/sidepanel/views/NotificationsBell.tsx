import { useEffect, useRef, useState } from "preact/hooks";
import { Bell, BellRing, Check } from "lucide-preact";
import { sendMessage } from "../../../ui/sendMessage.ts";
import { formatRelative } from "../../../ui/format-time.ts";
import type { NotificationView } from "../../../utils/messages.ts";

type State =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "loaded"; items: NotificationView[]; unread: number }
  | { kind: "error"; message: string };

/**
 * Side-panel header bell. Polls the SW on open + on a 60s interval while
 * mounted. Click toggles a dropdown. Clicking an item navigates to that
 * notification's project; "Mark all read" drains the inbox.
 *
 * The dropdown is rendered inline (not portaled) — the side panel is
 * single-pane so z-index conflicts don't arise.
 */
export function NotificationsBell({
  onOpenProject,
}: {
  onOpenProject?: (projectId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<State>({ kind: "idle" });
  const containerRef = useRef<HTMLDivElement>(null);

  async function reload(): Promise<void> {
    setState({ kind: "loading" });
    try {
      const r = await sendMessage({ kind: "notifications/list" });
      if (r?.kind !== "notifications/list") {
        throw new Error("unexpected response");
      }
      if (r.error) throw new Error(r.error);
      setState({ kind: "loaded", items: r.items, unread: r.unread });
    } catch (err) {
      setState({
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  useEffect(() => {
    void reload();
    const id = setInterval(() => void reload(), 60_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!open) return;
    const handler = (ev: MouseEvent) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(ev.target as Node)) setOpen(false);
    };
    globalThis.addEventListener("click", handler);
    return () => globalThis.removeEventListener("click", handler);
  }, [open]);

  async function markAllRead(): Promise<void> {
    await sendMessage({ kind: "notifications/mark-read", all: true });
    await reload();
  }

  async function clickItem(item: NotificationView): Promise<void> {
    if (item.readAt === null) {
      await sendMessage({
        kind: "notifications/mark-read",
        ids: [item.id],
      });
    }
    setOpen(false);
    if (item.payload.projectId) onOpenProject?.(item.payload.projectId);
    await reload();
  }

  const unread = state.kind === "loaded" ? state.unread : 0;

  return (
    <div class="notifications-bell" ref={containerRef}>
      <button
        type="button"
        class="icon-button notifications-toggle"
        aria-label={unread > 0
          ? `Notifications (${unread} unread)`
          : "Notifications"}
        title="Notifications"
        onClick={(ev) => {
          ev.stopPropagation();
          setOpen((v) => !v);
          if (!open) void reload();
        }}
      >
        {unread > 0 ? <BellRing /> : <Bell />}
        {unread > 0
          ? (
            <span class="notifications-badge">
              {unread > 99 ? "99+" : unread}
            </span>
          )
          : null}
      </button>
      {open
        ? (
          <div class="notifications-pop">
            <div class="notifications-pop-head">
              <p class="title">Notifications</p>
              {unread > 0
                ? (
                  <button
                    type="button"
                    class="text-only"
                    onClick={() => void markAllRead()}
                  >
                    <Check size={12} /> Mark all read
                  </button>
                )
                : null}
            </div>
            {state.kind === "loading" ? <p class="muted">Loading…</p> : null}
            {state.kind === "error"
              ? <p class="muted error">{state.message}</p>
              : null}
            {state.kind === "loaded" && state.items.length === 0
              ? <p class="muted">You're all caught up.</p>
              : null}
            {state.kind === "loaded" && state.items.length > 0
              ? (
                <ul class="notifications-list">
                  {state.items.map((item) => (
                    <li
                      key={item.id}
                      class={item.readAt ? undefined : "is-unread"}
                    >
                      <button
                        type="button"
                        class="notification-item"
                        onClick={() => void clickItem(item)}
                      >
                        <span class="notification-body">
                          {renderBody(item)}
                        </span>
                        <span class="notification-meta">
                          {formatRelative(item.createdAt)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )
              : null}
          </div>
        )
        : null}
    </div>
  );
}

function renderBody(n: NotificationView): string {
  const reviewer = n.payload.reviewerEmail ?? "A reviewer";
  const project = n.payload.projectName ?? "your project";
  switch (n.kind) {
    case "review_completed":
      return `${reviewer} reviewed ${project}.`;
    case "review_changes_requested":
      return `${reviewer} requested changes on ${project}.`;
    case "review_declined":
      return `${reviewer} declined to review ${project}.`;
    case "review_assigned":
      return `New review request on ${project}.`;
  }
}
