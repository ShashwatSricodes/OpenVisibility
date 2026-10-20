import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowUpRight, ExternalLink } from "lucide-react";
import { requireWorkspace } from "@/core/auth/session";
import { countryName } from "@/core/countries";
import { BRIGHT_DATA_PRICING, ENGINES } from "@/core/providers/registry";
import { citationSummary } from "@/core/citation-stats";
import { getRunDetail, MAX_ANSWERS_SHOWN } from "@/core/run-detail";
import { getDb } from "@/db/client";
import { Page, buttonSecondary } from "../../../_components/page-frame";
import { SourcesTable } from "../../../_components/sources-table";
import { cn } from "../../../_lib/cn";
import { AutoRefresh } from "../auto-refresh";
import { STATUS, duration, isActive, usd, visibleNote, when } from "../run-format";

export const metadata: Metadata = { title: "Run" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const n = (v: number) => v.toLocaleString("en-US");

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-line bg-panel px-4 py-3">
      <p className="text-xs text-fg-subtle">{label}</p>
      <p className="tabular mt-1 text-lg font-semibold">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-fg-subtle">{sub}</p>}
    </div>
  );
}

export default async function RunPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  // linked from a prompt's page: open that answer's prompt and point at it
  const focus = (await searchParams).answer;
  if (!UUID.test(id)) notFound();
  const { workspace } = await requireWorkspace();
  const db = getDb();
  const [detail, sources] = await Promise.all([
    getRunDetail(db, workspace.id, id),
    citationSummary(db, workspace.id, { runId: id }, { limit: 10, pagesPerDomain: 3 }),
  ]);
  if (!detail) notFound();
  const { run, engines, byPrompt, shown } = detail;

  const active = isActive(run.status);
  const status = STATUS[run.status];
  const note = visibleNote(run);
  const total = run.totalItems - run.sampledOutItems;
  const saved = run.reusedItems + run.sampledOutItems;

  return (
    <Page
      title={`Run on ${when(run.createdAt)}`}
      description={run.trigger === "manual" ? "Started with Run now" : "Started by the schedule"}
      actions={
        <Link href="/runs" className={buttonSecondary}>
          <ArrowLeft className="size-3.5" />
          All runs
        </Link>
      }
    >
      <AutoRefresh active={active} />

      <div className="flex flex-wrap items-center gap-2 text-[13px]">
        <span className={cn("rounded px-1.5 py-px text-[11px] font-medium", status.style)}>
          {status.label}
        </span>
        {active && (
          <span className="text-fg-subtle">
            Answers take a few minutes per engine; this page updates as they come in.
          </span>
        )}
        {note && <span className="text-fg-subtle">{note}</span>}
      </div>

      <div
        className={cn("grid grid-cols-2 gap-3", saved > 0 ? "lg:grid-cols-4" : "lg:grid-cols-3")}
      >
        <Stat label="Answers" value={`${n(run.doneItems)} / ${n(total)}`} />
        <Stat label="Took" value={duration(run.startedAt, run.finishedAt)} />
        <Stat
          label="Cost"
          value={usd(run.actualCost)}
          sub={active ? `of about ${usd(run.estimatedCost)}` : "at Bright Data's list price"}
        />
        {saved > 0 && (
          <Stat
            label="Saved"
            value={usd(saved * BRIGHT_DATA_PRICING.perAnswerUsd)}
            sub={[
              run.reusedItems && `${n(run.reusedItems)} answers reused`,
              run.sampledOutItems && `${n(run.sampledOutItems)} not needed`,
            ]
              .filter(Boolean)
              .join(" · ")}
          />
        )}
      </div>

      <section className="overflow-x-auto rounded-xl border border-line bg-panel">
        <table className="w-full min-w-[480px] text-left text-[13px]">
          <thead className="border-b border-line bg-hover text-xs text-fg-subtle">
            <tr>
              <th className="px-4 py-2 font-medium">Engine</th>
              <th className="px-4 py-2 font-medium">Answers</th>
              <th className="px-4 py-2 font-medium">Cost</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {engines.map((e) => {
              const pct = e.planned ? Math.round((e.done / e.planned) * 100) : 0;
              return (
                <tr key={e.engine}>
                  <td className="px-4 py-3 font-medium">{ENGINES[e.engine].name}</td>
                  <td className="px-4 py-3">
                    <span className="tabular">
                      {n(e.done)} / {n(e.planned)}
                    </span>
                    {active && (
                      <span className="mt-1.5 block h-1 w-28 overflow-hidden rounded-full bg-pressed">
                        <span
                          className="block h-full rounded-full bg-fg"
                          style={{ width: `${pct}%` }}
                        />
                      </span>
                    )}
                  </td>
                  <td className="tabular px-4 py-3 text-fg-subtle">{usd(e.cost)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      {sources.domains.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold">Most-cited sources</h2>
          <SourcesTable domains={sources.domains} answers={sources.answers} />
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">Answers</h2>
        {byPrompt.length === 0 ? (
          <p className="rounded-xl border border-line bg-panel px-4 py-6 text-center text-[13px] text-fg-subtle">
            {active ? "No answers yet. They appear here as each engine finishes." : "No answers."}
          </p>
        ) : (
          <div className="divide-y divide-line rounded-xl border border-line bg-panel">
            {byPrompt.map((p) => (
              <details
                key={p.prompt}
                className="group"
                open={p.answers.some((a) => a.id === focus) || undefined}
              >
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-[13px] hover:bg-hover">
                  <span className="font-medium">{p.prompt}</span>
                  <span className="shrink-0 text-xs text-fg-subtle">
                    {p.answers.length} {p.answers.length === 1 ? "answer" : "answers"}
                  </span>
                </summary>
                <div className="flex flex-col gap-3 px-4 pb-4">
                  {p.answers.map((a) => (
                    <article
                      key={a.id}
                      id={`answer-${a.id}`}
                      className={cn(
                        "scroll-mt-4 rounded-lg border border-line px-3.5 py-3",
                        a.id === focus && "border-line-strong ring-2 ring-line",
                      )}
                    >
                      <p className="flex flex-wrap items-center gap-x-2 text-xs text-fg-subtle">
                        <span className="font-medium text-fg">{ENGINES[a.engine].name}</span>
                        {a.country && <span>{countryName(a.country)}</span>}
                        <span>Sample {a.sampleIndex + 1}</span>
                        {a.reused && (
                          <span className="rounded bg-pressed px-1.5 py-px text-[11px]">
                            Reused
                          </span>
                        )}
                        <Link
                          href={`/answers/${a.id}`}
                          className="ml-auto inline-flex items-center gap-0.5 hover:text-fg"
                        >
                          Open
                          <ArrowUpRight className="size-3" />
                        </Link>
                      </p>
                      <p className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
                        {a.named.some((m) => m.own) ? null : (
                          <span className="rounded bg-pressed px-1.5 py-px text-fg-subtle">
                            Doesn&rsquo;t name you
                          </span>
                        )}
                        {a.named.map((m, i) => (
                          <span
                            key={i}
                            className={cn(
                              "rounded px-1.5 py-px",
                              m.own
                                ? "bg-[color-mix(in_srgb,var(--good)_14%,transparent)] font-medium text-good"
                                : "bg-pressed text-fg-default",
                            )}
                          >
                            #{i + 1} {m.name}
                            {m.recommended && " · recommended"}
                          </span>
                        ))}
                      </p>
                      <p className="mt-2 max-h-64 overflow-y-auto whitespace-pre-wrap text-[13px] leading-relaxed">
                        {a.text || <span className="text-fg-subtle">(empty answer)</span>}
                      </p>
                      {a.sources.length > 0 && (
                        <ul className="mt-2 flex flex-wrap gap-1.5">
                          {a.sources.map((s, i) => (
                            <li key={i}>
                              <a
                                href={s.url}
                                target="_blank"
                                rel="noreferrer"
                                title={s.title ?? s.url}
                                className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-0.5 text-xs text-fg-subtle hover:text-fg"
                              >
                                {s.domain}
                                <ExternalLink className="size-3" />
                              </a>
                            </li>
                          ))}
                        </ul>
                      )}
                    </article>
                  ))}
                </div>
              </details>
            ))}
          </div>
        )}
        {shown >= MAX_ANSWERS_SHOWN && (
          <p className="text-xs text-fg-subtle">
            Showing the first {n(MAX_ANSWERS_SHOWN)} answers. The full archive is coming to the
            Answers page.
          </p>
        )}
      </section>
    </Page>
  );
}
