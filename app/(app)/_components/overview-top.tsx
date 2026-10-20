"use client";

import { useState, useTransition } from "react";
import { StickyNote, X } from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from "recharts";
import type { Kpi, KpiId } from "@/core/overview";
import { ENGINE_COLOR, KPI, change, type KpiInfo } from "../_lib/kpi";
import type { EngineId } from "@/core/providers/types";
import { addNoteAction, deleteNoteAction } from "../(workspace)/dashboard/actions";
import { cn } from "../_lib/cn";

const longDate = (iso: string) =>
  new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });

/* ── KPI tabs and the trend chart ─────────────────────────── */

type Point = { date: string } & Partial<Record<EngineId, number | null>>;
type Note = { id: string; day: string; text: string };

function ChartTooltip({
  active,
  payload,
  info,
  engines,
  notes,
}: TooltipContentProps<number, string> & {
  info: KpiInfo;
  engines: { id: EngineId; name: string }[];
  notes: Note[];
}) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload as Point;
  const here = notes.filter((n) => n.day === p.date);
  const rows = engines.filter((e) => p[e.id] !== null && p[e.id] !== undefined);
  return (
    <div className="min-w-44 max-w-64 rounded-lg border border-line bg-panel text-[13px] shadow-[0_8px_24px_rgb(0_0_0/0.08)]">
      <p className="border-b border-line px-3 py-2 text-fg">{longDate(p.date)}</p>
      <div className="flex flex-col gap-1 px-3 py-2">
        {rows.length === 0 && <span className="text-fg-subtle">No run this day</span>}
        {rows.map((e) => (
          <div key={e.id} className="flex items-center justify-between gap-6">
            <span className="flex items-center gap-2 text-fg-default">
              <span className="size-2 rounded-sm" style={{ background: ENGINE_COLOR[e.id] }} />
              {e.name}
            </span>
            <span className="tabular font-medium text-fg">{info.format(p[e.id]!)}</span>
          </div>
        ))}
      </div>
      {here.map((n) => (
        <p key={n.id} className="border-t border-line px-3 py-2 text-xs text-fg-default">
          <StickyNote className="mr-1 inline size-3 text-fg-subtle" />
          {n.text}
        </p>
      ))}
    </div>
  );
}

export function TrendPanel({
  kpis,
  trend,
  engines,
  notes,
  periodLabel,
  today,
}: {
  kpis: Kpi[];
  trend: Record<KpiId, Point[]>;
  engines: { id: EngineId; name: string }[];
  notes: Note[];
  periodLabel: string;
  today: string;
}) {
  // sentiment shows only once answers are rated
  const shown = kpis.filter((k) => k.id !== "sentiment" || k.value !== null);
  const [selected, setSelected] = useState<KpiId>("mention");
  const info = KPI[selected];
  const data = trend[selected];
  const first = data[0]?.date;
  const last = data[data.length - 1]?.date;
  const values = data.flatMap((p) =>
    engines.map((e) => p[e.id]).filter((v): v is number => typeof v === "number"),
  );

  return (
    <section className="overflow-hidden rounded-xl border border-line bg-panel">
      <div
        role="tablist"
        aria-label="Metric"
        className="scrollbar-hide flex overflow-x-auto overflow-y-hidden border-b border-line"
      >
        {shown.map((k) => {
          const c = change(k.id, k);
          const active = k.id === selected;
          return (
            <button
              key={k.id}
              role="tab"
              type="button"
              aria-selected={active}
              title={KPI[k.id].hint}
              onClick={() => setSelected(k.id)}
              className="relative min-w-36 flex-none border-r border-line px-4 py-3 text-left transition-colors last:border-r-0 hover:bg-hover focus:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-fg-subtle sm:min-w-44 sm:px-5 sm:py-4 sm:first:rounded-tl-xl"
            >
              <span className="text-xs text-fg-default">{KPI[k.id].label}</span>
              <span className="mt-1 flex h-8 items-baseline gap-2">
                <span className="tabular text-xl font-medium sm:text-2xl">
                  {k.value === null ? "–" : KPI[k.id].format(k.value)}
                </span>
                {c && (
                  <span
                    className={cn(
                      "tabular text-xs font-medium",
                      c.tone === "up" && "text-good",
                      c.tone === "down" && "text-bad",
                      c.tone === "flat" && "text-fg-subtle",
                    )}
                    title={`${periodLabel}, compared with the period before`}
                  >
                    {c.tone === "up" ? "▲ " : c.tone === "down" ? "▼ " : ""}
                    {c.text}
                  </span>
                )}
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

      <div
        className="h-60 px-2 pb-1 pt-4 sm:h-64 sm:px-5"
        role="img"
        aria-label={`${info.label} per engine, ${periodLabel.toLowerCase()}`}
      >
        {values.length === 0 ? (
          <p className="flex h-full items-center justify-center text-[13px] text-fg-subtle">
            No results in this period.
          </p>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 12, right: 8, bottom: 0, left: 0 }}>
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
                    fontSize={11}
                    fill={payload.value === last ? "var(--fg)" : "var(--fg-muted)"}
                  >
                    {longDate(payload.value)}
                  </text>
                )}
              />
              <YAxis
                width={40}
                tickLine={false}
                axisLine={false}
                tick={{ fill: "var(--fg-muted)", fontSize: 11 }}
                tickFormatter={(v: number) => info.format(v)}
                reversed={info.invert}
                domain={
                  selected === "sentiment"
                    ? [-1, 1]
                    : info.invert
                      ? [1, "auto"]
                      : [0, (max: number) => Math.min(100, Math.max(10, Math.ceil(max / 10) * 10))]
                }
                allowDecimals={info.invert || selected === "sentiment"}
                tickCount={4}
              />
              <Tooltip
                cursor={{ stroke: "var(--line-strong)", strokeWidth: 1 }}
                content={(props) => (
                  <ChartTooltip
                    {...(props as TooltipContentProps<number, string>)}
                    info={info}
                    engines={engines}
                    notes={notes}
                  />
                )}
              />
              {notes.map((n) => (
                <ReferenceLine
                  key={n.id}
                  x={n.day}
                  stroke="var(--fg-subtle)"
                  strokeDasharray="3 3"
                  label={{ value: "●", position: "top", fill: "var(--fg-subtle)", fontSize: 9 }}
                />
              ))}
              {engines.map((e) => (
                <Line
                  key={e.id}
                  type="linear"
                  dataKey={e.id}
                  name={e.name}
                  stroke={ENGINE_COLOR[e.id]}
                  strokeWidth={1.75}
                  connectNulls
                  dot={{ r: 2.5, fill: ENGINE_COLOR[e.id], strokeWidth: 0 }}
                  activeDot={{ r: 4, stroke: "var(--panel)", strokeWidth: 2 }}
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 pb-3 text-xs text-fg-subtle">
        {engines.map((e) => (
          <span key={e.id} className="flex items-center gap-1.5">
            <span className="size-2 rounded-sm" style={{ background: ENGINE_COLOR[e.id] }} />
            {e.name}
          </span>
        ))}
      </div>

      <Notes notes={notes} today={today} />
    </section>
  );
}

/* ── notes on the chart ───────────────────────────────────── */

function Notes({ notes, today }: { notes: Note[]; today: string }) {
  const [adding, setAdding] = useState(false);
  const [day, setDay] = useState(today);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const add = () =>
    start(async () => {
      const r = await addNoteAction(day, text);
      if (r.ok) {
        setText("");
        setAdding(false);
        setError(null);
      } else setError(r.message);
    });

  return (
    <div className="border-t border-line px-5 py-3 text-[13px]">
      {notes.length > 0 && (
        <ul className="mb-2 flex flex-col gap-1">
          {notes.map((n) => (
            <li key={n.id} className="group flex items-center gap-2">
              <span className="tabular w-24 shrink-0 text-xs text-fg-subtle">
                {longDate(n.day).replace(/^\w+, /, "")}
              </span>
              <span className="min-w-0 flex-1 truncate">{n.text}</span>
              <button
                type="button"
                aria-label={`Delete note: ${n.text}`}
                onClick={() => start(async () => void (await deleteNoteAction(n.id)))}
                className="rounded p-0.5 text-fg-muted opacity-0 hover:bg-hover hover:text-fg focus-visible:opacity-100 group-hover:opacity-100"
              >
                <X className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {adding ? (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <input
            type="date"
            aria-label="Date"
            value={day}
            max={today}
            onChange={(e) => setDay(e.target.value)}
            className="h-8 rounded-lg border border-line bg-panel px-2 text-[13px] text-fg outline-none focus:border-line-strong"
          />
          <input
            autoFocus
            aria-label="What changed"
            placeholder="What changed? e.g. published a comparison page"
            value={text}
            maxLength={200}
            onChange={(e) => setText(e.target.value)}
            className="h-8 min-w-48 flex-1 rounded-lg border border-line bg-panel px-2.5 text-[13px] text-fg outline-none focus:border-line-strong"
          />
          <button
            type="submit"
            disabled={pending || !text.trim()}
            className="h-8 rounded-lg bg-inverted px-3 text-[13px] font-medium text-on-inverted disabled:opacity-60"
          >
            {pending ? "Adding…" : "Add note"}
          </button>
          <button
            type="button"
            onClick={() => setAdding(false)}
            className="h-8 rounded-lg px-2 text-[13px] text-fg-subtle hover:text-fg"
          >
            Cancel
          </button>
          {error && <span className="w-full text-xs text-bad">{error}</span>}
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="flex items-center gap-1.5 text-xs text-fg-subtle hover:text-fg"
        >
          <StickyNote className="size-3.5" />
          Add a note to the chart: what did you change?
        </button>
      )}
    </div>
  );
}
