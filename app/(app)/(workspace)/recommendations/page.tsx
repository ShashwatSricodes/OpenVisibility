import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight, Lightbulb } from "lucide-react";
import { requireWorkspace } from "@/core/auth/session";
import { describeFilter, filterOptions, parseFilter } from "@/core/filters";
import { GAP_MIN, recommendations } from "@/core/gaps";
import { ENGINES } from "@/core/providers/registry";
import { getDb } from "@/db/client";
import { EmptyState, Page } from "../../_components/page-frame";
import { PageFilters } from "../../_components/page-filters";
import { RecommendationItem } from "../../_components/recommendation-item";

export const metadata: Metadata = { title: "Recommendations" };

const pct = (v: number) => `${Math.round(v * 100)}%`;
const shortUrl = (url: string) => {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, "") + (u.pathname === "/" ? "" : u.pathname);
  } catch {
    return url;
  }
};

export default async function RecommendationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { workspace } = await requireWorkspace();
  const db = getDb();
  const filter = parseFilter(await searchParams);
  const [{ items, gaps, targets }, options] = await Promise.all([
    recommendations(db, workspace.id, filter),
    filterOptions(db, workspace.id),
  ]);
  const pitchable = targets.filter((t) => t.kind === "third_party");

  return (
    <Page
      title="Recommendations"
      description={`What to do next, from your own results · ${describeFilter(filter)}`}
      actions={<PageFilters filter={filter} options={options} />}
    >
      {!options.engines.length ? (
        <EmptyState
          icon={<Lightbulb />}
          title="Recommendations come from your results"
          description="After a few runs, this lists the prompts competitors win and you don't, the pages AI cites for them that you could get onto, and the fixes your site needs."
          action={{ href: "/runs", label: "Go to runs" }}
        />
      ) : (
        <>
          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold">Next steps</h2>
            {items.length ? (
              <div className="divide-y divide-line rounded-xl border border-line bg-panel">
                {items.map((r, i) => (
                  <RecommendationItem key={r.id} r={r} n={i + 1} />
                ))}
              </div>
            ) : (
              <p className="rounded-xl border border-line bg-panel px-4 py-6 text-center text-[13px] text-fg-subtle">
                Nothing stands out for {describeFilter(filter)}: no prompt where a competitor is far
                ahead, no page to get onto, and no engine slipping. Run the site audit for fixes to
                your own pages.
              </p>
            )}
          </section>

          {gaps.length > 0 && (
            <section className="flex flex-col gap-2">
              <div>
                <h2 className="text-sm font-semibold">Content gaps</h2>
                <p className="text-xs text-fg-subtle">
                  Prompts where an engine names a competitor at least {pct(GAP_MIN)} more often than
                  you, biggest gap first, with the sources those answers cite.
                </p>
              </div>
              <div className="overflow-x-auto rounded-xl border border-line bg-panel">
                <table className="w-full min-w-[640px] text-left text-[13px]">
                  <thead className="border-b border-line bg-hover text-xs text-fg-subtle">
                    <tr>
                      <th className="px-4 py-2 font-medium">Prompt</th>
                      <th className="px-3 py-2 font-medium">Engine</th>
                      <th className="px-3 py-2 text-right font-medium">You</th>
                      <th className="px-3 py-2 font-medium">Leader</th>
                      <th className="px-4 py-2 font-medium">Sources cited</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {gaps.map((g) => (
                      <tr key={`${g.promptId}:${g.engine}`}>
                        <td className="max-w-xs px-4 py-2.5">
                          <Link href={`/prompts/${g.promptId}`} className="hover:underline">
                            {g.prompt}
                          </Link>
                          <Link
                            href={`/recommendations/brief/${g.promptId}`}
                            className="mt-0.5 block text-xs text-fg-subtle underline-offset-2 hover:underline"
                          >
                            Content brief
                          </Link>
                        </td>
                        <td className="px-3 py-2.5 text-fg-subtle">{ENGINES[g.engine].name}</td>
                        <td className="tabular px-3 py-2.5 text-right">{pct(g.yours)}</td>
                        <td className="px-3 py-2.5">
                          {g.rival} <span className="tabular text-fg-subtle">{pct(g.theirs)}</span>
                        </td>
                        <td className="px-4 py-2.5 text-xs text-fg-subtle">
                          {g.sources.length
                            ? g.sources.map((s) => s.domain).join(", ")
                            : "none cited"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {pitchable.length > 0 && (
            <section className="flex flex-col gap-2">
              <div>
                <h2 className="text-sm font-semibold">Pages to get onto</h2>
                <p className="text-xs text-fg-subtle">
                  Pages on other sites that answers cite when they name a competitor but not you. AI
                  already trusts them for your prompts, so a mention there can carry into answers.
                </p>
              </div>
              <div className="overflow-x-auto rounded-xl border border-line bg-panel">
                <table className="w-full min-w-[680px] text-left text-[13px]">
                  <thead className="border-b border-line bg-hover text-xs text-fg-subtle">
                    <tr>
                      <th className="px-4 py-2 font-medium">Page</th>
                      <th className="px-3 py-2 text-right font-medium">Answers without you</th>
                      <th className="px-3 py-2 font-medium">Names instead</th>
                      <th className="px-4 py-2 font-medium">Engines</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {pitchable.map((t) => (
                      <tr key={t.url}>
                        <td className="max-w-sm px-4 py-2.5">
                          <a
                            href={t.url}
                            target="_blank"
                            rel="noreferrer"
                            className="flex items-center gap-1 hover:underline"
                          >
                            <span className="truncate">{t.title || shortUrl(t.url)}</span>
                            <ArrowUpRight className="size-3 shrink-0 text-fg-muted" />
                          </a>
                          {(t.title || t.withYou > 0) && (
                            <span className="block truncate text-xs text-fg-subtle">
                              {[
                                t.title && shortUrl(t.url),
                                t.withYou > 0 && `also cited in ${t.withYou} answers naming you`,
                              ]
                                .filter(Boolean)
                                .join(" · ")}
                            </span>
                          )}
                        </td>
                        <td className="tabular px-3 py-2.5 text-right">
                          {t.answers}
                          <span className="block text-xs text-fg-subtle">
                            {t.prompts.length} {t.prompts.length === 1 ? "prompt" : "prompts"}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-xs">{t.rivals.slice(0, 3).join(", ")}</td>
                        <td className="px-4 py-2.5 text-xs text-fg-subtle">
                          {t.engines.map((e) => ENGINES[e].name).join(", ")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}
    </Page>
  );
}
