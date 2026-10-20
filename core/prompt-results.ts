/**
 * Results per prompt, from the daily metrics: the table on the Prompts page
 * (mention rate per engine, position, a sparkline) and one prompt's page
 * (per engine and country, who wins it, and its latest answers).
 */

import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { AnyDb } from "@/db/client";
import { answers, brands, competitors, mentions, prompts, runItems, runs } from "@/db/schema";
import { filterWindow, type ViewFilter } from "./filters";
import { brandMetrics, metricsBy, metricsBy2 } from "./metrics-query";
import { periods, type RangeId } from "./overview";
import { ENGINES, isEngineId } from "./providers/registry";
import type { EngineId } from "./providers/types";

const pct = (v: number | null) => (v === null ? null : v * 100);
const byEngineOrder = (a: EngineId, b: EngineId) =>
  Object.keys(ENGINES).indexOf(a) - Object.keys(ENGINES).indexOf(b);

export type PromptRow = {
  id: string;
  text: string;
  active: boolean;
  tags: string[];
  samples: number;
  /** 0–100 */
  mentionRate: number | null;
  averagePosition: number | null;
  /** 0–100 per engine; null: not asked there in this period */
  byEngine: Partial<Record<EngineId, number | null>>;
  /** mention rate per day, oldest first; null on days without a run */
  spark: (number | null)[];
};

/** Every prompt of the brand with its results over the range, worst first. */
export async function promptTable(
  db: AnyDb,
  workspaceId: string,
  brandId: string,
  f: ViewFilter,
  today = new Date(),
) {
  const { metrics: current, ...p } = filterWindow(f, today);
  const [list, overall, engineCells, dayCells] = await Promise.all([
    db
      .select({ id: prompts.id, text: prompts.text, active: prompts.active, tags: prompts.tags })
      .from(prompts)
      .where(eq(prompts.brandId, brandId))
      .orderBy(asc(prompts.createdAt)),
    metricsBy(db, workspaceId, current, "prompt", null),
    metricsBy2(db, workspaceId, current, ["prompt", "engine"]),
    metricsBy2(db, workspaceId, current, ["prompt", "day"]),
  ]);
  const engines = [...new Set(engineCells.map((c) => c.b))]
    .filter((e): e is EngineId => !!e && isEngineId(e))
    .sort(byEngineOrder);

  // sparklines start at the first day with any result, like the Overview chart
  const withData = new Set(dayCells.map((c) => c.b));
  const first = p.days.findIndex((d) => withData.has(d));
  const days = p.days.slice(first < 0 ? 0 : Math.max(0, Math.min(first, p.days.length - 7)));

  const rows: PromptRow[] = list.map((pr) => {
    const cells = engineCells.filter((c) => c.a === pr.id);
    const all = overall.find((o) => o.key === pr.id);
    return {
      ...pr,
      samples: all?.samples ?? 0,
      mentionRate: pct(all?.mentionRate ?? null),
      averagePosition: all?.averagePosition ?? null,
      byEngine: Object.fromEntries(
        engines.map((e) => [e, pct(cells.find((c) => c.b === e)?.mentionRate ?? null)]),
      ),
      spark: days.map((d) =>
        pct(dayCells.find((c) => c.a === pr.id && c.b === d)?.mentionRate ?? null),
      ),
    };
  });
  // worst first; prompts without results last
  rows.sort(
    (a, b) =>
      Number(a.mentionRate === null) - Number(b.mentionRate === null) ||
      (a.mentionRate ?? 0) - (b.mentionRate ?? 0) ||
      Number(b.active) - Number(a.active),
  );
  return { rows, engines, days };
}

/** One prompt: its results by engine and country, who wins it, and its latest answers. */
export async function promptDetail(
  db: AnyDb,
  workspaceId: string,
  promptId: string,
  range: RangeId,
  today = new Date(),
) {
  const [prompt] = await db
    .select({
      id: prompts.id,
      text: prompts.text,
      active: prompts.active,
      tags: prompts.tags,
      brandId: prompts.brandId,
      brandName: brands.name,
    })
    .from(prompts)
    .innerJoin(brands, eq(prompts.brandId, brands.id))
    .where(and(eq(prompts.id, promptId), eq(brands.workspaceId, workspaceId)));
  if (!prompt) return null;

  const p = periods(range, today);
  const filter = { ...p.current, promptIds: [promptId] };
  const [ranking, cells] = await Promise.all([
    brandMetrics(db, workspaceId, filter),
    metricsBy2(db, workspaceId, filter, ["engine", "country"]),
  ]);

  const latest = await db
    .select({
      answerId: answers.id,
      text: answers.text,
      engine: runItems.engine,
      country: runItems.country,
      runId: runs.id,
      at: answers.createdAt,
    })
    .from(answers)
    .innerJoin(runItems, eq(answers.runItemId, runItems.id))
    .innerJoin(runs, eq(runItems.runId, runs.id))
    .where(and(eq(runItems.promptId, promptId), eq(runs.workspaceId, workspaceId)))
    .orderBy(desc(answers.createdAt))
    .limit(20);
  const named = latest.length
    ? await db
        .select({
          answerId: mentions.answerId,
          name: sql<string>`coalesce(${competitors.name}, ${prompt.brandName})`,
          own: sql<boolean>`${mentions.competitorId} is null`,
          snippet: mentions.snippet,
        })
        .from(mentions)
        .leftJoin(competitors, eq(mentions.competitorId, competitors.id))
        .where(
          inArray(
            mentions.answerId,
            latest.map((l) => l.answerId),
          ),
        )
        .orderBy(asc(mentions.position))
    : [];

  return {
    prompt,
    own: ranking.find((b) => b.competitorId === null) ?? null,
    ranking,
    cells: cells
      .filter((c): c is typeof c & { a: EngineId } => !!c.a && isEngineId(c.a))
      .sort((x, y) => byEngineOrder(x.a, y.a) || (x.b ?? "").localeCompare(y.b ?? "")),
    answers: latest.map((l) => {
      const mine = named.filter((n) => n.answerId === l.answerId);
      const ownSnippet = mine.find((n) => n.own)?.snippet;
      return {
        ...l,
        named: mine.map((n) => ({ name: n.name, own: n.own })),
        // what the answer says about you, or how it starts
        excerpt: ownSnippet ?? l.text.slice(0, 220).replace(/\s+/g, " "),
      };
    }),
  };
}
