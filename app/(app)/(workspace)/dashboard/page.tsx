import type { Metadata } from "next";
import { Bot, Link2, MessageSquareText, Swords } from "lucide-react";
import { BarListCard } from "../../_components/bar-list-card";
import { OverviewTop } from "../../_components/overview-top";
import {
  BRAND,
  CITED_DOMAINS,
  CITED_PAGES,
  COMPETITORS,
  ENGINES,
  PROMPTS,
  engineAverages,
} from "../../_lib/sample-data";

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

const KIND_TAG = { owned: "Owned", competitor: "Competitor", third_party: undefined } as const;

export default function OverviewPage() {
  const mention = engineAverages("mention");
  const position = engineAverages("position");

  const engineItems = (rows: typeof mention, asc: boolean) =>
    [...rows]
      .sort((a, b) => (asc ? a.value - b.value : b.value - a.value))
      .map(({ engine, value }) => ({
        key: engine.id,
        label: engine.name,
        value,
        icon: <Swatch color={engine.color} />,
      }));

  return (
    <div className="flex flex-col gap-4 p-4 sm:p-5 lg:px-6 lg:py-5">
      <OverviewTop
        title="Overview"
        subtitle={`${BRAND.name} · ${PROMPTS.length} prompts across ${ENGINES.length} engines · sample data`}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <BarListCard
          tint="green"
          caption="Answers"
          captionIcon={<Bot className="size-3.5" />}
          tabs={[
            {
              id: "mention",
              label: "Engines",
              format: "percent",
              max: 100,
              items: engineItems(mention, false),
            },
            {
              id: "position",
              label: "Position",
              format: "position",
              invert: true,
              items: engineItems(position, true),
            },
          ]}
        />

        <BarListCard
          tint="blue"
          caption="Mentions"
          captionIcon={<Swords className="size-3.5" />}
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
          tint="orange"
          caption="Mention rate"
          captionIcon={<MessageSquareText className="size-3.5" />}
          tabs={[
            {
              id: "missing",
              label: "Missing",
              format: "percent",
              max: 100,
              items: [...PROMPTS]
                .sort((a, b) => a.rate - b.rate)
                .map((p) => ({ key: p.text, label: p.text, value: p.rate })),
            },
            {
              id: "winning",
              label: "Winning",
              format: "percent",
              max: 100,
              items: [...PROMPTS]
                .sort((a, b) => b.rate - a.rate)
                .map((p) => ({ key: p.text, label: p.text, value: p.rate })),
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
                  id: "url",
                  label: "URL",
                  items: CITED_PAGES.map((p) => ({
                    key: p.url,
                    label: p.url,
                    value: p.count,
                    icon: <Favicon domain={p.url.split("/")[0]} />,
                  })),
                },
              ],
            },
            {
              id: "owned",
              label: "Owned",
              format: "count",
              items: CITED_DOMAINS.filter((d) => d.kind === "owned").map((d) => ({
                key: d.domain,
                label: d.domain,
                value: d.count,
                icon: <Favicon domain={d.domain} />,
              })),
            },
          ]}
        />
      </div>
    </div>
  );
}
