/**
 * The answer archive: every stored answer, filterable, and one answer in
 * full with its mentions, citations, metadata and the searches the engine ran.
 * Scoped to the workspace like every page query.
 */

import {
  and,
  asc,
  count,
  desc,
  eq,
  exists,
  ilike,
  inArray,
  isNull,
  not,
  or,
  sql,
} from "drizzle-orm";
import type { AnyDb } from "@/db/client";
import {
  answers,
  brands,
  citations,
  competitors,
  mentions,
  prompts,
  runItems,
  runs,
} from "@/db/schema";
import { loadEntities } from "./analysis";
import { findMatches } from "./mentions";
import type { EngineId } from "./providers/types";

export const PAGE_SIZE = 25;

export type ArchiveFilter = {
  engine?: EngineId;
  promptId?: string;
  country?: string;
  runId?: string;
  /** "yes": answers naming your brand; "no": answers that don't */
  named?: "yes" | "no";
  /** words in the answer or its prompt */
  q?: string;
  page?: number;
};

export async function listAnswers(db: AnyDb, workspaceId: string, f: ArchiveFilter) {
  const page = Math.max(1, f.page ?? 1);
  const namesYou = exists(
    db
      .select({ id: mentions.id })
      .from(mentions)
      .where(and(eq(mentions.answerId, answers.id), isNull(mentions.competitorId))),
  );
  const q = f.q?.trim().slice(0, 100);
  const where = and(
    eq(runs.workspaceId, workspaceId),
    f.engine ? eq(runItems.engine, f.engine) : undefined,
    f.promptId ? eq(runItems.promptId, f.promptId) : undefined,
    f.country ? eq(runItems.country, f.country) : undefined,
    f.runId ? eq(runs.id, f.runId) : undefined,
    f.named === "yes" ? namesYou : undefined,
    f.named === "no" ? not(namesYou) : undefined,
    q
      ? or(
          ilike(answers.text, `%${q.replace(/[%_\\]/g, "\\$&")}%`),
          ilike(runItems.promptText, `%${q.replace(/[%_\\]/g, "\\$&")}%`),
        )
      : undefined,
  );
  const base = () =>
    db
      .select({
        id: answers.id,
        at: answers.createdAt,
        text: answers.text,
        engine: runItems.engine,
        country: runItems.country,
        prompt: runItems.promptText,
        sampleIndex: runItems.sampleIndex,
        runId: runs.id,
        reused: sql<boolean>`${answers.reusedFromId} is not null`,
      })
      .from(answers)
      .innerJoin(runItems, eq(answers.runItemId, runItems.id))
      .innerJoin(runs, eq(runItems.runId, runs.id))
      .where(where);

  const [rows, [{ total }]] = await Promise.all([
    base()
      .orderBy(desc(answers.createdAt), asc(runItems.engine))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
    db
      .select({ total: count() })
      .from(answers)
      .innerJoin(runItems, eq(answers.runItemId, runItems.id))
      .innerJoin(runs, eq(runItems.runId, runs.id))
      .where(where),
  ]);

  const named = rows.length
    ? await db
        .select({
          answerId: mentions.answerId,
          competitor: competitors.name,
          snippet: mentions.snippet,
        })
        .from(mentions)
        .leftJoin(competitors, eq(mentions.competitorId, competitors.id))
        .where(
          inArray(
            mentions.answerId,
            rows.map((r) => r.id),
          ),
        )
        .orderBy(asc(mentions.position))
    : [];

  return {
    total,
    page,
    pages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    rows: rows.map(({ text, ...r }) => {
      const mine = named.filter((n) => n.answerId === r.id);
      const own = mine.find((n) => n.competitor === null);
      return {
        ...r,
        namesYou: !!own,
        named: mine.map((n) => n.competitor ?? null),
        excerpt: own?.snippet ?? text.slice(0, 200).replace(/\s+/g, " "),
      };
    }),
  };
}

/** What the filters can offer: the workspace's prompts, engines, countries and recent runs. */
export async function archiveOptions(db: AnyDb, workspaceId: string) {
  const [promptRows, cells, runRows] = await Promise.all([
    db
      .select({ id: prompts.id, text: prompts.text })
      .from(prompts)
      .innerJoin(brands, eq(prompts.brandId, brands.id))
      .where(eq(brands.workspaceId, workspaceId))
      .orderBy(asc(prompts.createdAt)),
    db
      .selectDistinct({ engine: runItems.engine, country: runItems.country })
      .from(runItems)
      .innerJoin(runs, eq(runItems.runId, runs.id))
      .where(and(eq(runs.workspaceId, workspaceId), eq(runItems.status, "done"))),
    db
      .select({ id: runs.id, at: runs.createdAt, trigger: runs.trigger })
      .from(runs)
      .where(and(eq(runs.workspaceId, workspaceId), sql`${runs.doneItems} > 0`))
      .orderBy(desc(runs.createdAt))
      .limit(30),
  ]);
  return {
    prompts: promptRows,
    engines: [...new Set(cells.map((c) => c.engine))],
    countries: [...new Set(cells.flatMap((c) => (c.country ? [c.country] : [])))].sort(),
    runs: runRows,
  };
}

/** The searches the engine says it ran; Bright Data gives ChatGPT's as web_search_query. */
export function fanOut(raw: unknown): string[] {
  const v = (raw as Record<string, unknown> | null)?.web_search_query;
  const list = Array.isArray(v) ? v : typeof v === "string" ? [v] : [];
  return [
    ...new Set(
      list.filter((x): x is string => typeof x === "string" && !!x.trim()).map((x) => x.trim()),
    ),
  ];
}

/** One answer in full. */
export async function getAnswer(db: AnyDb, workspaceId: string, answerId: string) {
  const [a] = await db
    .select({
      id: answers.id,
      text: answers.text,
      raw: answers.raw,
      model: answers.model,
      webSearchTriggered: answers.webSearchTriggered,
      shown: answers.shown,
      latencyMs: answers.latencyMs,
      costUsd: answers.costUsd,
      analysisCostUsd: answers.analysisCostUsd,
      reusedFromId: answers.reusedFromId,
      at: answers.createdAt,
      engine: runItems.engine,
      source: runItems.source,
      country: runItems.country,
      sampleIndex: runItems.sampleIndex,
      prompt: runItems.promptText,
      promptId: runItems.promptId,
      runId: runs.id,
      brandId: runs.brandId,
    })
    .from(answers)
    .innerJoin(runItems, eq(answers.runItemId, runItems.id))
    .innerJoin(runs, eq(runItems.runId, runs.id))
    .where(and(eq(answers.id, answerId), eq(runs.workspaceId, workspaceId)));
  if (!a) return null;

  const [named, cited, entities] = await Promise.all([
    db
      .select({
        competitorId: mentions.competitorId,
        name: sql<string>`coalesce(${competitors.name}, ${brands.name})`,
        position: mentions.position,
        sentiment: mentions.sentiment,
        recommended: mentions.recommended,
        snippet: mentions.snippet,
      })
      .from(mentions)
      .leftJoin(competitors, eq(mentions.competitorId, competitors.id))
      .innerJoin(brands, eq(brands.id, a.brandId))
      .where(eq(mentions.answerId, a.id))
      .orderBy(asc(mentions.position)),
    db
      .select({
        url: citations.url,
        title: citations.title,
        domain: citations.domain,
        kind: citations.kind,
        competitor: competitors.name,
      })
      .from(citations)
      .leftJoin(competitors, eq(citations.competitorId, competitors.id))
      .where(eq(citations.answerId, a.id))
      .orderBy(asc(citations.position), asc(citations.id)),
    loadEntities(db, [a.brandId]),
  ]);

  const { raw, brandId, ...rest } = a;
  return {
    ...rest,
    named,
    cited,
    searches: fanOut(raw),
    /** where each tracked brand is named, for highlighting */
    matches: findMatches(a.text, entities.get(brandId) ?? []),
  };
}
