import Link from "next/link";
import type { PromptRow } from "@/core/prompt-results";
import { ENGINES } from "@/core/providers/registry";
import type { EngineId } from "@/core/providers/types";
import { cn } from "../../_lib/cn";

/** A cell tinted by mention rate: the more you're named, the greener. */
function Heat({ rate }: { rate: number | null | undefined }) {
  if (rate === null || rate === undefined)
    return <span className="block rounded-md py-1 text-center text-xs text-fg-muted">–</span>;
  return (
    <span
      className="tabular block rounded-md py-1 text-center text-xs font-medium"
      style={{
        background: `color-mix(in srgb, var(--good) ${Math.round(8 + rate * 0.5)}%, transparent)`,
      }}
    >
      {Math.round(rate)}%
    </span>
  );
}

/** Mention rate over the period; gaps are days without a run. */
export function Sparkline({ values }: { values: (number | null)[] }) {
  const w = 88;
  const h = 24;
  const pts = values
    .map((v, i) =>
      v === null
        ? null
        : [values.length > 1 ? (i / (values.length - 1)) * w : w / 2, h - 2 - (v / 100) * (h - 4)],
    )
    .filter((p): p is number[] => p !== null);
  if (!pts.length) return <span className="text-xs text-fg-muted">–</span>;
  const last = pts[pts.length - 1];
  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      aria-hidden="true"
      className="overflow-visible"
    >
      <line x1={0} x2={w} y1={h - 2} y2={h - 2} stroke="var(--chart-grid)" strokeDasharray="2 3" />
      {pts.length > 1 && (
        <polyline
          points={pts.map((p) => p.join(",")).join(" ")}
          fill="none"
          stroke="var(--series-1)"
          strokeWidth={1.5}
          strokeLinejoin="round"
        />
      )}
      <circle cx={last[0]} cy={last[1]} r={2.5} fill="var(--series-1)" />
    </svg>
  );
}

export function ResultsTable({
  rows,
  engines,
  range,
}: {
  rows: PromptRow[];
  engines: EngineId[];
  range: string;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-panel">
      <table className="w-full min-w-[760px] text-left text-[13px]">
        <thead className="border-b border-line bg-hover text-xs text-fg-subtle">
          <tr>
            <th className="min-w-52 px-4 py-2 font-medium">Prompt</th>
            <th className="px-3 py-2 text-right font-medium">Named in</th>
            {engines.map((e) => (
              <th key={e} className="w-24 px-1.5 py-2 text-center font-medium">
                {ENGINES[e].name.replace("Google ", "")}
              </th>
            ))}
            <th className="px-3 py-2 text-right font-medium">Position</th>
            <th className="px-4 py-2 font-medium">Trend</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((r) => (
            <tr key={r.id} className="relative hover:bg-hover">
              <td className="max-w-md px-4 py-2.5">
                <Link
                  href={`/prompts/${r.id}${range === "30d" ? "" : `?range=${range}`}`}
                  className="after:absolute after:inset-0 hover:underline"
                >
                  {r.text}
                </Link>
                {!r.active && (
                  <span className="ml-2 rounded bg-pressed px-1.5 py-px text-[11px] text-fg-subtle">
                    Paused
                  </span>
                )}
              </td>
              <td
                className={cn(
                  "tabular px-3 py-2.5 text-right font-medium",
                  r.mentionRate === null && "font-normal text-fg-muted",
                )}
              >
                {r.mentionRate === null ? "No results yet" : `${Math.round(r.mentionRate)}%`}
              </td>
              {engines.map((e) => (
                <td key={e} className="px-1.5 py-2.5">
                  <Heat rate={r.byEngine[e]} />
                </td>
              ))}
              <td className="tabular px-3 py-2.5 text-right text-fg-subtle">
                {r.averagePosition === null ? "–" : `#${r.averagePosition.toFixed(1)}`}
              </td>
              <td className="px-4 py-2.5">
                <Sparkline values={r.spark} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
