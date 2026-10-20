/**
 * One run for its detail page: totals, answers per engine, and the answers
 * themselves with their sources. Scoped to the workspace, like every page query.
 */

import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { AnyDb } from "@/db/client";
import { answers, brands, citations, competitors, mentions, runItems, runs } from "@/db/schema";
import type { EngineId } from "./providers/types";

/** a run page shows at most this many answers; bigger runs say so */
export const MAX_ANSWERS_SHOWN = 500;

export async function getRunDetail(db: AnyDb, workspaceId: string, runId: string) {
  const [run] = await db
    .select()
    .from(runs)
    .where(and(eq(runs.id, runId), eq(runs.workspaceId, workspaceId)));
  if (!run) return null;

  const engineRows = await db
    .select({
      engine: runItems.engine,
      // skipped by smart sampling: never meant to be asked
      planned: sql<number>`count(*) filter (where ${runItems.skipReason} is distinct from 'sampling')::int`,
      done: sql<number>`count(*) filter (where ${runItems.status} = 'done')::int`,
      cost: sql<string>`coalesce(sum(${answers.costUsd} + ${answers.analysisCostUsd}), 0)::text`,
    })
    .from(runItems)
    .leftJoin(answers, eq(answers.runItemId, runItems.id))
    .where(eq(runItems.runId, runId))
    .groupBy(runItems.engine)
    .orderBy(asc(runItems.engine));

  const rows = await db
    .select({
      id: answers.id,
      promptText: runItems.promptText,
      engine: runItems.engine,
      country: runItems.country,
      sampleIndex: runItems.sampleIndex,
      text: answers.text,
      reused: sql<boolean>`${answers.reusedFromId} is not null`,
    })
    .from(answers)
    .innerJoin(runItems, eq(answers.runItemId, runItems.id))
    .where(eq(runItems.runId, runId))
    .orderBy(
      asc(runItems.promptText),
      asc(runItems.engine),
      asc(runItems.country),
      asc(runItems.sampleIndex),
    )
    .limit(MAX_ANSWERS_SHOWN);

  const sources = new Map<string, { url: string; title: string | null; domain: string }[]>();
  for (let i = 0; i < rows.length; i += 1000) {
    const cites = await db
      .select({
        answerId: citations.answerId,
        url: citations.url,
        title: citations.title,
        domain: citations.domain,
      })
      .from(citations)
      .where(
        inArray(
          citations.answerId,
          rows.slice(i, i + 1000).map((r) => r.id),
        ),
      )
      .orderBy(asc(citations.position));
    for (const { answerId, ...c } of cites) {
      if (!sources.has(answerId)) sources.set(answerId, []);
      sources.get(answerId)!.push(c);
    }
  }

  // tracked brands each answer names, in order; own: the workspace's brand
  const [brand] = await db
    .select({ name: brands.name })
    .from(brands)
    .where(eq(brands.id, run.brandId));
  const named = new Map<string, { name: string; own: boolean; recommended: boolean }[]>();
  for (let i = 0; i < rows.length; i += 1000) {
    const found = await db
      .select({
        answerId: mentions.answerId,
        competitor: competitors.name,
        position: mentions.position,
        recommended: mentions.recommended,
      })
      .from(mentions)
      .leftJoin(competitors, eq(mentions.competitorId, competitors.id))
      .where(
        inArray(
          mentions.answerId,
          rows.slice(i, i + 1000).map((r) => r.id),
        ),
      )
      .orderBy(asc(mentions.position));
    for (const m of found) {
      if (!named.has(m.answerId)) named.set(m.answerId, []);
      named.get(m.answerId)!.push({
        name: m.competitor ?? brand?.name ?? "",
        own: !m.competitor,
        recommended: m.recommended === true,
      });
    }
  }

  // grouped by prompt, in order
  const byPrompt: {
    prompt: string;
    answers: ((typeof rows)[number] & {
      sources: { url: string; title: string | null; domain: string }[];
      named: { name: string; own: boolean; recommended: boolean }[];
    })[];
  }[] = [];
  for (const r of rows) {
    const last = byPrompt.at(-1);
    const answer = { ...r, sources: sources.get(r.id) ?? [], named: named.get(r.id) ?? [] };
    if (last?.prompt === r.promptText) last.answers.push(answer);
    else byPrompt.push({ prompt: r.promptText, answers: [answer] });
  }

  return {
    run,
    engines: engineRows as { engine: EngineId; planned: number; done: number; cost: string }[],
    byPrompt,
    shown: rows.length,
  };
}
