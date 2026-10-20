import type { Metadata } from "next";
import { Check, ExternalLink, ScanSearch, X } from "lucide-react";
import { requireWorkspace } from "@/core/auth/session";
import { getAudit, MAX_PAGES, type SiteAudit } from "@/core/geo/audit";
import { matters } from "@/core/geo/crawlers";
import { ENGINES } from "@/core/providers/registry";
import { getDb } from "@/db/client";
import { EmptyState, Page } from "../../_components/page-frame";
import { cn } from "../../_lib/cn";
import { AutoRefresh } from "../runs/auto-refresh";
import { RunAuditButton } from "./run-audit-button";

export const metadata: Metadata = { title: "Site audit" };

const when = (d: Date) =>
  d.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  });
const pathOf = (url: string) => {
  try {
    const u = new URL(url);
    return u.pathname + u.search;
  } catch {
    return url;
  }
};

const TONE = {
  problem: "text-bad",
  warning: "text-[var(--series-4)]",
  note: "text-fg-subtle",
} as const;

/** One line: is anything keeping this site out of answers? */
function Summary({ site }: { site: SiteAudit }) {
  const problems = site.pages.flatMap((p) =>
    p.issues.filter((i) => i.severity === "problem"),
  ).length;
  const blocked = site.crawlers.filter((c) => matters(c) && !c.verdict.allowed).length;
  return (
    <p
      className={cn(
        "rounded-lg border px-3 py-2 text-[13px]",
        problems + blocked
          ? "border-[color-mix(in_srgb,var(--bad)_30%,transparent)] bg-[color-mix(in_srgb,var(--bad)_8%,transparent)]"
          : "border-[color-mix(in_srgb,var(--good)_30%,transparent)] bg-[color-mix(in_srgb,var(--good)_8%,transparent)]",
      )}
    >
      {problems + blocked === 0
        ? `AI crawlers can read all ${site.checked} pages checked on ${site.domain}.`
        : [
            blocked &&
              `${blocked} AI ${blocked === 1 ? "crawler is" : "crawlers are"} blocked from your site`,
            problems &&
              `${problems} ${problems === 1 ? "problem" : "problems"} on the pages checked`,
          ]
            .filter(Boolean)
            .join("; ") + "."}
    </p>
  );
}

function Crawlers({ site }: { site: SiteAudit }) {
  const forAnswers = site.crawlers.filter(matters);
  const training = site.crawlers.filter((c) => !matters(c));
  return (
    <section className="flex flex-col gap-2">
      <div>
        <h2 className="text-sm font-semibold">AI crawlers</h2>
        <p className="text-xs text-fg-subtle">
          What your robots.txt tells each crawler about your home page.
          {site.robotsState === "missing" &&
            " You have no robots.txt, so every crawler is allowed."}
          {site.robotsState === "unreachable" &&
            " Your robots.txt couldn't be fetched; crawlers treat that as “keep out” until it can."}
        </p>
      </div>
      <div className="overflow-x-auto rounded-xl border border-line bg-panel">
        <table className="w-full min-w-[560px] text-left text-[13px]">
          <thead className="border-b border-line bg-hover text-xs text-fg-subtle">
            <tr>
              <th className="px-4 py-2 font-medium">Crawler</th>
              <th className="px-3 py-2 font-medium">Answers it feeds</th>
              <th className="px-4 py-2 font-medium">Your site</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {forAnswers.map((c) => (
              <tr key={c.agent} title={c.note}>
                <td className="px-4 py-2.5">
                  <span className="font-medium">{c.agent}</span>
                  <span className="text-xs text-fg-subtle"> · {c.owner}</span>
                </td>
                <td className="px-3 py-2.5 text-fg-subtle">
                  {c.engines.map((e) => ENGINES[e].name).join(", ")}
                  {c.purpose === "user" && " (opening links)"}
                </td>
                <td className="px-4 py-2.5">
                  {c.verdict.allowed ? (
                    <span className="inline-flex items-center gap-1 text-good">
                      <Check className="size-3.5" /> Allowed
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 font-medium text-bad">
                      <X className="size-3.5" /> Blocked
                      {c.verdict.rule && (
                        <code className="ml-1 rounded bg-hover px-1 text-xs font-normal text-fg-subtle">
                          Disallow: {c.verdict.rule.path}
                        </code>
                      )}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-fg-subtle">
        Training crawlers ({training.map((c) => c.agent).join(", ")}) don&rsquo;t decide whether
        you&rsquo;re in answers today; blocking them is a business choice.{" "}
        {training.some((c) => !c.verdict.allowed)
          ? `You block ${training
              .filter((c) => !c.verdict.allowed)
              .map((c) => c.agent)
              .join(", ")}.`
          : "You allow all of them."}
      </p>
    </section>
  );
}

function Score({ value }: { value: number | null }) {
  if (value === null) return null;
  return (
    <span
      title="Content score: how ready the page is to be quoted, out of 100"
      className={cn(
        "tabular rounded px-1.5 py-px text-[11px] font-medium",
        value >= 70
          ? "bg-[color-mix(in_srgb,var(--good)_14%,transparent)] text-good"
          : value >= 40
            ? "bg-[color-mix(in_srgb,var(--series-4)_16%,transparent)] text-[var(--series-4)]"
            : "bg-[color-mix(in_srgb,var(--bad)_12%,transparent)] text-bad",
      )}
    >
      {value}/100
    </span>
  );
}

function Pages({ site }: { site: SiteAudit }) {
  return (
    <section className="flex flex-col gap-2">
      <div>
        <h2 className="text-sm font-semibold">Pages</h2>
        <p className="text-xs text-fg-subtle">
          Your home page, the pages AI answers already cite, then pages from your sitemap
          {site.sitemapUrl ? "" : " (none found)"}, up to {MAX_PAGES}, fetched the way an AI crawler
          fetches them: without running JavaScript. Each gets a content score out of 100: a
          checklist of what makes a page easy to quote, not a prediction.
        </p>
      </div>
      <ul className="divide-y divide-line rounded-xl border border-line bg-panel">
        {site.pages.map((p) => (
          <li key={p.id} className="flex flex-col gap-1 px-4 py-3 text-[13px]">
            <span className="flex flex-wrap items-center gap-2">
              <a
                href={p.url}
                target="_blank"
                rel="noreferrer"
                className="flex min-w-0 items-center gap-1 font-medium hover:underline"
              >
                <span className="truncate">{pathOf(p.url)}</span>
                <ExternalLink className="size-3 shrink-0 text-fg-muted" />
              </a>
              <Score value={p.score} />
              {p.source === "cited" && (
                <span className="rounded bg-pressed px-1.5 py-px text-[11px]">
                  Cited in answers
                </span>
              )}
            </span>
            {p.issues.map((i) => (
              <span key={i.code} className={cn("text-xs", TONE[i.severity])}>
                {i.text}
              </span>
            ))}
            {p.check && !p.check.content && !p.issues.length && (
              <span className="text-xs text-fg-subtle">
                Run the audit again to score this page.
              </span>
            )}
            {p.fixes.length > 0 && (
              <ul className="ml-4 list-disc text-xs text-fg-default marker:text-fg-muted">
                {p.fixes.slice(0, 3).map((f) => (
                  <li key={f.id}>{f.fix}</li>
                ))}
              </ul>
            )}
            {p.fixes.length > 3 && (
              <details className="text-xs">
                <summary className="cursor-pointer text-fg-subtle">
                  {p.fixes.length - 3} more {p.fixes.length - 3 === 1 ? "fix" : "fixes"}
                </summary>
                <ul className="ml-4 mt-1 list-disc text-fg-default marker:text-fg-muted">
                  {p.fixes.slice(3).map((f) => (
                    <li key={f.id}>{f.fix}</li>
                  ))}
                </ul>
              </details>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

/** Your pages next to the pages AI cites for your prompts, on the same checks. */
function Comparison({ c }: { c: NonNullable<SiteAudit["comparison"]> }) {
  const rows: [string, string, string][] = [
    [
      "Words (median)",
      c.yours.medianWords.toLocaleString("en-US"),
      c.cited.medianWords.toLocaleString("en-US"),
    ],
    ["Question headings", pct(c.yours.questionHeadings), pct(c.cited.questionHeadings)],
    ["Lists or tables", pct(c.yours.listsOrTables), pct(c.cited.listsOrTables)],
    ["Structured data", pct(c.yours.schema), pct(c.cited.schema)],
    ["FAQ, how-to or review markup", pct(c.yours.answerSchema), pct(c.cited.answerSchema)],
    ["A date", pct(c.yours.dated), pct(c.cited.dated)],
    ["An author", pct(c.yours.author), pct(c.cited.author)],
  ];
  return (
    <section className="flex flex-col gap-2">
      <div>
        <h2 className="text-sm font-semibold">Compared with the pages AI cites</h2>
        <p className="text-xs text-fg-subtle">
          The {c.cited.pages} pages from other sites that answers cite most for your prompts,
          checked the same way. Where they have something your pages don&rsquo;t, that&rsquo;s the
          gap to close.
        </p>
      </div>
      <div className="overflow-x-auto rounded-xl border border-line bg-panel">
        <table className="w-full min-w-[420px] text-left text-[13px]">
          <thead className="border-b border-line bg-hover text-xs text-fg-subtle">
            <tr>
              <th className="px-4 py-2 font-medium" />
              <th className="px-3 py-2 text-right font-medium">Your pages ({c.yours.pages})</th>
              <th className="px-4 py-2 text-right font-medium">Pages AI cites ({c.cited.pages})</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map(([label, yours, cited]) => (
              <tr key={label}>
                <td className="px-4 py-2">{label}</td>
                <td className="tabular px-3 py-2 text-right">{yours}</td>
                <td className="tabular px-4 py-2 text-right">{cited}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-fg-subtle">
        Compared with:{" "}
        {c.citedPages.map((p, i) => (
          <span key={p.url}>
            {i > 0 && ", "}
            <a href={p.url} target="_blank" rel="noreferrer" className="hover:underline">
              {(() => {
                try {
                  return new URL(p.url).hostname.replace(/^www\./, "");
                } catch {
                  return p.url;
                }
              })()}
            </a>
          </span>
        ))}
        .
      </p>
    </section>
  );
}

export default async function AuditPage() {
  const { workspace, role } = await requireWorkspace();
  const sites = await getAudit(getDb(), workspace.id);
  const owner = role === "owner";
  const working = sites.some((s) => s.status !== "done");
  const last = sites.find((s) => s.finishedAt)?.finishedAt;

  if (!sites.length)
    return (
      <Page title="Site audit" description="Can AI engines read your site?">
        <EmptyState
          icon={<ScanSearch />}
          title="Check whether AI can read your site"
          description="The audit reads your robots.txt the way each AI crawler does, then fetches your home page, the pages answers cite, and pages from your sitemap without running JavaScript, as most AI crawlers do. It flags anything that keeps a page out of answers, and scores how ready each page is to be quoted."
        >
          {owner && <RunAuditButton />}
        </EmptyState>
      </Page>
    );

  return (
    <Page
      title="Site audit"
      description={
        working
          ? "Checking your site…"
          : `Can AI engines read your site? · checked ${last ? `${when(last)} UTC` : ""}`
      }
      actions={owner && !working ? <RunAuditButton again /> : undefined}
    >
      <AutoRefresh active={working} />
      {sites.map((site) => (
        <div key={site.id} className="flex flex-col gap-4">
          {sites.length > 1 && <h2 className="text-base font-semibold">{site.domain}</h2>}
          {site.status !== "done" ? (
            <p className="rounded-lg border border-line bg-hover px-3 py-2 text-[13px]">
              {site.status === "queued" || !site.pages.length
                ? `Starting on ${site.domain}…`
                : `Checking ${site.domain}: ${site.checked} of ${site.pages.length} pages`}
            </p>
          ) : site.error ? (
            <p className="rounded-lg border border-line bg-hover px-3 py-2 text-[13px]">
              Couldn&rsquo;t audit {site.domain}: {site.error}. Check the domain in setup, then run
              the audit again.
            </p>
          ) : (
            <>
              <Summary site={site} />
              <Crawlers site={site} />
              <Pages site={site} />
              {site.comparison && <Comparison c={site.comparison} />}
              <p className="text-xs text-fg-subtle">
                {site.llmsTxt
                  ? "You have an llms.txt file."
                  : "No llms.txt. It's optional: no major AI engine has said it reads one, so it's not a fix to prioritise."}
              </p>
            </>
          )}
        </div>
      ))}
    </Page>
  );
}
