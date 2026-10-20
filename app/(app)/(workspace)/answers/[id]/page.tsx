import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink, Search } from "lucide-react";
import type { ReactNode } from "react";
import { getAnswer } from "@/core/answer-archive";
import { requireWorkspace } from "@/core/auth/session";
import { countryName } from "@/core/countries";
import { ENGINES } from "@/core/providers/registry";
import { getDb } from "@/db/client";
import { Page, buttonSecondary } from "../../../_components/page-frame";
import { cn } from "../../../_lib/cn";

export const metadata: Metadata = { title: "Answer" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const OWN = "bg-[color-mix(in_srgb,var(--good)_22%,transparent)] text-fg rounded-sm px-0.5";
const RIVAL = "bg-[color-mix(in_srgb,var(--series-4)_24%,transparent)] text-fg rounded-sm px-0.5";

const KIND = {
  owned: { text: "Yours", style: "bg-[color-mix(in_srgb,var(--good)_14%,transparent)] text-good" },
  competitor: {
    text: "Competitor",
    style: "bg-[color-mix(in_srgb,var(--series-4)_16%,transparent)] text-[var(--series-4)]",
  },
  third_party: { text: "Third party", style: "bg-pressed text-fg-subtle" },
} as const;

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-panel">
      <h2 className="border-b border-line px-4 py-2.5 text-[13px] font-semibold">{title}</h2>
      <div className="px-4 py-3">{children}</div>
    </section>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-1 text-[13px]">
      <dt className="text-fg-subtle">{label}</dt>
      <dd className="text-right">{value}</dd>
    </div>
  );
}

export default async function AnswerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const { workspace } = await requireWorkspace();
  const a = await getAnswer(getDb(), workspace.id, id);
  if (!a) notFound();

  // the text in pieces: plain, and each place a tracked brand is named
  const parts: ReactNode[] = [];
  let at = 0;
  for (const [i, m] of a.matches.entries()) {
    parts.push(a.text.slice(at, m.start));
    parts.push(
      <mark key={i} className={m.competitorId === null ? OWN : RIVAL}>
        {a.text.slice(m.start, m.end)}
      </mark>,
    );
    at = m.end;
  }
  parts.push(a.text.slice(at));

  const engine = ENGINES[a.engine];
  const at_ = a.at.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  });

  return (
    <Page
      title={a.prompt}
      description={`${engine.name}${a.country ? ` · ${countryName(a.country)}` : ""} · ${at_} UTC`}
      actions={
        <>
          <Link href={`/runs/${a.runId}`} className={buttonSecondary}>
            Its run
          </Link>
          <Link href="/answers" className={buttonSecondary}>
            <ArrowLeft className="size-3.5" />
            All answers
          </Link>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <article className="rounded-xl border border-line bg-panel px-5 py-4">
          <p className="mb-3 flex flex-wrap items-center gap-3 text-xs text-fg-subtle">
            <span className="flex items-center gap-1.5">
              <mark className={OWN}>Your brand</mark>
            </span>
            <span className="flex items-center gap-1.5">
              <mark className={RIVAL}>Competitors</mark>
            </span>
          </p>
          <div className="whitespace-pre-wrap text-[14px] leading-relaxed">
            {a.text ? parts : <span className="text-fg-subtle">(empty answer)</span>}
          </div>
        </article>

        <div className="flex flex-col gap-4">
          <Card title="Brands named">
            {a.named.length === 0 ? (
              <p className="text-[13px] text-fg-subtle">No tracked brand is named.</p>
            ) : (
              <ol className="flex flex-col gap-2.5">
                {a.named.map((m) => (
                  <li key={m.competitorId ?? "you"} className="text-[13px]">
                    <span className="flex items-center gap-2">
                      <span className="tabular w-6 text-fg-subtle">#{m.position ?? "–"}</span>
                      <span className={cn("font-medium", m.competitorId === null && "text-good")}>
                        {m.name}
                      </span>
                      {m.recommended && (
                        <span className="rounded bg-pressed px-1.5 py-px text-[11px]">
                          Recommended
                        </span>
                      )}
                      {m.sentiment !== null && (
                        <span
                          className="tabular ml-auto text-xs text-fg-subtle"
                          title="Sentiment, -1 to 1"
                        >
                          {m.sentiment > 0 ? "+" : ""}
                          {m.sentiment.toFixed(2)}
                        </span>
                      )}
                    </span>
                    {m.snippet && (
                      <span className="ml-8 mt-0.5 line-clamp-2 block text-xs text-fg-subtle">
                        {m.snippet}
                      </span>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </Card>

          <Card title={`Sources (${a.cited.length})`}>
            {a.cited.length === 0 ? (
              <p className="text-[13px] text-fg-subtle">This answer cites no sources.</p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {a.cited.map((c) => (
                  <li key={c.url} className="flex items-center gap-2 text-[13px]">
                    <a
                      href={c.url}
                      target="_blank"
                      rel="noreferrer"
                      title={c.title ?? c.url}
                      className="flex min-w-0 flex-1 items-center gap-1 hover:underline"
                    >
                      <span className="truncate">{c.domain}</span>
                      <ExternalLink className="size-3 shrink-0 text-fg-muted" />
                    </a>
                    <span
                      className={cn(
                        "shrink-0 rounded px-1.5 py-px text-[11px]",
                        KIND[c.kind].style,
                      )}
                    >
                      {c.competitor ?? KIND[c.kind].text}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {a.engine === "chatgpt" && (
            <Card title="Searches it ran">
              {a.searches.length === 0 ? (
                <p className="text-[13px] text-fg-subtle">
                  {/* Bright Data sometimes says "no search" for answers that cite sources */}
                  {a.webSearchTriggered === false && a.cited.length === 0
                    ? "ChatGPT answered without searching the web."
                    : "ChatGPT didn't report its searches for this answer."}
                </p>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {a.searches.map((s) => (
                    <li key={s} className="flex items-start gap-2 text-[13px]">
                      <Search className="mt-0.5 size-3.5 shrink-0 text-fg-muted" />
                      {s}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}

          <Card title="Details">
            <dl>
              <Row label="Engine" value={engine.name} />
              <Row
                label="Source"
                value={
                  a.source === "consumer_app" ? "The real app, via Bright Data" : "Official API"
                }
              />
              {a.model && <Row label="Model" value={a.model} />}
              {a.country && <Row label="Country" value={countryName(a.country)} />}
              <Row label="Sample" value={`#${a.sampleIndex + 1}`} />
              {a.webSearchTriggered !== null && (
                <Row
                  label="Searched the web"
                  value={a.webSearchTriggered ? "Yes" : a.cited.length ? "Not reported" : "No"}
                />
              )}
              {a.shown !== null && <Row label="AI Overview shown" value={a.shown ? "Yes" : "No"} />}
              <Row
                label="Cost"
                value={
                  a.reusedFromId
                    ? "Free (reused an earlier answer)"
                    : `$${(Number(a.costUsd) + Number(a.analysisCostUsd)).toFixed(4)}`
                }
              />
              {a.latencyMs !== null && (
                <Row label="Took" value={`${Math.round(a.latencyMs / 1000)}s`} />
              )}
            </dl>
          </Card>
        </div>
      </div>
    </Page>
  );
}
