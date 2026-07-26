import { useState } from "preact/hooks";
import { Trash2 } from "lucide-preact";
import { requestOrThrow } from "../../../ui/sendMessage.ts";

interface Props {
  projectId: string;
  projectName: string | null;
  onClose: () => void;
  onDeleted: () => void;
  onRenamed?: (name: string) => void;
}

/** Project controls whose behavior is implemented today. */
export function Settings({
  projectId,
  projectName,
  onClose,
  onDeleted,
  onRenamed,
}: Props) {
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState(projectName ?? "");
  const [renaming, setRenaming] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);

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
    setDeleteError(null);
    setDeleting(true);
    try {
      const r = await requestOrThrow({ kind: "project/delete", projectId });
      if (!r.deleted) throw new Error("delete failed");
      onDeleted();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : String(err));
      setDeleting(false);
    }
  }

  return (
    <section class="settings-view">
      <div class="settings-header">
        <p class="title">Project settings</p>
        <button type="button" onClick={onClose}>Close</button>
      </div>

      <div class="settings-form">
        <div class="settings-field">
          <label for="projectName">Project name</label>
          <div class="settings-inline-row">
            <input
              id="projectName"
              type="text"
              value={nameDraft}
              onInput={(event) => setNameDraft(event.currentTarget.value)}
              disabled={renaming}
            />
            <button
              type="button"
              disabled={renaming || nameDraft.trim().length === 0 ||
                nameDraft.trim() === (projectName ?? "")}
              onClick={() => void onRename()}
            >
              {renaming ? "Saving…" : "Rename"}
            </button>
          </div>
          <small>
            Displayed in Margin. This does not rename the Google Doc.
          </small>
          {renameError ? <p class="muted error">{renameError}</p> : null}
        </div>
      </div>

      <div class="danger-zone">
        <p class="muted text-[12px]">
          Removes the project from Margin, including versions, comments, and
          review requests. Your Google Doc is not deleted.
        </p>
        {deleteError ? <p class="muted error">{deleteError}</p> : null}
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
