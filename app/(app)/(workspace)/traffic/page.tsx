import type { Metadata } from "next";
import { Bot } from "lucide-react";
import { requireWorkspace } from "@/core/auth/session";
import { env } from "@/core/env";
import { RANGES, isRange, type RangeId } from "@/core/overview";
import { listKeys } from "@/core/mcp/keys";
import { SNIPPET_AGENTS, SNIPPET_REFERRERS } from "@/core/traffic/agents";
import {
  citedPagesCrawled,
  crawlerSummary,
  perDay,
  referrals,
  topCrawled,
  trafficStatus,
} from "@/core/traffic/stats";
import { getDb } from "@/db/client";
import { EmptyState, Page } from "../../_components/page-frame";
import { Segments } from "../../_components/segments";
import { cn } from "../../_lib/cn";
import { ConnectSite } from "./connect";

export const metadata: Metadata = { title: "AI traffic" };

const n = (v: number) => v.toLocaleString("en-US");
const day = (d: Date | null) =>
  d ? d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }) : "never";
const PURPOSE = {
  search: "Finds pages for answers",
  user: "Opens pages mid-answer",
  training: "Trains models",
} as const;

function Section({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
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

const th = "px-3 py-2 text-xs font-medium text-fg-subtle";
const td = "px-3 py-2";

/** Visits per day as bars: crawlers above, referrals below; drawn on the server. */
function Bars({ days }: { days: { day: string; crawlers: number; referrals: number }[] }) {
  const max = Math.max(1, ...days.map((d) => d.crawlers), ...days.map((d) => d.referrals));
  const w = 100 / Math.max(days.length, 1);
  return (
    <div className="rounded-xl border border-line bg-panel p-4">
      <svg
        viewBox="0 0 100 40"
        preserveAspectRatio="none"
        className="h-40 w-full"
        role="img"
        aria-label="AI visits per day"
      >
        {days.map((d, i) => (
          <g key={d.day}>
            <rect
              x={i * w + w * 0.15}
              width={w * 0.7}
              y={20 - (d.crawlers / max) * 19}
              height={(d.crawlers / max) * 19}
              fill="var(--series-1)"
            />
            <rect
              x={i * w + w * 0.15}
              width={w * 0.7}
              y={21}
              height={(d.referrals / max) * 19}
              fill="var(--series-4)"
            />
          </g>
        ))}
        <line x1={0} x2={100} y1={20.5} y2={20.5} stroke="var(--chart-grid)" strokeWidth={0.2} />
      </svg>
      <div className="mt-2 flex justify-between text-xs text-fg-subtle">
        <span>{days[0]?.day}</span>
        <span className="flex gap-4">
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-sm bg-[var(--series-1)]" /> AI crawler visits
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-sm bg-[var(--series-4)]" /> People from AI assistants
          </span>
        </span>
        <span>{days.at(-1)?.day}</span>
      </div>
    </div>
  );
}

export default async function TrafficPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { workspace, role } = await requireWorkspace();
  const db = getDb();
  const q = await searchParams;
  const range: RangeId = isRange(q.range) ? q.range : "30d";
  const since = new Date(Date.now() - RANGES[range].days * 86_400_000);
  const [status, crawlers, days, pages, cited, refs, keys] = await Promise.all([
    trafficStatus(db, workspace.id),
    crawlerSummary(db, workspace.id, since),
    perDay(db, workspace.id, since),
    topCrawled(db, workspace.id, since),
    citedPagesCrawled(db, workspace.id),
    referrals(db, workspace.id, since),
    listKeys(db, workspace.id),
  ]);
  const owner = role === "owner";
  const connect = (
    <ConnectSite
      keys={keys.filter((k) => k.access === "ingest")}
      endpoint={`${env().BETTER_AUTH_URL.replace(/\/$/, "")}/api/ingest/visits`}
      agents={SNIPPET_AGENTS}
      referrers={SNIPPET_REFERRERS}
      canEdit={owner}
    />
  );

  if (!status.total)
    return (
      <Page
        title="AI traffic"
        description="AI crawlers on your site, and people arriving from AI assistants"
      >
        <EmptyState
          icon={<Bot />}
          title="See which AI crawlers read your site"
          description="Which AI bots fetch your pages (and whether they're real), which pages they read, whether your site answers them properly, and how many people click through from ChatGPT, Perplexity, Gemini and the rest."
        />
        <div className="rounded-xl border border-line bg-panel p-5">{connect}</div>
      </Page>
    );

  const genuine = crawlers.reduce((s, c) => s + c.visits, 0);
  const fakes = crawlers.reduce((s, c) => s + c.fake, 0);
  const people = refs.byAssistant.reduce((s, r) => s + r.visits, 0);
  const errors = crawlers.reduce((s, c) => s + c.errors, 0);

  return (
    <Page
      title="AI traffic"
      description={`AI crawlers on your site, and people arriving from AI assistants · ${RANGES[range].label.toLowerCase()}`}
      actions={
        <Segments
          items={(Object.keys(RANGES) as RangeId[]).map((r) => ({
            href: r === "30d" ? "/traffic" : `/traffic?range=${r}`,
            label: RANGES[r].label.replace("Last ", ""),
            active: r === range,
          }))}
        />
      }
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {(
          [
            ["AI crawler visits", n(genuine), "verified, or unverifiable"],
            ["People from AI", n(people), "clicked through from an assistant"],
            ["Errors served to crawlers", n(errors), "4xx and 5xx responses"],
            ["Fake AI crawlers", n(fakes), "claimed a name, wrong address"],
          ] as const
        ).map(([label, value, sub]) => (
          <div key={label} className="rounded-xl border border-line bg-panel px-4 py-3">
            <p className="text-xs text-fg-subtle">{label}</p>
            <p className="tabular mt-1 text-lg font-semibold">{value}</p>
            <p className="mt-0.5 text-xs text-fg-subtle">{sub}</p>
          </div>
        ))}
      </div>

      {days.length > 0 && <Bars days={days} />}

      <Section
        title="AI crawlers"
        note="Each visit is checked against the IP ranges its company publishes. Visits that claim a crawler's name from anywhere else are counted as fakes, not as the crawler."
      >
        <div className="overflow-x-auto rounded-xl border border-line bg-panel">
          <table className="w-full min-w-[720px] text-left text-[13px]">
            <thead className="border-b border-line bg-hover">
              <tr>
                <th className={th}>Crawler</th>
                <th className={th}>What it does</th>
                <th className={cn(th, "text-right")}>Visits</th>
                <th className={cn(th, "text-right")}>Pages</th>
                <th className={cn(th, "text-right")}>Errors</th>
                <th className={th}>Last visit</th>
                <th className={th}>Checked</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {crawlers.map((c) => (
                <tr key={c.agent}>
                  <td className={td}>
                    <span className="font-medium">{c.agent}</span>
                    <span className="text-xs text-fg-subtle"> · {c.owner}</span>
                  </td>
                  <td className={cn(td, "text-fg-subtle")}>{PURPOSE[c.purpose]}</td>
                  <td className={cn(td, "tabular text-right")}>{n(c.visits)}</td>
                  <td className={cn(td, "tabular text-right")}>{n(c.pages)}</td>
                  <td className={cn(td, "tabular text-right", c.errors > 0 && "text-bad")}>
                    {n(c.errors)}
                  </td>
                  <td className={cn(td, "text-fg-subtle")}>{day(c.lastSeen)}</td>
                  <td className={cn(td, "text-xs")}>
                    {!c.checkable ? (
                      <span className="text-fg-subtle">publishes no addresses</span>
                    ) : c.fake > 0 ? (
                      <span className="text-bad">{n(c.fake)} fake</span>
                    ) : (
                      <span className="text-good">
                        {c.verified === c.visits ? "all genuine" : `${n(c.verified)} verified`}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {cited.length > 0 && (
        <Section
          title="Your pages that AI cites"
          note="When a crawler that feeds answers last fetched each one. A cited page none of them has fetched lately is being quoted from an old copy."
        >
          <ul className="divide-y divide-line rounded-xl border border-line bg-panel">
            {cited.map((p) => (
              <li
                key={p.url}
                className="flex items-center justify-between gap-3 px-4 py-2.5 text-[13px]"
              >
                <span className="truncate">{p.url.replace(/^https?:\/\//, "")}</span>
                <span
                  className={cn("shrink-0 text-xs", p.lastCrawled ? "text-fg-subtle" : "text-bad")}
                >
                  {p.lastCrawled
                    ? `${day(p.lastCrawled)} · ${p.by.join(", ")}`
                    : "no AI crawler visit seen"}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {pages.length > 0 && (
        <Section title="Pages AI crawlers read most">
          <ul className="divide-y divide-line rounded-xl border border-line bg-panel">
            {pages.map((p) => (
              <li
                key={p.path}
                className="flex items-center justify-between gap-3 px-4 py-2.5 text-[13px]"
              >
                <span className="truncate">{p.path}</span>
                <span className="shrink-0 text-xs text-fg-subtle">
                  {n(p.visits)} · {p.agents.join(", ")}
                  {p.errors > 0 && <span className="text-bad"> · {n(p.errors)} errors</span>}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section
        title="People arriving from AI assistants"
        note="Visits whose referrer is an AI assistant, or whose link carries its utm_source. Some assistants send no referrer, so this undercounts; connecting Google Analytics will add its numbers."
      >
        {refs.byAssistant.length ? (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <ul className="divide-y divide-line rounded-xl border border-line bg-panel">
              {refs.byAssistant.map((r) => (
                <li key={r.assistant} className="flex justify-between px-4 py-2.5 text-[13px]">
                  <span>{r.assistant}</span>
                  <span className="tabular">{n(r.visits)}</span>
                </li>
              ))}
            </ul>
            <ul className="divide-y divide-line rounded-xl border border-line bg-panel">
              {refs.landing.map((p) => (
                <li key={p.path} className="flex justify-between gap-3 px-4 py-2.5 text-[13px]">
                  <span className="truncate">{p.path}</span>
                  <span className="shrink-0 text-xs text-fg-subtle">
                    {n(p.visits)} · {p.assistants.join(", ")}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="rounded-xl border border-line bg-panel px-4 py-4 text-[13px] text-fg-subtle">
            No visits from AI assistants in this period.
          </p>
        )}
      </Section>

      <Section title="Connect your site">
        <div className="rounded-xl border border-line bg-panel p-5">{connect}</div>
        <p className="text-xs text-fg-subtle">
          {n(status.fromSnippet)} visits reported live, {n(status.fromLogs)} from uploaded logs;
          last one {day(status.last)}. Visits are kept for six months.
        </p>
      </Section>
    </Page>
  );
}
