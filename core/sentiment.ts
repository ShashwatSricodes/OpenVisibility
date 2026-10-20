/**
 * Model-assisted analysis: how each answer talks about the brands it names.
 * Runs after mention detection (core/analysis.ts), which stays the judge of
 * whether a brand is mentioned; the model only adds, for each mention, a
 * sentiment from -1 to 1 and whether the answer recommends the brand.
 *
 * The model is any OpenAI-compatible API, set with ANALYSIS_BASE_URL,
 * ANALYSIS_MODEL and (unless it's a local Ollama) ANALYSIS_API_KEY. Without
 * them this step is off and answers keep their mentions without ratings.
 * One call per worker tick, a few answers per call, so free tiers' request
 * limits (around 30 a minute) are never reached.
 */

import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { Output, generateText, type LanguageModel } from "ai";
import { and, eq, inArray, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { z } from "zod";
import type { AnyDb } from "@/db/client";
import { answers, brands, competitors, mentions, runItems, runs } from "@/db/schema";
import { env } from "./env";

export const MAX_RATING_ATTEMPTS = 3;

export type AnalysisModel = {
  model: LanguageModel;
  batch: number;
  /** US dollars per million tokens */
  priceInput: number;
  priceOutput: number;
};

/** The configured analysis model, or null when none is set up. */
export function analysisModel(e = env()): AnalysisModel | null {
  if (!e.ANALYSIS_BASE_URL || !e.ANALYSIS_MODEL) return null;
  const provider = createOpenAICompatible({
    name: "analysis",
    baseURL: e.ANALYSIS_BASE_URL,
    apiKey: e.ANALYSIS_API_KEY,
    includeUsage: true,
  });
  return {
    model: provider.chatModel(e.ANALYSIS_MODEL),
    batch: e.ANALYSIS_BATCH,
    priceInput: e.ANALYSIS_PRICE_INPUT,
    priceOutput: e.ANALYSIS_PRICE_OUTPUT,
  };
}

export type ToRate = { text: string; brands: string[] };
export type Rating = { name: string; sentiment: number; recommended: boolean };

const schema = z.object({
  answers: z.array(
    z.object({
      answer: z.number().int().describe("the answer's number, as given"),
      brands: z.array(
        z.object({
          name: z.string().describe("the brand's name exactly as listed for that answer"),
          sentiment: z
            .number()
            .describe("-1 very negative, 0 neutral or only listed, 1 very positive"),
          recommended: z
            .boolean()
            .describe("true if the answer recommends choosing it, not just mentions it"),
        }),
      ),
    }),
  ),
});

export function ratingPrompt(batch: ToRate[]): string {
  return [
    "You read answers that AI assistants gave to people's questions, and judge how each answer talks about some brands.",
    "For every brand listed under an answer, give:",
    "- sentiment: a number from -1 to 1. -1 is clearly negative (criticised, warned against), 0 is neutral or simply listed, 1 is clearly positive (praised).",
    "- recommended: true only if the answer recommends choosing it, for example as a top pick or the best option for someone; false if it's only mentioned or listed among others without endorsement.",
    "Judge only from the answer's text. Rate every listed brand, using its name exactly as listed.",
    "",
    ...batch.flatMap((a, i) => [
      `### Answer ${i + 1}`,
      `Brands: ${a.brands.join("; ")}`,
      "",
      a.text.length > 12_000 ? `${a.text.slice(0, 12_000)}\n[cut]` : a.text,
      "",
    ]),
  ].join("\n");
}

const clamp = (v: number) => Math.max(-1, Math.min(1, Number.isFinite(v) ? v : 0));

/** Rate a batch of answers. Throws if the model call fails. */
export async function rateAnswers(
  { model, priceInput, priceOutput }: AnalysisModel,
  batch: ToRate[],
): Promise<{ ratings: Rating[][]; costUsd: number }> {
  const result = await generateText({
    model,
    output: Output.object({ schema }),
    prompt: ratingPrompt(batch),
    temperature: 0,
  });
  const ratings = batch.map((a, i) => {
    const got = result.output.answers.find((r) => r.answer === i + 1)?.brands ?? [];
    // keep only the brands we asked about, matched by name in any case
    return a.brands.flatMap((name) => {
      const r = got.find((g) => g.name.trim().toLowerCase() === name.toLowerCase());
      return r ? [{ name, sentiment: clamp(r.sentiment), recommended: r.recommended }] : [];
    });
  });
  const { inputTokens = 0, outputTokens = 0 } = result.usage;
  const costUsd = (inputTokens * priceInput + outputTokens * priceOutput) / 1_000_000;
  return { ratings, costUsd };
}

/**
 * Rate one batch of answers whose mentions are found but not yet rated.
 * Answers that name no tracked brand have nothing to rate and are marked done
 * without a call. Returns how many answers were rated.
 */
export async function ratePending(
  db: AnyDb,
  analysis: AnalysisModel | null = analysisModel(),
  now = new Date(),
): Promise<number> {
  if (!analysis) return 0;
  const pending = await db
    .select({ id: answers.id, text: answers.text, attempts: answers.ratingAttempts })
    .from(answers)
    .where(
      and(
        isNotNull(answers.analyzedAt),
        isNull(answers.ratedAt),
        lt(answers.ratingAttempts, MAX_RATING_ATTEMPTS),
      ),
    )
    .limit(analysis.batch * 4);
  if (!pending.length) return 0;

  const found = await db
    .select({
      id: mentions.id,
      answerId: mentions.answerId,
      name: sql<string>`coalesce(${competitors.name}, ${brands.name})`,
    })
    .from(mentions)
    .innerJoin(answers, eq(mentions.answerId, answers.id))
    .innerJoin(runItems, eq(answers.runItemId, runItems.id))
    .innerJoin(runs, eq(runItems.runId, runs.id))
    .innerJoin(brands, eq(runs.brandId, brands.id))
    .leftJoin(competitors, eq(mentions.competitorId, competitors.id))
    .where(
      inArray(
        mentions.answerId,
        pending.map((p) => p.id),
      ),
    );

  // nothing named: nothing to rate
  const empty = pending.filter((p) => !found.some((m) => m.answerId === p.id));
  if (empty.length)
    await db
      .update(answers)
      .set({ ratedAt: now })
      .where(
        inArray(
          answers.id,
          empty.map((p) => p.id),
        ),
      );

  const batch = pending
    .filter((p) => found.some((m) => m.answerId === p.id))
    .slice(0, analysis.batch);
  if (!batch.length) return 0;
  const input = batch.map((p) => ({
    text: p.text,
    brands: found.filter((m) => m.answerId === p.id).map((m) => m.name),
  }));

  let rated;
  try {
    rated = await rateAnswers(analysis, input);
  } catch (err) {
    console.error(`Analysis model failed: ${(err as Error).message}`);
    await db
      .update(answers)
      .set({ ratingAttempts: sql`${answers.ratingAttempts} + 1` })
      .where(
        inArray(
          answers.id,
          batch.map((p) => p.id),
        ),
      );
    return 0;
  }

  const share = (rated.costUsd / batch.length).toFixed(6);
  await db.transaction(async (tx) => {
    for (const [i, p] of batch.entries()) {
      for (const r of rated.ratings[i]) {
        const m = found.find((f) => f.answerId === p.id && f.name === r.name);
        if (m)
          await tx
            .update(mentions)
            .set({ sentiment: r.sentiment, recommended: r.recommended })
            .where(eq(mentions.id, m.id));
      }
      await tx
        .update(answers)
        .set({ ratedAt: now, analysisCostUsd: sql`${answers.analysisCostUsd} + ${share}` })
        .where(eq(answers.id, p.id));
    }
  });
  if (rated.costUsd > 0)
    await refreshRunCosts(
      db,
      batch.map((p) => p.id),
    );
  return batch.length;
}

/** A run's cost is its answers plus their analysis, which can finish after the run. */
async function refreshRunCosts(db: AnyDb, answerIds: string[]) {
  const ids = db
    .selectDistinct({ id: runItems.runId })
    .from(answers)
    .innerJoin(runItems, eq(answers.runItemId, runItems.id))
    .where(inArray(answers.id, answerIds));
  await db
    .update(runs)
    .set({
      actualCost: sql`(
        select coalesce(sum(a.cost_usd + a.analysis_cost_usd), 0)
        from ${answers} a join ${runItems} ri on a.run_item_id = ri.id
        where ri.run_id = ${runs.id}
      )`,
    })
    .where(inArray(runs.id, ids));
}
