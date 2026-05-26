import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { config } from "../config.ts";

// Lazy under a Proxy so importing this module doesn't eagerly read
// DATABASE_URL — test setup (`test/setup.ts`) needs to boot a PGlite-backed
// socket server and set the env var before any pool method is invoked, and
// ESM evaluates sibling modules of a TLA-paused importer in the meantime.
// Drizzle calls pool methods (.connect / .query) only at first DB op.
let realPool: pg.Pool | undefined;
function getPool(): pg.Pool {
  if (!realPool) realPool = new pg.Pool({ connectionString: config.databaseUrl });
  return realPool;
}

export const pool: pg.Pool = new Proxy({} as pg.Pool, {
  get(_target, prop) {
    const p = getPool();
    const v = (p as unknown as Record<PropertyKey, unknown>)[prop];
    return typeof v === "function" ? (v as (...args: unknown[]) => unknown).bind(p) : v;
  },
});

export const db = drizzle({ client: pool });
export type DB = typeof db;

/**
 * True when `err` is a UNIQUE-constraint violation. Used by upsert paths
 * that wrap a SELECT-then-INSERT in a transaction: the unique index is
 * the backstop for the read-then-write race, and the caller re-reads
 * the winner row instead of bubbling the error up.
 */
export function isUniqueConstraintError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = "code" in err && typeof err.code === "string" ? err.code : "";
  return code === "23505";
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * RFC 4122 textual UUID predicate. Nullable getters short-circuit on
 * non-UUID input so callers can pass route params straight through — without
 * this guard, Postgres rejects the parameter with SQLSTATE 22P02 before the
 * "no row" branch can fire.
 */
export function isUuid(s: string): boolean {
  return UUID_RE.test(s);
}
