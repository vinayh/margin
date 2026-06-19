import { useEffect, useState } from "preact/hooks";
import { Trash2 } from "lucide-preact";
import { requestOrThrow } from "../../../ui/sendMessage.ts";
import { parseEmails, validateEmails } from "../../../utils/emails.ts";
import type { ProjectSettingsView } from "../../../utils/types.ts";

interface Props {
  projectId: string;
  projectName: string | null;
  onClose: () => void;
  onDeleted: () => void;
  onRenamed?: (name: string) => void;
}

type State =
  | { kind: "loading" }
  | { kind: "loaded"; settings: ProjectSettingsView }
  | { kind: "error"; message: string };

/**
 * Side-panel "Settings" view (SPEC §12 Phase 4 — notification prefs, default
 * reviewers, Slack workspace linking). Settings live on `project.settings`
 * and are mediated by `/api/extension/settings` through the SW. Save sends
 * a `patch` shaped like the diff between the current form state and the
 * last-loaded server state; missing keys keep their stored value.
 */
export function Settings({
  projectId,
  projectName,
  onClose,
  onDeleted,
  onRenamed,
}: Props) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<ProjectSettingsView | null>(null);
  const [nameDraft, setNameDraft] = useState(projectName ?? "");
  const [renaming, setRenaming] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);
  // The reviewer-emails textarea is stored as the raw string the user typed,
  // not the parsed list — round-tripping through `parseEmails` on every
  // keystroke discards empty lines, so the user can't press Enter to start a
  // new email. Parsing happens once at save time.
  const [reviewerEmailsRaw, setReviewerEmailsRaw] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const r = await requestOrThrow({ kind: "settings/load", projectId });
        if (cancelled) return;
        if (!r.settings) {
          setState({ kind: "error", message: "settings unavailable" });
          return;
        }
        setState({ kind: "loaded", settings: r.settings });
        setForm(r.settings);
        setReviewerEmailsRaw(r.settings.defaultReviewerEmails.join("\n"));
      } catch (err) {
        if (cancelled) return;
        setState({
          kind: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  async function onRename(): Promise<void> {
    const trimmed = nameDraft.trim();
    if (trimmed.length === 0) {
      setRenameError("Name cannot be empty.");
      return;
    }
    if (trimmed === (projectName ?? "")) return;
    setRenameError(null);
    setRenaming(true);
    try {
      const r = await requestOrThrow({
        kind: "project/rename",
        projectId,
        name: trimmed,
      });
      if (!r.project) throw new Error("rename failed");
      onRenamed?.(r.project.name);
    } catch (err) {
      setRenameError(err instanceof Error ? err.message : String(err));
    } finally {
      setRenaming(false);
    }
  }

  async function onDelete(): Promise<void> {
    const label = projectName ?? "this project";
    if (!globalThis.confirm(`Delete "${label}"? This cannot be undone.`)) {
      return;
    }
    setError(null);
    setDeleting(true);
    try {
      const r = await requestOrThrow({ kind: "project/delete", projectId });
      if (!r.deleted) throw new Error("delete failed");
      onDeleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setDeleting(false);
    }
  }

  async function onSave(): Promise<void> {
    if (state.kind !== "loaded" || !form) return;
    setError(null);
    const { valid, invalid } = validateEmails(reviewerEmailsRaw);
    if (invalid.length > 0) {
      setError(
        `Invalid email${invalid.length > 1 ? "s" : ""}: ${invalid.join(", ")}`,
      );
      return;
    }
    setSaving(true);
    try {
      const next: ProjectSettingsView = {
        ...form,
        defaultReviewerEmails: valid,
      };
      const patch = diffSettings(state.settings, next);
      if (Object.keys(patch).length === 0) {
        setSaving(false);
        return;
      }
      const r = await requestOrThrow({
        kind: "settings/update",
        projectId,
        patch,
      });
      if (!r.settings) throw new Error("no settings returned");
      setState({ kind: "loaded", settings: r.settings });
      setForm(r.settings);
      setReviewerEmailsRaw(r.settings.defaultReviewerEmails.join("\n"));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  if (state.kind === "loading") {
    return (
      <section class="settings-view">
        <SettingsHeader onClose={onClose} />
        <div class="settings-form">
          <span class="skeleton skeleton-line" />
          <span class="skeleton skeleton-line" />
          <span class="skeleton skeleton-line skeleton-line-short" />
        </div>
      </section>
    );
  }
  if (state.kind === "error") {
    return (
      <section class="settings-view">
        <SettingsHeader onClose={onClose} />
        <p class="muted error">{state.message}</p>
      </section>
    );
  }
  if (!form) return null;

  const formWithParsedEmails: ProjectSettingsView = {
    ...form,
    defaultReviewerEmails: parseEmails(reviewerEmailsRaw),
  };
  const dirty =
    Object.keys(diffSettings(state.settings, formWithParsedEmails)).length > 0;

  return (
    <section class="settings-view">
      <SettingsHeader onClose={onClose} />
      <div class="settings-form">
        <div class="settings-field">
          <label for="projectName">Project name</label>
          <div class="settings-inline-row">
            <input
              id="projectName"
              type="text"
              value={nameDraft}
              onInput={(ev) =>
                setNameDraft((ev.currentTarget as HTMLInputElement).value)}
              disabled={renaming}
            />
            <button
              type="button"
              disabled={renaming ||
                nameDraft.trim().length === 0 ||
                nameDraft.trim() === (projectName ?? "")}
              onClick={() => void onRename()}
            >
              {renaming ? "Saving…" : "Rename"}
            </button>
          </div>
          <small>
            Displayed in the side panel header. Doesn't rename the Google Doc.
          </small>
          {renameError ? <p class="muted error">{renameError}</p> : null}
        </div>

        <label class="settings-toggle">
          <input
            type="checkbox"
            name="notifyOnComment"
            checked={form.notifyOnComment}
            onChange={(ev) =>
              setForm({
                ...form,
                notifyOnComment: (ev.currentTarget as HTMLInputElement).checked,
              })}
          />
          Notify me when a new comment arrives
        </label>
        <label class="settings-toggle">
          <input
            type="checkbox"
            name="notifyOnReviewComplete"
            checked={form.notifyOnReviewComplete}
            onChange={(ev) =>
              setForm({
                ...form,
                notifyOnReviewComplete:
                  (ev.currentTarget as HTMLInputElement).checked,
              })}
          />
          Notify me when a review request finishes
        </label>

        <div class="settings-field">
          <label for="defaultReviewerEmails">Default reviewer emails</label>
          <textarea
            id="defaultReviewerEmails"
            value={reviewerEmailsRaw}
            onInput={(ev) =>
              setReviewerEmailsRaw(
                (ev.currentTarget as HTMLTextAreaElement).value,
              )}
          />
          <small>One email per line. Pre-fills new review requests.</small>
        </div>

        <div class="settings-field">
          <label for="slackWorkspaceRef">Slack workspace</label>
          <input
            id="slackWorkspaceRef"
            type="text"
            placeholder="team-id (Phase 5 will populate this automatically)"
            value={form.slackWorkspaceRef ?? ""}
            onInput={(ev) =>
              setForm({
                ...form,
                slackWorkspaceRef:
                  ((ev.currentTarget as HTMLInputElement).value || "").trim() ||
                  null,
              })}
          />
          <small>
            Links this project to a Slack workspace. Margin's Slack bot ships in
            Phase 5; for now this is a free-form identifier.
          </small>
        </div>

        {error ? <p class="muted error">{error}</p> : null}

        <div class="settings-actions">
          <button
            type="button"
            class="primary"
            disabled={saving || !dirty}
            onClick={() => void onSave()}
          >
            {saving ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            disabled={saving || !dirty}
            onClick={() => {
              setForm(state.settings);
              setReviewerEmailsRaw(
                state.settings.defaultReviewerEmails.join("\n"),
              );
            }}
          >
            Reset
          </button>
        </div>
      </div>

      <div class="danger-zone">
        <p class="muted text-[12px]">
          Removes the project from Margin (versions, comments, review requests).
          Your Google Doc isn't touched.
        </p>
        <button
          type="button"
          class="danger"
          disabled={deleting}
          onClick={() => void onDelete()}
        >
          <Trash2 /> {deleting ? "Deleting…" : "Delete project"}
        </button>
      </div>
    </section>
  );
}

function SettingsHeader({ onClose }: { onClose: () => void }) {
  return (
    <div class="settings-header">
      <p class="title">Settings</p>
      <button type="button" onClick={onClose}>
        Close
      </button>
    </div>
  );
}

function diffSettings(
  base: ProjectSettingsView,
  next: ProjectSettingsView,
): Partial<ProjectSettingsView> {
  const out: Partial<ProjectSettingsView> = {};
  if (base.notifyOnComment !== next.notifyOnComment) {
    out.notifyOnComment = next.notifyOnComment;
  }
  if (base.notifyOnReviewComplete !== next.notifyOnReviewComplete) {
    out.notifyOnReviewComplete = next.notifyOnReviewComplete;
  }
  if (!sameStrings(base.defaultReviewerEmails, next.defaultReviewerEmails)) {
    out.defaultReviewerEmails = next.defaultReviewerEmails;
  }
  if ((base.slackWorkspaceRef ?? null) !== (next.slackWorkspaceRef ?? null)) {
    out.slackWorkspaceRef = next.slackWorkspaceRef;
  }
  if ((base.defaultOverlayId ?? null) !== (next.defaultOverlayId ?? null)) {
    out.defaultOverlayId = next.defaultOverlayId;
  }
  return out;
}

function sameStrings(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
