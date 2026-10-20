import type { Metadata } from "next";
import { ExternalLink, Link2 } from "lucide-react";
import { requireWorkspace } from "@/core/auth/session";
import { citationSummary, citationsByEngine, ownedPages, pageTrends } from "@/core/citation-stats";
import { describeFilter, filterOptions, filterWindow, parseFilter } from "@/core/filters";
import { RANGES } from "@/core/overview";
import { ENGINES } from "@/core/providers/registry";
import { getDb } from "@/db/client";
import { EmptyState, Page } from "../../_components/page-frame";
import { PageFilters } from "../../_components/page-filters";
import { SourcesTable } from "../../_components/sources-table";
import { cn } from "../../_lib/cn";

export const metadata: Metadata = { title: "Citations" };

const pct = (n: number, of: number) => (of ? Math.round((n / of) * 100) : 0);
const pathOf = (url: string) => url.replace(/^https?:\/\//, "");

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-xl border border-line bg-panel px-4 py-3">
      <p className="text-xs text-fg-subtle">{label}</p>
      <p className="tabular mt-1 text-lg font-semibold">{value}</p>
      <p className="mt-0.5 text-xs text-fg-subtle">{sub}</p>
    </div>
  );
}

/** A page's place in the sources list per day; up is better (cited earlier). */
function PositionSpark({ points }: { points: (number | null)[] }) {
  const w = 88;
  const h = 24;
  const known = points.filter((p): p is number => p !== null);
  if (!known.length) return <span className="text-xs text-fg-muted">–</span>;
  const worst = Math.max(3, ...known);
  const xy = points
    .map((p, i) =>
      p === null
        ? null
        : [
            points.length > 1 ? (i / (points.length - 1)) * w : w / 2,
            2 + ((p - 1) / (worst - 1)) * (h - 4),
          ],
    )
    .filter((p): p is number[] => p !== null);
  const last = xy[xy.length - 1];
  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      aria-hidden="true"
      className="overflow-visible"
    >
      <line x1={0} x2={w} y1={2} y2={2} stroke="var(--chart-grid)" strokeDasharray="2 3" />
      {xy.length > 1 && (
        <polyline
          points={xy.map((p) => p.join(",")).join(" ")}
          fill="none"
          stroke="var(--series-2)"
          strokeWidth={1.5}
          strokeLinejoin="round"
        />
      )}
      <circle cx={last[0]} cy={last[1]} r={2.5} fill="var(--series-2)" />
    </svg>
  );
}

const SPLIT = [
  { key: "owned", label: "Yours", color: "var(--good)" },
  { key: "competitor", label: "Competitors'", color: "var(--series-4)" },
  { key: "thirdParty", label: "Third party", color: "var(--fg-subtle)" },
] as const;

export default async function CitationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { workspace } = await requireWorkspace();
  const db = getDb();
  const filter = parseFilter(await searchParams);
  const { range, engine, country } = filter;
  const p = filterWindow(filter);
  const scope = { since: p.since, engine, country };

  const [s, perEngine, pages, owned, options] = await Promise.all([
    citationSummary(db, workspace.id, scope),
    citationsByEngine(db, workspace.id, scope),
    pageTrends(db, workspace.id, scope),
    ownedPages(db, workspace.id, scope),
    filterOptions(db, workspace.id),
  ]);

  // sparklines start at the first day any of these pages was cited
  const cited = new Set(pages.flatMap((pg) => pg.byDay.map((d) => d.day)));
  const first = p.days.findIndex((d) => cited.has(d));
  const days = p.days.slice(first < 0 ? 0 : Math.max(0, Math.min(first, p.days.length - 7)));

  return (
    <Page
      title="Citations"
      description={`The sources AI engines cite when they answer your prompts · ${describeFilter(filter)}`}
      actions={<PageFilters filter={filter} options={options} exports={["citations", "answers"]} />}
    >
      {(s.answers === 0 || s.domains.length === 0) && options.engines.length > 0 ? (
        <p className="rounded-xl border border-line bg-panel px-4 py-8 text-center text-[13px] text-fg-subtle">
          No citations for {describeFilter(filter)}. Try a longer range or another engine.
        </p>
      ) : s.answers === 0 || s.domains.length === 0 ? (
        <EmptyState
          icon={<Link2 />}
          title="No citations yet"
          description="After a run, this shows which sites and pages the engines cite: yours, your competitors', and the review sites in between. Those are the pages worth getting onto."
          action={{ href: "/runs", label: "See runs" }}
        />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Stat
              label="Cite your site"
              value={`${pct(s.citingOwned, s.answers)}%`}
              sub={`of ${s.answers.toLocaleString("en-US")} answers`}
            />
            <Stat
              label="Cite a competitor's site"
              value={`${pct(s.citingCompetitor, s.answers)}%`}
              sub="of the same answers"
            />
            <Stat
              label="Cite any source"
              value={`${pct(s.withSources, s.answers)}%`}
              sub="of the same answers"
            />
          </div>

          {perEngine.length > 1 && (
            <section className="flex flex-col gap-2">
              <h2 className="text-sm font-semibold">Whose sites each engine cites</h2>
              <div className="overflow-x-auto rounded-xl border border-line bg-panel">
                <table className="w-full min-w-[480px] text-left text-[13px]">
                  <thead className="border-b border-line bg-hover text-xs text-fg-subtle">
                    <tr>
                      <th className="px-4 py-2 font-medium">Engine</th>
                      {SPLIT.map((x) => (
                        <th key={x.key} className="px-4 py-2 text-right font-medium">
                          <span className="inline-flex items-center gap-1.5">
                            <span className="size-2 rounded-sm" style={{ background: x.color }} />
                            {x.label}
                          </span>
                        </th>
                      ))}
                      <th className="px-4 py-2 text-right font-medium">Answers</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {perEngine.map((e) => (
                      <tr key={e.engine}>
                        <td className="px-4 py-2.5 font-medium">{ENGINES[e.engine].name}</td>
                        {SPLIT.map((x) => (
                          <td key={x.key} className="tabular px-4 py-2.5 text-right">
                            {pct(e[x.key], e.answers)}%
                          </td>
                        ))}
                        <td className="tabular px-4 py-2.5 text-right text-fg-subtle">
                          {e.answers}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-fg-subtle">
                Share of each engine&rsquo;s answers citing at least one site of that kind. An
                answer can cite several kinds, so rows don&rsquo;t add up to 100%.
              </p>
            </section>
          )}

          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold">Most-cited sites</h2>
            <SourcesTable domains={s.domains} answers={s.answers} showEngines />
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold">Most-cited pages</h2>
            <div className="overflow-x-auto rounded-xl border border-line bg-panel">
              <table className="w-full min-w-[640px] text-left text-[13px]">
                <thead className="border-b border-line bg-hover text-xs text-fg-subtle">
                  <tr>
                    <th className="px-4 py-2 font-medium">Page</th>
                    <th className="px-3 py-2 text-right font-medium">Cited in</th>
                    <th
                      className="px-3 py-2 text-right font-medium"
                      title="Its place in the answer's list of sources; 1 is first"
                    >
                      Avg. place
                    </th>
                    <th className="px-4 py-2 font-medium">Place over time</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {pages.map((pg) => (
                    <tr key={pg.url}>
                      <td className="max-w-md px-4 py-2.5">
                        <a
                          href={pg.url}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center gap-1 hover:underline"
                        >
                          <span className="truncate">{pg.title || pathOf(pg.url)}</span>
                          <ExternalLink className="size-3 shrink-0 text-fg-muted" />
                        </a>
                        <span className="flex items-center gap-2 text-xs text-fg-subtle">
                          <span className="truncate">{pg.domain}</span>
                          {pg.kind !== "third_party" && (
                            <span
                              className={cn(
                                "rounded px-1.5 py-px text-[11px]",
                                pg.kind === "owned"
                                  ? "bg-[color-mix(in_srgb,var(--good)_14%,transparent)] text-good"
                                  : "bg-[color-mix(in_srgb,var(--series-4)_16%,transparent)] text-[var(--series-4)]",
                              )}
                            >
                              {pg.kind === "owned" ? "Yours" : pg.competitor}
                            </span>
                          )}
                        </span>
                      </td>
                      <td className="tabular px-3 py-2.5 text-right">
                        {pg.answers} {pg.answers === 1 ? "answer" : "answers"}
                      </td>
                      <td className="tabular px-3 py-2.5 text-right text-fg-subtle">
                        {pg.position === null ? "–" : `#${pg.position.toFixed(1)}`}
                      </td>
                      <td className="px-4 py-2.5">
                        <PositionSpark
                          points={days.map(
                            (d) => pg.byDay.find((x) => x.day === d)?.position ?? null,
                          )}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold">Your pages</h2>
            {owned.length === 0 ? (
              <p className="rounded-xl border border-line bg-panel px-4 py-4 text-[13px] text-fg-subtle">
                No engine has cited a page on your site yet. Pages that review sites and comparison
                articles link to are the usual way in; the GEO audit (coming) will check which of
                your pages engines can read.
              </p>
            ) : (
              <ul className="divide-y divide-line rounded-xl border border-line bg-panel">
                {owned.map((o) => (
                  <li key={o.url} className="flex items-center gap-3 px-4 py-2.5 text-[13px]">
                    <a
                      href={o.url}
                      target="_blank"
                      rel="noreferrer"
                      className="flex min-w-0 flex-1 items-center gap-1 hover:underline"
                    >
                      <span className="truncate">{o.title || pathOf(o.url)}</span>
                      <ExternalLink className="size-3 shrink-0 text-fg-muted" />
                    </a>
                    {o.inPeriod === 0 ? (
                      <span className="rounded bg-[color-mix(in_srgb,var(--bad)_12%,transparent)] px-1.5 py-px text-[11px] text-bad">
                        Not cited {RANGES[range].label.toLowerCase()}
                      </span>
                    ) : (
                      <span className="tabular text-fg-subtle">
                        {o.inPeriod} {o.inPeriod === 1 ? "answer" : "answers"}
                      </span>
                    )}
                    <span className="tabular w-28 text-right text-xs text-fg-muted">
                      {o.allTime} all time
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </Page>
  );
}
