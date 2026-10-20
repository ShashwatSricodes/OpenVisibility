/**
 * The daily rollup: metrics_daily holds counters (core/metrics.ts) for every
 * workspace × day × engine × country × prompt × tracked brand. The worker
 * rebuilds a whole day whenever one of its runs is due: finished and not yet
 * rolled up, or rolled up before its answers were re-analyzed or rated
 * (those steps clear runs.rolled_up_at). Runs still going aren't counted, and
 * neither are answers still waiting for mention detection.
 */

import { and, asc, eq, gte, inArray, isNull, lt, notExists } from "drizzle-orm";
import type { AnyDb } from "@/db/client";
import { answers, citations, mentions, metricsDaily, runItems, runs } from "@/db/schema";
import { loadEntities } from "./analysis";
import { NEGATIVE_FROM, POSITIVE_FROM, ZERO, type Counters } from "./metrics";
import type { EngineId } from "./providers/types";

export type Sample = {
  promptId: string | null;
  engine: EngineId;
  country: string;
  /** an answer was stored: what it named and cited */
  answer?: {
    mentions: { competitorId: string | null; position: number | null; sentiment: number | null }[];
    citations: { kind: "owned" | "competitor" | "third_party"; competitorId: string | null }[];
  };
  /** skipped by smart sampling: whether your brand was named in the samples asked */
  inferredMentioned?: boolean;
};

/** One sample's counters for each tracked brand (null: your own brand). */
export function countSample(s: Sample, brands: (string | null)[]): Map<string | null, Counters> {
  const out = new Map<string | null, Counters>();
  for (const b of brands) {
    const c = { ...ZERO };
    if (s.answer) {
      const m = s.answer.mentions.find((x) => x.competitorId === b);
      c.samples = 1;
      c.asked = 1;
      c.allMentions = s.answer.mentions.length;
      c.allCitations = s.answer.citations.length;
      c.citations = s.answer.citations.filter((x) =>
        b === null ? x.kind === "owned" : x.kind === "competitor" && x.competitorId === b,
      ).length;
      if (m) {
        c.mentioned = 1;
        c.mentions = 1;
        if (m.position) {
          c.positioned = 1;
          c.positionSum = m.position;
          c.reciprocalSum = 1 / m.position;
        }
        if (m.sentiment !== null) {
          c.rated = 1;
          c.sentimentSum = m.sentiment;
          c.positive = m.sentiment >= POSITIVE_FROM ? 1 : 0;
          c.negative = m.sentiment <= NEGATIVE_FROM ? 1 : 0;
        }
      }
    } else if (b === null && s.inferredMentioned !== undefined) {
      // smart sampling decides only about your own brand
      c.samples = 1;
      c.mentioned = s.inferredMentioned ? 1 : 0;
    } else continue;
    out.set(b, c);
  }
  return out;
}

const dayOf = (d: Date) => d.toISOString().slice(0, 10);
const FINISHED = ["completed", "partial", "failed"] as const;

/** Rebuild metrics_daily for one workspace and day from its finished runs. */
export async function rebuildDay(db: AnyDb, workspaceId: string, day: string, now = new Date()) {
  const start = new Date(`${day}T00:00:00Z`);
  const end = new Date(start.getTime() + 86_400_000);
  const dayRuns = await db
    .select({ id: runs.id, brandId: runs.brandId })
    .from(runs)
    .where(
      and(
        eq(runs.workspaceId, workspaceId),
        inArray(runs.status, [...FINISHED]),
        gte(runs.createdAt, start),
        lt(runs.createdAt, end),
      ),
    );

  const cells = new Map<
    string,
    { key: Omit<typeof metricsDaily.$inferInsert, keyof Counters | "id">; c: Counters }
  >();
  if (dayRuns.length) {
    const runIds = dayRuns.map((r) => r.id);
    const brandOfRun = new Map(dayRuns.map((r) => [r.id, r.brandId]));
    const entities = await loadEntities(db, [...new Set(brandOfRun.values())]);

    const items = await db
      .select({
        runId: runItems.runId,
        promptId: runItems.promptId,
        engine: runItems.engine,
        country: runItems.country,
        status: runItems.status,
        skipReason: runItems.skipReason,
        inferredMentioned: runItems.inferredMentioned,
        answerId: answers.id,
      })
      .from(runItems)
      .leftJoin(answers, eq(answers.runItemId, runItems.id))
      .where(inArray(runItems.runId, runIds))
      .orderBy(asc(runItems.id));
    const answerIds = items.flatMap((i) => (i.answerId ? [i.answerId] : []));

    const byAnswer = new Map<string, NonNullable<Sample["answer"]>>();
    for (const id of answerIds) byAnswer.set(id, { mentions: [], citations: [] });
    for (let i = 0; i < answerIds.length; i += 1000) {
      const chunk = answerIds.slice(i, i + 1000);
      const [ms, cs] = await Promise.all([
        db
          .select({
            answerId: mentions.answerId,
            competitorId: mentions.competitorId,
            position: mentions.position,
            sentiment: mentions.sentiment,
          })
          .from(mentions)
          .where(inArray(mentions.answerId, chunk)),
        db
          .select({
            answerId: citations.answerId,
            kind: citations.kind,
            competitorId: citations.competitorId,
          })
          .from(citations)
          .where(inArray(citations.answerId, chunk)),
      ]);
      for (const { answerId, ...m } of ms) byAnswer.get(answerId)!.mentions.push(m);
      for (const { answerId, ...c } of cs) byAnswer.get(answerId)!.citations.push(c);
    }

    for (const it of items) {
      const base = { promptId: it.promptId, engine: it.engine, country: it.country ?? "" };
      const sample: Sample | null =
        it.status === "done" && it.answerId
          ? { ...base, answer: byAnswer.get(it.answerId) }
          : it.skipReason === "sampling" && it.inferredMentioned !== null
            ? { ...base, inferredMentioned: it.inferredMentioned }
            : null;
      if (!sample) continue;
      const brandId = brandOfRun.get(it.runId)!;
      const tracked = (entities.get(brandId) ?? []).map((e) => e.competitorId);
      for (const [competitorId, c] of countSample(sample, tracked)) {
        const id = [brandId, sample.engine, sample.country, sample.promptId, competitorId].join(
          "|",
        );
        const cell = cells.get(id);
        if (cell) for (const k of Object.keys(ZERO) as (keyof Counters)[]) cell.c[k] += c[k];
        else
          cells.set(id, {
            key: {
              workspaceId,
              brandId,
              day,
              engine: sample.engine,
              country: sample.country,
              promptId: sample.promptId,
              competitorId,
            },
            c,
          });
      }
    }
  }

  await db.transaction(async (tx) => {
    await tx
      .delete(metricsDaily)
      .where(and(eq(metricsDaily.workspaceId, workspaceId), eq(metricsDaily.day, day)));
    const rows = [...cells.values()].map(({ key, c }) => ({ ...key, ...c }));
    for (let i = 0; i < rows.length; i += 500)
      await tx.insert(metricsDaily).values(rows.slice(i, i + 500));
    if (dayRuns.length)
      await tx
        .update(runs)
        .set({ rolledUpAt: now })
        .where(
          inArray(
            runs.id,
            dayRuns.map((r) => r.id),
          ),
        );
  });
}

/** Rebuild every day with a run that's due. Returns the days rebuilt. */
export async function rollupPending(db: AnyDb, now = new Date()): Promise<number> {
  const due = await db
    .select({ workspaceId: runs.workspaceId, createdAt: runs.createdAt })
    .from(runs)
    .where(
      and(
        inArray(runs.status, [...FINISHED]),
        isNull(runs.rolledUpAt),
        // wait for mention detection to finish on this run's answers
        notExists(
          db
            .select({ id: answers.id })
            .from(answers)
            .innerJoin(runItems, eq(answers.runItemId, runItems.id))
            .where(and(eq(runItems.runId, runs.id), isNull(answers.analyzedAt))),
        ),
      ),
    );
  const days = new Set(due.map((r) => `${r.workspaceId} ${dayOf(r.createdAt)}`));
  for (const d of days) {
    const [workspaceId, day] = d.split(" ");
    await rebuildDay(db, workspaceId, day, now);
  }
  return days.size;
}

/** Answers changed after their run was rolled up: count that run's day again. */
export async function markRunsDue(db: AnyDb, answerIds: string[]) {
  if (!answerIds.length) return;
  const ids = db
    .selectDistinct({ id: runItems.runId })
    .from(answers)
    .innerJoin(runItems, eq(answers.runItemId, runItems.id))
    .where(inArray(answers.id, answerIds));
  await db.update(runs).set({ rolledUpAt: null }).where(inArray(runs.id, ids));
}
