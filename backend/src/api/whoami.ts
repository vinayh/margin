import { authedPost } from "./middleware.ts";
import { getUserById } from "../domain/user.ts";

/**
 * POST /api/extension/whoami — returns the authenticated user's profile
 * (email, name, avatar URL) so the Options page can render the signed-in
 * identity block. The bearer session identifies the user; the body is unused.
 */
export function handleWhoamiPost(req: Request): Promise<Response> {
  return authedPost(req, async ({ auth }) => {
    const u = await getUserById(auth.userId);
    return {
      email: u?.email ?? null,
      name: u?.name ?? null,
      image: u?.image ?? null,
    };
  });
}
