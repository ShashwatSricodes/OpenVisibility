/**
 * The filters every results page shares: date range, engine and country.
 * They live in the URL (?range=7d&engine=chatgpt&country=US), so a view can
 * be bookmarked or sent to someone; exports and the report read the same
 * parameters, so they match what's on screen.
 */

import { eq } from "drizzle-orm";
import type { AnyDb } from "@/db/client";
import { metricsDaily } from "@/db/schema";
import { countryName } from "./countries";
import { RANGES, isRange, periods, type RangeId } from "./overview";
import { ENGINES, isEngineId } from "./providers/registry";
import type { EngineId } from "./providers/types";

export type ViewFilter = { range: RangeId; engine?: EngineId; country?: string };

export const DEFAULT_RANGE: RangeId = "30d";

type Query = Record<string, string | string[] | undefined> | URLSearchParams;

const one = (q: Query, key: string) => {
  const v = q instanceof URLSearchParams ? q.get(key) : q[key];
  return typeof v === "string" ? v : undefined;
};

export const isCountry = (v: unknown): v is string => typeof v === "string" && /^[A-Z]{2}$/.test(v);

/** The filters from a page's search params; anything unknown is ignored. */
export function parseFilter(q: Query): ViewFilter {
  const range = one(q, "range");
  const engine = one(q, "engine");
  const country = one(q, "country");
  return {
    range: isRange(range) ? range : DEFAULT_RANGE,
    engine: engine && isEngineId(engine) ? engine : undefined,
    country: isCountry(country) ? country : undefined,
  };
}

/** The filters as search params, leaving out defaults so links stay short. */
export function filterParams(
  f: Partial<ViewFilter>,
  extra: Record<string, string | undefined> = {},
) {
  const p = new URLSearchParams();
  if (f.range && f.range !== DEFAULT_RANGE) p.set("range", f.range);
  if (f.engine) p.set("engine", f.engine);
  if (f.country) p.set("country", f.country);
  for (const [k, v] of Object.entries(extra)) if (v) p.set(k, v);
  return p;
}

export const filterHref = (
  path: string,
  f: Partial<ViewFilter>,
  extra?: Record<string, string | undefined>,
) => {
  const p = filterParams(f, extra);
  return `${path}${p.size ? `?${p}` : ""}`;
};

/** The days a filter covers, for queries on metrics_daily and on raw answers. */
export function filterWindow(f: ViewFilter, today = new Date()) {
  const p = periods(f.range, today);
  return {
    ...p,
    since: new Date(`${p.current.from}T00:00:00Z`),
    metrics: {
      ...p.current,
      engines: f.engine ? [f.engine] : undefined,
      countries: f.country ? [f.country] : undefined,
    },
  };
}

/** In words, for page descriptions, exports and the report: "last 30 days · ChatGPT · Germany". */
export function describeFilter(f: ViewFilter) {
  return [
    RANGES[f.range].label.toLowerCase(),
    f.engine && ENGINES[f.engine].name,
    f.country && countryName(f.country),
  ]
    .filter(Boolean)
    .join(" · ");
}

/** What the filter menus can offer: engines and countries with any results. */
export async function filterOptions(db: AnyDb, workspaceId: string) {
  const cells = await db
    .selectDistinct({ engine: metricsDaily.engine, country: metricsDaily.country })
    .from(metricsDaily)
    .where(eq(metricsDaily.workspaceId, workspaceId));
  const order = Object.keys(ENGINES);
  return {
    engines: [...new Set(cells.map((c) => c.engine))]
      .filter(isEngineId)
      .sort((a, b) => order.indexOf(a) - order.indexOf(b))
      .map((id) => ({ id, name: ENGINES[id].name })),
    countries: [...new Set(cells.map((c) => c.country).filter(Boolean))].sort(),
  };
}
