/**
 * Test setup. Bun ran this via `bunfig.toml preload`; under Deno there is
 * no preload, so every test file imports `./setup.ts` at the top — ES
 * module caching means the side effects run exactly once per test process.
 *
 * Pins `MARGIN_DB_PATH` to a per-process temp file before `src/db/client.ts`
 * opens its sqlite handle (the path is resolved at import time and never
 * re-read), ensures `MARGIN_MASTER_KEY` + `BETTER_AUTH_SECRET` exist for
 * the envelope-encryption + Better Auth code paths, and supplies dummy
 * Google OAuth client id/secret defaults (`src/auth/server.ts` reads them
 * at module load).
 *
 * Migrations run here too, so any test can `import { db }` and start writing.
 */
import { Buffer } from "node:buffer";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const tmp = mkdtempSync(resolve(tmpdir(), "margin-test-"));
Deno.env.set("MARGIN_DB_PATH", resolve(tmp, "test.db"));

if (!Deno.env.get("MARGIN_MASTER_KEY")) {
  Deno.env.set(
    "MARGIN_MASTER_KEY",
    Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64"),
  );
}

if (!Deno.env.get("BETTER_AUTH_SECRET")) {
  Deno.env.set(
    "BETTER_AUTH_SECRET",
    Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64"),
  );
}

if (!Deno.env.get("GOOGLE_CLIENT_ID")) Deno.env.set("GOOGLE_CLIENT_ID", "test-google-client-id");
if (!Deno.env.get("GOOGLE_CLIENT_SECRET")) {
  Deno.env.set("GOOGLE_CLIENT_SECRET", "test-google-client-secret");
}

const { migrate } = await import("drizzle-orm/node-sqlite/migrator");
const { db } = await import("../src/db/client.ts");
migrate(db, { migrationsFolder: "./drizzle" });
