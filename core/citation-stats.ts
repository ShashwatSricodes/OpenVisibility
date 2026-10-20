/**
 * Which sources the engines cite, for a run or the last few weeks: the
 * domains cited most, whose they are, and their most-cited pages.
 * Shares are of answers (did an answer cite it?), not of citations, so one
 * answer listing the same site five times doesn't count five times.
 */

import { and, desc, eq, gte, inArray, sql, type SQL } from "drizzle-orm";
import type { AnyDb } from "@/db/client";
import { answers, citations, competitors, runItems, runs } from "@/db/schema";
import type { EngineId } from "./providers/types";

export type Scope = { runId: string } | { since: Date; engine?: EngineId };

export type DomainRow = {
  domain: string;
  kind: "owned" | "competitor" | "third_party";
  /** the competitor's name, for their domains */
  competitor: string | null;
  /** answers citing this domain */
  answers: number;
  citations: number;
  /** the engines whose answers cite it */
  engines: EngineId[];
  pages: { url: string; title: string | null; answers: number }[];
};

export type CitationSummary = {
  /** answers in scope */
  answers: number;
  /** answers that cite at least one source */
  withSources: number;
  /** answers citing the brand's own site, or a competitor's */
  citingOwned: number;
  citingCompetitor: number;
  domains: DomainRow[];
};

function scopeWhere(workspaceId: string, scope: Scope): SQL {
  return and(
    eq(runs.workspaceId, workspaceId),
    "runId" in scope ? eq(runs.id, scope.runId) : gte(answers.createdAt, scope.since),
    "engine" in scope && scope.engine ? eq(runItems.engine, scope.engine) : undefined,
  )!;
}

export async function citationSummary(
  db: AnyDb,
  workspaceId: string,
  scope: Scope,
  { limit = 50, pagesPerDomain = 5 } = {},
): Promise<CitationSummary> {
  const where = scopeWhere(workspaceId, scope);

  const [totals] = await db
    .select({
      answers: sql<number>`count(distinct ${answers.id})::int`,
      withSources: sql<number>`count(distinct ${citations.answerId})::int`,
      citingOwned: sql<number>`count(distinct ${citations.answerId}) filter (where ${citations.kind} = 'owned')::int`,
      citingCompetitor: sql<number>`count(distinct ${citations.answerId}) filter (where ${citations.kind} = 'competitor')::int`,
    })
    .from(answers)
    .innerJoin(runItems, eq(answers.runItemId, runItems.id))
    .innerJoin(runs, eq(runItems.runId, runs.id))
    .leftJoin(citations, eq(citations.answerId, answers.id))
    .where(where);

  const top = await db
    .select({
      domain: citations.domain,
      kind: sql<DomainRow["kind"]>`min(${citations.kind}::text)`,
      competitor: sql<string | null>`min(${competitors.name})`,
      answers: sql<number>`count(distinct ${citations.answerId})::int`,
      citations: sql<number>`count(*)::int`,
      engines: sql<EngineId[]>`array_agg(distinct ${runItems.engine}::text)`,
    })
    .from(citations)
    .innerJoin(answers, eq(citations.answerId, answers.id))
    .innerJoin(runItems, eq(answers.runItemId, runItems.id))
    .innerJoin(runs, eq(runItems.runId, runs.id))
    .leftJoin(competitors, eq(citations.competitorId, competitors.id))
    .where(where)
    .groupBy(citations.domain)
    .orderBy(
      desc(sql`count(distinct ${citations.answerId})`),
      desc(sql`count(*)`),
      citations.domain,
    )
    .limit(limit);

  const pages = top.length
    ? await db
        .select({
          domain: citations.domain,
          url: citations.url,
          title: sql<string | null>`max(${citations.title})`,
          answers: sql<number>`count(distinct ${citations.answerId})::int`,
        })
        .from(citations)
        .innerJoin(answers, eq(citations.answerId, answers.id))
        .innerJoin(runItems, eq(answers.runItemId, runItems.id))
        .innerJoin(runs, eq(runItems.runId, runs.id))
        .where(
          and(
            where,
            inArray(
              citations.domain,
              top.map((t) => t.domain),
            ),
          ),
        )
        .groupBy(citations.domain, citations.url)
        .orderBy(desc(sql`count(distinct ${citations.answerId})`), citations.url)
    : [];

  return {
    ...(totals ?? { answers: 0, withSources: 0, citingOwned: 0, citingCompetitor: 0 }),
    domains: top.map((t) => ({
      ...t,
      pages: pages
        .filter((p) => p.domain === t.domain)
        .slice(0, pagesPerDomain)
        .map(({ url, title, answers: n }) => ({ url, title, answers: n })),
    })),
  };
}

/** For each engine: how many of its answers cite your site, a competitor's, or only third parties. */
export async function citationsByEngine(db: AnyDb, workspaceId: string, scope: Scope) {
  const rows = await db
    .select({
      engine: runItems.engine,
      answers: sql<number>`count(distinct ${answers.id})::int`,
      withSources: sql<number>`count(distinct ${citations.answerId})::int`,
      owned: sql<number>`count(distinct ${citations.answerId}) filter (where ${citations.kind} = 'owned')::int`,
      competitor: sql<number>`count(distinct ${citations.answerId}) filter (where ${citations.kind} = 'competitor')::int`,
      thirdParty: sql<number>`count(distinct ${citations.answerId}) filter (where ${citations.kind} = 'third_party')::int`,
    })
    .from(answers)
    .innerJoin(runItems, eq(answers.runItemId, runItems.id))
    .innerJoin(runs, eq(runItems.runId, runs.id))
    .leftJoin(citations, eq(citations.answerId, answers.id))
    .where(scopeWhere(workspaceId, scope))
    .groupBy(runItems.engine)
    .orderBy(runItems.engine);
  return rows;
}

const dayOf = sql<string>`to_char(${answers.createdAt} at time zone 'UTC', 'YYYY-MM-DD')`;

/**
 * The most-cited pages, each with its position in the sources list per day
 * (1 = cited first), to see a page rising or falling.
 */
export async function pageTrends(
  db: AnyDb,
  workspaceId: string,
  scope: Scope,
  { limit = 15 } = {},
) {
  const where = scopeWhere(workspaceId, scope);
  const top = await db
    .select({
      url: citations.url,
      domain: citations.domain,
      kind: sql<DomainRow["kind"]>`min(${citations.kind}::text)`,
      competitor: sql<string | null>`min(${competitors.name})`,
      title: sql<string | null>`max(${citations.title})`,
      answers: sql<number>`count(distinct ${citations.answerId})::int`,
      position: sql<number | null>`avg(${citations.position})::float8`,
    })
    .from(citations)
    .innerJoin(answers, eq(citations.answerId, answers.id))
    .innerJoin(runItems, eq(answers.runItemId, runItems.id))
    .innerJoin(runs, eq(runItems.runId, runs.id))
    .leftJoin(competitors, eq(citations.competitorId, competitors.id))
    .where(where)
    .groupBy(citations.url, citations.domain)
    .orderBy(desc(sql`count(distinct ${citations.answerId})`), citations.url)
    .limit(limit);
  if (!top.length) return [];
  const daily = await db
    .select({
      url: citations.url,
      day: dayOf,
      position: sql<number | null>`avg(${citations.position})::float8`,
    })
    .from(citations)
    .innerJoin(answers, eq(citations.answerId, answers.id))
    .innerJoin(runItems, eq(answers.runItemId, runItems.id))
    .innerJoin(runs, eq(runItems.runId, runs.id))
    .where(
      and(
        where,
        inArray(
          citations.url,
          top.map((t) => t.url),
        ),
      ),
    )
    .groupBy(citations.url, dayOf);
  return top.map((t) => ({
    ...t,
    byDay: daily.filter((d) => d.url === t.url).map(({ day, position }) => ({ day, position })),
  }));
}

/**
 * Your pages that engines have cited at any time, with how often in this
 * period: a page at 0 has stopped being cited. (Pages never cited at all
 * need your sitemap; that comes with the GEO audit.)
 */
export async function ownedPages(
  db: AnyDb,
  workspaceId: string,
  scope: { since: Date; engine?: EngineId },
) {
  return db
    .select({
      url: citations.url,
      title: sql<string | null>`max(${citations.title})`,
      inPeriod: sql<number>`count(distinct ${citations.answerId}) filter (where ${answers.createdAt} >= ${scope.since.toISOString()}::timestamptz${scope.engine ? sql` and ${runItems.engine} = ${scope.engine}` : sql``})::int`,
      allTime: sql<number>`count(distinct ${citations.answerId})::int`,
      lastCited: sql<string>`max(${answers.createdAt})::text`,
    })
    .from(citations)
    .innerJoin(answers, eq(citations.answerId, answers.id))
    .innerJoin(runItems, eq(answers.runItemId, runItems.id))
    .innerJoin(runs, eq(runItems.runId, runs.id))
    .where(and(eq(runs.workspaceId, workspaceId), eq(citations.kind, "owned")))
    .groupBy(citations.url)
    .orderBy(desc(sql`count(distinct ${citations.answerId})`));
}
