import type { Metadata } from "next";
import Link from "next/link";
import { ListChecks, Sparkles } from "lucide-react";
import { requireWorkspace } from "@/core/auth/session";
import { getBrandSetup } from "@/core/brands";
import { describeFilter, filterHref, filterOptions, parseFilter } from "@/core/filters";
import { promptTable } from "@/core/prompt-results";
import { listBrandPrompts } from "@/core/prompts";
import { getTrackingConfig } from "@/core/tracking-config";
import { getDb } from "@/db/client";
import { EmptyState, Page, buttonSecondary } from "../../_components/page-frame";
import { PageFilters } from "../../_components/page-filters";
import { Segments } from "../../_components/segments";
import { PromptManager } from "./prompt-manager";
import { ResultsTable } from "./results-table";

export const metadata: Metadata = { title: "Prompts" };

export default async function PromptsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { workspace, role } = await requireWorkspace();
  const db = getDb();
  const q = await searchParams;
  const view = q.view === "manage" ? "manage" : "results";
  const filter = parseFilter(q);

  const [{ brand }, config, options] = await Promise.all([
    getBrandSetup(db, workspace.id),
    getTrackingConfig(db, workspace.id),
    filterOptions(db, workspace.id),
  ]);
  const rows = brand ? await listBrandPrompts(db, brand.id) : [];
  const active = rows.filter((p) => p.active).length;
  const table =
    brand && view === "results" ? await promptTable(db, workspace.id, brand.id, filter) : null;
  const anyResults = table?.rows.some((r) => r.mentionRate !== null) ?? false;

  return (
    <Page
      title="Prompts"
      description={
        rows.length
          ? `${active} active of ${rows.length} · the questions each run asks every engine`
          : "The questions each run asks every engine"
      }
      actions={
        brand && role === "owner" ? (
          <Link href="/onboarding?step=prompts" className={buttonSecondary}>
            <Sparkles className="size-3.5" />
            Get suggestions
          </Link>
        ) : undefined
      }
    >
      {!brand ? (
        <EmptyState
          icon={<ListChecks />}
          title="Set up your brand first"
          description="Prompts are the questions your customers ask AI, like “best invoicing app for freelancers”. Setup suggests them from your brand, category and competitors."
          action={{ href: "/onboarding", label: "Set up your brand" }}
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Segments
              items={[
                {
                  href: filterHref("/prompts", filter),
                  label: "Results",
                  active: view === "results",
                },
                {
                  href: "/prompts?view=manage",
                  label: "Manage prompts",
                  active: view === "manage",
                },
              ]}
            />
            {view === "results" && (
              <PageFilters filter={filter} options={options} exports={["metrics", "answers"]} />
            )}
          </div>

          {view === "manage" ? (
            <PromptManager
              prompts={rows.map(({ id, text, tags, countries, active }) => ({
                id,
                text,
                tags,
                countries,
                active,
              }))}
              defaultCountries={config.countries}
              canEdit={role === "owner"}
            />
          ) : !rows.length ? (
            <EmptyState
              icon={<ListChecks />}
              title="No prompts yet"
              description="Add the questions your customers ask AI, then run them to see where you're named."
              action={{ href: "/prompts?view=manage", label: "Add prompts" }}
            />
          ) : (
            <>
              {!anyResults && (
                <p className="rounded-lg border border-line bg-hover px-3 py-2 text-[13px] text-fg-default">
                  No results in this period yet. Run your prompts from{" "}
                  <Link href="/runs" className="underline underline-offset-2">
                    Runs
                  </Link>{" "}
                  and they&rsquo;ll fill in here.
                </p>
              )}
              <p className="text-xs text-fg-subtle">
                How often each prompt&rsquo;s answers name {brand.name}, worst first ·{" "}
                {describeFilter(filter)}. Open a prompt for its answers and who wins it.
              </p>
              <ResultsTable rows={table!.rows} engines={table!.engines} range={filter.range} />
            </>
          )}
        </>
      )}
    </Page>
  );
}
