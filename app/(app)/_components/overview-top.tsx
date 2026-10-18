"use client";

import { useState } from "react";
import * as Menu from "@radix-ui/react-dropdown-menu";
import { Calendar, Check, ChevronDown, ListFilter, Play } from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from "recharts";
import { cn } from "../_lib/cn";
import {
  ENGINES,
  METRICS,
  SERIES,
  type EngineId,
  type Metric,
  type MetricId,
} from "../_lib/sample-data";

/* Dub gives each event tab a colour (clicks blue, leads violet, sales teal);
   the chart takes the colour of the selected tab. */
const METRIC_COLOR: Record<MetricId, string> = {
  mention: "#3b82f6",
  sov: "#7c3aed",
  position: "#2dd4bf",
  owned: "#f59e0b",
};

const RANGES = ["Last 7 days", "Last 30 days", "Last 90 days", "Month to date"];
const COUNTRIES = [
  { code: "US", name: "United States" },
  { code: "IN", name: "India" },
  { code: "GB", name: "United Kingdom" },
];

const longDate = (iso: string) =>
  new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });

const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** The selected metric over time: one engine, or the average across all. */
function seriesFor(metric: MetricId, engine: EngineId | "all") {
  return SERIES[metric].map((p) => ({
    date: p.date,
    value: engine === "all" ? avg(ENGINES.map((e) => p[e.id])) : p[engine],
  }));
}

/* ── filter controls, Dub style ───────────────────────────── */

const triggerClass =
  "flex h-9 items-center gap-2 rounded-lg border border-line bg-panel px-3 text-sm text-fg outline-none transition-colors hover:bg-hover focus-visible:ring-2 focus-visible:ring-line-strong data-[state=open]:bg-hover";

const contentClass =
  "z-50 min-w-52 rounded-lg border border-line bg-panel p-1 text-sm text-fg shadow-[0_8px_24px_rgb(0_0_0/0.08)]";

const itemClass =
  "flex h-8 cursor-default items-center justify-between gap-6 rounded-md px-2 outline-none data-[highlighted]:bg-hover";

function FilterMenu({
  engine,
  setEngine,
  country,
  setCountry,
}: {
  engine: EngineId | "all";
  setEngine: (e: EngineId | "all") => void;
  country: string;
  setCountry: (c: string) => void;
}) {
  const active = (engine !== "all" ? 1 : 0) + (country !== "US" ? 1 : 0);
  return (
    <Menu.Root>
      <Menu.Trigger className={triggerClass}>
        <ListFilter className="size-4" />
        Filter
        {active > 0 && (
          <span className="tabular rounded bg-fg px-1.5 text-[11px] font-medium text-panel">
            {active}
          </span>
        )}
        <ChevronDown className="size-4 text-fg-muted" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content align="end" sideOffset={6} className={contentClass}>
          <Menu.Label className="px-2 pb-1 pt-1.5 text-xs text-fg-muted">Engine</Menu.Label>
          {[{ id: "all" as const, name: "All engines" }, ...ENGINES].map((e) => (
            <Menu.Item key={e.id} onSelect={() => setEngine(e.id)} className={itemClass}>
              {e.name}
              {engine === e.id && <Check className="size-4" strokeWidth={2.25} />}
            </Menu.Item>
          ))}
          <Menu.Separator className="my-1 h-px bg-line" />
          <Menu.Label className="px-2 pb-1 pt-1.5 text-xs text-fg-muted">Country</Menu.Label>
          {COUNTRIES.map((c) => (
            <Menu.Item key={c.code} onSelect={() => setCountry(c.code)} className={itemClass}>
              {c.name}
              {country === c.code && <Check className="size-4" strokeWidth={2.25} />}
            </Menu.Item>
          ))}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}

function DateMenu({ range, setRange }: { range: string; setRange: (r: string) => void }) {
  return (
    <Menu.Root>
      <Menu.Trigger className={cn(triggerClass, "min-w-40 justify-between")}>
        <span className="flex items-center gap-2">
          <Calendar className="size-4" />
          {range}
        </span>
        <ChevronDown className="size-4 text-fg-muted" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content align="end" sideOffset={6} className={contentClass}>
          {RANGES.map((r) => (
            <Menu.Item key={r} onSelect={() => setRange(r)} className={itemClass}>
              {r}
              {range === r && <Check className="size-4" strokeWidth={2.25} />}
            </Menu.Item>
          ))}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}

/* ── KPI tabs ─────────────────────────────────────────────── */

function KpiTabs({
  engine,
  selected,
  onSelect,
}: {
  engine: EngineId | "all";
  selected: MetricId;
  onSelect: (id: MetricId) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Metric"
      className="scrollbar-hide flex overflow-x-auto overflow-y-hidden border-b border-line"
    >
      {METRICS.map((m) => {
        const s = seriesFor(m.id, engine);
        const current = avg(s.slice(-7).map((p) => p.value));
        const active = m.id === selected;
        return (
          <button
            key={m.id}
            role="tab"
            type="button"
            aria-selected={active}
            title={m.hint}
            onClick={() => onSelect(m.id)}
            className="relative min-w-40 flex-none border-r border-line px-5 py-4 text-left transition-colors last:border-r-0 hover:bg-hover focus:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-fg-subtle sm:min-w-60 sm:px-8 sm:py-6 sm:first:rounded-tl-xl"
          >
            <span className="flex items-center gap-2.5 text-sm text-fg-default">
              <span
                className="size-2 rounded-sm shadow-[inset_0_0_0_1px_rgb(0_0_0/0.1)]"
                style={{ background: METRIC_COLOR[m.id], opacity: 0.5 }}
              />
              {m.label}
            </span>
            <span className="mt-1 flex h-12 items-center">
              <span className="tabular text-2xl font-medium sm:text-3xl">{m.format(current)}</span>
            </span>
            <span
              aria-hidden="true"
              className={cn(
                "absolute bottom-0 left-0 h-0.5 w-full bg-fg transition-transform duration-100",
                !active && "translate-y-0.75",
              )}
            />
          </button>
        );
      })}
    </div>
  );
}

/* ── chart ────────────────────────────────────────────────── */

function ChartTooltip({
  active,
  payload,
  metric,
  color,
}: TooltipContentProps<number, string> & { metric: Metric; color: string }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload as { date: string; value: number };
  return (
    <div className="min-w-44 rounded-lg border border-line bg-panel text-sm shadow-[0_8px_24px_rgb(0_0_0/0.08)]">
      <p className="border-b border-line px-4 py-3 text-fg">{longDate(p.date)}</p>
      <div className="flex items-center justify-between gap-6 px-4 py-3">
        <span className="flex items-center gap-2 text-fg-default">
          <span className="size-2 rounded-sm" style={{ background: color, opacity: 0.5 }} />
          {metric.label}
        </span>
        <span className="tabular font-medium text-fg">{metric.format(p.value)}</span>
      </div>
    </div>
  );
}

export function OverviewTop({ title, subtitle }: { title: string; subtitle: string }) {
  const [metricId, setMetricId] = useState<MetricId>("mention");
  const [engine, setEngine] = useState<EngineId | "all">("all");
  const [country, setCountry] = useState("US");
  const [range, setRange] = useState("Last 30 days");

  const metric = METRICS.find((m) => m.id === metricId)!;
  const color = METRIC_COLOR[metricId];
  const data = seriesFor(metricId, engine);
  const first = data[0].date;
  const last = data[data.length - 1].date;
  const gradientId = `ov-area-${metricId}`;

  return (
    <>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold">{title}</h1>
          <p className="truncate text-sm text-fg-subtle">{subtitle}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <FilterMenu
            engine={engine}
            setEngine={setEngine}
            country={country}
            setCountry={setCountry}
          />
          <DateMenu range={range} setRange={setRange} />
          <button
            type="button"
            className="flex h-9 items-center gap-2 rounded-lg bg-inverted px-3 text-sm font-medium text-on-inverted transition-opacity hover:opacity-90"
          >
            <Play className="size-3.5 fill-current" />
            Run now
          </button>
        </div>
      </div>

      <section className="overflow-hidden rounded-xl border border-line bg-panel">
        <KpiTabs engine={engine} selected={metricId} onSelect={setMetricId} />
        <div
          className="h-80 px-2 pb-4 pt-6 sm:h-96 sm:px-6"
          role="img"
          aria-label={`${metric.label}${engine === "all" ? " across all engines" : ` on ${ENGINES.find((e) => e.id === engine)?.name}`}, ${range.toLowerCase()}`}
        >
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity={0.18} />
                  <stop offset="100%" stopColor={color} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke="var(--chart-grid)" strokeDasharray="4 4" />
              <XAxis
                dataKey="date"
                ticks={[first, last]}
                interval={0}
                tickLine={false}
                axisLine={{ stroke: "var(--chart-grid)" }}
                tickMargin={10}
                tick={({ x, y, payload }) => (
                  <text
                    x={x}
                    y={y}
                    dy={10}
                    textAnchor={payload.value === first ? "start" : "end"}
                    fontSize={12}
                    fill={payload.value === last ? "var(--fg)" : "var(--fg-muted)"}
                    fontWeight={payload.value === last ? 500 : 400}
                  >
                    {longDate(payload.value)}
                  </text>
                )}
              />
              <YAxis
                width={40}
                tickLine={false}
                axisLine={false}
                tick={{ fill: "var(--fg-muted)", fontSize: 12 }}
                tickFormatter={(v: number) => (metric.invert ? `#${v}` : `${v}%`)}
                reversed={metric.invert}
                domain={metric.invert ? [1, "auto"] : [0, "auto"]}
                allowDecimals={metric.invert}
                tickCount={4}
              />
              <Tooltip
                cursor={{ stroke: "var(--line-strong)", strokeWidth: 1 }}
                content={(props) => (
                  <ChartTooltip
                    {...(props as TooltipContentProps<number, string>)}
                    metric={metric}
                    color={color}
                  />
                )}
              />
              <Area
                type="linear"
                dataKey="value"
                stroke={color}
                strokeWidth={1.5}
                fill={`url(#${gradientId})`}
                isAnimationActive={false}
                dot={(props: { cx?: number; cy?: number; index?: number }) =>
                  props.index === data.length - 1 ? (
                    <circle key="end" cx={props.cx} cy={props.cy} r={3.5} fill={color} />
                  ) : (
                    <g key={props.index} />
                  )
                }
                activeDot={{ r: 4, fill: color, stroke: "var(--panel)", strokeWidth: 2 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </section>
    </>
  );
}
