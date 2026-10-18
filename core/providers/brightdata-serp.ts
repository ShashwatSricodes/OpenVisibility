/**
 * Google AI Overviews through Bright Data's SERP API.
 *
 * AI Overviews aren't a separate app: they sit at the top of ordinary
 * Google results, and only for some queries. The SERP API returns the
 * results page as JSON (`brd_json=1`) with a parsed `ai_overview` block.
 * Docs: https://docs.brightdata.com/products/serp-api/parsed-json-results
 *
 * Needs a SERP API zone, created once in the Bright Data control panel.
 * Billing and the free 5,000 a month are shared with the scrapers.
 */

import type { Citation } from "./brightdata";

export type AiOverviewResult = {
  query: string;
  ok: boolean;
  error?: string;
  /** whether Google showed an AI Overview for this query at all */
  present: boolean;
  text: string;
  citations: Citation[];
  /** top organic results, useful context for brand position */
  organic: { url: string; title?: string; rank: number }[];
  country?: string;
  raw: Record<string, unknown>;
};

type AiOverviewBlock = {
  texts?: { type?: string; snippet?: string; links?: { text?: string; link?: string }[] }[];
  references?: { href?: string; title?: string; source?: string; index?: number }[];
};

export async function fetchAiOverview(
  apiKey: string,
  zone: string,
  { query, country = "US", hl = "en" }: { query: string; country?: string; hl?: string },
): Promise<AiOverviewResult> {
  const params = new URLSearchParams({ q: query, hl, gl: country.toLowerCase(), brd_json: "1" });
  const res = await fetch("https://api.brightdata.com/request", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ zone, url: `https://www.google.com/search?${params}`, format: "raw" }),
  });

  const body = await res.text();
  const fail = (error: string): AiOverviewResult => ({
    query, ok: false, error, present: false, text: "", citations: [], organic: [], country, raw: {},
  });

  if (!res.ok) return fail(`Bright Data SERP ${res.status}: ${body.slice(0, 500)}`);

  let json: Record<string, unknown>;
  try {
    json = JSON.parse(body) as Record<string, unknown>;
  } catch {
    return fail(`SERP response was not JSON (is brd_json supported on this zone?): ${body.slice(0, 200)}`);
  }

  const aio = json.ai_overview as AiOverviewBlock | undefined;
  const text = (aio?.texts ?? [])
    .map((t) => t.snippet?.trim())
    .filter(Boolean)
    .join("\n");
  const citations: Citation[] = (aio?.references ?? [])
    .filter((r) => r.href)
    .map((r, i) => ({ url: r.href!, title: r.title ?? r.source, position: r.index ?? i + 1 }));

  const organic = Array.isArray(json.organic)
    ? (json.organic as { link?: string; title?: string; rank?: number; global_rank?: number }[])
        .filter((o) => o.link)
        .slice(0, 10)
        .map((o, i) => ({ url: o.link!, title: o.title, rank: o.rank ?? o.global_rank ?? i + 1 }))
    : [];

  // keep the overview and organic results; drop the rest of the page
  const raw = { ai_overview: json.ai_overview ?? null, organic: json.organic ?? null, general: json.general ?? null };

  return { query, ok: true, present: Boolean(aio && (text || citations.length)), text, citations, organic, country, raw };
}
