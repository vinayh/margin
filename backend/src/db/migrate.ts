import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { config } from "../config.ts";

const pool = new pg.Pool({ connectionString: config.databaseUrlDirect });
const db = drizzle({ client: pool });

await migrate(db, { migrationsFolder: "./drizzle" });
console.log("migrations applied");
await pool.end();
