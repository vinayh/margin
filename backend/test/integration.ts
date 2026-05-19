import { it } from "@std/testing/bdd";

/**
 * Integration tests run against real Google APIs. They're gated on a
 * pre-issued OAuth refresh token + the rest of the OAuth client config so
 * unit-test runs (and fresh forks) don't fail when the secrets aren't set.
 *
 * Use `integrationTest` in place of `test` inside `*.integration.test.ts`
 * files; the body runs only when every gate-var is present.
 */
const REQUIRED_VARS = [
  "GOOGLE_CI_REFRESH_TOKEN",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
] as const;

function missingVars(): string[] {
  return REQUIRED_VARS.filter((k) => !Deno.env.get(k));
}

export const hasIntegrationCreds = missingVars().length === 0;

export const integrationTest = (
  name: string,
  body: () => void | Promise<void>,
  timeoutMs?: number,
) => {
  // @std/testing/bdd has no positional timeout; wrap the body in a Promise.race
  // so slow Google round-trips fail loudly instead of stalling the suite.
  const wrapped = timeoutMs === undefined ? body : async () => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.resolve().then(body),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`integration test timed out after ${timeoutMs}ms`)),
            timeoutMs,
          );
        }),
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  };
  if (hasIntegrationCreds) return it(name, wrapped);
  const missing = missingVars().join(", ");
  return it.skip(`${name} (skipped: missing ${missing})`, wrapped);
};
