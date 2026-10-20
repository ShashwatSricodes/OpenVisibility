/**
 * Dashboard queries. They read metrics_daily only, never raw answers: sum the
 * counters for a selection, then turn them into metrics (core/metrics.ts).
 */

import { and, eq, gte, inArray, lte, sql, type SQL } from "drizzle-orm";
import type { AnyDb } from "@/db/client";
import { brands, competitors, metricsDaily } from "@/db/schema";
import { ZERO, coverageOf, metricsOf, type Counters, type Metrics } from "./metrics";
import type { EngineId } from "./providers/types";

export type MetricsFilter = {
  /** first and last day, inclusive, as YYYY-MM-DD (UTC) */
  from: string;
  to: string;
  engines?: EngineId[];
  countries?: string[];
  promptIds?: string[];
};

export type BrandMetrics = Metrics & {
  /** null: your own brand */
  competitorId: string | null;
  name: string;
  /** 0–1; prompts naming the brand ÷ prompts with samples */
  coverage: number | null;
};

const FIELDS = Object.keys(ZERO) as (keyof Counters)[];
const COLUMN: Record<keyof Counters, string> = {
  samples: "samples",
  asked: "asked",
  mentioned: "mentioned",
  mentions: "mentions",
  positioned: "positioned",
  positionSum: "position_sum",
  reciprocalSum: "reciprocal_sum",
  allMentions: "all_mentions",
  citations: "citations",
  allCitations: "all_citations",
  rated: "rated",
  sentimentSum: "sentiment_sum",
  positive: "positive",
  negative: "negative",
};
const sums = Object.fromEntries(
  FIELDS.map((f) => [f, sql<number>`coalesce(sum(${sql.identifier(COLUMN[f])}), 0)::float8`]),
) as Record<keyof Counters, SQL<number>>;

function where(workspaceId: string, f: MetricsFilter) {
  return and(
    eq(metricsDaily.workspaceId, workspaceId),
    gte(metricsDaily.day, f.from),
    lte(metricsDaily.day, f.to),
    f.engines?.length ? inArray(metricsDaily.engine, f.engines) : undefined,
    f.countries?.length ? inArray(metricsDaily.country, f.countries) : undefined,
    f.promptIds?.length ? inArray(metricsDaily.promptId, f.promptIds) : undefined,
  );
}

const counters = (row: Record<string, unknown>): Counters =>
  Object.fromEntries(FIELDS.map((f) => [f, Number(row[f] ?? 0)])) as Counters;

async function names(db: AnyDb, workspaceId: string) {
  const [own] = await db
    .select({ id: brands.id, name: brands.name })
    .from(brands)
    .where(eq(brands.workspaceId, workspaceId))
    .limit(1);
  const rivals = own
    ? await db
        .select({ id: competitors.id, name: competitors.name })
        .from(competitors)
        .where(eq(competitors.brandId, own.id))
    : [];
  return new Map<string | null, string>([
    [null, own?.name ?? "Your brand"],
    ...rivals.map((r) => [r.id, r.name] as [string, string]),
  ]);
}

/**
 * Metrics for your brand and every competitor over a selection; your brand
 * first, then competitors by Brand Visibility Index.
 */
export async function brandMetrics(
  db: AnyDb,
  workspaceId: string,
  filter: MetricsFilter,
): Promise<BrandMetrics[]> {
  const [totals, perPrompt, named] = await Promise.all([
    db
      .select({ competitorId: metricsDaily.competitorId, ...sums })
      .from(metricsDaily)
      .where(where(workspaceId, filter))
      .groupBy(metricsDaily.competitorId),
    db
      .select({
        competitorId: metricsDaily.competitorId,
        promptId: metricsDaily.promptId,
        ...sums,
      })
      .from(metricsDaily)
      .where(where(workspaceId, filter))
      .groupBy(metricsDaily.competitorId, metricsDaily.promptId),
    names(db, workspaceId),
  ]);
  return totals
    .filter((t) => named.has(t.competitorId))
    .map((t) => ({
      competitorId: t.competitorId,
      name: named.get(t.competitorId)!,
      ...metricsOf(counters(t)),
      coverage: coverageOf(
        perPrompt.filter((p) => p.competitorId === t.competitorId).map(counters),
      ),
    }))
    .sort(
      (a, b) =>
        Number(b.competitorId === null) - Number(a.competitorId === null) ||
        (b.visibilityIndex ?? -1) - (a.visibilityIndex ?? -1),
    );
}

export type Dimension = "day" | "engine" | "country" | "prompt";

const DIMENSION = {
  day: metricsDaily.day,
  engine: metricsDaily.engine,
  country: metricsDaily.country,
  prompt: metricsDaily.promptId,
} as const;

/**
 * Metrics split by day, engine, country or prompt, for one brand (null: yours)
 * or all of them; for trend lines and breakdown tables.
 */
export async function metricsBy(
  db: AnyDb,
  workspaceId: string,
  filter: MetricsFilter,
  by: Dimension,
  competitorId?: string | null,
): Promise<({ key: string | null; competitorId: string | null } & Metrics)[]> {
  const col = DIMENSION[by];
  const rows = await db
    .select({ key: col, competitorId: metricsDaily.competitorId, ...sums })
    .from(metricsDaily)
    .where(
      and(
        where(workspaceId, filter),
        competitorId === undefined
          ? undefined
          : competitorId === null
            ? sql`${metricsDaily.competitorId} is null`
            : eq(metricsDaily.competitorId, competitorId),
      ),
    )
    .groupBy(col, metricsDaily.competitorId)
    .orderBy(col);
  return rows.map((r) => ({
    key: r.key === null ? null : String(r.key),
    competitorId: r.competitorId,
    ...metricsOf(counters(r)),
  }));
}

/**
 * Metrics split by two dimensions at once, e.g. prompt × engine for a
 * heatmap or prompt × day for sparklines; for one brand (null: yours).
 */
export async function metricsBy2(
  db: AnyDb,
  workspaceId: string,
  filter: MetricsFilter,
  [a, b]: [Dimension, Dimension],
  competitorId: string | null = null,
): Promise<({ a: string | null; b: string | null } & Metrics)[]> {
  const ca = DIMENSION[a];
  const cb = DIMENSION[b];
  const rows = await db
    .select({ a: ca, b: cb, ...sums })
    .from(metricsDaily)
    .where(
      and(
        where(workspaceId, filter),
        competitorId === null
          ? sql`${metricsDaily.competitorId} is null`
          : eq(metricsDaily.competitorId, competitorId),
      ),
    )
    .groupBy(ca, cb)
    .orderBy(ca, cb);
  return rows.map((r) => ({
    a: r.a === null ? null : String(r.a),
    b: r.b === null ? null : String(r.b),
    ...metricsOf(counters(r)),
  }));
}
