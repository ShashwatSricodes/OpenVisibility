/**
 * CSV exports: answers, mentions, citations and the daily metrics, filtered
 * like the page they're downloaded from. Rows are read in batches and
 * written as they come, so a large export streams instead of timing out.
 *
 * The files are meant to open cleanly in Excel and Google Sheets: UTF-8 with
 * a byte-order mark (or Excel garbles non-English text), CRLF line ends,
 * every text field quoted, and text that starts like a formula ("=", "+",
 * "-", "@") prefixed with an apostrophe so a spreadsheet won't run it.
 * Every row comes from answers that are already stored: nothing here calls a
 * provider, so an export costs nothing.
 */

import { and, asc, eq, gte, inArray, lte, sql, type SQL } from "drizzle-orm";
import type { AnyDb } from "@/db/client";
import {
  answers,
  brands,
  citations,
  competitors,
  mentions,
  metricsDaily,
  prompts,
  runItems,
  runs,
} from "@/db/schema";
import { archiveWhere, type ArchiveFilter } from "./answer-archive";
import { countryName } from "./countries";
import { metricsOf, type Counters } from "./metrics";
import type { MetricsFilter } from "./metrics-query";
import { ENGINES } from "./providers/registry";
import type { EngineId } from "./providers/types";

export const EXPORTS = {
  answers: { label: "Answers", hint: "Every answer, word for word" },
  mentions: { label: "Mentions", hint: "Each brand named, with its position" },
  citations: { label: "Citations", hint: "Each source cited, and whose it is" },
  metrics: { label: "Daily metrics", hint: "Per day, engine, country, prompt and brand" },
} as const;
export type ExportKind = keyof typeof EXPORTS;
export const isExportKind = (v: unknown): v is ExportKind => typeof v === "string" && v in EXPORTS;

/* ── CSV ──────────────────────────────────────────────────── */

export type Cell = string | number | boolean | null | undefined;

export function csvCell(v: Cell): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  if (typeof v === "boolean") return v ? "yes" : "no";
  // a leading = + - @ (or tab/CR) makes Excel and Sheets treat text as a formula
  const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return `"${safe.replace(/"/g, '""')}"`;
}

export const csvRow = (cells: Cell[]) => cells.map(csvCell).join(",") + "\r\n";

/** "2026-10-20 14:03:11", UTC; sorts as text and Excel reads it as a date. */
const stamp = (d: Date) => d.toISOString().slice(0, 19).replace("T", " ");
const round = (v: number | null, digits = 4) =>
  v === null ? null : Math.round(v * 10 ** digits) / 10 ** digits;

/* ── rows ─────────────────────────────────────────────────── */

const BATCH = 500;

function answerPage(
  db: AnyDb,
  where: SQL | undefined,
  after: { at: string; id: string } | null,
  batch: number,
) {
  return db
    .select({
      id: answers.id,
      cursor: sql<string>`${answers.createdAt}::text`,
      at: answers.createdAt,
      text: answers.text,
      model: answers.model,
      webSearch: answers.webSearchTriggered,
      reused: sql<boolean>`${answers.reusedFromId} is not null`,
      runId: runs.id,
      engine: runItems.engine,
      country: runItems.country,
      prompt: runItems.promptText,
      sample: runItems.sampleIndex,
    })
    .from(answers)
    .innerJoin(runItems, eq(answers.runItemId, runItems.id))
    .innerJoin(runs, eq(runItems.runId, runs.id))
    .where(
      and(
        where,
        after
          ? sql`(${answers.createdAt}, ${answers.id}) > (${after.at}::timestamptz, ${after.id}::uuid)`
          : undefined,
      ),
    )
    .orderBy(asc(answers.createdAt), asc(answers.id))
    .limit(batch);
}

/**
 * The answers a filter selects, oldest first, a batch at a time. The cursor
 * is the timestamp as text, so microseconds survive the round trip.
 */
async function* answerBatches(db: AnyDb, workspaceId: string, f: ArchiveFilter, size = BATCH) {
  const where = archiveWhere(db, workspaceId, f);
  let after: { at: string; id: string } | null = null;
  for (;;) {
    const rows = await answerPage(db, where, after, size);
    if (!rows.length) return;
    yield rows;
    if (rows.length < size) return;
    const last = rows[rows.length - 1];
    after = { at: last.cursor, id: last.id };
  }
}

const about = (a: { at: Date; engine: EngineId; country: string | null; prompt: string }) => [
  stamp(a.at),
  ENGINES[a.engine].name,
  a.country ? countryName(a.country) : null,
  a.prompt,
];
const ABOUT = ["Date (UTC)", "Engine", "Country", "Prompt"];

async function mentionsOf(db: AnyDb, ids: string[]) {
  return db
    .select({
      answerId: mentions.answerId,
      competitorId: mentions.competitorId,
      brand: competitors.name,
      position: mentions.position,
      sentiment: mentions.sentiment,
      recommended: mentions.recommended,
      snippet: mentions.snippet,
    })
    .from(mentions)
    .leftJoin(competitors, eq(mentions.competitorId, competitors.id))
    .where(inArray(mentions.answerId, ids))
    .orderBy(asc(mentions.answerId), sql`${mentions.position} asc nulls last`);
}

async function brandName(db: AnyDb, workspaceId: string) {
  const [own] = await db
    .select({ name: brands.name })
    .from(brands)
    .where(eq(brands.workspaceId, workspaceId))
    .limit(1);
  return own?.name ?? "Your brand";
}

async function* answerRows(db: AnyDb, workspaceId: string, f: ArchiveFilter, size = BATCH) {
  yield [
    ...ABOUT,
    "Sample",
    "Names you",
    "Your position",
    "Brands named",
    "Sources cited",
    "Reused",
    "Model",
    "Searched the web",
    "Answer ID",
    "Run ID",
    "Answer",
  ];
  const own = await brandName(db, workspaceId);
  for await (const batch of answerBatches(db, workspaceId, f, size)) {
    const ids = batch.map((a) => a.id);
    const [named, cited] = await Promise.all([
      mentionsOf(db, ids),
      db
        .select({ answerId: citations.answerId, n: sql<number>`count(*)::int` })
        .from(citations)
        .where(inArray(citations.answerId, ids))
        .groupBy(citations.answerId),
    ]);
    for (const a of batch) {
      const mine = named.filter((m) => m.answerId === a.id);
      const you = mine.find((m) => m.competitorId === null);
      yield [
        ...about(a),
        a.sample + 1,
        !!you,
        you?.position ?? null,
        mine.map((m) => m.brand ?? own).join("; "),
        cited.find((c) => c.answerId === a.id)?.n ?? 0,
        a.reused,
        a.model,
        a.webSearch,
        a.id,
        a.runId,
        a.text,
      ];
    }
  }
}

async function* mentionRows(db: AnyDb, workspaceId: string, f: ArchiveFilter, size = BATCH) {
  yield [
    ...ABOUT,
    "Brand",
    "Yours",
    "Position",
    "Sentiment",
    "Recommended",
    "Sentence",
    "Answer ID",
  ];
  const own = await brandName(db, workspaceId);
  for await (const batch of answerBatches(db, workspaceId, f, size)) {
    const named = await mentionsOf(
      db,
      batch.map((a) => a.id),
    );
    for (const a of batch)
      for (const m of named.filter((x) => x.answerId === a.id))
        yield [
          ...about(a),
          m.brand ?? own,
          m.competitorId === null,
          m.position,
          round(m.sentiment, 3),
          m.recommended,
          m.snippet,
          a.id,
        ];
  }
}

const WHOSE = { owned: "Yours", competitor: "Competitor", third_party: "Third party" };

async function* citationRows(db: AnyDb, workspaceId: string, f: ArchiveFilter, size = BATCH) {
  yield [...ABOUT, "Position", "URL", "Domain", "Title", "Whose", "Competitor", "Answer ID"];
  for await (const batch of answerBatches(db, workspaceId, f, size)) {
    const cited = await db
      .select({
        answerId: citations.answerId,
        url: citations.url,
        domain: citations.domain,
        title: citations.title,
        position: citations.position,
        kind: citations.kind,
        competitor: competitors.name,
      })
      .from(citations)
      .leftJoin(competitors, eq(citations.competitorId, competitors.id))
      .where(
        inArray(
          citations.answerId,
          batch.map((a) => a.id),
        ),
      )
      .orderBy(asc(citations.answerId), sql`${citations.position} asc nulls last`);
    for (const a of batch)
      for (const c of cited.filter((x) => x.answerId === a.id))
        yield [
          ...about(a),
          c.position,
          c.url,
          c.domain,
          c.title,
          WHOSE[c.kind],
          c.competitor,
          a.id,
        ];
  }
}

const COUNTERS: [keyof Counters, string][] = [
  ["samples", "Samples"],
  ["asked", "Asked"],
  ["mentioned", "Samples naming the brand"],
  ["mentions", "Times named"],
  ["allMentions", "Times any brand named"],
  ["positioned", "Samples with a position"],
  ["positionSum", "Position sum"],
  ["reciprocalSum", "Reciprocal position sum"],
  ["citations", "Answers citing its site"],
  ["allCitations", "Answers citing any tracked site"],
  ["rated", "Mentions rated"],
  ["sentimentSum", "Sentiment sum"],
  ["positive", "Positive"],
  ["negative", "Negative"],
];

/** metrics_daily as stored (counters, so any selection can be summed), plus the metrics per row. */
async function* metricRows(db: AnyDb, workspaceId: string, f: MetricsFilter, batch = BATCH) {
  yield [
    "Day",
    "Engine",
    "Country",
    "Prompt",
    "Brand",
    "Yours",
    "Mention rate",
    "Average position",
    "Share of voice",
    "Citation share",
    "Sentiment",
    "Visibility index",
    ...COUNTERS.map(([, label]) => label),
  ];
  const own = await brandName(db, workspaceId);
  const where = and(
    eq(metricsDaily.workspaceId, workspaceId),
    gte(metricsDaily.day, f.from),
    lte(metricsDaily.day, f.to),
    f.engines?.length ? inArray(metricsDaily.engine, f.engines) : undefined,
    f.countries?.length ? inArray(metricsDaily.country, f.countries) : undefined,
  );
  for (let offset = 0; ; offset += batch) {
    const rows = await db
      .select({
        row: metricsDaily,
        prompt: prompts.text,
        competitor: competitors.name,
      })
      .from(metricsDaily)
      .leftJoin(prompts, eq(metricsDaily.promptId, prompts.id))
      .leftJoin(competitors, eq(metricsDaily.competitorId, competitors.id))
      .where(where)
      .orderBy(
        asc(metricsDaily.day),
        asc(metricsDaily.engine),
        asc(metricsDaily.country),
        asc(metricsDaily.promptId),
        sql`${metricsDaily.competitorId} asc nulls first`,
        asc(metricsDaily.id),
      )
      .limit(batch)
      .offset(offset);
    for (const { row: r, prompt, competitor } of rows) {
      const m = metricsOf(r);
      yield [
        r.day,
        ENGINES[r.engine].name,
        r.country ? countryName(r.country) : null,
        prompt ?? "(deleted prompt)",
        r.competitorId === null ? own : competitor,
        r.competitorId === null,
        round(m.mentionRate),
        round(m.averagePosition, 2),
        round(m.shareOfVoice),
        round(m.citationShare),
        round(m.sentiment, 3),
        round(m.visibilityIndex, 1),
        ...COUNTERS.map(([k]) => round(r[k])),
      ];
    }
    if (rows.length < batch) return;
  }
}

export type ExportFilter = {
  archive: ArchiveFilter;
  metrics: MetricsFilter;
  /** rows per database read; smaller only in tests */
  batch?: number;
};

export function exportRows(
  db: AnyDb,
  workspaceId: string,
  kind: ExportKind,
  f: ExportFilter,
): AsyncGenerator<Cell[]> {
  switch (kind) {
    case "answers":
      return answerRows(db, workspaceId, f.archive, f.batch);
    case "mentions":
      return mentionRows(db, workspaceId, f.archive, f.batch);
    case "citations":
      return citationRows(db, workspaceId, f.archive, f.batch);
    case "metrics":
      return metricRows(db, workspaceId, f.metrics, f.batch);
  }
}

/**
 * The whole file as a stream of UTF-8 bytes: a BOM, the header row, then the
 * rows. No title or note lines above the header, so the file loads straight
 * into a spreadsheet, pandas or a database.
 */
export function csvStream(rows: AsyncGenerator<Cell[]>) {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(encoder.encode("﻿"));
    },
    async pull(controller) {
      // a few hundred rows per chunk keeps memory flat without a write per row
      let chunk = "";
      for (let i = 0; i < 200; i++) {
        const next = await rows.next();
        if (next.done) {
          if (chunk) controller.enqueue(encoder.encode(chunk));
          controller.close();
          return;
        }
        chunk += csvRow(next.value);
      }
      controller.enqueue(encoder.encode(chunk));
    },
    async cancel() {
      await rows.return(undefined);
    },
  });
}
