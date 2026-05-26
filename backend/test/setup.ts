/**
 * Test setup. Deno has no preload hook, so every test file imports
 * `./setup.ts` at the top — ES module caching means the side effects
 * run exactly once per test process.
 *
 * Boots an in-process PGlite database fronted by a TCP socket server so
 * both the parent test process and any `runCli`-spawned subprocess can
 * connect via the standard `pg` driver (i.e. the same code path as prod
 * against Neon). Each test process gets its own DB on an ephemeral port,
 * isolated from sibling test files.
 */
import { Buffer } from "node:buffer";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

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

const pglite = await PGlite.create();
const server = new PGLiteSocketServer({
  db: pglite,
  port: 0,
  host: "127.0.0.1",
  // The parent test process holds one pool; runCli subprocesses bring more.
  // PGlite still serializes queries internally — this only governs concurrent
  // sockets, not write contention.
  maxConnections: 32,
});
await server.start();
const port = (server as unknown as { port: number }).port;
Deno.env.set(
  "DATABASE_URL",
  `postgresql://postgres:postgres@127.0.0.1:${port}/postgres`,
);

const { migrate } = await import("drizzle-orm/node-postgres/migrator");
const { db } = await import("../src/db/client.ts");
await migrate(db, { migrationsFolder: "./drizzle" });
