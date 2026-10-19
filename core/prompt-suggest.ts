/**
 * Prompt research: the questions customers might ask AI about your category.
 *
 * Without an AI key, suggestions come from templates built on the brand's
 * category, audience and competitors: free, instant and offline. With
 * AI_GATEWAY_API_KEY set, a cheap model writes them instead, and the
 * templates are the fallback if that call fails.
 */

import { Output, createGateway, generateText, type LanguageModel } from "ai";
import { z } from "zod";
import { env } from "./env";
import { INTENTS, cleanPromptText, withAutoTags, type Intent } from "./prompt-rules";

export type SuggestContext = {
  brand: string;
  aliases: string[];
  category: string;
  audience?: string | null;
  description?: string | null;
  competitors: string[];
};

export type Suggestion = { text: string; tags: string[] };

export type SuggestResult = {
  suggestions: Suggestion[];
  source: "templates" | "ai";
  /** what the AI call cost, when the gateway reports it */
  costUsd?: number;
  /** why the AI wasn't used, when it was expected to be */
  note?: string;
};

const TARGET = 20;

/**
 * Suggestions from templates. Non-branded first: they matter most for visibility.
 * No "a" before the category, so they read right for "CRM" and "invoicing software" alike.
 */
export function templateSuggestions(ctx: SuggestContext): Suggestion[] {
  const category = ctx.category.trim();
  const audience = ctx.audience?.trim();
  const [c1, c2, c3] = ctx.competitors.filter((c) => c.trim());
  const brand = ctx.brand.trim();

  const raw: [string, Intent][] = [
    [`What is the best ${category}?`, "discovery"],
    ...(audience
      ? [[`What is the best ${category} for ${audience}?`, "discovery"] as [string, Intent]]
      : []),
    [`What are the top 5 ${category} options right now?`, "discovery"],
    [`Which ${category} would you recommend for a small business?`, "discovery"],
    [`Is there any free ${category} that's actually good?`, "discovery"],
    [`What is the cheapest ${category} that is still reliable?`, "discovery"],
    [`Which ${category} is the easiest to use?`, "discovery"],
    [`How do I choose the right ${category}?`, "how-to"],
    [`What should I look for when choosing ${category}?`, "how-to"],
    ...[c1, c2, c3]
      .filter(Boolean)
      .map((c) => [`What are the best alternatives to ${c}?`, "alternatives"] as [string, Intent]),
    ...[c1, c2, c3]
      .filter(Boolean)
      .map((c) => [`${brand} vs ${c}: which is better?`, "comparison"] as [string, Intent]),
    [`Is ${brand} any good?`, "reviews"],
    [`What do people say about ${brand}?`, "reviews"],
    [`What are the pros and cons of ${brand}?`, "reviews"],
    [`How much does ${brand} cost?`, "pricing"],
    ...(c1
      ? [[`Is ${brand} worth the price compared with ${c1}?`, "pricing"] as [string, Intent]]
      : []),
  ];

  const names = [brand, ...ctx.aliases];
  return dedupe(
    raw.map(([text, intent]) => ({
      text: cleanPromptText(text),
      tags: withAutoTags(text, [intent], names),
    })),
  ).slice(0, TARGET);
}

function dedupe(list: Suggestion[]): Suggestion[] {
  const seen = new Set<string>();
  return list.filter((s) => {
    const key = s.text.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const aiSchema = z.object({
  prompts: z
    .array(
      z.object({
        text: z
          .string()
          .describe("The question, exactly as a customer would type it to an AI assistant"),
        intent: z.enum(INTENTS),
      }),
    )
    .min(5)
    .max(30),
});

function instructions(ctx: SuggestContext) {
  return [
    `Write ${TARGET} questions that potential customers might type into ChatGPT, Gemini or Google's AI Mode while looking for a product like this one.`,
    ``,
    `Brand: ${ctx.brand}`,
    `Category: ${ctx.category}`,
    ctx.audience ? `Customers: ${ctx.audience}` : "",
    ctx.description ? `What it does: ${ctx.description}` : "",
    ctx.competitors.length ? `Competitors: ${ctx.competitors.join(", ")}` : "",
    ``,
    `Mix: about 12 that don't name ${ctx.brand} (finding the best option, recommendations for specific needs, how to choose, alternatives to a competitor), and about 8 that do (comparisons with competitors, reviews, pricing).`,
    `Write them the way real people ask: natural, specific, one question each, no numbering, no quotation marks. Vary the needs and situations. Use the language the brand description is written in.`,
  ]
    .filter((l) => l !== "")
    .join("\n");
}

/** Suggestions written by a model. Throws if the call fails; `suggestPrompts` falls back. */
export async function aiSuggestions(
  ctx: SuggestContext,
  model: LanguageModel,
): Promise<{ suggestions: Suggestion[]; costUsd?: number }> {
  const result = await generateText({
    model,
    output: Output.object({ schema: aiSchema }),
    prompt: instructions(ctx),
  });
  const names = [ctx.brand, ...ctx.aliases];
  const suggestions = dedupe(
    result.output.prompts
      .map((p) => ({ text: cleanPromptText(p.text), intent: p.intent }))
      .filter((p) => p.text.length >= 3 && p.text.length <= 300)
      .map((p) => ({ text: p.text, tags: withAutoTags(p.text, [p.intent], names) })),
  ).slice(0, TARGET);
  const cost = Number((result.providerMetadata?.gateway as { cost?: unknown } | undefined)?.cost);
  return { suggestions, costUsd: Number.isFinite(cost) ? cost : undefined };
}

/** The model to use, or null when no AI key is configured. */
export function suggestionModel(): LanguageModel | null {
  const { AI_GATEWAY_API_KEY, PROMPT_SUGGEST_MODEL } = env();
  if (!AI_GATEWAY_API_KEY) return null;
  return createGateway({ apiKey: AI_GATEWAY_API_KEY })(PROMPT_SUGGEST_MODEL);
}

export async function suggestPrompts(
  ctx: SuggestContext,
  model: LanguageModel | null = suggestionModel(),
): Promise<SuggestResult> {
  if (!model) return { suggestions: templateSuggestions(ctx), source: "templates" };
  try {
    const { suggestions, costUsd } = await aiSuggestions(ctx, model);
    if (suggestions.length >= 5) {
      console.info(
        `Prompt suggestions: ${suggestions.length} from the model` +
          (costUsd !== undefined ? `, cost $${costUsd.toFixed(5)}` : ""),
      );
      return { suggestions, source: "ai", costUsd };
    }
    throw new Error(`only ${suggestions.length} usable suggestions`);
  } catch (err) {
    console.warn(
      `Prompt suggestions: the model failed (${(err as Error).message}); using templates`,
    );
    return {
      suggestions: templateSuggestions(ctx),
      source: "templates",
      note: "The AI model couldn't be reached, so these come from templates.",
    };
  }
}
