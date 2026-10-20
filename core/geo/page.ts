/**
 * What an AI crawler gets from a page's HTML, before any JavaScript runs:
 * the title, the readable text, and the robots directives in meta tags and
 * the X-Robots-Tag header. Most AI crawlers don't run JavaScript, so a page
 * whose text only appears after scripts load is a blank page to them.
 */

import { CRAWLERS, matters, type Crawler } from "./crawlers";
import { verdictFor, type RobotsFile } from "./robots";

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

const decode = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });

/** The text a reader sees, without scripts, styles or markup. */
export function visibleText(html: string) {
  return decode(
    html
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<head[\s>][\s\S]*?<\/head>/gi, " ")
      .replace(/<(script|style|noscript|template|svg|iframe)[\s>][\s\S]*?<\/\1>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

export const wordCount = (text: string) =>
  (text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []).length;

function attributes(tag: string) {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/([a-zA-Z-:]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g))
    out[m[1].toLowerCase()] = decode(m[3] ?? m[4] ?? m[5] ?? "");
  return out;
}

/** Robots meta tags by name: "robots" applies to every crawler, others to one ("googlebot"). */
export function metaRobots(html: string) {
  const out: { name: string; content: string }[] = [];
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const a = attributes(m[0]);
    if (a.name && a.content !== undefined) {
      const name = a.name.toLowerCase();
      if (name === "robots" || CRAWLERS.some((c) => c.agent.toLowerCase() === name))
        out.push({ name, content: a.content.toLowerCase() });
    }
  }
  return out;
}

/** X-Robots-Tag values: "noindex" for everyone, or "googlebot: noindex" for one. */
export function headerRobots(value: string | null) {
  if (!value) return [];
  return value.split(/,(?=\s*[a-z-]+\s*:)/i).map((part) => {
    const m = /^\s*([a-z][a-z0-9-]*)\s*:\s*(.+)$/i.exec(part);
    return m && !/^(noindex|nofollow|none|nosnippet|max-|noarchive|unavailable_after)/i.test(m[1])
      ? { name: m[1].toLowerCase(), content: m[2].toLowerCase() }
      : { name: "robots", content: part.trim().toLowerCase() };
  });
}

const has = (content: string, ...words: string[]) =>
  content.split(/[\s,]+/).some((w) => words.includes(w));

export type PageFacts = {
  title: string | null;
  words: number;
  scripts: number;
  /** directives that apply to every crawler, from meta tags and the header */
  noindex: boolean;
  nosnippet: boolean;
  /** crawlers told noindex by name, e.g. a "googlebot" meta tag */
  noindexFor: string[];
};

export function readPage(html: string, xRobotsTag: string | null): PageFacts {
  const directives = [...metaRobots(html), ...headerRobots(xRobotsTag)];
  const forAll = directives.filter((d) => d.name === "robots").map((d) => d.content);
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  return {
    title: title ? decode(title).replace(/\s+/g, " ").trim() || null : null,
    words: wordCount(visibleText(html)),
    scripts: (html.match(/<script\b/gi) ?? []).length,
    noindex: forAll.some((c) => has(c, "noindex", "none")),
    nosnippet: forAll.some((c) => has(c, "nosnippet") || /max-snippet\s*:\s*0\b/.test(c)),
    noindexFor: [
      ...new Set(
        directives
          .filter((d) => d.name !== "robots" && has(d.content, "noindex", "none"))
          .map((d) => d.name),
      ),
    ],
  };
}

/** Fewer words than this without JavaScript and the page reads as empty to most AI crawlers. */
export const THIN_WORDS = 50;
/** Slower than this and crawlers may give up, or fetch fewer of your pages. */
export const SLOW_MS = 3_000;

export type PageCheck = {
  url: string;
  finalUrl: string;
  status: number | null;
  error: string | null;
  redirects: number;
  ms: number;
  facts: PageFacts | null;
  /** search and user crawlers robots.txt keeps off this page */
  blocked: string[];
  /** training crawlers it keeps off: a choice, not a problem for answers */
  blockedTraining: string[];
};

export type Issue = {
  code:
    | "unreachable"
    | "blocked"
    | "noindex"
    | "nosnippet"
    | "needs_js"
    | "thin"
    | "slow"
    | "redirects"
    | "training";
  /** problems keep a page out of answers; warnings may; notes are for information */
  severity: "problem" | "warning" | "note";
  text: string;
};

/** The crawlers robots.txt blocks for a path: those answers depend on, and training ones. */
export function blockedFor(robots: RobotsFile, path: string, crawlers: Crawler[] = CRAWLERS) {
  const blocked = crawlers.filter((c) => !verdictFor(robots, c.agent, path).allowed);
  return {
    blocked: blocked.filter(matters).map((c) => c.agent),
    blockedTraining: blocked.filter((c) => !matters(c)).map((c) => c.agent),
  };
}

/** What's wrong with a page, worst first, in words a marketer can act on. */
export function pageIssues(p: PageCheck): Issue[] {
  const out: Issue[] = [];
  if (p.error || p.status === null || p.status >= 400) {
    out.push({
      code: "unreachable",
      severity: "problem",
      text: p.error ?? `The page answers with HTTP ${p.status}, so crawlers get an error`,
    });
    return out;
  }
  if (p.blocked.length)
    out.push({
      code: "blocked",
      severity: "problem",
      text: `robots.txt blocks ${p.blocked.join(", ")}`,
    });
  const f = p.facts;
  if (f?.noindex)
    out.push({
      code: "noindex",
      severity: "problem",
      text: "Marked noindex: search engines and AI search drop it",
    });
  else if (f?.noindexFor.length)
    out.push({
      code: "noindex",
      severity: "problem",
      text: `Marked noindex for ${f.noindexFor.join(", ")}`,
    });
  if (f?.nosnippet)
    out.push({
      code: "nosnippet",
      severity: "problem",
      text: "Marked nosnippet: Google won't quote it in AI Overviews or AI Mode",
    });
  if (f && f.words < THIN_WORDS)
    out.push(
      f.scripts > 0
        ? {
            code: "needs_js",
            severity: "problem",
            text: `Only ${f.words} words without JavaScript: most AI crawlers don't run scripts, so they see an empty page`,
          }
        : { code: "thin", severity: "warning", text: `Only ${f.words} words of text` },
    );
  if (p.ms > SLOW_MS)
    out.push({
      code: "slow",
      severity: "warning",
      text: `Took ${(p.ms / 1000).toFixed(1)}s to load`,
    });
  if (p.redirects > 1)
    out.push({
      code: "redirects",
      severity: "warning",
      text: `${p.redirects} redirects before the page`,
    });
  if (p.blockedTraining.length)
    out.push({
      code: "training",
      severity: "note",
      text: `Closed to training crawlers (${p.blockedTraining.join(", ")}); this doesn't keep it out of answers`,
    });
  return out;
}
