/**
 * Content briefs: what a page of yours needs to be cited for a prompt,
 * worked out from the pages that are cited for it now.
 *
 * The worker fetches up to five cited pages (other sites', last 90 days),
 * reads them as a crawler does, and the brief takes what they share: about
 * how long they are, the questions their headings answer, whether they use
 * lists, tables and FAQ markup, and which sites they come from (the ones to
 * earn a mention on). With the analysis model set up it also suggests a
 * title, an angle and an outline, from those pages and the brand's facts.
 */

import { Output, generateText } from "ai";
import { and, asc, desc, eq, gte, ne, sql } from "drizzle-orm";
import { z } from "zod";
import type { AnyDb } from "@/db/client";
import { answers, citations, contentBriefs, prompts, runItems, runs } from "@/db/schema";
import { ANSWER_TYPES, readContent, type ContentFacts } from "../geo/content";
import { safeGet, type Net } from "../geo/fetch";
import { visibleText } from "../geo/page";
import type { AnalysisModel } from "../sentiment";
import { brandOf } from "./targets";
import type { Brand } from "./research";

const QUESTION = /\?\s*$|^(what|how|why|which|who|when|where|is|are|can|does|do|should)\b/i;

const STOP = new Set(
  "what which where when best good with that this from your have does there than into about most more much will would should could some them they their need want using used make".split(
    " ",
  ),
);
const stems = (text: string) =>
  (text.toLowerCase().match(/\p{L}{4,}/gu) ?? [])
    .filter((w) => !STOP.has(w))
    .map((w) => w.slice(0, 5));

/**
 * Is a heading about the prompt? A cited page is sometimes a site's home
 * page, whose headings are other articles' titles ("ClickUp vs Asana…").
 * Keep headings sharing a word with the prompt, and generic ones ("How much
 * does it cost?"); drop those full of other names.
 */
export function onTopic(heading: string, prompt: string) {
  const want = new Set(stems(prompt));
  if (!want.size || stems(heading).some((s) => want.has(s))) return true;
  // off the prompt's words, only a plain question stays ("Is there a free plan?"),
  // not a call to action ("Ready to own page one?") or a title full of names
  const h = heading.trim();
  const names = h
    .split(/\s+/)
    .slice(1)
    .filter((w) => /^[A-Z0-9]/.test(w)).length;
  return (
    /^(what|how|why|which|who|when|where|is|are|can|does|do|should)\b/i.test(h) &&
    h.endsWith("?") &&
    names < 2
  );
}

export type Brief = {
  prompt: string;
  /** the pages it's based on */
  pages: { url: string; title: string | null; words: number }[];
  /** round figure from the cited pages' median */
  words: number;
  /** questions the cited pages' headings answer, most common first */
  questions: string[];
  /** formats most cited pages use */
  formats: string[];
  /** sites to earn a mention on: they're cited for this prompt */
  sources: string[];
  /** from the model, when one is set up */
  title?: string;
  angle?: string;
  outline?: string[];
  source: "model" | "rules";
};

/** The brief the rules can write from the cited pages alone. */
export function briefFromPages(
  prompt: string,
  pages: { url: string; facts: ContentFacts; headings: string[] }[],
): Brief {
  const words = pages.map((p) => p.facts.words).sort((a, b) => a - b);
  const median = words.length ? words[Math.floor(words.length / 2)] : 0;
  const counts = new Map<string, { text: string; n: number }>();
  for (const p of pages)
    for (const h of new Set(
      p.headings.filter((h) => QUESTION.test(h.trim()) && onTopic(h, prompt)),
    )) {
      const key = h
        .toLowerCase()
        .replace(/[^\p{L}\p{N} ]/gu, "")
        .trim();
      const c = counts.get(key) ?? { text: h.trim(), n: 0 };
      c.n++;
      counts.set(key, c);
    }
  const most = (test: (f: ContentFacts) => boolean) =>
    pages.length > 0 && pages.filter((p) => test(p.facts)).length * 2 >= pages.length;
  return {
    prompt,
    pages: pages.map((p) => ({ url: p.url, title: p.facts.title, words: p.facts.words })),
    words: Math.max(300, Math.round(median / 100) * 100),
    questions: [...counts.values()]
      .sort((a, b) => b.n - a.n || a.text.localeCompare(b.text))
      .slice(0, 8)
      .map((c) => c.text),
    formats: [
      most((f) => f.lists > 0) && "a list of the options or steps",
      most((f) => f.tables > 0) && "a comparison table",
      most((f) => f.schema.some((t) => ANSWER_TYPES.includes(t))) && "FAQ or review markup",
      most((f) => !!(f.published || f.modified)) && "a visible updated date",
      most((f) => f.author) && "an author",
    ].filter((x): x is string => !!x),
    sources: [
      ...new Set(
        pages.map((p) => {
          try {
            return new URL(p.url).hostname.replace(/^www\./, "");
          } catch {
            return p.url;
          }
        }),
      ),
    ],
    source: "rules",
  };
}

const schema = z.object({
  title: z.string().describe("a title for the page, plain and specific"),
  angle: z
    .string()
    .describe("one or two sentences: what the page should argue or show, honestly, for this brand"),
  outline: z.array(z.string()).describe("5 to 8 section headings, several phrased as questions"),
});

async function briefByModel(m: AnalysisModel, brief: Brief, brand: Brand) {
  try {
    const result = await generateText({
      model: m.model,
      output: Output.object({ schema }),
      prompt: [
        "You plan a web page that AI assistants could cite when people ask the question below.",
        "Base the plan on what the pages cited today have in common, and on the company facts only. Never invent features, prices or customers.",
        "",
        `Question people ask: "${brief.prompt}"`,
        `Company: ${brand.name}${brand.description ? `, ${brand.description}` : ""}${brand.audience ? `, for ${brand.audience}` : ""}.`,
        `Cited pages run about ${brief.words} words and use: ${brief.formats.join(", ") || "plain text"}.`,
        brief.questions.length > 0 &&
          `Their headings answer: ${brief.questions.map((q) => `"${q}"`).join(", ")}.`,
        `Cited pages: ${brief.pages.map((p) => p.title ?? p.url).join("; ")}.`,
      ]
        .filter(Boolean)
        .join("\n"),
    });
    const { inputTokens = 0, outputTokens = 0 } = result.usage;
    return {
      ...result.output,
      costUsd: (inputTokens * m.priceInput + outputTokens * m.priceOutput) / 1_000_000,
    };
  } catch {
    return null;
  }
}

/** Ask for a brief; the worker writes it. Asking again starts over. */
export async function requestBrief(db: AnyDb, workspaceId: string, promptId: string) {
  await db
    .insert(contentBriefs)
    .values({ workspaceId, promptId })
    .onConflictDoUpdate({
      target: [contentBriefs.workspaceId, contentBriefs.promptId],
      set: { status: "queued", brief: null, createdAt: new Date() },
    });
}

/** Pages on other sites cited for a prompt in the last 90 days, one per site, most cited first. */
async function citedFor(db: AnyDb, workspaceId: string, promptId: string, now: Date) {
  const rows = await db
    .select({ url: citations.url, domain: citations.domain })
    .from(citations)
    .innerJoin(answers, eq(citations.answerId, answers.id))
    .innerJoin(runItems, eq(answers.runItemId, runItems.id))
    .innerJoin(runs, eq(runItems.runId, runs.id))
    .where(
      and(
        eq(runs.workspaceId, workspaceId),
        eq(runItems.promptId, promptId),
        ne(citations.kind, "owned"),
        gte(answers.createdAt, new Date(now.getTime() - 90 * 86_400_000)),
      ),
    )
    .groupBy(citations.url, citations.domain)
    .orderBy(desc(sql`count(distinct ${citations.answerId})`), asc(citations.url))
    .limit(100);
  const seen = new Set<string>();
  return rows.filter((r) => !seen.has(r.domain) && !!seen.add(r.domain)).slice(0, 5);
}

/** The worker step: write one queued brief. Returns how many were written. */
export async function briefPending(
  db: AnyDb,
  net: Net,
  model: AnalysisModel | null,
  now = new Date(),
) {
  const [job] = await db
    .select({ brief: contentBriefs, prompt: prompts.text })
    .from(contentBriefs)
    .innerJoin(prompts, eq(contentBriefs.promptId, prompts.id))
    .where(eq(contentBriefs.status, "queued"))
    .orderBy(asc(contentBriefs.createdAt))
    .limit(1);
  if (!job) return 0;
  const claimed = await db
    .update(contentBriefs)
    .set({ status: "running" })
    .where(and(eq(contentBriefs.id, job.brief.id), eq(contentBriefs.status, "queued")))
    .returning({ id: contentBriefs.id });
  if (!claimed.length) return 0;

  const brand = await brandOf(db, job.brief.workspaceId);
  const cited = await citedFor(db, job.brief.workspaceId, job.brief.promptId, now);
  const pages = (
    await Promise.all(
      cited.map(async (c) => {
        const r = await safeGet(c.url, net);
        if (!r.status || r.status >= 400) return null;
        return {
          url: c.url,
          facts: readContent(r.body, brand?.names ?? []),
          headings: [...r.body.matchAll(/<h([2-3])[^>]*>([\s\S]*?)<\/h\1>/gi)].map((m) =>
            visibleText(m[2]),
          ),
        };
      }),
    )
  ).filter((p) => p !== null);

  let brief = briefFromPages(job.prompt, pages);
  let costUsd = 0;
  if (model && brand && pages.length) {
    const extra = await briefByModel(model, brief, brand.brand);
    if (extra) {
      const { costUsd: cost, ...plan } = extra;
      brief = { ...brief, ...plan, source: "model" };
      costUsd = cost;
    }
  }
  await db
    .update(contentBriefs)
    .set({ status: "done", brief, costUsd: String(costUsd) })
    .where(eq(contentBriefs.id, job.brief.id));
  return 1;
}

export async function getBrief(db: AnyDb, workspaceId: string, promptId: string) {
  const [row] = await db
    .select()
    .from(contentBriefs)
    .where(and(eq(contentBriefs.workspaceId, workspaceId), eq(contentBriefs.promptId, promptId)))
    .limit(1);
  return row ? { status: row.status, brief: row.brief as Brief | null } : null;
}
