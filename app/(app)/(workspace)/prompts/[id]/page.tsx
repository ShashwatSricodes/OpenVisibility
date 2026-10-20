import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowUpRight } from "lucide-react";
import { requireWorkspace } from "@/core/auth/session";
import { countryName } from "@/core/countries";
import { RANGES, isRange, type RangeId } from "@/core/overview";
import { promptDetail } from "@/core/prompt-results";
import { ENGINES } from "@/core/providers/registry";
import { getDb } from "@/db/client";
import { Page, buttonSecondary } from "../../../_components/page-frame";
import { Segments } from "../../../_components/segments";
import { cn } from "../../../_lib/cn";

export const metadata: Metadata = { title: "Prompt" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const rate = (v: number | null) => (v === null ? "–" : `${Math.round(v * 100)}%`);
const rank = (v: number | null) => (v === null ? "–" : `#${v.toFixed(1)}`);
const when = (d: Date) =>
  d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-line bg-panel px-4 py-3">
      <p className="text-xs text-fg-subtle">{label}</p>
      <p className="tabular mt-1 text-lg font-semibold">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-fg-subtle">{sub}</p>}
    </div>
  );
}

export default async function PromptPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const q = await searchParams;
  const range: RangeId = isRange(q.range) ? q.range : "30d";
  const { workspace } = await requireWorkspace();
  const d = await promptDetail(getDb(), workspace.id, id, range);
  if (!d) notFound();
  const { prompt, own, ranking, cells, answers } = d;
  const max = Math.max(1, ...ranking.map((b) => b.mentionRate ?? 0));

  return (
    <Page
      title={prompt.text}
      description={
        own
          ? `${prompt.brandName} is named in ${rate(own.mentionRate)} of ${own.samples} answers · ${RANGES[range].label.toLowerCase()}`
          : `No results ${RANGES[range].label.toLowerCase()}`
      }
      actions={
        <>
          <Segments
            items={(Object.keys(RANGES) as RangeId[]).map((r) => ({
              href: `/prompts/${id}${r === "30d" ? "" : `?range=${r}`}`,
              label: RANGES[r].label.replace("Last ", ""),
              active: r === range,
            }))}
          />
          <Link
            href={range === "30d" ? "/prompts" : `/prompts?range=${range}`}
            className={buttonSecondary}
          >
            <ArrowLeft className="size-3.5" />
            All prompts
          </Link>
        </>
      }
    >
      {!prompt.active && (
        <p className="rounded-lg border border-line bg-hover px-3 py-2 text-[13px]">
          This prompt is paused: runs don&rsquo;t ask it. Resume it under Manage prompts.
        </p>
      )}

      {own && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Named in" value={rate(own.mentionRate)} sub={`of ${own.samples} answers`} />
          <Stat
            label="Avg. position"
            value={rank(own.averagePosition)}
            sub="among tracked brands"
          />
          <Stat label="Share of voice" value={rate(own.shareOfVoice)} />
          <Stat
            label="Visibility index"
            value={own.visibilityIndex === null ? "–" : `${Math.round(own.visibilityIndex)}`}
            sub="out of 100"
          />
        </div>
      )}

      {ranking.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold">Who wins this prompt</h2>
          <div className="overflow-x-auto rounded-xl border border-line bg-panel">
            <table className="w-full min-w-[560px] text-left text-[13px]">
              <thead className="border-b border-line bg-hover text-xs text-fg-subtle">
                <tr>
                  <th className="px-4 py-2 font-medium">Brand</th>
                  <th className="px-4 py-2 font-medium">Named in</th>
                  <th className="px-4 py-2 text-right font-medium">Position</th>
                  <th className="px-4 py-2 text-right font-medium">Share of voice</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {[...ranking]
                  .sort((a, b) => (b.mentionRate ?? 0) - (a.mentionRate ?? 0))
                  .map((b) => (
                    <tr key={b.competitorId ?? "you"} className={cn(!b.competitorId && "bg-hover")}>
                      <td className="px-4 py-2.5 font-medium">
                        {b.name}
                        {!b.competitorId && (
                          <span className="ml-2 rounded bg-pressed px-1.5 py-px text-[11px] font-normal text-fg-subtle">
                            You
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="flex items-center gap-2">
                          <span className="h-1.5 w-24 overflow-hidden rounded-full bg-pressed">
                            <span
                              className={cn(
                                "block h-full rounded-full",
                                b.competitorId ? "bg-fg-subtle" : "bg-good",
                              )}
                              style={{ width: `${((b.mentionRate ?? 0) / max) * 100}%` }}
                            />
                          </span>
                          <span className="tabular">{rate(b.mentionRate)}</span>
                        </span>
                      </td>
                      <td className="tabular px-4 py-2.5 text-right text-fg-subtle">
                        {rank(b.averagePosition)}
                      </td>
                      <td className="tabular px-4 py-2.5 text-right text-fg-subtle">
                        {rate(b.shareOfVoice)}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {cells.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold">By engine and country</h2>
          <div className="overflow-x-auto rounded-xl border border-line bg-panel">
            <table className="w-full min-w-[480px] text-left text-[13px]">
              <thead className="border-b border-line bg-hover text-xs text-fg-subtle">
                <tr>
                  <th className="px-4 py-2 font-medium">Engine</th>
                  <th className="px-4 py-2 font-medium">Country</th>
                  <th className="px-4 py-2 text-right font-medium">Named in</th>
                  <th className="px-4 py-2 text-right font-medium">Position</th>
                  <th className="px-4 py-2 text-right font-medium">Answers</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {cells.map((c) => (
                  <tr key={`${c.a}-${c.b}`}>
                    <td className="px-4 py-2.5 font-medium">{ENGINES[c.a].name}</td>
                    <td className="px-4 py-2.5 text-fg-subtle">{c.b ? countryName(c.b) : "–"}</td>
                    <td className="tabular px-4 py-2.5 text-right">{rate(c.mentionRate)}</td>
                    <td className="tabular px-4 py-2.5 text-right text-fg-subtle">
                      {rank(c.averagePosition)}
                    </td>
                    <td className="tabular px-4 py-2.5 text-right text-fg-subtle">{c.samples}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">Latest answers</h2>
        {answers.length === 0 ? (
          <p className="rounded-xl border border-line bg-panel px-4 py-6 text-center text-[13px] text-fg-subtle">
            No answers yet. Run your prompts to see what each engine says.
          </p>
        ) : (
          <div className="divide-y divide-line rounded-xl border border-line bg-panel">
            {answers.map((a) => (
              <article key={a.answerId} className="flex flex-col gap-1.5 px-4 py-3">
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-fg-subtle">
                  <span className="font-medium text-fg">{ENGINES[a.engine].name}</span>
                  {a.country && <span>{countryName(a.country)}</span>}
                  <span>{when(a.at)}</span>
                  <span className="flex flex-wrap gap-1">
                    {a.named.some((n) => n.own) ? null : (
                      <span className="rounded bg-pressed px-1.5 py-px">
                        Doesn&rsquo;t name you
                      </span>
                    )}
                    {a.named.map((n, i) => (
                      <span
                        key={i}
                        className={cn(
                          "rounded px-1.5 py-px",
                          n.own
                            ? "bg-[color-mix(in_srgb,var(--good)_14%,transparent)] font-medium text-good"
                            : "bg-pressed text-fg-default",
                        )}
                      >
                        #{i + 1} {n.name}
                      </span>
                    ))}
                  </span>
                  <Link
                    href={`/answers/${a.answerId}`}
                    className="ml-auto inline-flex items-center gap-0.5 hover:text-fg"
                  >
                    Full answer
                    <ArrowUpRight className="size-3" />
                  </Link>
                </p>
                <p className="line-clamp-2 text-[13px] text-fg-default">{a.excerpt}</p>
              </article>
            ))}
          </div>
        )}
      </section>
    </Page>
  );
}
