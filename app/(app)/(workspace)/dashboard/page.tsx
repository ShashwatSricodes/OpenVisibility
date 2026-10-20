import type { Metadata } from "next";
import { redirect } from "next/navigation";
import {
  Bot,
  LayoutDashboard,
  Link2,
  MessageSquareText,
  Swords,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { requireWorkspace } from "@/core/auth/session";
import { getBrandSetup } from "@/core/brands";
import { citationSummary } from "@/core/citation-stats";
import { describeFilter, filterOptions, parseFilter } from "@/core/filters";
import { RANGES, getOverview } from "@/core/overview";
import { ENGINES } from "@/core/providers/registry";
import { getDb } from "@/db/client";
import { BarListCard } from "../../_components/bar-list-card";
import { TrendPanel } from "../../_components/overview-top";
import { PageFilters } from "../../_components/page-filters";
import { ENGINE_COLOR, change } from "../../_lib/kpi";
import { EmptyState } from "../../_components/page-frame";
import { RunNowButton } from "../../_components/run-now-button";
import { cn } from "../../_lib/cn";

export const metadata: Metadata = { title: "Overview" };

function Favicon({ domain }: { domain: string }) {
  return (
    <img
      src={`https://www.google.com/s2/favicons?domain=${domain}&sz=32`}
      alt=""
      width={14}
      height={14}
      className="size-3.5 shrink-0"
      loading="lazy"
    />
  );
}

const Swatch = ({ color }: { color: string }) => (
  <span className="size-2 shrink-0 rounded-sm" style={{ background: color }} aria-hidden="true" />
);

const KIND_TAG = { owned: "Yours", competitor: "Competitor", third_party: undefined } as const;

export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { workspace } = await requireWorkspace();
  const db = getDb();
  const setup = await getBrandSetup(db, workspace.id);
  // new workspaces start in setup: there's nothing to show until a brand exists
  if (!setup.brand) redirect("/onboarding");

  const q = await searchParams;
  const filter = parseFilter(q);
  const { range, engine, country } = filter;

  const [o, options] = await Promise.all([
    getOverview(db, workspace.id, filter),
    filterOptions(db, workspace.id),
  ]);
  const today = new Date().toISOString().slice(0, 10);
  const periodLabel = RANGES[range].label;

  if (!o.hasData)
    return (
      <div className="flex flex-col gap-4 p-4 sm:p-5 lg:px-6 lg:py-5">
        <h1 className="text-base font-semibold">Overview</h1>
        <EmptyState
          icon={<LayoutDashboard />}
          title="Your first results will appear here"
          description="Run your prompts to see how often AI engines name you, where you rank against competitors, and which sources they cite. Bright Data answers take a few minutes per engine."
          action={{ href: "/runs", label: "Go to runs" }}
        />
      </div>
    );

  const sources = await citationSummary(
    db,
    workspace.id,
    { since: new Date(`${o.period.from}T00:00:00Z`), engine, country },
    { limit: 20, pagesPerDomain: 10 },
  );

  // the five-second answer: is your mention rate going up or down?
  const mention = o.kpis.find((k) => k.id === "mention")!;
  const trend = change("mention", mention);
  const engineNames = o.engines.map((e) => ({ id: e, name: ENGINES[e].name }));

  return (
    <div className="flex flex-col gap-4 p-4 sm:p-5 lg:px-6 lg:py-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-base font-semibold">Overview</h1>
          <p className="truncate text-xs text-fg-subtle">
            {setup.brand.name} · {o.samples.toLocaleString("en-US")} answers ·{" "}
            {describeFilter(filter)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PageFilters
            filter={filter}
            options={options}
            exports={["metrics", "answers", "mentions", "citations"]}
          />
          <RunNowButton />
        </div>
      </div>

      <p
        className={cn(
          "flex items-center gap-2 rounded-lg border px-3 py-2 text-[13px]",
          trend?.tone === "up"
            ? "border-[color-mix(in_srgb,var(--good)_30%,transparent)] bg-[color-mix(in_srgb,var(--good)_8%,transparent)]"
            : trend?.tone === "down"
              ? "border-[color-mix(in_srgb,var(--bad)_30%,transparent)] bg-[color-mix(in_srgb,var(--bad)_8%,transparent)]"
              : "border-line bg-hover",
        )}
      >
        {trend?.tone === "down" ? (
          <TrendingDown className="size-4 shrink-0 text-bad" />
        ) : (
          <TrendingUp
            className={cn("size-4 shrink-0", trend?.tone === "up" ? "text-good" : "text-fg-subtle")}
          />
        )}
        <span>
          {mention.value === null
            ? "No answers in this period yet."
            : trend === null
              ? `AI engines name ${setup.brand.name} in ${Math.round(mention.value)}% of answers. There's no earlier period to compare with yet.`
              : trend.tone === "flat"
                ? `Holding steady: ${setup.brand.name} is named in ${Math.round(mention.value)}% of answers, the same as the ${RANGES[range].days} days before.`
                : `${trend.tone === "up" ? "Improving" : "Slipping"}: ${setup.brand.name} is named in ${Math.round(mention.value)}% of answers, ${trend.text.replace("+", "up ").replace("−", "down ")} on the ${RANGES[range].days} days before.`}
          {o.visibilityIndex !== null && (
            <span className="text-fg-subtle">
              {" "}
              Visibility index {Math.round(o.visibilityIndex)}/100.
            </span>
          )}
        </span>
      </p>

      <TrendPanel
        kpis={o.kpis}
        trend={o.trend}
        engines={engineNames}
        notes={o.annotations}
        periodLabel={periodLabel}
        today={today}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <BarListCard
          tint="orange"
          caption="Prompts"
          captionIcon={<MessageSquareText className="size-3.5" />}
          tabs={[
            {
              id: "missing",
              label: "Where you're missing",
              format: "percent",
              max: 100,
              items: o.prompts.map((p) => ({ key: p.id, label: p.text, value: p.rate })),
            },
            {
              id: "winning",
              label: "Winning",
              format: "percent",
              max: 100,
              items: [...o.prompts]
                .reverse()
                .map((p) => ({ key: p.id, label: p.text, value: p.rate })),
            },
          ]}
        />

        <BarListCard
          tint="blue"
          caption="Competitors"
          captionIcon={<Swords className="size-3.5" />}
          tabs={[
            {
              id: "sov",
              label: "Share of voice",
              format: "percent",
              max: 100,
              items: [...o.brands]
                .sort((a, b) => (b.shareOfVoice ?? 0) - (a.shareOfVoice ?? 0))
                .map((b) => ({
                  key: b.competitorId ?? "you",
                  label: b.name,
                  value: (b.shareOfVoice ?? 0) * 100,
                  tag: b.competitorId ? undefined : "You",
                })),
            },
            {
              id: "rate",
              label: "Mention rate",
              format: "percent",
              max: 100,
              items: [...o.brands]
                .sort((a, b) => (b.mentionRate ?? 0) - (a.mentionRate ?? 0))
                .map((b) => ({
                  key: b.competitorId ?? "you",
                  label: b.name,
                  value: (b.mentionRate ?? 0) * 100,
                  tag: b.competitorId ? undefined : "You",
                })),
            },
          ]}
        />

        <BarListCard
          tint="green"
          caption="Engines"
          captionIcon={<Bot className="size-3.5" />}
          tabs={[
            {
              id: "mention",
              label: "Mention rate",
              format: "percent",
              max: 100,
              items: [...o.byEngine]
                .sort((a, b) => b.rate - a.rate)
                .map((e) => ({
                  key: e.engine,
                  label: ENGINES[e.engine].name,
                  value: e.rate,
                  icon: <Swatch color={ENGINE_COLOR[e.engine]} />,
                })),
            },
            {
              id: "position",
              label: "Position",
              format: "position",
              invert: true,
              items: o.byEngine
                .filter((e) => e.position !== null)
                .sort((a, b) => a.position! - b.position!)
                .map((e) => ({
                  key: e.engine,
                  label: ENGINES[e.engine].name,
                  value: e.position!,
                  icon: <Swatch color={ENGINE_COLOR[e.engine]} />,
                })),
            },
          ]}
        />

        <BarListCard
          tint="red"
          caption="Citations"
          captionIcon={<Link2 className="size-3.5" />}
          tabs={[
            {
              id: "sources",
              label: "Sources",
              format: "count",
              subTabs: [
                {
                  id: "domain",
                  label: "Domain",
                  items: sources.domains.map((d) => ({
                    key: d.domain,
                    label: d.domain,
                    value: d.answers,
                    icon: <Favicon domain={d.domain} />,
                    tag: d.competitor ?? KIND_TAG[d.kind],
                  })),
                },
                {
                  id: "url",
                  label: "Page",
                  items: sources.domains
                    .flatMap((d) => d.pages)
                    .sort((a, b) => b.answers - a.answers)
                    .slice(0, 20)
                    .map((p) => ({
                      key: p.url,
                      label: p.url.replace(/^https?:\/\//, ""),
                      value: p.answers,
                      icon: <Favicon domain={new URL(p.url).hostname} />,
                    })),
                },
              ],
            },
            {
              id: "owned",
              label: "Yours",
              format: "count",
              items: sources.domains
                .filter((d) => d.kind === "owned")
                .flatMap((d) => d.pages)
                .map((p) => ({
                  key: p.url,
                  label: p.url.replace(/^https?:\/\//, ""),
                  value: p.answers,
                })),
            },
          ]}
        />
      </div>
    </div>
  );
}
