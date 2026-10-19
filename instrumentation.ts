/**
 * Runs once when the Next.js server starts, before it handles requests.
 * Prepares the embedded development database (a no-op with DATABASE_URL).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { prepareDb } = await import("./db/client");
    await prepareDb();
  }
}
