import type { Metadata } from "next";
import type { CSSProperties, ReactNode } from "react";
import { redirect } from "next/navigation";
import { requireWorkspace } from "@/core/auth/session";
import { getBrandSetup } from "@/core/brands";
import { citationSummary, ownedPages } from "@/core/citation-stats";
import { competitorView } from "@/core/competitor-results";
import { describeFilter, filterWindow, parseFilter } from "@/core/filters";
import { RANGES, getOverview } from "@/core/overview";
import { ENGINES } from "@/core/providers/registry";
import type { EngineId } from "@/core/providers/types";
import { getDb } from "@/db/client";
import { ENGINE_COLOR, KPI, change } from "../_lib/kpi";
import { cn } from "../_lib/cn";
import { PrintButton } from "./print-button";

export const metadata: Metadata = { title: "Report" };

/* The report prints light whatever the app theme, before first paint. */
const lightScript = `document.documentElement.classList.remove("dark")`;

const pct = (v: number | null) => (v === null ? "–" : `${Math.round(v * 100)}%`);
const share = (n: number, of: number) => {
  if (!of) return "–";
  const v = Math.round((n / of) * 100);
  return v === 0 && n > 0 ? "<1%" : `${v}%`;
};
const longDay = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="flex break-inside-avoid flex-col gap-2">
      <div>
        <h2 className="text-sm font-semibold">{title}</h2>
        {note && <p className="text-xs text-fg-subtle">{note}</p>}
      </div>
      {children}
    </section>
  );
}

const th = "px-3 py-1.5 text-xs font-medium text-fg-subtle";
const td = "px-3 py-1.5";

/** Mention rate per day, one line per engine; drawn on the server so it prints as is. */
function TrendChart({
  points,
  engines,
}: {
  points: ({ date: string } & Partial<Record<EngineId, number | null>>)[];
  engines: EngineId[];
}) {
  const w = 680;
  const h = 160;
  const pad = { l: 32, r: 8, t: 8, b: 20 };
  const x = (i: number) =>
    pad.l + (points.length > 1 ? (i / (points.length - 1)) * (w - pad.l - pad.r) : 0);
  const y = (v: number) => pad.t + (1 - v / 100) * (h - pad.t - pad.b);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" role="img" aria-label="Mention rate per day">
      {[0, 50, 100].map((v) => (
        <g key={v}>
          <line
            x1={pad.l}
            x2={w - pad.r}
            y1={y(v)}
            y2={y(v)}
            stroke="var(--chart-grid)"
            strokeDasharray="4 4"
          />
          <text x={pad.l - 6} y={y(v) + 3} textAnchor="end" fontSize={10} fill="var(--fg-muted)">
            {v}%
          </text>
        </g>
      ))}
      {points.length > 0 && (
        <>
          <text x={pad.l} y={h - 4} fontSize={10} fill="var(--fg-muted)">
            {longDay(points[0].date)}
          </text>
          <text x={w - pad.r} y={h - 4} textAnchor="end" fontSize={10} fill="var(--fg-muted)">
            {longDay(points[points.length - 1].date)}
          </text>
        </>
      )}
      {engines.map((e) => {
        const xy = points.flatMap((p, i) => {
          const v = p[e];
          return typeof v === "number" ? [[x(i), y(v)]] : [];
        });
        return (
          <g key={e}>
            {xy.length > 1 && (
              <polyline
                points={xy.map((p) => p.join(",")).join(" ")}
                fill="none"
                stroke={ENGINE_COLOR[e]}
                strokeWidth={1.75}
                strokeLinejoin="round"
              />
            )}
            {xy.map(([cx, cy], i) => (
              <circle key={i} cx={cx} cy={cy} r={2} fill={ENGINE_COLOR[e]} />
            ))}
          </g>
        );
      })}
    </svg>
  );
}

/**
 * A one-document summary of the Overview, Competitors and Citations pages,
 * for a client or a board. It takes the same filters as those pages; the
 * browser's print dialog saves it as a PDF.
 */
export default async function ReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { workspace } = await requireWorkspace();
  const db = getDb();
  const setup = await getBrandSetup(db, workspace.id);
  if (!setup.brand) redirect("/onboarding");

  const filter = parseFilter(await searchParams);
  const { engine, country } = filter;
  const window = filterWindow(filter);
  const scope = { since: window.since, engine, country };
  const [o, rivals, sources, owned] = await Promise.all([
    getOverview(db, workspace.id, filter),
    competitorView(db, workspace.id, filter),
    citationSummary(db, workspace.id, scope, { limit: 10, pagesPerDomain: 0 }),
    ownedPages(db, workspace.id, scope),
  ]);
  const mention = o.kpis.find((k) => k.id === "mention")!;
  const trend = change("mention", mention);
  const missing = o.prompts.filter((p) => p.rate < 50).slice(0, 10);
  const generated = new Date().toISOString().slice(0, 10);
  const kpis = o.kpis.filter((k) => k.id !== "sentiment" || k.value !== null);

  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: lightScript }} />
      <div className="mx-auto flex max-w-[760px] flex-col gap-6 bg-panel px-6 py-8 text-[13px] print:max-w-none print:px-0 print:py-0">
        <header className="flex items-start justify-between gap-4 border-b border-line pb-4">
          <div>
            <p className="text-xs text-fg-subtle">AI visibility report</p>
            <h1 className="font-display text-xl font-semibold">{setup.brand.name}</h1>
            <p className="mt-1 text-fg-subtle">
              {longDay(o.period.from)} – {longDay(o.period.to)} · {describeFilter(filter)}
            </p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <PrintButton />
            <p className="text-xs text-fg-subtle">Generated {longDay(generated)}</p>
          </div>
        </header>

        {!o.hasData || o.samples === 0 ? (
          <p className="rounded-lg border border-line px-4 py-8 text-center text-fg-subtle">
            No results for {describeFilter(filter)}. Run your prompts, or pick a longer range.
          </p>
        ) : (
          <>
            <Section title="Summary">
              <p>
                Across {o.samples.toLocaleString("en-US")} answers, AI engines named{" "}
                {setup.brand.name} in <strong>{Math.round(mention.value ?? 0)}%</strong> of them
                {trend
                  ? trend.tone === "flat"
                    ? `, the same as the ${RANGES[filter.range].days} days before`
                    : `, ${trend.text.replace("+", "up ").replace("−", "down ")} on the ${RANGES[filter.range].days} days before`
                  : ""}
                .
                {o.visibilityIndex !== null &&
                  ` Its visibility index is ${Math.round(o.visibilityIndex)} out of 100.`}
              </p>
              <div
                className="grid grid-cols-2 gap-2 sm:grid-cols-[repeat(var(--n),minmax(0,1fr))] print:grid-cols-[repeat(var(--n),minmax(0,1fr))]"
                style={{ "--n": kpis.length } as CSSProperties}
              >
                {kpis.map((k) => {
                  const c = change(k.id, k);
                  return (
                    <div key={k.id} className="rounded-lg border border-line px-3 py-2">
                      <p className="text-xs text-fg-subtle">{KPI[k.id].label}</p>
                      <p className="tabular text-lg font-semibold">
                        {k.value === null ? "–" : KPI[k.id].format(k.value)}
                      </p>
                      <p
                        className={cn(
                          "tabular text-xs",
                          c?.tone === "up"
                            ? "text-good"
                            : c?.tone === "down"
                              ? "text-bad"
                              : "text-fg-subtle",
                        )}
                      >
                        {c ? c.text : "no earlier data"}
                      </p>
                    </div>
                  );
                })}
              </div>
            </Section>

            <Section title="Mention rate over time" note="Share of answers naming you, per engine">
              <TrendChart points={o.trend.mention} engines={o.engines} />
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-subtle">
                {o.byEngine.map((e) => (
                  <span key={e.engine} className="flex items-center gap-1.5">
                    <span
                      className="size-2 rounded-sm"
                      style={{ background: ENGINE_COLOR[e.engine] }}
                    />
                    {ENGINES[e.engine].name}: {Math.round(e.rate)}%
                    {e.position !== null && `, #${e.position.toFixed(1)}`}
                  </span>
                ))}
              </div>
            </Section>

            {rivals.leaderboard.length > 1 && (
              <Section
                title="Against competitors"
                note="Visibility index combines mention rate, position and share of voice (0–100)"
              >
                <table className="w-full text-left">
                  <thead className="border-b border-line">
                    <tr>
                      <th className={th}>Brand</th>
                      <th className={cn(th, "text-right")}>Visibility</th>
                      <th className={cn(th, "text-right")}>Named in</th>
                      <th className={cn(th, "text-right")}>Position</th>
                      <th className={cn(th, "text-right")}>Share of voice</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {rivals.leaderboard.map((b) => (
                      <tr key={b.key} className={b.competitorId === null ? "font-semibold" : ""}>
                        <td className={td}>{b.name}</td>
                        <td className={cn(td, "tabular text-right")}>
                          {b.visibilityIndex === null ? "–" : Math.round(b.visibilityIndex)}
                        </td>
                        <td className={cn(td, "tabular text-right")}>{pct(b.mentionRate)}</td>
                        <td className={cn(td, "tabular text-right")}>
                          {b.averagePosition === null ? "–" : `#${b.averagePosition.toFixed(1)}`}
                        </td>
                        <td className={cn(td, "tabular text-right")}>{pct(b.shareOfVoice)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {rivals.beaten.length > 0 && (
                  <>
                    <p className="mt-2 text-xs font-medium">
                      Prompts where a competitor is named more often
                    </p>
                    <ul className="flex flex-col gap-1">
                      {rivals.beaten.slice(0, 5).map((p) => (
                        <li key={p.promptId} className="flex justify-between gap-4">
                          <span>{p.text}</span>
                          <span className="tabular shrink-0 text-fg-subtle">
                            {p.rival} {Math.round(p.theirs)}% · you {Math.round(p.you)}%
                          </span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </Section>
            )}

            {missing.length > 0 && (
              <Section
                title="Where you're missing"
                note="Prompts whose answers name you less than half the time, worst first"
              >
                <ul className="flex flex-col gap-1">
                  {missing.map((p) => (
                    <li key={p.id} className="flex justify-between gap-4">
                      <span>{p.text}</span>
                      <span className="tabular shrink-0 text-fg-subtle">{Math.round(p.rate)}%</span>
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            {sources.answers > 0 && (
              <Section title="Sources the engines cite">
                <p>
                  {share(sources.citingOwned, sources.answers)} of answers cite your site,{" "}
                  {share(sources.citingCompetitor, sources.answers)} a competitor&rsquo;s.{" "}
                  {owned.filter((p) => p.inPeriod > 0).length} of your pages were cited in this
                  period.
                </p>
                {sources.domains.length > 0 && (
                  <table className="w-full text-left">
                    <thead className="border-b border-line">
                      <tr>
                        <th className={th}>Site</th>
                        <th className={th}>Whose</th>
                        <th className={cn(th, "text-right")}>Answers citing it</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {sources.domains.map((d) => (
                        <tr key={d.domain}>
                          <td className={td}>{d.domain}</td>
                          <td className={cn(td, "text-fg-subtle")}>
                            {d.kind === "owned"
                              ? "Yours"
                              : d.kind === "competitor"
                                ? d.competitor
                                : "Third party"}
                          </td>
                          <td className={cn(td, "tabular text-right")}>
                            {d.answers.toLocaleString("en-US")} ({share(d.answers, sources.answers)}
                            )
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </Section>
            )}
          </>
        )}

        <footer className="border-t border-line pt-3 text-xs text-fg-subtle">
          Answers were collected by asking each engine your prompts as a logged-out visitor.
          Signed-in or paying users may see different answers, and answers vary from one asking to
          the next, so treat single-point moves with care. Made with OpenVisibility.
        </footer>
      </div>
    </>
  );
}
