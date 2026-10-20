/**
 * Everything the Overview page shows, from the daily metrics (never raw
 * answers): your KPIs against the previous period of the same length, the
 * trend per engine, the prompts where you're missing, competitors' share of
 * voice, and notes on the chart.
 */

import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import type { AnyDb } from "@/db/client";
import { annotations, metricsDaily, prompts } from "@/db/schema";
import type { Metrics } from "./metrics";
import { brandMetrics, metricsBy, type BrandMetrics, type MetricsFilter } from "./metrics-query";
import { ENGINES, isEngineId } from "./providers/registry";
import type { EngineId } from "./providers/types";

export const RANGES = {
  "7d": { label: "Last 7 days", days: 7 },
  "30d": { label: "Last 30 days", days: 30 },
  "90d": { label: "Last 90 days", days: 90 },
} as const;
export type RangeId = keyof typeof RANGES;
export const isRange = (v: unknown): v is RangeId => typeof v === "string" && v in RANGES;

export type KpiId = "mention" | "position" | "sov" | "owned" | "sentiment";

/** what each KPI reads from the metrics; position and sentiment aren't percentages */
const KPI_FIELD: Record<KpiId, keyof Metrics> = {
  mention: "mentionRate",
  position: "averagePosition",
  sov: "shareOfVoice",
  owned: "citationShare",
  sentiment: "sentiment",
};
export const PERCENT_KPIS: KpiId[] = ["mention", "sov", "owned"];

export type Kpi = {
  id: KpiId;
  /** percentages as 0–100; position as a rank; sentiment -1 to 1 */
  value: number | null;
  previous: number | null;
};

export type OverviewFilter = { range: RangeId; engine?: EngineId; country?: string };

const DAY = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);

export function periods(range: RangeId, today = new Date()) {
  const days = RANGES[range].days;
  const to = new Date(`${iso(today)}T00:00:00Z`);
  const from = new Date(to.getTime() - (days - 1) * DAY);
  return {
    current: { from: iso(from), to: iso(to) },
    previous: {
      from: iso(new Date(from.getTime() - days * DAY)),
      to: iso(new Date(from.getTime() - DAY)),
    },
    days: Array.from({ length: days }, (_, i) => iso(new Date(from.getTime() + i * DAY))),
  };
}

const kpiValue = (m: Metrics | undefined, id: KpiId) => {
  const v = m?.[KPI_FIELD[id]] ?? null;
  return v === null ? null : PERCENT_KPIS.includes(id) ? v * 100 : v;
};

export async function getOverview(
  db: AnyDb,
  workspaceId: string,
  f: OverviewFilter,
  today = new Date(),
) {
  const p = periods(f.range, today);
  const scope = {
    engines: f.engine ? [f.engine] : undefined,
    countries: f.country ? [f.country] : undefined,
  };
  const current: MetricsFilter = { ...p.current, ...scope };

  const [now, before, byEngine, byPrompt, available, notes] = await Promise.all([
    brandMetrics(db, workspaceId, current),
    brandMetrics(db, workspaceId, { ...p.previous, ...scope }),
    metricsBy(db, workspaceId, current, "engine", null),
    metricsBy(db, workspaceId, current, "prompt", null),
    // what the filters can offer: engines and countries with any data
    db
      .selectDistinct({ engine: metricsDaily.engine, country: metricsDaily.country })
      .from(metricsDaily)
      .where(eq(metricsDaily.workspaceId, workspaceId)),
    db
      .select({ id: annotations.id, day: annotations.day, text: annotations.text })
      .from(annotations)
      .where(
        and(
          eq(annotations.workspaceId, workspaceId),
          gte(annotations.day, p.current.from),
          lte(annotations.day, p.current.to),
        ),
      )
      .orderBy(asc(annotations.day), asc(annotations.createdAt)),
  ]);

  const own = now.find((b) => b.competitorId === null);
  const ownBefore = before.find((b) => b.competitorId === null);
  const kpis: Kpi[] = (["mention", "position", "sov", "owned", "sentiment"] as KpiId[]).map(
    (id) => ({
      id,
      value: kpiValue(own, id),
      previous: kpiValue(ownBefore, id),
    }),
  );

  // the trend: each KPI per day, one series per engine
  const engines = [...new Set(available.map((a) => a.engine))]
    .filter(isEngineId)
    .filter((e) => !f.engine || e === f.engine)
    .sort((a, b) => Object.keys(ENGINES).indexOf(a) - Object.keys(ENGINES).indexOf(b));
  const perEngine = await Promise.all(
    engines.map((e) =>
      metricsBy(db, workspaceId, { ...current, engines: [e] }, "day", null).then((rows) => ({
        engine: e,
        rows,
      })),
    ),
  );
  // a young workspace: start the chart at its first results (showing a week at least)
  const withData = new Set(perEngine.flatMap(({ rows }) => rows.map((r) => r.key)));
  const firstData = p.days.findIndex((d) => withData.has(d));
  const shownDays = p.days.slice(
    firstData < 0 ? 0 : Math.max(0, Math.min(firstData, p.days.length - 7)),
  );
  const trend = Object.fromEntries(
    kpis.map(({ id }) => [
      id,
      shownDays.map((date) => ({
        date,
        ...Object.fromEntries(
          perEngine.map(({ engine, rows }) => [
            engine,
            kpiValue(
              rows.find((r) => r.key === date),
              id,
            ),
          ]),
        ),
      })),
    ]),
  ) as Record<KpiId, ({ date: string } & Partial<Record<EngineId, number | null>>)[]>;

  // prompts, worst first, with their current text
  const promptIds = byPrompt.flatMap((r) => (r.key ? [r.key] : []));
  const texts = promptIds.length
    ? await db
        .select({ id: prompts.id, text: prompts.text })
        .from(prompts)
        .where(inArray(prompts.id, promptIds))
    : [];
  const promptRates = byPrompt
    .filter((r) => r.key && r.mentionRate !== null)
    .map((r) => ({
      id: r.key!,
      text: texts.find((t) => t.id === r.key)?.text ?? "(deleted prompt)",
      rate: r.mentionRate! * 100,
      samples: r.samples,
    }))
    .sort((a, b) => a.rate - b.rate || b.samples - a.samples);

  return {
    period: p.current,
    hasData: available.length > 0,
    samples: own?.samples ?? 0,
    visibilityIndex: own?.visibilityIndex ?? null,
    kpis,
    trend,
    engines,
    countries: [...new Set(available.map((a) => a.country).filter(Boolean))].sort(),
    byEngine: byEngine.flatMap((r) =>
      r.key && isEngineId(r.key) && r.mentionRate !== null
        ? [{ engine: r.key, rate: r.mentionRate * 100, position: r.averagePosition }]
        : [],
    ),
    brands: now as BrandMetrics[],
    prompts: promptRates,
    annotations: notes,
  };
}

export type Overview = Awaited<ReturnType<typeof getOverview>>;

export const MAX_NOTE = 200;

export function validateNote(day: string, text: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(`${day}T00:00:00Z`)))
    return "Pick a date.";
  if (!text.trim()) return "Write what changed.";
  if (text.trim().length > MAX_NOTE) return `Keep it under ${MAX_NOTE} characters.`;
  return null;
}
