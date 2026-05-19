import { DatabaseSync } from "node:sqlite";
import { drizzle } from "drizzle-orm/node-sqlite";
import { config } from "../config.ts";
import * as schema from "./schema.ts";

export const sqlite = new DatabaseSync(config.dbPath);
sqlite.exec("PRAGMA journal_mode = WAL;");
sqlite.exec("PRAGMA foreign_keys = ON;");
sqlite.exec("PRAGMA synchronous = NORMAL;");

export const db = drizzle({ client: sqlite, schema });
export type DB = typeof db;

/**
 * True when `err` is a UNIQUE-constraint violation. Used by upsert paths
 * that wrap a SELECT-then-INSERT in a transaction: the unique index is
 * the backstop for the read-then-write race, and the caller re-reads
 * the winner row instead of bubbling the error up.
 *
 * Recognizes both SQLite (current) and Postgres (post-§14.2 swap) error
 * shapes so the swap doesn't need to touch every caller.
 */
export function isUniqueConstraintError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const message = "message" in err && typeof err.message === "string" ? err.message : "";
  if (message.includes("UNIQUE constraint failed")) return true;
  const code = "code" in err && typeof err.code === "string" ? err.code : "";
  // SQLite: SQLITE_CONSTRAINT_UNIQUE / _PRIMARYKEY. Postgres: SQLSTATE 23505.
  return code === "SQLITE_CONSTRAINT_UNIQUE" || code === "SQLITE_CONSTRAINT_PRIMARYKEY" ||
    code === "23505";
}
