/**
 * Runs once when the Next.js server starts, before it handles requests.
 * Prepares the embedded development database (a no-op with DATABASE_URL),
 * and starts the run worker in this process when that's where it belongs.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { prepareDb } = await import("./db/client");
    await prepareDb();
    // the run worker lives here when the database is embedded (see core/runs/loop.ts)
    const { startWorker, workerMode } = await import("./core/runs/loop");
    if (workerMode() === "inline") startWorker();
  }
}
