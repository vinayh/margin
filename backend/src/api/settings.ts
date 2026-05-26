import * as v from "valibot";
import { IdSchema, notFound, validatedPost } from "./middleware.ts";
import {
  loadProjectSettings,
  ProjectSettingsPatchSchema,
  SettingsNotFoundError,
  updateProjectSettings,
} from "../domain/settings.ts";

const MAX_BODY_BYTES = 8 * 1024;

const SettingsBodySchema = v.object({
  projectId: IdSchema,
  patch: v.optional(ProjectSettingsPatchSchema),
});

/**
 * POST /api/extension/settings — project settings surface for the side
 * panel (SPEC §12 Phase 4: notification prefs, default reviewers, Slack
 * workspace linking).
 *
 * Body shape:
 *   { projectId }                 → return current settings
 *   { projectId, patch: {...} }   → merge-update + return the new state
 *
 * `patch` is a partial of `ProjectSettingsView`; omitted fields keep their
 * current value. Owner-scoped — 404 when the project is missing or not
 * owned by the caller (no info leak).
 */
export function handleSettingsPost(req: Request): Promise<Response> {
  return validatedPost(
    req,
    SettingsBodySchema,
    async ({ auth, body }) => {
      try {
        if (body.patch === undefined) {
          const settings = await loadProjectSettings({
            projectId: body.projectId,
            userId: auth.userId,
          });
          return { settings };
        }
        const settings = await updateProjectSettings({
          projectId: body.projectId,
          userId: auth.userId,
          patch: body.patch,
        });
        return { settings };
      } catch (err) {
        if (err instanceof SettingsNotFoundError) return notFound(err.message);
        throw err;
      }
    },
    { maxBytes: MAX_BODY_BYTES },
  );
}
