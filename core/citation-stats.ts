/**
 * Which sources the engines cite, for a run or the last few weeks: the
 * domains cited most, whose they are, and their most-cited pages.
 * Shares are of answers (did an answer cite it?), not of citations, so one
 * answer listing the same site five times doesn't count five times.
 */

import { and, desc, eq, gte, inArray, sql, type SQL } from "drizzle-orm";
import type { AnyDb } from "@/db/client";
import { answers, citations, competitors, runItems, runs } from "@/db/schema";

export type Scope = { runId: string } | { since: Date };

export type DomainRow = {
  domain: string;
  kind: "owned" | "competitor" | "third_party";
  /** the competitor's name, for their domains */
  competitor: string | null;
  /** answers citing this domain */
  answers: number;
  citations: number;
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
