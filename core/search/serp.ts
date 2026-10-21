/**
 * Google's top results for each prompt, through Bright Data's SERP API: the
 * pages that rank for the questions your buyers ask. AI Overviews and AI
 * Mode mostly quote pages that already rank, so a page in the top five is
 * worth being on even before an AI answer cites it.
 *
 * Each prompt is searched twice, as asked ("What is the best invoicing
 * software for freelancers?") and as a short keyword search ("best invoicing
 * software freelancers"), since the two can rank different pages; the top
 * five across both are kept. Weekly, per tracked country, a few prompts per
 * worker tick. Off unless BRIGHT_DATA_SERP_ZONE names a SERP API zone.
 */

import { and, eq, inArray, sql } from "drizzle-orm";
import type { AnyDb } from "@/db/client";
import {
  answers,
  brands,
  citations,
  prompts,
  runItems,
  runs,
  searchChecks,
  searchResults,
  workspaces,
} from "@/db/schema";
import { normalizeUrl } from "../citations";

export const TOP = 5;
export const REFRESH_DAYS = 7;
const MAX_FAILURES = 3;

export type SearchHit = { url: string; title: string | null; position: number };
/** One Google search; throws when it fails. */
export type Search = (query: string, country: string, workspaceId: string) => Promise<SearchHit[]>;

const QUESTION_WORDS =
  /^(what|which|who|how|where|when|why|is|are|can|could|should|do|does|i|we|my|our|the|a|an|there|any|me|to|for|it|its|that|in|of|right|now|actually)$/;

/** The short form people type: "What is the best invoicing app?" → "best invoicing app". */
export function keywordForm(prompt: string) {
  const words = prompt
    .toLowerCase()
    .replace(/[“”"?!.,:;()]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  // drop the question's opening words, keep the rest as typed
  let i = 0;
  while (i < words.length - 2 && QUESTION_WORDS.test(words[i])) i++;
  return words.slice(i).join(" ");
}

/** The searches for a prompt: as asked, and the keyword form when it differs (Google ignores case). */
export function queryForms(prompt: string) {
  const asked = prompt.trim();
  const short = keywordForm(prompt);
  return short === asked.toLowerCase() || short.split(" ").length < 2 ? [asked] : [asked, short];
}

/** Google's interface language for a country; English where it's common. */
const LANGUAGE: Record<string, string> = {
  DE: "de",
  FR: "fr",
  ES: "es",
  IT: "it",
  NL: "nl",
  SE: "sv",
  BR: "pt",
  MX: "es",
  JP: "ja",
};

export function googleUrl(query: string, country: string) {
  const p = new URLSearchParams({ q: query, hl: LANGUAGE[country] ?? "en", num: "10" });
  if (country) p.set("gl", country.toLowerCase());
  return `https://www.google.com/search?${p}`;
}

/**
 * The organic results in a SERP API response. Bright Data's docs show two
 * shapes (organic[] with link and global_rank, and results[] with type,
 * url and position), so both are read.
 */
export function parseSerp(body: unknown): SearchHit[] {
  let data = body;
  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch {
      return [];
    }
  }
  if (!data || typeof data !== "object") return [];
  const d = data as Record<string, unknown>;
  const organic = Array.isArray(d.organic)
    ? d.organic
    : Array.isArray(d.results)
      ? d.results.filter((r) => !r?.type || r.type === "organic")
      : [];
  return organic
    .flatMap((r: Record<string, unknown>, i: number) => {
      const url = r?.link ?? r?.url;
      if (typeof url !== "string" || !/^https?:\/\//.test(url)) return [];
      const rank = Number(r.global_rank ?? r.rank ?? r.position ?? i + 1);
      return [
        {
          url,
          title: typeof r.title === "string" ? r.title : null,
          position: Number.isFinite(rank) && rank > 0 ? rank : i + 1,
        },
      ];
    })
    .sort((a: SearchHit, b: SearchHit) => a.position - b.position);
}

/** A Search that asks Bright Data's SERP API. */
export function brightDataSearch(
  apiKeyFor: (workspaceId: string) => Promise<string | null>,
  zone: string,
  fetchImpl: typeof fetch = fetch,
): Search {
  return async (query, country, workspaceId) => {
    const key = await apiKeyFor(workspaceId);
    if (!key) throw new Error("No Bright Data key");
    const res = await fetchImpl("https://api.brightdata.com/request", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        zone,
        url: googleUrl(query, country),
        format: "raw",
        data_format: "parsed_light",
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`Bright Data SERP API: HTTP ${res.status}`);
    return parseSerp(await res.text());
  };
}

/** The top results across a prompt's searches: each page once, at its best position. */
export function mergeHits(lists: SearchHit[][], top = TOP) {
  const best = new Map<string, SearchHit & { domain: string }>();
  for (const hits of lists)
    for (const h of hits) {
      const n = normalizeUrl(h.url);
      if (!n) continue;
      const known = best.get(n.url);
      if (!known || h.position < known.position)
        best.set(n.url, {
          ...h,
          url: n.url,
          domain: n.domain,
          title: h.title ?? known?.title ?? null,
        });
    }
  return [...best.values()]
    .sort((a, b) => a.position - b.position || a.url.localeCompare(b.url))
    .slice(0, top)
    .map((h, i) => ({ ...h, position: i + 1 }));
}

/** Prompt × country pairs whose results are missing or older than a week. */
async function due(db: AnyDb, now: Date, limit: number) {
  const stale = new Date(now.getTime() - REFRESH_DAYS * 86_400_000);
  const rows = await db
    .select({
      workspaceId: brands.workspaceId,
      promptId: prompts.id,
      text: prompts.text,
      countries: prompts.countries,
      defaults: workspaces.defaultCountries,
    })
    .from(prompts)
    .innerJoin(brands, eq(prompts.brandId, brands.id))
    .innerJoin(workspaces, eq(brands.workspaceId, workspaces.id))
    .where(eq(prompts.active, true));
  const pairs = rows.flatMap((r) => {
    const countries = r.countries?.length ? r.countries : r.defaults?.length ? r.defaults : [""];
    return countries.map((country) => ({ ...r, country }));
  });
  if (!pairs.length) return [];
  const checks = await db
    .select()
    .from(searchChecks)
    .where(
      inArray(
        searchChecks.promptId,
        pairs.map((p) => p.promptId),
      ),
    );
  return pairs
    .filter((p) => {
      const c = checks.find((x) => x.promptId === p.promptId && x.country === p.country);
      if (!c) return true;
      // failing searches wait for the next week instead of retrying every tick
      if (c.failures > 0 && c.failures < MAX_FAILURES)
        return c.checkedAt.getTime() < now.getTime() - 3_600_000;
      return c.checkedAt < stale;
    })
    .slice(0, limit);
}

/** The worker step: search a few due prompts. Returns the workspaces whose results changed. */
export async function searchPending(
  db: AnyDb,
  search: Search,
  { limit = 2, now = new Date() } = {},
) {
  const todo = await due(db, now, limit);
  const changed = new Set<string>();
  for (const p of todo) {
    try {
      const lists = await Promise.all(
        queryForms(p.text).map((q) => search(q, p.country, p.workspaceId)),
      );
      const top = mergeHits(lists);
      await db
        .delete(searchResults)
        .where(and(eq(searchResults.promptId, p.promptId), eq(searchResults.country, p.country)));
      if (top.length)
        await db.insert(searchResults).values(
          top.map((h) => ({
            workspaceId: p.workspaceId,
            promptId: p.promptId,
            country: p.country,
            position: h.position,
            url: h.url,
            domain: h.domain,
            title: h.title,
            fetchedAt: now,
          })),
        );
      await db
        .insert(searchChecks)
        .values({
          workspaceId: p.workspaceId,
          promptId: p.promptId,
          country: p.country,
          checkedAt: now,
        })
        .onConflictDoUpdate({
          target: [searchChecks.promptId, searchChecks.country],
          set: { checkedAt: now, failures: 0, error: null },
        });
      changed.add(p.workspaceId);
    } catch (err) {
      await db
        .insert(searchChecks)
        .values({
          workspaceId: p.workspaceId,
          promptId: p.promptId,
          country: p.country,
          checkedAt: now,
          failures: 1,
          error: String(err).slice(0, 300),
        })
        .onConflictDoUpdate({
          target: [searchChecks.promptId, searchChecks.country],
          set: {
            checkedAt: now,
            failures: sql`${searchChecks.failures} + 1`,
            error: String(err).slice(0, 300),
          },
        });
    }
  }
  return [...changed];
}

/** The latest top results for a workspace's prompts, with each prompt's text. */
export async function topResults(db: AnyDb, workspaceId: string) {
  return db
    .select({
      url: searchResults.url,
      domain: searchResults.domain,
      title: searchResults.title,
      position: searchResults.position,
      country: searchResults.country,
      promptId: searchResults.promptId,
      prompt: prompts.text,
    })
    .from(searchResults)
    .innerJoin(prompts, eq(searchResults.promptId, prompts.id))
    .where(and(eq(searchResults.workspaceId, workspaceId), eq(prompts.active, true)));
}

/** When the workspace's prompts were last searched, and whether any search is failing. */
export async function searchStatus(db: AnyDb, workspaceId: string) {
  const [row] = await db
    .select({
      last: sql<string | null>`max(${searchChecks.checkedAt})::text`,
      failing: sql<number>`count(*) filter (where ${searchChecks.failures} > 0)::int`,
      error: sql<string | null>`max(${searchChecks.error})`,
    })
    .from(searchChecks)
    .where(eq(searchChecks.workspaceId, workspaceId));
  return {
    last: row?.last ? new Date(row.last) : null,
    failing: row?.failing ?? 0,
    error: row?.error ?? null,
  };
}

/**
 * Development only (OV_FAKE_ANSWERS=1): a stand-in for Google that returns
 * the workspace's most-cited pages from other sites, so the outreach flow
 * can be tried without a SERP zone. Never used with real answers.
 */
export function citedAsSearch(db: AnyDb): Search {
  return async (_query, _country, workspaceId) => {
    const rows = await db
      .select({ url: citations.url, title: sql<string | null>`max(${citations.title})` })
      .from(citations)
      .innerJoin(answers, eq(citations.answerId, answers.id))
      .innerJoin(runItems, eq(answers.runItemId, runItems.id))
      .innerJoin(runs, eq(runItems.runId, runs.id))
      .where(and(eq(runs.workspaceId, workspaceId), eq(citations.kind, "third_party")))
      .groupBy(citations.url)
      .orderBy(sql`count(*) desc`, citations.url)
      .limit(TOP);
    return rows.map((r, i) => ({ url: r.url, title: r.title, position: i + 1 }));
  };
}
