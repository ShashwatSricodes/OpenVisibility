import type { Metadata } from "next";
import Link from "next/link";
import { Swords } from "lucide-react";
import type { ReactNode } from "react";
import { requireWorkspace } from "@/core/auth/session";
import { competitorView } from "@/core/competitor-results";
import { RANGES, isRange, type RangeId } from "@/core/overview";
import { ENGINES, isEngineId } from "@/core/providers/registry";
import { listCompetitors } from "@/core/workspace-data";
import { getDb } from "@/db/client";
import { EmptyState, Page, buttonSecondary } from "../../_components/page-frame";
import { Segments } from "../../_components/segments";
import { cn } from "../../_lib/cn";
import { SovChart } from "./sov-chart";

export const metadata: Metadata = { title: "Competitors" };

/* your brand keeps the first series colour; competitors take the rest in order */
const COLORS = [
  "var(--series-1)",
  "var(--series-2)",
  "var(--series-3)",
  "var(--series-4)",
  "var(--series-5)",
  "var(--series-6)",
];

const rate = (v: number | null) => (v === null ? "–" : `${Math.round(v * 100)}%`);
const rank = (v: number | null) => (v === null ? "–" : `#${v.toFixed(1)}`);

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <div>
        <h2 className="text-sm font-semibold">{title}</h2>
        {note && <p className="text-xs text-fg-subtle">{note}</p>}
      </div>
      {children}
    </section>
  );
}

function Change({ now, before }: { now: number | null; before: number | null }) {
  if (now === null || before === null) return null;
  const d = Math.round((now - before) * 100);
  if (d === 0) return <span className="text-xs text-fg-subtle">no change</span>;
  return (
    <span className={cn("tabular text-xs font-medium", d > 0 ? "text-good" : "text-bad")}>
      {d > 0 ? "▲ +" : "▼ −"}
      {Math.abs(d)} pts
    </span>
  );
}

export default async function CompetitorsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { workspace } = await requireWorkspace();
  const db = getDb();
  const q = await searchParams;
  const range: RangeId = isRange(q.range) ? q.range : "30d";
  const engine = typeof q.engine === "string" && isEngineId(q.engine) ? q.engine : undefined;
  const tracked = await listCompetitors(db, workspace.id);

  const editLink = (
    <Link href="/onboarding" className={buttonSecondary}>
      Edit competitors
    </Link>
  );
  if (tracked.length === 0)
    return (
      <Page title="Competitors" description="The brands you're compared with in AI answers">
        <EmptyState
          icon={<Swords />}
          title="No competitors yet"
          description="Add the brands customers compare you with. Each run counts how often AI answers name them, where they rank, and which sources they're cited from."
          action={{ href: "/onboarding", label: "Add competitors" }}
        />
      </Page>
    );

  const v = await competitorView(db, workspace.id, { range, engine });
  const brands = v.leaderboard.map((b, i) => ({
    key: b.key,
    name: b.name,
    you: b.competitorId === null,
    color: COLORS[i % COLORS.length],
  }));
  const href = (r: RangeId, e?: string) => {
    const p = new URLSearchParams();
    if (r !== "30d") p.set("range", r);
    if (e) p.set("engine", e);
    return `/competitors${p.size ? `?${p}` : ""}`;
  };

  return (
    <Page
      title="Competitors"
      description={`${tracked.length} tracked · how AI answers compare them with you · ${RANGES[range].label.toLowerCase()}`}
      actions={
        <>
          <Segments
            items={(Object.keys(RANGES) as RangeId[]).map((r) => ({
              href: href(r, engine),
              label: RANGES[r].label.replace("Last ", ""),
              active: r === range,
            }))}
          />
          {editLink}
        </>
      }
    >
      {v.leaderboard.length === 0 ? (
        <EmptyState
          icon={<Swords />}
          title="No results in this period"
          description="Run your prompts to see how often AI answers name each competitor next to you."
          action={{ href: "/runs", label: "Go to runs" }}
        />
      ) : (
        <>
          {v.engines.length > 1 || engine ? (
            <Segments
              items={[
                { href: href(range), label: "All engines", active: !engine },
                ...(engine && !v.engines.includes(engine) ? [engine] : v.engines).map((e) => ({
                  href: href(range, e),
                  label: ENGINES[e].name,
                  active: engine === e,
                })),
              ]}
            />
          ) : null}

          <div className="overflow-x-auto rounded-xl border border-line bg-panel">
            <table className="w-full min-w-[720px] text-left text-[13px]">
              <thead className="border-b border-line bg-hover text-xs text-fg-subtle">
                <tr>
                  <th className="px-4 py-2 font-medium">Brand</th>
                  <th
                    className="px-3 py-2 text-right font-medium"
                    title="0–100: mention rate, position and share of voice combined"
                  >
                    Visibility
                  </th>
                  <th className="px-3 py-2 text-right font-medium">Named in</th>
                  <th className="px-3 py-2 text-right font-medium">Position</th>
                  <th className="px-3 py-2 text-right font-medium">Share of voice</th>
                  <th
                    className="px-3 py-2 text-right font-medium"
                    title="Citations pointing to their own site"
                  >
                    Own-site citations
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {[...v.leaderboard]
                  .sort((a, b) => (b.visibilityIndex ?? -1) - (a.visibilityIndex ?? -1))
                  .map((b) => (
                    <tr key={b.key} className={cn(b.competitorId === null && "bg-hover")}>
                      <td className="px-4 py-2.5">
                        <span className="flex items-center gap-2 font-medium">
                          <span
                            className="size-2 rounded-sm"
                            style={{ background: brands.find((x) => x.key === b.key)?.color }}
                          />
                          {b.name}
                          {b.competitorId === null && (
                            <span className="rounded bg-pressed px-1.5 py-px text-[11px] font-normal text-fg-subtle">
                              You
                            </span>
                          )}
                        </span>
                      </td>
                      <td className="tabular px-3 py-2.5 text-right font-medium">
                        {b.visibilityIndex === null ? "–" : Math.round(b.visibilityIndex)}
                      </td>
                      <td className="tabular px-3 py-2.5 text-right">{rate(b.mentionRate)}</td>
                      <td className="tabular px-3 py-2.5 text-right text-fg-subtle">
                        {rank(b.averagePosition)}
                      </td>
                      <td className="tabular px-3 py-2.5 text-right">
                        <span className="flex items-center justify-end gap-2">
                          <Change now={b.shareOfVoice} before={b.shareOfVoiceBefore} />
                          {rate(b.shareOfVoice)}
                        </span>
                      </td>
                      <td className="tabular px-3 py-2.5 text-right text-fg-subtle">
                        {rate(b.citationShare)}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>

          <Section
            title="Share of voice over time"
            note="Each brand's share of all tracked-brand mentions, per day."
          >
            <div className="rounded-xl border border-line bg-panel px-3 pb-2 pt-4 sm:px-5">
              <SovChart data={v.sovTrend} brands={brands} />
              <div className="flex flex-wrap gap-x-4 gap-y-1 px-2 pt-2 text-xs text-fg-subtle">
                {brands.map((b) => (
                  <span key={b.key} className="flex items-center gap-1.5">
                    <span className="size-2 rounded-sm" style={{ background: b.color }} />
                    {b.name}
                  </span>
                ))}
              </div>
            </div>
          </Section>

          {v.beaten.length > 0 && (
            <Section
              title="Where they beat you"
              note="Prompts where a competitor is named more often than you, biggest gap first."
            >
              <ul className="divide-y divide-line rounded-xl border border-line bg-panel">
                {v.beaten.slice(0, 10).map((p) => (
                  <li key={p.promptId}>
                    <Link
                      href={`/prompts/${p.promptId}${range === "30d" ? "" : `?range=${range}`}`}
                      className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 text-[13px] hover:bg-hover"
                    >
                      <span className="min-w-0 flex-1">{p.text}</span>
                      <span className="tabular text-xs text-fg-subtle">
                        {p.rival}{" "}
                        <span className="font-medium text-fg">{Math.round(p.theirs)}%</span>
                        {" · "}you <span className="font-medium text-fg">{Math.round(p.you)}%</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {v.headToHead.length > 0 && (
            <Section
              title="Head-to-head by engine"
              note="How often each engine names each brand, and where."
            >
              <div className="overflow-x-auto rounded-xl border border-line bg-panel">
                <table
                  className="w-full text-left text-[13px]"
                  style={{ minWidth: 160 + brands.length * 120 }}
                >
                  <thead className="border-b border-line bg-hover text-xs text-fg-subtle">
                    <tr>
                      <th className="px-4 py-2 font-medium">Engine</th>
                      {brands.map((b) => (
                        <th key={b.key} className="px-3 py-2 text-right font-medium">
                          {b.name}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {v.headToHead.map((row) => {
                      const best = Math.max(
                        ...brands.map((b) => row.brands[b.key]?.mentionRate ?? -1),
                      );
                      return (
                        <tr key={row.engine}>
                          <td className="px-4 py-2.5 font-medium">{ENGINES[row.engine].name}</td>
                          {brands.map((b) => {
                            const cell = row.brands[b.key];
                            return (
                              <td key={b.key} className="tabular px-3 py-2.5 text-right">
                                <span
                                  className={cn(
                                    cell?.mentionRate === best && best > 0 && "font-semibold",
                                  )}
                                >
                                  {rate(cell?.mentionRate ?? null)}
                                </span>
                                <span className="ml-1.5 text-xs text-fg-subtle">
                                  {rank(cell?.averagePosition ?? null)}
                                </span>
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Section>
          )}

          <Section title="Sentiment">
            {v.rated ? (
              <div className="overflow-x-auto rounded-xl border border-line bg-panel">
                <table className="w-full min-w-[420px] text-left text-[13px]">
                  <thead className="border-b border-line bg-hover text-xs text-fg-subtle">
                    <tr>
                      <th className="px-4 py-2 font-medium">Brand</th>
                      <th className="px-3 py-2 text-right font-medium">Average (−1 to 1)</th>
                      <th
                        className="px-3 py-2 text-right font-medium"
                        title="% positive minus % negative mentions"
                      >
                        Net sentiment
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {v.leaderboard.map((b) => (
                      <tr key={b.key} className={cn(b.competitorId === null && "bg-hover")}>
                        <td className="px-4 py-2.5 font-medium">{b.name}</td>
                        <td className="tabular px-3 py-2.5 text-right">
                          {b.sentiment === null
                            ? "–"
                            : `${b.sentiment > 0 ? "+" : ""}${b.sentiment.toFixed(2)}`}
                        </td>
                        <td
                          className={cn(
                            "tabular px-3 py-2.5 text-right",
                            (b.netSentiment ?? 0) > 0 && "text-good",
                            (b.netSentiment ?? 0) < 0 && "text-bad",
                          )}
                        >
                          {b.netSentiment === null
                            ? "–"
                            : `${b.netSentiment > 0 ? "+" : ""}${Math.round(b.netSentiment)}`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="rounded-xl border border-line bg-panel px-4 py-3 text-[13px] text-fg-subtle">
                Sentiment needs an analysis model to rate how answers talk about each brand. Set one
                up in your environment (see <code>ANALYSIS_*</code> in <code>.env.example</code>;
                free tiers work) and new answers get rated automatically.
              </p>
            )}
          </Section>
        </>
      )}
    </Page>
  );
}
