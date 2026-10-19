/**
 * Apply pending migrations from db/migrations. Safe to run repeatedly:
 * already-applied migrations are skipped.
 *
 *   npm run db:migrate
 *
 * Uses drizzle-orm's migrator rather than drizzle-kit, so it also runs in the
 * production Docker image, where dev dependencies aren't installed.
 */

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { requireEnv } from "../core/env";

async function main() {
  const client = postgres(requireEnv("DATABASE_URL"), { max: 1 });
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
