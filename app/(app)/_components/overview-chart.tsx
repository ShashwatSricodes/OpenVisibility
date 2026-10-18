"use client";

import { useState } from "react";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
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
  summary,
  type EngineId,
  type Metric,
  type MetricId,
} from "../_lib/sample-data";

const shortDate = (iso: string) =>
  new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });

function Delta({ metric, change }: { metric: Metric; change: number }) {
  if (Math.abs(change) < 0.05) return null;
  const better = metric.invert ? change < 0 : change > 0;
  const Arrow = change > 0 ? ArrowUpRight : ArrowDownRight;
  const text =
    metric.id === "position" ? Math.abs(change).toFixed(1) : `${Math.abs(change).toFixed(1)} pts`;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 text-xs font-medium",
        better ? "text-good" : "text-bad",
      )}
    >
      <Arrow className="size-3.5" strokeWidth={2} aria-hidden="true" />
      <span className="sr-only">{better ? "improved by" : "worsened by"}</span>
      {text}
    </span>
  );
}

function KpiTabs({ selected, onSelect }: { selected: MetricId; onSelect: (id: MetricId) => void }) {
  return (
    <div
      role="tablist"
      aria-label="Metric"
      className="grid grid-cols-2 border-b border-line sm:grid-cols-4 sm:divide-x sm:divide-line"
    >
      {METRICS.map((m) => {
        const { current, change } = summary(m.id);
        const active = m.id === selected;
        return (
          <button
            key={m.id}
            role="tab"
            type="button"
            aria-selected={active}
            title={m.hint}
            onClick={() => onSelect(m.id)}
            className={cn(
              "relative overflow-hidden px-4 py-3 text-left transition-colors hover:bg-hover focus:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-fg-subtle sm:px-6 sm:py-5",
              "border-line max-sm:border-b max-sm:odd:border-r sm:first:rounded-tl-md",
            )}
          >
            <span className="text-sm text-fg-subtle">{m.label}</span>
            <span className="mt-1 flex items-baseline gap-2">
              <span className="tabular text-2xl font-semibold tracking-tighter sm:text-[32px]">
                {m.format(current)}
              </span>
              <Delta metric={m} change={change} />
            </span>
            <span
              aria-hidden="true"
              className={cn(
                "absolute bottom-0 left-0 h-0.5 w-full bg-fg transition-transform duration-150",
                !active && "translate-y-0.75",
              )}
            />
          </button>
        );
      })}
    </div>
  );
}

function ChartTooltip({
  active,
  payload,
  label,
  metric,
}: TooltipContentProps<number, string> & { metric: Metric }) {
  if (!active || !payload?.length) return null;
  const rows = [...payload].sort((a, b) =>
    metric.invert ? Number(a.value) - Number(b.value) : Number(b.value) - Number(a.value),
  );
  return (
    <div className="min-w-48 rounded border border-line bg-panel text-sm shadow-[0_8px_24px_rgb(0_0_0/0.08)]">
      <p className="border-b border-line px-3 py-2 font-medium">{shortDate(String(label))}</p>
      <div className="grid gap-1.5 px-3 py-2">
        {rows.map((r) => {
          const engine = ENGINES.find((e) => e.id === r.dataKey);
          return (
            <div key={String(r.dataKey)} className="flex items-center justify-between gap-6">
              <span className="flex items-center gap-2 text-fg-default">
                <span className="size-2 rounded-xs" style={{ background: engine?.color }} />
                {engine?.name}
              </span>
              <span className="tabular font-medium">{metric.format(Number(r.value))}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function OverviewChart() {
  const [metricId, setMetricId] = useState<MetricId>("mention");
  const [hidden, setHidden] = useState<Set<EngineId>>(new Set());
  const metric = METRICS.find((m) => m.id === metricId)!;
  const data = SERIES[metricId];

  const toggle = (id: EngineId) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < ENGINES.length - 1) next.add(id); // keep at least one line
      return next;
    });

  return (
    <section className="overflow-hidden rounded-md border border-line bg-panel">
      <KpiTabs selected={metricId} onSelect={setMetricId} />

      <div className="flex flex-wrap items-center gap-1.5 px-4 pt-4 sm:px-6">
        {ENGINES.map((e) => {
          const off = hidden.has(e.id);
          return (
            <button
              key={e.id}
              type="button"
              aria-pressed={!off}
              onClick={() => toggle(e.id)}
              className={cn(
                "flex h-7 items-center gap-1.5 rounded-xs border border-line px-2 text-xs transition-colors hover:bg-hover",
                off ? "text-fg-muted" : "text-fg-default",
              )}
            >
              <span
                className="size-2 rounded-xs"
                style={{ background: off ? "var(--line-strong)" : e.color }}
              />
              {e.name}
              <span className="text-fg-muted">· {e.source}</span>
            </button>
          );
        })}
      </div>

      <div
        className="h-72 px-2 pb-4 pt-2 sm:h-80 sm:px-4"
        role="img"
        aria-label={`${metric.label} by engine over the last 30 days`}
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 12, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--grid)" />
            <XAxis
              dataKey="date"
              tickFormatter={shortDate}
              tickLine={false}
              axisLine={false}
              tick={{ fill: "var(--fg-muted)", fontSize: 12 }}
              minTickGap={32}
              tickMargin={8}
            />
            <YAxis
              width={44}
              tickLine={false}
              axisLine={false}
              tick={{ fill: "var(--fg-muted)", fontSize: 12 }}
              tickFormatter={(v: number) => (metric.invert ? `#${v}` : `${v}%`)}
              reversed={metric.invert}
              domain={metric.invert ? [1, "auto"] : [0, "auto"]}
              allowDecimals={metric.invert}
            />
            <Tooltip
              cursor={{ stroke: "var(--line-strong)", strokeWidth: 1 }}
              content={(props) => (
                <ChartTooltip {...(props as TooltipContentProps<number, string>)} metric={metric} />
              )}
            />
            {ENGINES.filter((e) => !hidden.has(e.id)).map((e) => (
              <Line
                key={e.id}
                dataKey={e.id}
                name={e.name}
                type="monotone"
                stroke={e.color}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--panel)" }}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
