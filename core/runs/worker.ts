/**
 * The run worker. The run_items table is the queue; each `tick` moves it on:
 *
 *   1. submit:   queued items go out as one batch per run and engine, and the
 *                provider's job ID is saved on each item (status "running").
 *                With smart sampling, samples after the first two wait until
 *                those are back, and are skipped if the two agree on whether
 *                the brand is mentioned.
 *   2. collect:  running batches are checked; finished ones are stored as
 *                answers (with citations), failed answers are re-queued or failed
 *   3. analyze:  mentions are found in new answers (core/analysis.ts), then,
 *                if an analysis model is set up, rated (core/sentiment.ts)
 *   4. finish:   runs with nothing left to do are closed with their totals
 *   5. roll up:  the daily metrics are rebuilt for days with a finished
 *                run that changed (core/rollup.ts)
 *
 * Every step is written to the database before the next, so a restart picks
 * up where it left off and a batch already paid for is never submitted again.
 * Storing an answer is idempotent (one answer per item).
 */

import { and, asc, eq, gte, inArray, isNotNull, lt, sql } from "drizzle-orm";
import type { AnyDb } from "@/db/client";
import { answers, citations, runItems, runs } from "@/db/schema";
import { analyzePending, loadEntities } from "../analysis";
import { citationRows, ownersOf, type Owners } from "../citations";
import { getBudget } from "../budget";
import { detectMentions } from "../mentions";
import { rollupPending } from "../rollup";
import { SAMPLING_DECIDES_FROM } from "../savings";
import { ratePending, type AnalysisModel } from "../sentiment";
import { ProviderError } from "../providers/errors";
import type { EngineId, ItemError, Provider, QueryResult } from "../providers/types";

export type ProviderFor = (workspaceId: string, engine: EngineId) => Promise<Provider>;

export type WorkerOptions = {
  db: AnyDb;
  providerFor: ProviderFor;
  /** tries per item, counting the first */
  maxAttempts?: number;
  /** most inputs per provider batch */
  maxBatch?: number;
  /** a batch still not ready after this long is given up on */
  staleAfterMs?: number;
  /** how often to ask the provider about one batch; Bright Data jobs take minutes */
  checkEveryMs?: number;
  /** the model that rates sentiment; default from the environment, null for none */
  analysis?: AnalysisModel | null;
  now?: () => Date;
};

export type TickReport = {
  submitted: number;
  collected: number;
  requeued: number;
  analyzed: number;
  rated: number;
  finished: string[];
  /** workspace-days whose metrics were rebuilt */
  rolledUp: number;
};

type ItemRow = typeof runItems.$inferSelect;

/* a batch that failed to submit waits before trying again, per run and engine */
const backoff = new Map<string, number>();
/* when each batch was last checked, so a slow batch isn't asked about every tick */
const lastChecked = new Map<string, number>();

const describe = (e: ItemError | { message: string }) => e.message.slice(0, 500);

export async function tick(opts: WorkerOptions): Promise<TickReport> {
  const report: TickReport = {
    submitted: 0,
    collected: 0,
    requeued: 0,
    analyzed: 0,
    rated: 0,
    finished: [],
    rolledUp: 0,
  };
  await submitQueued(opts, report);
  await collectRunning(opts, report);
  const now = (opts.now ?? (() => new Date()))();
  report.analyzed = await analyzePending(opts.db, { now });
  report.rated = await ratePending(opts.db, opts.analysis, now);
  report.finished = await finishRuns(opts);
  report.rolledUp = await rollupPending(opts.db, now);
  return report;
}

/* ── 1. submit ─────────────────────────────────────────────── */

async function submitQueued(opts: WorkerOptions, report: TickReport) {
  const { db, providerFor, maxBatch = 200 } = opts;
  const now = (opts.now ?? (() => new Date()))();
  const held = await smartSample(db, now);

  const queued = await db
    .select({ item: runItems, workspaceId: runs.workspaceId })
    .from(runItems)
    .innerJoin(runs, eq(runItems.runId, runs.id))
    .where(and(eq(runItems.status, "queued"), inArray(runs.status, ["queued", "running"])))
    .orderBy(asc(runItems.runId), asc(runItems.engine), asc(runItems.id));

  const groups = new Map<string, { workspaceId: string; items: ItemRow[] }>();
  for (const { item, workspaceId } of queued) {
    if (held.has(item.id)) continue;
    const key = `${item.runId}:${item.engine}`;
    if (!groups.has(key)) groups.set(key, { workspaceId, items: [] });
    groups.get(key)!.items.push(item);
  }

  for (const [key, { workspaceId, items }] of groups) {
    if ((backoff.get(key) ?? 0) > now.getTime()) continue;
    const engine = items[0].engine;
    for (let i = 0; i < items.length; i += maxBatch) {
      let batch = items.slice(i, i + maxBatch);
      // the monthly limit: send only what still fits, and skip the rest of this run
      const { cap, left } = await getBudget(db, workspaceId, now);
      if (left < batch.length) {
        const skipped = items.slice(i + left);
        await db
          .update(runItems)
          .set({
            status: "skipped",
            skipReason: "limit",
            error: "Monthly answer limit reached",
            finishedAt: now,
          })
          .where(
            inArray(
              runItems.id,
              skipped.map((it) => it.id),
            ),
          );
        await noteRun(
          db,
          batch[0].runId,
          `Stopped at the monthly limit of ${cap!.toLocaleString("en-US")} answers; ${skipped.length} not asked. Raise it in Settings.`,
        );
        if (left === 0) break;
        batch = batch.slice(0, left);
        i = items.length; // nothing after this batch
      }
      try {
        const provider = await providerFor(workspaceId, engine);
        const jobId = await provider.submit(
          engine,
          batch.map((it) => ({ prompt: it.promptText, country: it.country ?? undefined })),
        );
        await db.transaction(async (tx) => {
          for (const [batchIndex, it] of batch.entries())
            await tx
              .update(runItems)
              .set({
                status: "running",
                externalId: jobId,
                batchIndex,
                attempts: it.attempts + 1,
                startedAt: now,
                error: null,
              })
              .where(eq(runItems.id, it.id));
          await tx
            .update(runs)
            .set({ status: "running", startedAt: sql`coalesce(${runs.startedAt}, ${now})` })
            .where(eq(runs.id, batch[0].runId));
        });
        report.submitted += batch.length;
      } catch (err) {
        const e = err instanceof ProviderError ? err : new ProviderError("upstream", String(err));
        if (e.retryable) {
          // try this run and engine again in a minute
          backoff.set(key, now.getTime() + 60_000);
          await noteRun(db, batch[0].runId, `${engine}: ${e.message} Retrying shortly.`);
          break;
        }
        // a bad key or an engine without a source: these items can't succeed
        await db
          .update(runItems)
          .set({ status: "failed", error: describe(e), finishedAt: now })
          .where(
            inArray(
              runItems.id,
              batch.map((it) => it.id),
            ),
          );
        await noteRun(db, batch[0].runId, `${engine}: ${e.message}`);
      }
    }
  }
}

/**
 * Smart sampling. For each prompt, engine and country, the samples after the
 * first two wait until those two are answered. If both name the brand, or
 * neither does, the rest are skipped and carry that result over (so mention
 * rates stay honest); if they disagree, or one failed, the rest are asked.
 * Returns the items still waiting.
 */
async function smartSample(db: AnyDb, now: Date): Promise<Set<string>> {
  const later = await db
    .select({ item: runItems, brandId: runs.brandId })
    .from(runItems)
    .innerJoin(runs, eq(runItems.runId, runs.id))
    .where(
      and(
        eq(runs.smartSampling, true),
        inArray(runs.status, ["queued", "running"]),
        eq(runItems.status, "queued"),
        gte(runItems.sampleIndex, SAMPLING_DECIDES_FROM),
      ),
    );
  const held = new Set<string>();
  if (!later.length) return held;

  const runIds = [...new Set(later.map((l) => l.item.runId))];
  const brandIds = [...new Set(later.map((l) => l.brandId))];
  const [firsts, entities] = await Promise.all([
    db
      .select({
        runId: runItems.runId,
        promptText: runItems.promptText,
        engine: runItems.engine,
        country: runItems.country,
        status: runItems.status,
        text: answers.text,
      })
      .from(runItems)
      .leftJoin(answers, eq(answers.runItemId, runItems.id))
      .where(and(inArray(runItems.runId, runIds), lt(runItems.sampleIndex, SAMPLING_DECIDES_FROM))),
    loadEntities(db, brandIds),
  ]);
  const key = (i: { runId: string; promptText: string; engine: string; country: string | null }) =>
    `${i.runId}\u0000${i.engine}\u0000${i.country ?? ""}\u0000${i.promptText}`;
  const groups = new Map<string, typeof firsts>();
  for (const f of firsts) {
    if (!groups.has(key(f))) groups.set(key(f), []);
    groups.get(key(f))!.push(f);
  }

  const skip = { true: [] as string[], false: [] as string[] };
  for (const { item, brandId } of later) {
    const first = groups.get(key(item)) ?? [];
    if (first.length < SAMPLING_DECIDES_FROM || first.some((f) => f.status !== "done")) {
      // still being asked: wait; failed or skipped: nothing to go on, so ask
      if (first.some((f) => f.status === "queued" || f.status === "running")) held.add(item.id);
      continue;
    }
    // only the workspace's own brand decides
    const own = (entities.get(brandId) ?? []).filter((e) => e.competitorId === null);
    if (!own.length) continue;
    const seen = first.map((f) => detectMentions(f.text ?? "", own).length > 0);
    if (seen.every((m) => m === seen[0])) skip[String(seen[0]) as "true" | "false"].push(item.id);
  }
  for (const mentioned of [true, false])
    if (skip[`${mentioned}`].length)
      await db
        .update(runItems)
        .set({
          status: "skipped",
          skipReason: "sampling",
          inferredMentioned: mentioned,
          error: null,
          finishedAt: now,
        })
        .where(inArray(runItems.id, skip[`${mentioned}`]));
  for (const id of [...skip.true, ...skip.false]) held.add(id);
  return held;
}

/* ── 2. collect ────────────────────────────────────────────── */

async function collectRunning(opts: WorkerOptions, report: TickReport) {
  const { db, providerFor, maxAttempts = 3, staleAfterMs = 45 * 60_000, checkEveryMs = 0 } = opts;
  const now = (opts.now ?? (() => new Date()))();

  const jobs = await db
    .selectDistinct({
      externalId: runItems.externalId,
      runId: runItems.runId,
      engine: runItems.engine,
      workspaceId: runs.workspaceId,
    })
    .from(runItems)
    .innerJoin(runs, eq(runItems.runId, runs.id))
    .where(and(eq(runItems.status, "running"), isNotNull(runItems.externalId)));

  for (const job of jobs) {
    const since = now.getTime() - (lastChecked.get(job.externalId!) ?? 0);
    if (checkEveryMs > 0 && since >= 0 && since < checkEveryMs) continue;
    lastChecked.set(job.externalId!, now.getTime());
    const items = await db
      .select()
      .from(runItems)
      .where(and(eq(runItems.externalId, job.externalId!), eq(runItems.status, "running")))
      .orderBy(asc(runItems.batchIndex));
    if (!items.length) continue;

    let provider: Provider;
    try {
      provider = await providerFor(job.workspaceId, job.engine);
    } catch (err) {
      const e = err instanceof ProviderError ? err : new ProviderError("upstream", String(err));
      await settle(
        db,
        items,
        items.map(() => e.toItemError()),
        maxAttempts,
        now,
        report,
      );
      continue;
    }

    let state;
    try {
      state = await provider.check(job.externalId!);
    } catch {
      continue; // couldn't ask; try again next tick
    }

    if (state.state === "pending") {
      const started = items[0].startedAt?.getTime() ?? now.getTime();
      if (now.getTime() - started > staleAfterMs)
        await settle(
          db,
          items,
          items.map(() => ({
            kind: "timeout" as const,
            message: `No answer from the provider after ${Math.round(staleAfterMs / 60_000)} minutes`,
            retryable: true,
          })),
          maxAttempts,
          now,
          report,
        );
      continue;
    }
    if (state.state === "failed") {
      await settle(
        db,
        items,
        items.map(() => state.error),
        maxAttempts,
        now,
        report,
      );
      continue;
    }

    let results: QueryResult[];
    try {
      results = await provider.collect(
        job.engine,
        job.externalId!,
        items.map((it) => ({ prompt: it.promptText, country: it.country ?? undefined })),
      );
    } catch {
      continue; // the download failed; it's still there next tick
    }
    const [run] = await db
      .select({ brandId: runs.brandId })
      .from(runs)
      .where(eq(runs.id, job.runId));
    const owners = ownersOf((await loadEntities(db, [run.brandId])).get(run.brandId) ?? []);
    const errors: (ItemError | null)[] = [];
    for (const [i, item] of items.entries()) {
      const r = results[i];
      if (r?.ok) {
        await storeAnswer(db, item, r, owners, now);
        report.collected++;
        errors.push(null);
      } else {
        errors.push(
          r?.error ?? {
            kind: "upstream",
            message: "No answer came back for this prompt",
            retryable: true,
          },
        );
      }
    }
    const failed = items.filter((_, i) => errors[i]);
    await settle(
      db,
      failed,
      errors.filter((e): e is ItemError => e !== null),
      maxAttempts,
      now,
      report,
    );
  }
}

/** Failed items go back in the queue if they can still succeed, or fail for good. */
async function settle(
  db: AnyDb,
  items: ItemRow[],
  errors: ItemError[],
  maxAttempts: number,
  now: Date,
  report: TickReport,
) {
  for (const [i, item] of items.entries()) {
    const error = errors[i];
    const retry = error.retryable && item.attempts < maxAttempts;
    await db
      .update(runItems)
      .set(
        retry
          ? { status: "queued", externalId: null, batchIndex: null, error: describe(error) }
          : { status: "failed", error: describe(error), finishedAt: now },
      )
      .where(eq(runItems.id, item.id));
    if (retry) report.requeued++;
  }
}

/** Store one answer and its citations, once: a repeated call changes nothing. */
async function storeAnswer(db: AnyDb, item: ItemRow, r: QueryResult, owners: Owners, now: Date) {
  await db.transaction(async (tx) => {
    const [answer] = await tx
      .insert(answers)
      .values({
        runItemId: item.id,
        text: r.text,
        raw: r.raw,
        model: r.model ?? null,
        webSearchTriggered: r.webSearchTriggered ?? null,
        shown: r.shown ?? null,
        latencyMs: item.startedAt ? now.getTime() - item.startedAt.getTime() : null,
        costUsd: r.costUsd.toFixed(6),
      })
      .onConflictDoNothing({ target: answers.runItemId })
      .returning({ id: answers.id });

    if (answer && r.citations.length) {
      const rows = citationRows(r.citations, owners);
      if (rows.length)
        await tx.insert(citations).values(rows.map((c) => ({ ...c, answerId: answer.id })));
    }
    await tx
      .update(runItems)
      .set({ status: "done", error: null, finishedAt: now })
      .where(eq(runItems.id, item.id));
  });
}

/* ── 3. finish ─────────────────────────────────────────────── */

async function finishRuns(opts: WorkerOptions): Promise<string[]> {
  const { db } = opts;
  const now = (opts.now ?? (() => new Date()))();
  const open = await db
    .select({ id: runs.id })
    .from(runs)
    .where(inArray(runs.status, ["queued", "running"]));

  const finished: string[] = [];
  for (const { id } of open) {
    const counts = await db
      .select({ status: runItems.status, n: sql<number>`count(*)::int` })
      .from(runItems)
      .where(eq(runItems.runId, id))
      .groupBy(runItems.status);
    const n = (s: string) => counts.find((c) => c.status === s)?.n ?? 0;
    const done = n("done");
    const [sampled] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(runItems)
      .where(and(eq(runItems.runId, id), eq(runItems.skipReason, "sampling")));
    const [cost] = await db
      .select({
        total: sql<string>`coalesce(sum(${answers.costUsd} + ${answers.analysisCostUsd}), 0)::text`,
      })
      .from(answers)
      .innerJoin(runItems, eq(answers.runItemId, runItems.id))
      .where(eq(runItems.runId, id));

    const progress = { doneItems: done, actualCost: cost.total, sampledOutItems: sampled.n };
    if (n("queued") + n("running") > 0) {
      await db.update(runs).set(progress).where(eq(runs.id, id));
      continue;
    }
    // samples smart sampling didn't need aren't missing answers
    const missing = n("failed") + n("skipped") - sampled.n;
    const status = done === 0 ? "failed" : missing > 0 ? "partial" : "completed";
    await db
      .update(runs)
      .set({ ...progress, status, finishedAt: now })
      .where(eq(runs.id, id));
    finished.push(id);
  }
  return finished;
}

async function noteRun(db: AnyDb, runId: string, note: string) {
  await db
    .update(runs)
    .set({ note: note.slice(0, 500) })
    .where(eq(runs.id, runId));
}
