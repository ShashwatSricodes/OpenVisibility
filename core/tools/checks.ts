/**
 * The free tools' checks on any URL, logged out: can AI crawlers read it,
 * and is it ready to be quoted? The same code as the site audit (Days P2 and
 * P3), for one page. Fetches go through safeGet, which refuses private and
 * internal addresses on every redirect.
 */

import { CRAWLERS, matters } from "../geo/crawlers";
import { fixesOf, readContent, scoreContent } from "../geo/content";
import { safeGet, type Net } from "../geo/fetch";
import { pageIssues, readPage } from "../geo/page";
import { fetchRobots } from "../geo/audit";
import { verdictFor } from "../geo/robots";

/** A URL as typed: "ledgerly.app/pricing" becomes https://ledgerly.app/pricing. */
export function normalizeInput(raw: string): URL | null {
  const t = raw.trim();
  if (!t || t.length > 2_000) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(t) ? t : `https://${t}`);
    if (!/^https?:$/.test(u.protocol) || !u.hostname.includes(".")) return null;
    u.hash = "";
    return u;
  } catch {
    return null;
  }
}

export async function crawlabilityCheck(raw: string, net: Net) {
  const url = normalizeInput(raw);
  if (!url)
    return { ok: false as const, message: "Enter a web address, like ledgerly.app/pricing." };
  const [robots, page, llms] = await Promise.all([
    fetchRobots(url.origin, net),
    safeGet(url.toString(), net),
    safeGet(`${url.origin}/llms.txt`, net, { maxBytes: 1, accept: "text/plain,text/markdown,*/*" }),
  ]);
  if (page.error && page.status === null)
    return { ok: false as const, message: `Couldn't load the page: ${page.error}.` };
  const path = (() => {
    try {
      const f = new URL(page.finalUrl);
      return f.pathname + f.search;
    } catch {
      return url.pathname + url.search;
    }
  })();
  const html = /html|xml/i.test(page.headers?.get("content-type") ?? "text/html");
  const facts =
    page.status && page.status < 400 && html
      ? readPage(page.body, page.headers?.get("x-robots-tag") ?? null)
      : null;
  const crawlers = CRAWLERS.map((c) => ({
    agent: c.agent,
    owner: c.owner,
    purpose: c.purpose,
    engines: c.engines,
    note: c.note,
    allowed: verdictFor(robots.file, c.agent, path).allowed,
    rule: verdictFor(robots.file, c.agent, path).rule,
  }));
  const blocked = crawlers.filter((c) => !c.allowed);
  const issues = pageIssues({
    url: url.toString(),
    finalUrl: page.finalUrl,
    status: page.status,
    error: page.error,
    redirects: page.redirects.length,
    ms: page.ms,
    facts,
    blocked: blocked.filter(matters).map((c) => c.agent),
    blockedTraining: blocked.filter((c) => !matters(c)).map((c) => c.agent),
  });
  return {
    ok: true as const,
    url: url.toString(),
    finalUrl: page.finalUrl,
    status: page.status,
    ms: page.ms,
    words: facts?.words ?? null,
    robots: robots.file.state,
    llmsTxt: !!llms.status && llms.status >= 200 && llms.status < 300,
    crawlers,
    issues,
  };
}

export async function contentCheck(raw: string, brand: string, net: Net) {
  const url = normalizeInput(raw);
  if (!url)
    return { ok: false as const, message: "Enter a web address, like ledgerly.app/pricing." };
  const page = await safeGet(url.toString(), net);
  if (page.error || !page.status || page.status >= 400)
    return {
      ok: false as const,
      message: `Couldn't read the page (${page.error ?? `HTTP ${page.status}`}).`,
    };
  const names = brand.trim() ? [brand.trim().slice(0, 80)] : [];
  const facts = readContent(page.body, names);
  const checks = scoreContent(facts);
  // without a brand name there's nothing to look for: don't mark the page down for it
  const counted = names.length ? checks : checks.filter((c) => c.id !== "brand");
  const max = counted.reduce((n, c) => n + c.weight, 0);
  const got = counted.reduce((n, c) => n + c.points, 0);
  return {
    ok: true as const,
    url: page.finalUrl,
    score: Math.round((got / max) * 100),
    facts,
    checks: counted,
    fixes: fixesOf(counted),
  };
}
