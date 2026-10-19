/**
 * The run worker as its own process, for deployments with a real Postgres
 * (DATABASE_URL). With the embedded development database the worker runs
 * inside `npm run dev` instead, and this refuses to start.
 *
 *   npm run worker
 */

import { prepareDb } from "../db/client";
import { env } from "../core/env";
import { startWorker } from "../core/runs/loop";

async function main() {
  if (!env().DATABASE_URL) {
    console.error(
      "The worker needs DATABASE_URL. With the embedded development database it already runs inside `npm run dev`.",
    );
    process.exit(1);
  }
  await prepareDb();
  const worker = startWorker();
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.on(signal, () => {
      worker.stop();
      process.exit(0);
    });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
