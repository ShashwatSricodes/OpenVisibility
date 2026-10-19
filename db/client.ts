/**
 * Shared database client. Import `db` wherever the app needs Postgres;
 * the connection opens on first use, so importing this file is cheap.
 */

import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { requireEnv } from "../core/env";
import * as schema from "./schema";

export type Database = PostgresJsDatabase<typeof schema>;

/* one pool per process; Next.js dev reloads modules, so keep it on globalThis */
const globalForDb = globalThis as unknown as { __ovDb?: Database };

export function getDb(): Database {
  if (!globalForDb.__ovDb) {
    const client = postgres(requireEnv("DATABASE_URL"), { max: 10 });
    globalForDb.__ovDb = drizzle(client, { schema, casing: "snake_case" });
  }
  return globalForDb.__ovDb;
}
