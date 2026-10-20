"use client";

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

type Brand = { key: string; name: string; color: string; you: boolean };
type Point = { date: string } & Record<string, number | null | string>;

const longDate = (iso: string) =>
  new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });

function Tip({
  active,
  payload,
  brands,
}: TooltipContentProps<number, string> & { brands: Brand[] }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload as Point;
  const rows = brands
    .filter((b) => typeof p[b.key] === "number")
    .sort((a, b) => (p[b.key] as number) - (p[a.key] as number));
  return (
    <div className="min-w-44 rounded-lg border border-line bg-panel text-[13px] shadow-[0_8px_24px_rgb(0_0_0/0.08)]">
      <p className="border-b border-line px-3 py-2">{longDate(p.date)}</p>
      <div className="flex flex-col gap-1 px-3 py-2">
        {rows.length === 0 && <span className="text-fg-subtle">No run this day</span>}
        {rows.map((b) => (
          <div key={b.key} className="flex items-center justify-between gap-6">
            <span className="flex items-center gap-2">
              <span className="size-2 rounded-sm" style={{ background: b.color }} />
              {b.name}
            </span>
            <span className="tabular font-medium">{Math.round(p[b.key] as number)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Share of voice per day, one line per brand; yours drawn heavier. */
export function SovChart({ data, brands }: { data: Point[]; brands: Brand[] }) {
  const first = data[0]?.date;
  const last = data[data.length - 1]?.date;
  return (
    <div className="h-56 sm:h-64" role="img" aria-label="Share of voice over time, per brand">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
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
                fill="var(--fg-muted)"
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
            tickFormatter={(v: number) => `${v}%`}
            domain={[0, (max: number) => Math.min(100, Math.max(10, Math.ceil(max / 10) * 10))]}
            tickCount={4}
          />
          <Tooltip
            cursor={{ stroke: "var(--line-strong)", strokeWidth: 1 }}
            content={(props) => (
              <Tip {...(props as TooltipContentProps<number, string>)} brands={brands} />
            )}
          />
          {brands.map((b) => (
            <Line
              key={b.key}
              dataKey={b.key}
              name={b.name}
              type="linear"
              stroke={b.color}
              strokeWidth={b.you ? 2.5 : 1.5}
              connectNulls
              dot={{ r: b.you ? 3 : 2, fill: b.color, strokeWidth: 0 }}
              activeDot={{ r: 4, stroke: "var(--panel)", strokeWidth: 2 }}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
