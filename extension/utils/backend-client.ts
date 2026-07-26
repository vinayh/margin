import { getBackendUrl, getSettings, patchSettings } from "./storage.ts";
import type { NotificationView } from "./messages.ts";
import type {
  CommentActionKind,
  CommentActionResult,
  DocState,
  ProjectDetail,
  ProjectListEntry,
  ReviewRequestResult,
  Settings,
  VersionCommentsPayload,
  VersionCreateResult,
  VersionDiffPayload,
} from "./types.ts";

// Authenticated backend client. Runs only in the SW; popup/sidepanel reach it
// via sendMessage and never see the session token. The Bearer header is added here.

// Throws on any non-2xx (including 404). Use when a 404 is a real failure;
// reach for postJsonOrNull when "missing" is an expected, non-error null.
async function postJson<T>(
  path: string,
  body: unknown,
  settings: Settings,
): Promise<T> {
  const res = await postJsonRaw(path, body, settings);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${path} ${res.status}: ${text.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

// Returns null on 404 (missing / not yours); throws on any other error.
async function postJsonOrNull<T>(
  path: string,
  body: unknown,
  settings: Settings,
): Promise<T | null> {
  const res = await postJsonRaw(path, body, settings);
  if (res.status === 404) return null;
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${path} ${res.status}: ${text.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

async function postJsonRaw(
  path: string,
  body: unknown,
  settings: Settings,
): Promise<Response> {
  const url = new URL(path, settings.backendUrl).toString();
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${settings.sessionToken}`,
    },
    body: JSON.stringify(body),
  });
  if (res.status === 401 || res.status === 403) {
    throw new Error("session rejected; sign in again from Options");
  }
  return res;
}

// Invalidates the DB session via Better Auth's /sign-out. On backend failure
// the local token is still cleared (the row expires on its own).
export async function signOutFromBackend(): Promise<void> {
  const settings = await getSettings();
  if (settings) {
    try {
      const url = new URL("/api/auth/sign-out", settings.backendUrl).toString();
      await fetch(url, {
        method: "POST",
        headers: { authorization: `Bearer ${settings.sessionToken}` },
      });
    } catch (err) {
      console.warn("[margin] sign-out backend call failed:", err);
    }
  }
  await patchSettings({ sessionToken: "" });
}

export async function checkBackendHealth(): Promise<
  { ok: boolean; status: number }
> {
  const backendUrl = await getBackendUrl();
  if (!backendUrl) throw new Error("no backend configured");
  const res = await fetch(new URL("/healthz", backendUrl), {
    method: "GET",
    signal: AbortSignal.timeout(3000),
  });
  const body = (await res.json().catch(() => null)) as { ok?: boolean } | null;
  return { ok: res.ok && body?.ok === true, status: res.status };
}

export interface WhoamiResponse {
  email: string | null;
  name: string | null;
  image: string | null;
}

// Authenticated user's profile for the Options identity block (avatar, name,
// email). Null when there's no session or the backend is unreachable.
export async function fetchWhoami(): Promise<WhoamiResponse | null> {
  const settings = await getSettings();
  if (!settings) return null;
  return postJsonOrNull<WhoamiResponse>("/api/extension/whoami", {}, settings);
}

// null = settings missing (popup renders that as "configure backend"). Network errors throw.
export async function fetchDocState(docId: string): Promise<DocState | null> {
  const settings = await getSettings();
  if (!settings) return null;
  return postJson<DocState>("/api/extension/doc-state", { docId }, settings);
}

export async function runDocSync(docId: string): Promise<DocState | null> {
  const settings = await getSettings();
  if (!settings) return null;
  return postJson<DocState>("/api/extension/doc-sync", { docId }, settings);
}

export async function listProjects(): Promise<ProjectListEntry[] | null> {
  const settings = await getSettings();
  if (!settings) return null;
  const r = await postJsonOrNull<{ projects: ProjectListEntry[] }>(
    "/api/extension/projects",
    {},
    settings,
  );
  return r?.projects ?? null;
}

export async function fetchProjectDetail(
  projectId: string,
): Promise<ProjectDetail | null> {
  const settings = await getSettings();
  if (!settings) return null;
  return postJsonOrNull<ProjectDetail>(
    "/api/extension/project",
    { projectId },
    settings,
  );
}

export async function deleteProject(projectId: string): Promise<boolean> {
  const settings = await getSettings();
  if (!settings) return false;
  const r = await postJsonOrNull<{ deleted: boolean }>(
    "/api/extension/project-delete",
    { projectId },
    settings,
  );
  return r?.deleted === true;
}

export async function renameProject(
  projectId: string,
  name: string,
): Promise<{ projectId: string; name: string } | null> {
  const settings = await getSettings();
  if (!settings) return null;
  return postJsonOrNull<{ projectId: string; name: string }>(
    "/api/extension/project-rename",
    { projectId, name },
    settings,
  );
}

export async function fetchNotifications(): Promise<
  {
    items: NotificationView[];
    unread: number;
  } | null
> {
  const settings = await getSettings();
  if (!settings) return null;
  return postJsonOrNull<{ items: NotificationView[]; unread: number }>(
    "/api/extension/notifications",
    {},
    settings,
  );
}

export async function markNotificationsRead(opts: {
  ids?: string[];
  all?: boolean;
}): Promise<number> {
  const settings = await getSettings();
  if (!settings) return 0;
  const r = await postJsonOrNull<{ marked: number }>(
    "/api/extension/notifications/mark-read",
    opts,
    settings,
  );
  return r?.marked ?? 0;
}

export async function createVersion(opts: {
  projectId: string;
  label?: string;
}): Promise<VersionCreateResult | null> {
  const settings = await getSettings();
  if (!settings) return null;
  // 404 = missing / not owned: a real failure for a user-triggered snapshot,
  // not a silent no-op. null is reserved for "settings missing" above.
  return postJson<VersionCreateResult>(
    "/api/extension/version/create",
    opts,
    settings,
  );
}

export async function fetchVersionDiff(
  fromVersionId: string,
  toVersionId: string,
): Promise<VersionDiffPayload | null> {
  const settings = await getSettings();
  if (!settings) return null;
  return postJsonOrNull<VersionDiffPayload>(
    "/api/extension/version-diff",
    { fromVersionId, toVersionId },
    settings,
  );
}

export async function fetchVersionComments(
  versionId: string,
): Promise<VersionCommentsPayload | null> {
  const settings = await getSettings();
  if (!settings) return null;
  return postJsonOrNull<VersionCommentsPayload>(
    "/api/extension/version-comments",
    { versionId },
    settings,
  );
}

export async function runCommentAction(opts: {
  canonicalCommentId: string;
  action: CommentActionKind;
  targetVersionId?: string;
}): Promise<CommentActionResult | null> {
  const settings = await getSettings();
  if (!settings) return null;
  return postJsonOrNull<CommentActionResult>(
    "/api/extension/comment-action",
    opts,
    settings,
  );
}

export async function createReviewRequest(opts: {
  versionId: string;
  assigneeEmails: string[];
  deadline?: number | null;
}): Promise<ReviewRequestResult | null> {
  const settings = await getSettings();
  if (!settings) return null;
  // 4xx = missing / not owned / rejected (e.g. rate-limited): all real failures
  // for a user-requested review. null is reserved for "settings missing" above.
  return postJson<ReviewRequestResult>(
    "/api/extension/review/request",
    opts,
    settings,
  );
}
