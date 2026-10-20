/**
 * The Competitors page, from the daily metrics: a leaderboard against the
 * previous period, share of voice per day, head-to-head per engine, and the
 * prompts where a competitor is named more often than you.
 */

import { and, eq, inArray } from "drizzle-orm";
import type { AnyDb } from "@/db/client";
import { brands, prompts } from "@/db/schema";
import { filterWindow, type ViewFilter } from "./filters";
import { brandMetrics, metricsBy } from "./metrics-query";
import { ENGINES, isEngineId } from "./providers/registry";
import type { EngineId } from "./providers/types";

/** a brand's key in charts and maps: "you" or the competitor's id */
export const keyOf = (competitorId: string | null) => competitorId ?? "you";

export async function competitorView(
  db: AnyDb,
  workspaceId: string,
  f: ViewFilter,
  today = new Date(),
) {
  const { metrics: current, ...p } = filterWindow(f, today);
  const scope = { engines: current.engines, countries: current.countries };

  const [now, before, byDay, byEngine, byPrompt] = await Promise.all([
    brandMetrics(db, workspaceId, current),
    brandMetrics(db, workspaceId, { ...p.previous, ...scope }),
    metricsBy(db, workspaceId, current, "day"),
    metricsBy(db, workspaceId, current, "engine"),
    metricsBy(db, workspaceId, current, "prompt"),
  ]);

  const leaderboard = now.map((b) => {
    const prev = before.find((x) => x.competitorId === b.competitorId);
    return {
      ...b,
      key: keyOf(b.competitorId),
      shareOfVoiceBefore: prev?.shareOfVoice ?? null,
    };
  });
  const known = new Set(leaderboard.map((b) => b.competitorId));

  // share of voice per day, one series per brand; starts at the first day with results
  const withData = new Set(byDay.map((r) => r.key));
  const first = p.days.findIndex((d) => withData.has(d));
  const days = p.days.slice(first < 0 ? 0 : Math.max(0, Math.min(first, p.days.length - 7)));
  const sovTrend: ({ date: string } & Record<string, string | number | null>)[] = days.map(
    (date) => ({
      date,
      ...Object.fromEntries(
        byDay
          .filter((r) => r.key === date && known.has(r.competitorId))
          .map((r) => [
            keyOf(r.competitorId),
            r.shareOfVoice === null ? null : r.shareOfVoice * 100,
          ]),
      ),
    }),
  );

  // head-to-head: each engine × brand
  const engines = [...new Set(byEngine.map((r) => r.key))]
    .filter((e): e is EngineId => !!e && isEngineId(e))
    .sort((a, b) => Object.keys(ENGINES).indexOf(a) - Object.keys(ENGINES).indexOf(b));
  const headToHead = engines.map((e) => ({
    engine: e,
    brands: Object.fromEntries(
      byEngine
        .filter((r) => r.key === e && known.has(r.competitorId))
        .map((r) => [
          keyOf(r.competitorId),
          { mentionRate: r.mentionRate, averagePosition: r.averagePosition },
        ]),
    ),
  }));

  // prompts where a competitor is named more often than you, biggest gap first
  const promptIds = [...new Set(byPrompt.flatMap((r) => (r.key ? [r.key] : [])))];
  const texts = promptIds.length
    ? await db
        .select({ id: prompts.id, text: prompts.text })
        .from(prompts)
        .innerJoin(brands, eq(prompts.brandId, brands.id))
        .where(and(eq(brands.workspaceId, workspaceId), inArray(prompts.id, promptIds)))
    : [];
  const names = new Map(leaderboard.map((b) => [b.competitorId, b.name]));
  const beaten = texts
    .flatMap((t) => {
      const rows = byPrompt.filter((r) => r.key === t.id && known.has(r.competitorId));
      const you = rows.find((r) => r.competitorId === null)?.mentionRate ?? 0;
      const best = rows
        .filter((r) => r.competitorId !== null && r.mentionRate !== null)
        .sort((a, b) => b.mentionRate! - a.mentionRate!)[0];
      if (!best || best.mentionRate! <= you) return [];
      return [
        {
          promptId: t.id,
          text: t.text,
          you: you * 100,
          rival: names.get(best.competitorId) ?? "A competitor",
          theirs: best.mentionRate! * 100,
        },
      ];
    })
    .sort((a, b) => b.theirs - b.you - (a.theirs - a.you));

  return {
    leaderboard,
    sovTrend,
    headToHead,
    engines,
    beaten,
    rated: leaderboard.some((b) => b.sentiment !== null),
  };
}
