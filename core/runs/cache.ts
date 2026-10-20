/**
 * Reusing answers: when the same prompt was asked of the same engine in the
 * same country within the last few hours, a new run copies that answer (and
 * its citations) instead of paying for it again. Only this workspace's own
 * answers are reused, and only ones that were really asked, never copies, so
 * an answer can't be passed along past its age limit.
 *
 * Bright Data doesn't let us pick the model, so the model isn't part of the
 * match; each copy keeps the model its original reported.
 */

import { and, desc, eq, gte, inArray, isNull } from "drizzle-orm";
import type { AnyDb } from "@/db/client";
import { answers, citations, runItems, runs } from "@/db/schema";
import type { EngineId } from "../providers/types";

type Citation = Omit<typeof citations.$inferInsert, "id" | "answerId">;

export type Reusable = {
  id: string;
  text: string;
  model: string | null;
  webSearchTriggered: boolean | null;
  shown: boolean | null;
  citations: Citation[];
};

export const reuseKey = (engine: EngineId, country: string | null, promptText: string) =>
  `${engine}\u0000${country ?? ""}\u0000${promptText}`;

/** Recent answers for these prompts, newest first, grouped by reuseKey. */
export async function findReusable(
  db: AnyDb,
  workspaceId: string,
  promptTexts: string[],
  hours: number,
  now = new Date(),
): Promise<Map<string, Reusable[]>> {
  const found = new Map<string, Reusable[]>();
  if (!promptTexts.length) return found;
  const rows = await db
    .select({
      id: answers.id,
      text: answers.text,
      model: answers.model,
      webSearchTriggered: answers.webSearchTriggered,
      shown: answers.shown,
      promptText: runItems.promptText,
      engine: runItems.engine,
      country: runItems.country,
    })
    .from(answers)
    .innerJoin(runItems, eq(answers.runItemId, runItems.id))
    .innerJoin(runs, eq(runItems.runId, runs.id))
    .where(
      and(
        eq(runs.workspaceId, workspaceId),
        gte(answers.createdAt, new Date(now.getTime() - hours * 3_600_000)),
        isNull(answers.reusedFromId),
        inArray(runItems.promptText, promptTexts),
      ),
    )
    .orderBy(desc(answers.createdAt));
  if (!rows.length) return found;

  const byAnswer = new Map<string, Citation[]>();
  for (let i = 0; i < rows.length; i += 1000) {
    const cites = await db
      .select({
        answerId: citations.answerId,
        url: citations.url,
        domain: citations.domain,
        title: citations.title,
        position: citations.position,
        kind: citations.kind,
      })
      .from(citations)
      .where(
        inArray(
          citations.answerId,
          rows.slice(i, i + 1000).map((r) => r.id),
        ),
      );
    for (const { answerId, ...c } of cites) {
      if (!byAnswer.has(answerId)) byAnswer.set(answerId, []);
      byAnswer.get(answerId)!.push(c);
    }
  }

  for (const { promptText, engine, country, ...a } of rows) {
    const key = reuseKey(engine, country, promptText);
    if (!found.has(key)) found.set(key, []);
    found.get(key)!.push({ ...a, citations: byAnswer.get(a.id) ?? [] });
  }
  return found;
}

/** Store copies of reused answers on their new items, at no cost. */
export async function storeReused(tx: AnyDb, pairs: { itemId: string; from: Reusable }[]) {
  for (const { itemId, from } of pairs) {
    const [copy] = await tx
      .insert(answers)
      .values({
        runItemId: itemId,
        text: from.text,
        model: from.model,
        webSearchTriggered: from.webSearchTriggered,
        shown: from.shown,
        costUsd: "0",
        reusedFromId: from.id,
      })
      .returning({ id: answers.id });
    if (from.citations.length)
      await tx.insert(citations).values(from.citations.map((c) => ({ ...c, answerId: copy.id })));
  }
}
