import { migrate } from "drizzle-orm/node-sqlite/migrator";
import { db } from "./client.ts";

migrate(db, { migrationsFolder: "./drizzle" });
console.log("migrations applied");
