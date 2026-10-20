/**
 * The GEO audit, part 2: is a page ready to be quoted in an AI answer?
 *
 * AI search engines pull passages from pages that state things plainly:
 * headings that match the questions people ask, lists and tables they can
 * lift, structured data that says what the page is about, a date and an
 * author that say it's current and accountable, and the brand named in
 * words, not only in a logo. These checks look for those things in the HTML
 * a crawler gets (no JavaScript).
 *
 * The score is a checklist, not a prediction: a page can score 100 and not
 * be cited. That's why the audit also runs the same checks on the pages AI
 * does cite for your prompts, to compare like with like.
 */

import { visibleText, wordCount } from "./page";

const strip = (html: string) => visibleText(html);

/** Words that start a question, in headings: "How do I…", "Which is best…" */
const QUESTION =
  /^(what|how|why|which|who|when|where|is|are|can|does|do|should|will|best|top|vs\b)|\?\s*$/i;

/** schema.org types that describe what a brand's page is about. */
const USEFUL_TYPES = [
  "Organization",
  "Corporation",
  "LocalBusiness",
  "Product",
  "SoftwareApplication",
  "WebApplication",
  "Service",
  "Offer",
  "AggregateOffer",
  "FAQPage",
  "HowTo",
  "Article",
  "BlogPosting",
  "NewsArticle",
  "TechArticle",
  "Review",
  "AggregateRating",
  "WebPage",
  "BreadcrumbList",
];
/** the types AI answers quote most directly: questions, steps, ratings */
export const ANSWER_TYPES = ["FAQPage", "HowTo", "Review", "AggregateRating", "QAPage"];

/** Every @type in a page's JSON-LD and microdata. */
export function schemaTypes(html: string): string[] {
  const types = new Set<string>();
  const walk = (node: unknown) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== "object") return;
    const t = (node as Record<string, unknown>)["@type"];
    for (const v of Array.isArray(t) ? t : [t])
      if (typeof v === "string") types.add(v.replace(/^https?:\/\/schema\.org\//, ""));
    for (const v of Object.values(node)) if (typeof v === "object") walk(v);
  };
  for (const m of html.matchAll(
    /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    try {
      walk(JSON.parse(m[1].trim()));
    } catch {
      // broken JSON-LD is ignored by crawlers too
    }
  }
  for (const m of html.matchAll(/itemtype\s*=\s*["']https?:\/\/schema\.org\/([A-Za-z]+)/gi))
    types.add(m[1]);
  return [...types].sort();
}

function jsonLdField(html: string, field: string): string | null {
  const m = new RegExp(`"${field}"\\s*:\\s*"([^"]+)"`).exec(html);
  return m ? m[1] : null;
}

function metaContent(html: string, key: string): string | null {
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = m[0];
    const name = /(?:name|property)\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]?.toLowerCase();
    if (name === key) return /content\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1] ?? null;
  }
  return null;
}

const headingsOf = (html: string, levels: string) =>
  [...html.matchAll(new RegExp(`<h([${levels}])[^>]*>([\\s\\S]*?)<\\/h\\1>`, "gi"))].map((m) =>
    strip(m[2]),
  );

export type ContentFacts = {
  words: number;
  title: string | null;
  h1: string[];
  /** h2 and h3 headings, and those phrased as questions */
  headings: number;
  questionHeadings: number;
  /** lists with at least three items, and tables with at least two rows */
  lists: number;
  tables: number;
  schema: string[];
  /** when the page says it was published or last updated (ISO), from markup */
  published: string | null;
  modified: string | null;
  author: boolean;
  metaDescription: boolean;
  /** times the brand (or another of its names) is named in the text, and in the title or h1 */
  brandMentions: number;
  brandInTitle: boolean;
};

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function readContent(html: string, brandNames: string[]): ContentFacts {
  const text = visibleText(html);
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  const titleText = title ? strip(title) : null;
  const h1 = headingsOf(html, "1");
  const sub = headingsOf(html, "23");
  const lists = [...html.matchAll(/<(ul|ol)\b[^>]*>([\s\S]*?)<\/\1>/gi)].filter(
    (m) => (m[2].match(/<li\b/gi) ?? []).length >= 3,
  ).length;
  const tables = [...html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)].filter(
    (m) => (m[1].match(/<tr\b/gi) ?? []).length >= 2,
  ).length;
  const names = brandNames.filter((n) => n.trim().length >= 2);
  const brandRe = names.length
    ? new RegExp(`(?<![\\p{L}\\p{N}])(${names.map(escape).join("|")})(?![\\p{L}\\p{N}])`, "giu")
    : null;
  const inTitle = [titleText ?? "", ...h1].join(" ");
  return {
    words: wordCount(text),
    title: titleText || null,
    h1,
    headings: sub.length,
    questionHeadings: sub.filter((h) => QUESTION.test(h.trim())).length,
    lists,
    tables,
    schema: schemaTypes(html),
    published:
      jsonLdField(html, "datePublished") ??
      metaContent(html, "article:published_time") ??
      /<time[^>]*datetime\s*=\s*["']([^"']+)["']/i.exec(html)?.[1] ??
      null,
    modified: jsonLdField(html, "dateModified") ?? metaContent(html, "article:modified_time"),
    author:
      /"author"\s*:/.test(html) ||
      !!metaContent(html, "author") ||
      /rel\s*=\s*["']author["']/i.test(html),
    metaDescription: (metaContent(html, "description") ?? "").trim().length >= 50,
    brandMentions: brandRe ? (text.match(brandRe) ?? []).length : 0,
    brandInTitle: brandRe ? new RegExp(brandRe.source, "iu").test(inTitle) : false,
  };
}

export type Check = {
  id: string;
  label: string;
  /** points earned out of `weight` */
  points: number;
  weight: number;
  /** what to do about it, when points < weight */
  fix: string;
};

const DAY = 86_400_000;

/** The checklist, 100 points in all. */
export function scoreContent(f: ContentFacts, now = new Date()): Check[] {
  const latest = [f.modified, f.published]
    .map((d) => (d ? Date.parse(d) : NaN))
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => b - a)[0];
  const ageDays = latest ? (now.getTime() - latest) / DAY : null;
  const useful = f.schema.filter((t) => USEFUL_TYPES.includes(t));
  const answers = f.schema.filter((t) => ANSWER_TYPES.includes(t));
  const c = (id: string, label: string, weight: number, points: number, fix: string): Check => ({
    id,
    label,
    weight,
    points: Math.max(0, Math.min(weight, points)),
    fix,
  });
  return [
    c(
      "text",
      "Enough text to quote",
      15,
      f.words >= 400 ? 15 : f.words >= 150 ? 8 : 0,
      `Only ${f.words} words. Pages AI quotes usually explain the topic in a few hundred words or more.`,
    ),
    c(
      "title",
      "A clear title and one main heading",
      10,
      (f.title ? 5 : 0) + (f.h1.length === 1 ? 5 : 0),
      !f.title
        ? "Add a <title> that says what the page is about."
        : f.h1.length === 0
          ? "Add one <h1> that says what the page is about."
          : `Use one <h1>, not ${f.h1.length}.`,
    ),
    c(
      "questions",
      "Headings that answer questions",
      15,
      f.questionHeadings >= 2 ? 15 : f.questionHeadings === 1 ? 8 : 0,
      "Phrase a few subheadings as the questions buyers ask (“How much does it cost?”, “Which plan is best for freelancers?”) and answer each straight under it.",
    ),
    c(
      "structure",
      "Lists or tables",
      10,
      (f.lists > 0 ? 6 : 0) + (f.tables > 0 ? 4 : 0),
      f.lists === 0 && f.tables === 0
        ? "Put features, steps or comparisons in a list or table; answers lift them whole."
        : f.tables === 0
          ? "Add a comparison or pricing table; answers often quote tables."
          : "Add a list of the key points.",
    ),
    c(
      "schema",
      "Structured data (schema.org)",
      10,
      useful.length ? 10 : 0,
      "Add JSON-LD saying what the page is: Organization on the home page, Product or SoftwareApplication on product pages, Article on posts.",
    ),
    c(
      "answer-schema",
      "FAQ, how-to or review markup",
      5,
      answers.length ? 5 : 0,
      "If the page has questions and answers, steps, or ratings, mark them up as FAQPage, HowTo or Review.",
    ),
    c(
      "dated",
      "A published or updated date",
      10,
      latest ? 10 : 0,
      "Show when the page was published or last updated, and add datePublished and dateModified to its markup.",
    ),
    c(
      "fresh",
      "Updated in the last year",
      5,
      ageDays !== null && ageDays <= 365 ? 5 : 0,
      ageDays === null
        ? "Once the page has a date, keep it current."
        : `Last dated ${Math.round(ageDays / 30)} months ago; review it and update the date.`,
    ),
    c(
      "author",
      "An author or publisher",
      5,
      f.author ? 5 : 0,
      "Say who wrote or stands behind the page: an author name, or author in the markup.",
    ),
    c(
      "brand",
      "Your brand named in words",
      10,
      (f.brandInTitle ? 5 : 0) + (f.brandMentions >= 2 ? 5 : 0),
      !f.brandInTitle
        ? "Name your brand in the title or main heading, so a quoted passage carries it."
        : "Name your brand in the text, not only in the logo: an answer quoting the page should say who it's about.",
    ),
    c(
      "description",
      "A meta description",
      5,
      f.metaDescription ? 5 : 0,
      "Add a meta description of a sentence or two that sums up the page.",
    ),
  ];
}

export const scoreOf = (checks: Check[]) => checks.reduce((n, c) => n + c.points, 0);

/** The fixes worth doing first: the checks that lost the most points. */
export const fixesOf = (checks: Check[]) =>
  checks
    .filter((c) => c.points < c.weight)
    .sort((a, b) => b.weight - b.points - (a.weight - a.points));
