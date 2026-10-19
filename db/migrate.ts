/**
 * Apply pending migrations from db/migrations. Safe to run repeatedly:
 * already-applied migrations are skipped.
 *
 *   npm run db:migrate
 *
 * With DATABASE_URL set it migrates that database, using drizzle-orm's
 * migrator (works in the production image, without dev dependencies).
 * Without it, it prepares the embedded development database.
 */

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { env } from "../core/env";
import { prepareDb } from "./client";

async function main() {
  const url = env().DATABASE_URL;
  if (!url) {
    await prepareDb();
    process.exit(0);
  }
  const client = postgres(url, { max: 1 });
  try {
    await migrate(drizzle(client), { migrationsFolder: "db/migrations" });
    console.log("Migrations applied.");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
