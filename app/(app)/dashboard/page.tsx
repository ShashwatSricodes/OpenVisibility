import type { Metadata } from "next";
import { BarListCard } from "../_components/bar-list-card";
import { OverviewChart } from "../_components/overview-chart";
import { PageHeader } from "../_components/page-header";
import {
  BRAND,
  CITED_DOMAINS,
  CITED_PAGES,
  COMPETITORS,
  ENGINES,
  PROMPTS,
  engineAverages,
} from "../_lib/sample-data";

export const metadata: Metadata = { title: "Overview" };

function Favicon({ domain }: { domain: string }) {
  return (
    <img
      src={`https://www.google.com/s2/favicons?domain=${domain}&sz=32`}
      alt=""
      width={16}
      height={16}
      className="size-4 shrink-0 rounded-xs"
      loading="lazy"
    />
  );
}

const Swatch = ({ color }: { color: string }) => (
  <span className="size-2.5 shrink-0 rounded-xs" style={{ background: color }} aria-hidden="true" />
);

const KIND_TAG = { owned: "Owned", competitor: "Competitor", third_party: undefined } as const;

export default function OverviewPage() {
  const mention = engineAverages("mention");
  const position = engineAverages("position");

  return (
    <>
      <PageHeader
        title="Overview"
        subtitle={`${BRAND.name} · ${PROMPTS.length} prompts tracked daily across ${ENGINES.length} engines · sample data`}
      />

      <div className="flex flex-col gap-5 p-4 sm:p-6">
        <OverviewChart />

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <BarListCard
            caption="Engines"
            tabs={[
              {
                id: "mention",
                label: "Mention rate",
                max: 100,
                format: "percent",
                items: [...mention]
                  .sort((a, b) => b.value - a.value)
                  .map(({ engine, value }) => ({
                    key: engine.id,
                    label: engine.name,
                    value,
                    icon: <Swatch color={engine.color} />,
                  })),
              },
              {
                id: "position",
                label: "Avg. position",
                format: "position",
                invert: true,
                items: [...position]
                  .sort((a, b) => a.value - b.value)
                  .map(({ engine, value }) => ({
                    key: engine.id,
                    label: engine.name,
                    value,
                    icon: <Swatch color={engine.color} />,
                  })),
              },
            ]}
          />

          <BarListCard
            caption="Competitors"
            tint="orange"
            tabs={[
              {
                id: "sov",
                label: "Share of voice",
                format: "percent",
                items: COMPETITORS.map((c) => ({
                  key: c.domain,
                  label: c.name,
                  value: c.sov,
                  icon: <Favicon domain={c.domain} />,
                  tag: c.you ? "You" : undefined,
                })),
              },
              {
                id: "mentions",
                label: "Mentions",
                format: "count",
                shareOfTotal: true,
                items: COMPETITORS.map((c) => ({
                  key: c.domain,
                  label: c.name,
                  value: c.mentions,
                  icon: <Favicon domain={c.domain} />,
                  tag: c.you ? "You" : undefined,
                })),
              },
            ]}
          />

          <BarListCard
            caption="Prompts"
            tint="orange"
            tabs={[
              {
                id: "missing",
                label: "Where you're missing",
                max: 100,
                format: "percent",
                items: [...PROMPTS]
                  .sort((a, b) => a.rate - b.rate)
                  .map((p) => ({ key: p.text, label: p.text, value: p.rate })),
              },
              {
                id: "winning",
                label: "Where you win",
                max: 100,
                format: "percent",
                items: [...PROMPTS]
                  .sort((a, b) => b.rate - a.rate)
                  .map((p) => ({ key: p.text, label: p.text, value: p.rate })),
              },
            ]}
          />

          <BarListCard
            caption="Citations"
            tabs={[
              {
                id: "domains",
                label: "Domains",
                format: "count",
                shareOfTotal: true,
                items: [...CITED_DOMAINS]
                  .sort((a, b) => b.count - a.count)
                  .map((d) => ({
                    key: d.domain,
                    label: d.domain,
                    value: d.count,
                    icon: <Favicon domain={d.domain} />,
                    tag: KIND_TAG[d.kind],
                  })),
              },
              {
                id: "pages",
                label: "Pages",
                format: "count",
                shareOfTotal: true,
                items: CITED_PAGES.map((p) => ({
                  key: p.url,
                  label: p.url,
                  value: p.count,
                  icon: <Favicon domain={p.url.split("/")[0]} />,
                })),
              },
            ]}
          />
        </div>
      </div>
    </>
  );
}
