/**
 * Shared database client. Import `getDb()` wherever the app needs Postgres.
 *
 * With DATABASE_URL set, it connects to that Postgres (Docker, Neon, or a
 * production server). Without it, in development only, it uses an embedded
 * Postgres (PGlite) stored in .data/pglite, so the app runs with no setup.
 * `prepareDb()` applies migrations to the embedded database; Next.js calls it
 * once at startup (instrumentation.ts).
 */

import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "../core/env";
import * as schema from "./schema";

/** Any Drizzle Postgres connection: the postgres.js pool, or PGlite. */
export type AnyDb = PgDatabase<PgQueryResultHKT, typeof schema>;

export const EMBEDDED_DIR = ".data/pglite";

/* one connection per process; Next.js dev reloads modules, so keep it on globalThis */
const globalForDb = globalThis as unknown as {
  __ovDb?: AnyDb;
  __ovDbReady?: Promise<void>;
};

function usesEmbedded() {
  const { DATABASE_URL, NODE_ENV } = env();
  if (DATABASE_URL) return false;
  if (NODE_ENV === "production") {
    throw new Error(
      "DATABASE_URL is not set. Production needs a real Postgres; the embedded database is for development only.",
    );
  }
  return true;
}

export function getDb(): AnyDb {
  if (!globalForDb.__ovDb) {
    if (usesEmbedded()) {
      // required lazily so production bundles never load the WebAssembly build
      /* eslint-disable @typescript-eslint/no-require-imports */
      const { PGlite } = require("@electric-sql/pglite") as typeof import("@electric-sql/pglite");
      const { drizzle } = require("drizzle-orm/pglite") as typeof import("drizzle-orm/pglite");
      /* eslint-enable @typescript-eslint/no-require-imports */
      // PGlite creates its own folder but not missing parents
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      (require("node:fs") as typeof import("node:fs")).mkdirSync(EMBEDDED_DIR, { recursive: true });
      globalForDb.__ovDb = drizzle(new PGlite(EMBEDDED_DIR), { schema });
    } else {
      const client = postgres(env().DATABASE_URL!, { max: 10 });
      globalForDb.__ovDb = drizzlePostgres(client, { schema });
    }
  }
  return globalForDb.__ovDb;
}

/** Apply migrations to the embedded database. A no-op with DATABASE_URL set. */
export function prepareDb(): Promise<void> {
  if (!usesEmbedded()) return Promise.resolve();
  globalForDb.__ovDbReady ??= (async () => {
    const { migrate } = await import("drizzle-orm/pglite/migrator");
    try {
      await migrate(getDb() as Parameters<typeof migrate>[0], {
        migrationsFolder: "db/migrations",
      });
    } catch (err) {
      // PGlite reports a damaged data folder only as "Aborted()"; say what to do
      if (String((err as Error).cause ?? err).includes("Aborted"))
        throw new Error(
          `The embedded database in ${EMBEDDED_DIR} couldn't be opened. It may have been damaged when a process using it was stopped abruptly, or another process (a second dev server, npm run db:seed) has it open. Stop other processes and try again; if it still fails, rename ${EMBEDDED_DIR} to start with a fresh database.`,
          { cause: err },
        );
      throw err;
    }
    console.log(`Embedded database ready (${EMBEDDED_DIR}). Set DATABASE_URL to use your own.`);
  })();
  return globalForDb.__ovDbReady;
}
