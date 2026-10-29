/**
 * What the AI traffic page shows: which AI crawlers fetch the site and
 * what, whether they're who they say they are, whether the site answers
 * them properly, which of the pages AI cites they keep fetching, and how
 * many people arrive from each assistant.
 *
 * Visits that claim to be a crawler but come from outside its company's
 * published ranges are counted apart as fakes, never as the crawler.
 */

import { and, desc, eq, gte, isNull, or, sql } from "drizzle-orm";
import type { AnyDb } from "@/db/client";
import { aiVisits, answers, citations, runItems, runs } from "@/db/schema";
import { AGENTS, agentNamed } from "./agents";

/** Visits we believe: verified, or from crawlers that publish no ranges. */
const genuine = or(isNull(aiVisits.verified), eq(aiVisits.verified, true));

export async function crawlerSummary(db: AnyDb, workspaceId: string, since: Date) {
  const rows = await db
    .select({
      agent: aiVisits.agent,
      visits: sql<number>`count(*) filter (where ${aiVisits.verified} is distinct from false)::int`,
      verified: sql<number>`count(*) filter (where ${aiVisits.verified} = true)::int`,
      fake: sql<number>`count(*) filter (where ${aiVisits.verified} = false)::int`,
      pages: sql<number>`count(distinct ${aiVisits.path}) filter (where ${aiVisits.verified} is distinct from false)::int`,
      errors: sql<number>`count(*) filter (where ${aiVisits.status} >= 400 and ${aiVisits.verified} is distinct from false)::int`,
      lastSeen: sql<
        string | null
      >`max(${aiVisits.at}) filter (where ${aiVisits.verified} is distinct from false)::text`,
    })
    .from(aiVisits)
    .where(
      and(
        eq(aiVisits.workspaceId, workspaceId),
        eq(aiVisits.kind, "crawler"),
        gte(aiVisits.at, since),
      ),
    )
    .groupBy(aiVisits.agent);
  const order = AGENTS.map((a) => a.name);
  return rows
    .map((r) => {
      const a = agentNamed(r.agent);
      return {
        ...r,
        owner: a?.owner ?? "",
        purpose: a?.purpose ?? "training",
        /** whether visits can be checked against published ranges */
        checkable: !!a?.ranges?.length,
        lastSeen: r.lastSeen ? new Date(r.lastSeen) : null,
      };
    })
    .sort((a, b) => b.visits - a.visits || order.indexOf(a.agent) - order.indexOf(b.agent));
}

/** Visits per day, for crawlers (genuine ones) and for referrals. */
export async function perDay(db: AnyDb, workspaceId: string, since: Date) {
  const day = sql<string>`to_char(${aiVisits.at} at time zone 'UTC', 'YYYY-MM-DD')`;
  return db
    .select({
      day,
      crawlers: sql<number>`count(*) filter (where ${aiVisits.kind} = 'crawler' and ${aiVisits.verified} is distinct from false)::int`,
      referrals: sql<number>`count(*) filter (where ${aiVisits.kind} = 'referral')::int`,
    })
    .from(aiVisits)
    .where(and(eq(aiVisits.workspaceId, workspaceId), gte(aiVisits.at, since)))
    .groupBy(day)
    .orderBy(day);
}

/** The pages crawlers fetch most, with which crawlers. */
export async function topCrawled(db: AnyDb, workspaceId: string, since: Date, limit = 15) {
  return db
    .select({
      path: aiVisits.path,
      visits: sql<number>`count(*)::int`,
      agents: sql<string[]>`array_agg(distinct ${aiVisits.agent})`,
      errors: sql<number>`count(*) filter (where ${aiVisits.status} >= 400)::int`,
    })
    .from(aiVisits)
    .where(
      and(
        eq(aiVisits.workspaceId, workspaceId),
        eq(aiVisits.kind, "crawler"),
        gte(aiVisits.at, since),
        genuine,
      ),
    )
    .groupBy(aiVisits.path)
    .orderBy(desc(sql`count(*)`), aiVisits.path)
    .limit(limit);
}

/**
 * Your pages that AI answers cite, and when a crawler that feeds answers
 * (search or user agents, not training ones) last fetched each. A cited
 * page no AI crawler has fetched lately is quoted from an old copy.
 */
export async function citedPagesCrawled(db: AnyDb, workspaceId: string) {
  const cited = await db
    .select({
      url: citations.url,
      answers: sql<number>`count(distinct ${citations.answerId})::int`,
    })
    .from(citations)
    .innerJoin(answers, eq(citations.answerId, answers.id))
    .innerJoin(runItems, eq(answers.runItemId, runItems.id))
    .innerJoin(runs, eq(runItems.runId, runs.id))
    .where(and(eq(runs.workspaceId, workspaceId), eq(citations.kind, "owned")))
    .groupBy(citations.url)
    .orderBy(desc(sql`count(distinct ${citations.answerId})`))
    .limit(20);
  if (!cited.length) return [];
  const answering = AGENTS.filter((a) => a.purpose !== "training").map((a) => a.name);
  const visits = await db
    .select({
      path: aiVisits.path,
      agent: aiVisits.agent,
      last: sql<string>`max(${aiVisits.at})::text`,
    })
    .from(aiVisits)
    .where(and(eq(aiVisits.workspaceId, workspaceId), eq(aiVisits.kind, "crawler"), genuine))
    .groupBy(aiVisits.path, aiVisits.agent);
  return cited.map((c) => {
    let path = "/";
    try {
      const u = new URL(c.url);
      path = u.pathname + u.search;
    } catch {
      // keep "/"
    }
    const seen = visits
      .filter(
        (v) => (v.path === path || v.path.split("?")[0] === path) && answering.includes(v.agent),
      )
      .map((v) => ({ agent: v.agent, last: new Date(v.last) }))
      .sort((a, b) => b.last.getTime() - a.last.getTime());
    return {
      url: c.url,
      answers: c.answers,
      lastCrawled: seen[0]?.last ?? null,
      by: seen.map((s) => s.agent),
    };
  });
}

/** People arriving from each assistant, and the pages they land on. */
export async function referrals(db: AnyDb, workspaceId: string, since: Date) {
  const where = and(
    eq(aiVisits.workspaceId, workspaceId),
    eq(aiVisits.kind, "referral"),
    gte(aiVisits.at, since),
  );
  const [byAssistant, landing] = await Promise.all([
    db
      .select({ assistant: aiVisits.agent, visits: sql<number>`count(*)::int` })
      .from(aiVisits)
      .where(where)
      .groupBy(aiVisits.agent)
      .orderBy(desc(sql`count(*)`)),
    db
      .select({
        path: aiVisits.path,
        visits: sql<number>`count(*)::int`,
        assistants: sql<string[]>`array_agg(distinct ${aiVisits.agent})`,
      })
      .from(aiVisits)
      .where(where)
      .groupBy(aiVisits.path)
      .orderBy(desc(sql`count(*)`), aiVisits.path)
      .limit(15),
  ]);
  return { byAssistant, landing };
}

/** Whether anything has come in yet, and from where. */
export async function trafficStatus(db: AnyDb, workspaceId: string) {
  const [row] = await db
    .select({
      total: sql<number>`count(*)::int`,
      last: sql<string | null>`max(${aiVisits.at})::text`,
      fromSnippet: sql<number>`count(*) filter (where ${aiVisits.source} = 'snippet')::int`,
      fromLogs: sql<number>`count(*) filter (where ${aiVisits.source} = 'log')::int`,
    })
    .from(aiVisits)
    .where(eq(aiVisits.workspaceId, workspaceId));
  return { ...row, last: row.last ? new Date(row.last) : null };
}

/** Keep a rolling six months. */
export async function pruneVisits(db: AnyDb, now = new Date()) {
  const r = await db
    .delete(aiVisits)
    .where(
      sql`${aiVisits.at} < ${new Date(now.getTime() - 183 * 86_400_000).toISOString()}::timestamptz`,
    )
    .returning({ id: aiVisits.id });
  return r.length;
}
