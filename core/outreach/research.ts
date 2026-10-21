/**
 * What a target page is, and what mention of the brand would fit it.
 *
 * Rules always run: they recognise review platforms and directories (where
 * you list yourself rather than pitch), forums, and the shape of an article
 * (a "best of" list, a comparison, a review). With the analysis model set up
 * (ANALYSIS_*), it reads the page too and writes the opening and the reason
 * in its own words, using only facts from the brand's setup. Without it the
 * rules' plainer versions stand, and the agent still works.
 */

import { Output, generateText } from "ai";
import { z } from "zod";
import type { AnalysisModel } from "../sentiment";

export type PageKind =
  | "list"
  | "comparison"
  | "review"
  | "article"
  /** a directory or review platform: create or claim a listing */
  | "directory"
  /** a forum or community: take part, don't pitch */
  | "community";

export type Brand = {
  name: string;
  description: string | null;
  category: string | null;
  audience: string | null;
  domains: string[];
};

export type Research = {
  kind: PageKind;
  /** what's missing on the page, in a sentence */
  opening: string;
  /** why the brand belongs there, from the brand's own facts */
  reason: string;
  /** would an editor see the brand as relevant to this page? */
  fit: boolean;
  /** the page already names the brand (answers left it out anyway) */
  namesBrand: boolean;
  /** competitors the page itself names */
  rivalsOnPage?: string[];
  source: "model" | "rules";
};

const PLATFORMS = [
  "g2.com",
  "capterra.com",
  "getapp.com",
  "softwareadvice.com",
  "trustradius.com",
  "trustpilot.com",
  "producthunt.com",
  "alternativeto.net",
  "saasworthy.com",
  "crozdesk.com",
  "softwaresuggest.com",
  "sourceforge.net",
  "slashdot.org",
  "gartner.com",
  "yelp.com",
  "clutch.co",
  "goodfirms.co",
  "appsumo.com",
  "apps.apple.com",
  "play.google.com",
];
const COMMUNITIES = [
  "reddit.com",
  "quora.com",
  "stackexchange.com",
  "stackoverflow.com",
  "news.ycombinator.com",
  "community.",
  "forum.",
  "discord.com",
  "facebook.com",
  "linkedin.com",
  "x.com",
  "twitter.com",
  "youtube.com",
  "medium.com",
];

const onSite = (domain: string, list: string[]) =>
  list.some((d) =>
    d.endsWith(".") ? domain.startsWith(d) : domain === d || domain.endsWith(`.${d}`),
  );

export function kindOf(domain: string, url: string, title: string | null): PageKind {
  if (onSite(domain, PLATFORMS)) return "directory";
  if (onSite(domain, COMMUNITIES)) return "community";
  const text = `${title ?? ""} ${decodeURIComponent(new URL(url).pathname).replace(/[-_/]/g, " ")}`;
  if (/\bvs\.?\b|versus|compared|comparison/i.test(text)) return "comparison";
  if (
    /\b(best|top|\d+)\b.*\b(apps?|tools?|software|platforms?|services?|options|alternatives?|picks)\b|alternatives?\b/i.test(
      text,
    )
  )
    return "list";
  if (/\breviews?\b/i.test(text)) return "review";
  return "article";
}

const list = (xs: string[]) =>
  xs.length <= 2 ? xs.join(" and ") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`;

/** The rules' version: plain, never wrong about the brand. */
export function researchByRules(
  page: { url: string; domain: string; title: string | null; namesBrand: boolean },
  brand: Brand,
  rivals: string[],
): Research {
  const kind = kindOf(page.domain, page.url, page.title);
  const them = list(rivals.slice(0, 3)) || "your competitors";
  const opening =
    !rivals.length && kind !== "directory" && kind !== "community"
      ? `It ranks for your prompts but names neither ${brand.name} nor its competitors.`
      : {
          list: `The list names ${them} but not ${brand.name}.`,
          comparison: `The comparison covers ${them} but not ${brand.name}.`,
          review: `It reviews ${them}; ${brand.name} isn't covered.`,
          article: `The article mentions ${them} but not ${brand.name}.`,
          directory: `${page.domain} lists ${them}. A listing for ${brand.name} there is up to you to create or claim.`,
          community: `People on ${page.domain} recommend ${them}. This is a conversation to join honestly, not a site to pitch.`,
        }[kind];
  // only what the brand's setup says: what it is, and who it's for
  const what = brand.description ?? brand.category;
  const facts = [what, brand.audience && `for ${brand.audience}`].filter(Boolean).join(", ");
  return {
    kind,
    opening,
    reason: what
      ? `${brand.name}: ${facts}.`
      : `${brand.name} is in the same field as ${them}${brand.audience ? `, for ${brand.audience}` : ""}.`,
    fit: true,
    namesBrand: page.namesBrand,
    source: "rules",
  };
}

const schema = z.object({
  kind: z
    .enum(["list", "comparison", "review", "article", "directory", "community"])
    .describe("what the page is"),
  opening: z
    .string()
    .describe(
      "one sentence: what the page is missing that the brand could fill, e.g. 'The list of 9 invoicing apps for freelancers doesn't include Ledgerly.'",
    ),
  reason: z
    .string()
    .describe(
      "one or two sentences on why the page's readers would care about the brand, using only the brand facts given",
    ),
  fit: z
    .boolean()
    .describe(
      "false if the brand doesn't belong on this page (different audience, country or product type)",
    ),
  namesBrand: z.boolean().describe("true if the page already mentions the brand"),
});

export function researchPrompt(
  page: { url: string; title: string | null; headings: string[]; text: string },
  brand: Brand,
  rivals: string[],
  prompts: string[],
) {
  return [
    "You help a company get mentioned on web pages that AI assistants cite when answering its customers' questions.",
    "Read the page below and say what it is, what mention of the company would fit, and whether the company belongs there at all.",
    "Use only the company facts given. Never invent features, prices, awards or customers.",
    "",
    "Company:",
    `- name: ${brand.name}`,
    brand.description && `- what it is: ${brand.description}`,
    brand.category && `- category: ${brand.category}`,
    brand.audience && `- for: ${brand.audience}`,
    brand.domains.length > 0 && `- website: ${brand.domains.join(", ")}`,
    "",
    `AI answers cite this page for questions like: ${prompts
      .slice(0, 5)
      .map((p) => `"${p}"`)
      .join(", ")}.`,
    rivals.length > 0 &&
      `Those answers name these competitors, not the company: ${rivals.join(", ")}.`,
    "",
    `Page: ${page.url}`,
    page.title && `Title: ${page.title}`,
    page.headings.length > 0 && `Headings: ${page.headings.slice(0, 30).join(" | ")}`,
    "Text (may be cut short):",
    page.text.slice(0, 8000),
  ]
    .filter((l) => l !== false && l !== null && l !== undefined && l !== "")
    .join("\n");
}

/** The model's version, or null if the call fails (the rules' version stands). */
export async function researchByModel(
  m: AnalysisModel,
  page: { url: string; title: string | null; headings: string[]; text: string },
  brand: Brand,
  rivals: string[],
  prompts: string[],
): Promise<{ research: Research; costUsd: number } | null> {
  try {
    const result = await generateText({
      model: m.model,
      output: Output.object({ schema }),
      prompt: researchPrompt(page, brand, rivals, prompts),
    });
    const { inputTokens = 0, outputTokens = 0 } = result.usage;
    return {
      research: { ...result.output, source: "model" },
      costUsd: (inputTokens * m.priceInput + outputTokens * m.priceOutput) / 1_000_000,
    };
  } catch {
    return null;
  }
}
