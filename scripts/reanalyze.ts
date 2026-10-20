/**
 * Find mentions and label citations again in stored answers, so fixes to the
 * detector apply to history, then rebuild the daily metrics. Ratings from the
 * analysis model are cleared with the old mentions and redone by the worker
 * if a model is set up.
 *
 *   npm run reanalyze                      every answer
 *   npm run reanalyze -- --workspace "Demo"
 *
 * With the embedded database, stop `npm run dev` first: one process at a time.
 */

import { eq, inArray } from "drizzle-orm";
import { analyzePending } from "../core/analysis";
import { rollupPending } from "../core/rollup";
import { getDb, prepareDb } from "../db/client";
import { answers, runItems, runs, workspaces } from "../db/schema";

async function main() {
  await prepareDb();
  const db = getDb();
  const i = process.argv.indexOf("--workspace");
  const name = i > -1 ? process.argv[i + 1] : undefined;

  let scope;
  if (name) {
    const [ws] = await db.select().from(workspaces).where(eq(workspaces.name, name));
    if (!ws) throw new Error(`No workspace named "${name}".`);
    scope = inArray(
      answers.id,
      db
        .select({ id: answers.id })
        .from(answers)
        .innerJoin(runItems, eq(answers.runItemId, runItems.id))
        .innerJoin(runs, eq(runItems.runId, runs.id))
        .where(eq(runs.workspaceId, ws.id)),
    );
  }
  const reset = await db
    .update(answers)
    .set({ analyzedAt: null })
    .where(scope)
    .returning({ id: answers.id });
  console.log(`Analyzing ${reset.length} answers${name ? ` in ${name}` : ""}…`);

  let done = 0;
  for (
    let n = await analyzePending(db, { limit: 500 });
    n > 0;
    n = await analyzePending(db, { limit: 500 })
  ) {
    done += n;
    process.stdout.write(`\r  ${done} / ${reset.length}`);
  }
  console.log(`\nRebuilding metrics…`);
  const days = await rollupPending(db);
  console.log(`Done: ${done} answers analyzed, metrics rebuilt for ${days} workspace-day(s).`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
