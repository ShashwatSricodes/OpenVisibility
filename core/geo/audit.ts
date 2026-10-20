/**
 * The GEO audit, part 1: can AI crawlers read the brand's own site?
 *
 * Per owned domain: robots.txt (and what it says to each AI crawler),
 * llms.txt, and the sitemap. Then up to MAX_PAGES pages (the home page, the
 * pages answers already cite, then the sitemap's) are fetched as a crawler
 * would, without running JavaScript, and checked (core/geo/page.ts).
 *
 * The worker does the fetching a few pages per tick, so a slow site never
 * holds up runs; the Audit page refreshes while it works. Results are kept
 * until the audit is run again.
 */

import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { AnyDb } from "@/db/client";
import { answers, brands, citations, pageAudits, runItems, runs, siteAudits } from "@/db/schema";
import { normalizeUrl } from "../citations";
import { CRAWLERS } from "./crawlers";
import { safeGet, type Net } from "./fetch";
import { blockedFor, pageIssues, readPage, type PageCheck } from "./page";
import { parseRobots, verdictFor, type RobotsFile } from "./robots";

export const MAX_PAGES = 25;
const MAX_CITED = 10;

const sameSite = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`);

/* ── queueing ─────────────────────────────────────────────── */

export async function queueAudits(db: AnyDb, workspaceId: string) {
  const [brand] = await db
    .select({ domains: brands.domains })
    .from(brands)
    .where(eq(brands.workspaceId, workspaceId))
    .limit(1);
  const domains = brand?.domains ?? [];
  if (!domains.length)
    return { ok: false as const, message: "Add your website's domain in setup first." };
  const [busy] = await db
    .select({ id: siteAudits.id })
    .from(siteAudits)
    .where(
      and(
        eq(siteAudits.workspaceId, workspaceId),
        inArray(siteAudits.status, ["queued", "running"]),
      ),
    )
    .limit(1);
  if (busy) return { ok: false as const, message: "An audit is already running." };
  await db.delete(siteAudits).where(eq(siteAudits.workspaceId, workspaceId));
  await db.insert(siteAudits).values(domains.map((domain) => ({ workspaceId, domain })));
  return { ok: true as const, domains: domains.length };
}

/* ── discovery ────────────────────────────────────────────── */

export async function fetchRobots(
  origin: string,
  net: Net,
): Promise<{ file: RobotsFile; text: string | null }> {
  const r = await safeGet(`${origin}/robots.txt`, net, {
    maxBytes: 500_000,
    accept: "text/plain,*/*",
  });
  if (r.status !== null && r.status >= 200 && r.status < 300)
    return { file: { state: "found", robots: parseRobots(r.body) }, text: r.body };
  if (r.status !== null && r.status >= 400 && r.status < 500)
    return { file: { state: "missing" }, text: null };
  return { file: { state: "unreachable", status: r.status }, text: null };
}

/** The <loc> URLs in a sitemap, and whether it's an index of other sitemaps. */
export function parseSitemap(xml: string) {
  const locs = [
    ...xml.matchAll(/<loc>\s*(?:<!\[CDATA\[)?\s*([^<\]]+?)\s*(?:\]\]>)?\s*<\/loc>/gi),
  ].map((m) => m[1].replace(/&amp;/g, "&").trim());
  return { index: /<sitemapindex[\s>]/i.test(xml), locs };
}

async function sitemapPages(candidates: string[], domain: string, net: Net) {
  for (const url of candidates) {
    const r = await safeGet(url, net, { accept: "application/xml,text/xml,*/*" });
    if (!r.status || r.status >= 400 || !/<(urlset|sitemapindex)[\s>]/i.test(r.body)) continue;
    const s = parseSitemap(r.body);
    if (!s.index) return { sitemap: url, pages: s.locs };
    // an index: read the first few sitemaps it lists
    const pages: string[] = [];
    for (const child of s.locs.slice(0, 3)) {
      const c = await safeGet(child, net, { accept: "application/xml,text/xml,*/*" });
      if (c.status && c.status < 400) pages.push(...parseSitemap(c.body).locs);
      if (pages.length >= MAX_PAGES * 4) break;
    }
    return { sitemap: url, pages };
  }
  return { sitemap: null, pages: [] as string[] };
}

/** Owned pages the engines cite most, for this domain. */
async function citedPages(db: AnyDb, workspaceId: string, domain: string) {
  const rows = await db
    .select({ url: citations.url, domain: citations.domain })
    .from(citations)
    .innerJoin(answers, eq(citations.answerId, answers.id))
    .innerJoin(runItems, eq(answers.runItemId, runItems.id))
    .innerJoin(runs, eq(runItems.runId, runs.id))
    .where(and(eq(runs.workspaceId, workspaceId), eq(citations.kind, "owned")))
    .groupBy(citations.url, citations.domain)
    .orderBy(desc(sql`count(distinct ${citations.answerId})`))
    .limit(100);
  return rows
    .filter((r) => sameSite(r.domain, domain))
    .map((r) => r.url)
    .slice(0, MAX_CITED);
}

/** The pages to check: home first, then cited pages, then the sitemap's, each once. */
export function pickPages(
  domain: string,
  cited: string[],
  sitemap: string[],
  limit = MAX_PAGES,
): { url: string; source: "home" | "cited" | "sitemap" }[] {
  const seen = new Set<string>();
  const out: { url: string; source: "home" | "cited" | "sitemap" }[] = [];
  const add = (raw: string, source: "home" | "cited" | "sitemap") => {
    const n = normalizeUrl(raw);
    if (!n || !sameSite(n.domain, domain) || seen.has(n.url) || out.length >= limit) return;
    seen.add(n.url);
    out.push({ url: raw.startsWith("http") ? raw : n.url, source });
  };
  add(`https://${domain}/`, "home");
  for (const u of cited) add(u, "cited");
  for (const u of sitemap) add(u, "sitemap");
  return out;
}

/* ── checking a page ──────────────────────────────────────── */

export async function checkPage(
  url: string,
  robots: RobotsFile,
  domain: string,
  net: Net,
): Promise<PageCheck> {
  const r = await safeGet(url, net);
  const html = /html|xml/i.test(r.headers?.get("content-type") ?? "text/html");
  let blocked = { blocked: [] as string[], blockedTraining: [] as string[] };
  try {
    const u = new URL(r.finalUrl);
    // robots.txt only speaks for its own host
    if (sameSite(u.hostname.replace(/^www\./, ""), domain))
      blocked = blockedFor(robots, u.pathname + u.search);
  } catch {
    // an unparseable final URL already shows as an error
  }
  return {
    url,
    finalUrl: r.finalUrl,
    status: r.status,
    error: r.error,
    redirects: r.redirects.length,
    ms: r.ms,
    facts:
      r.status && r.status < 400 && html
        ? readPage(r.body, r.headers?.get("x-robots-tag") ?? null)
        : null,
    ...blocked,
  };
}

/* ── the worker step ──────────────────────────────────────── */

const robotsOf = (a: { robotsState: string | null; robotsText: string | null }): RobotsFile =>
  a.robotsState === "found"
    ? { state: "found", robots: parseRobots(a.robotsText ?? "") }
    : a.robotsState === "unreachable"
      ? { state: "unreachable", status: null }
      : { state: "missing" };

/**
 * Start one queued audit (robots.txt, llms.txt, sitemap, the page list),
 * then check up to `pages` pages of running audits. Returns pages checked.
 */
export async function auditPending(db: AnyDb, net: Net, { pages = 6, now = new Date() } = {}) {
  const [queued] = await db
    .select()
    .from(siteAudits)
    .where(eq(siteAudits.status, "queued"))
    .orderBy(asc(siteAudits.requestedAt))
    .limit(1);
  if (queued) {
    // claim it, so two workers don't both start it
    const claimed = await db
      .update(siteAudits)
      .set({ status: "running", startedAt: now })
      .where(and(eq(siteAudits.id, queued.id), eq(siteAudits.status, "queued")))
      .returning({ id: siteAudits.id });
    if (claimed.length) {
      const origin = `https://${queued.domain}`;
      const home = await safeGet(`${origin}/`, net, { maxBytes: 1 });
      if (home.error && home.status === null) {
        await db
          .update(siteAudits)
          .set({ status: "done", finishedAt: now, error: home.error })
          .where(eq(siteAudits.id, queued.id));
      } else {
        const [robots, llms, cited] = await Promise.all([
          fetchRobots(origin, net),
          safeGet(`${origin}/llms.txt`, net, {
            maxBytes: 1,
            accept: "text/plain,text/markdown,*/*",
          }),
          citedPages(db, queued.workspaceId, queued.domain),
        ]);
        const listed =
          robots.file.state === "found"
            ? robots.file.robots.sitemaps.filter((s) => {
                try {
                  return sameSite(new URL(s).hostname.replace(/^www\./, ""), queued.domain);
                } catch {
                  return false;
                }
              })
            : [];
        const map = await sitemapPages([...listed, `${origin}/sitemap.xml`], queued.domain, net);
        const picked = pickPages(queued.domain, cited, map.pages);
        await db
          .update(siteAudits)
          .set({
            robotsState: robots.file.state,
            robotsText: robots.text?.slice(0, 100_000) ?? null,
            llmsTxtStatus: llms.status,
            sitemapUrl: map.sitemap,
          })
          .where(eq(siteAudits.id, queued.id));
        await db
          .insert(pageAudits)
          .values(picked.map((p, position) => ({ auditId: queued.id, position, ...p })));
      }
    }
  }

  const todo = await db
    .select({ page: pageAudits, audit: siteAudits })
    .from(pageAudits)
    .innerJoin(siteAudits, eq(pageAudits.auditId, siteAudits.id))
    .where(and(eq(siteAudits.status, "running"), isNull(pageAudits.checkedAt)))
    .orderBy(asc(siteAudits.requestedAt), asc(pageAudits.position))
    .limit(pages);
  await Promise.all(
    todo.map(async ({ page, audit }) => {
      const result = await checkPage(page.url, robotsOf(audit), audit.domain, net);
      await db
        .update(pageAudits)
        .set({ result, checkedAt: new Date() })
        .where(eq(pageAudits.id, page.id));
    }),
  );

  // finish audits with nothing left to check
  const running = await db
    .select({ id: siteAudits.id })
    .from(siteAudits)
    .where(eq(siteAudits.status, "running"));
  for (const a of running) {
    const [left] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(pageAudits)
      .where(and(eq(pageAudits.auditId, a.id), isNull(pageAudits.checkedAt)));
    if (left.n === 0)
      await db
        .update(siteAudits)
        .set({ status: "done", finishedAt: new Date() })
        .where(and(eq(siteAudits.id, a.id), eq(siteAudits.status, "running")));
  }
  return todo.length;
}

/* ── reading results ──────────────────────────────────────── */

/** The workspace's latest audit, per domain: crawlers, llms.txt, and pages with their issues. */
export async function getAudit(db: AnyDb, workspaceId: string) {
  const sites = await db
    .select()
    .from(siteAudits)
    .where(eq(siteAudits.workspaceId, workspaceId))
    .orderBy(asc(siteAudits.domain));
  const pageRows = sites.length
    ? await db
        .select()
        .from(pageAudits)
        .where(
          inArray(
            pageAudits.auditId,
            sites.map((s) => s.id),
          ),
        )
        .orderBy(asc(pageAudits.position))
    : [];
  return sites.map((s) => {
    const robots = robotsOf(s);
    const pages = pageRows
      .filter((p) => p.auditId === s.id)
      .map((p) => {
        const check = p.result as PageCheck | null;
        return {
          id: p.id,
          url: p.url,
          source: p.source,
          position: p.position,
          check,
          issues: check ? pageIssues(check) : [],
        };
      })
      .sort(
        (a, b) =>
          b.issues.filter((i) => i.severity === "problem").length -
            a.issues.filter((i) => i.severity === "problem").length || a.position - b.position,
      );
    return {
      id: s.id,
      domain: s.domain,
      status: s.status,
      requestedAt: s.requestedAt,
      finishedAt: s.finishedAt,
      error: s.error,
      robotsState: s.robotsState,
      sitemapUrl: s.sitemapUrl,
      llmsTxt: s.llmsTxtStatus !== null && s.llmsTxtStatus >= 200 && s.llmsTxtStatus < 300,
      // what robots.txt says to each crawler about the home page
      crawlers: CRAWLERS.map((c) => ({ ...c, verdict: verdictFor(robots, c.agent, "/") })),
      checked: pages.filter((p) => p.check).length,
      pages,
    };
  });
}

export type SiteAudit = Awaited<ReturnType<typeof getAudit>>[number];
