import type { Metadata } from "next";
import { Link2 } from "lucide-react";
import { requireWorkspace } from "@/core/auth/session";
import { citationSummary } from "@/core/citation-stats";
import { getDb } from "@/db/client";
import { EmptyState, Page } from "../../_components/page-frame";
import { SourcesTable } from "../../_components/sources-table";

export const metadata: Metadata = { title: "Citations" };

const DAYS = 30;

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-xl border border-line bg-panel px-4 py-3">
      <p className="text-xs text-fg-subtle">{label}</p>
      <p className="tabular mt-1 text-lg font-semibold">{value}</p>
      <p className="mt-0.5 text-xs text-fg-subtle">{sub}</p>
    </div>
  );
}

export default async function CitationsPage() {
  const { workspace } = await requireWorkspace();
  const since = new Date(Date.now() - DAYS * 86_400_000);
  const s = await citationSummary(getDb(), workspace.id, { since });
  const pct = (n: number) => (s.answers ? `${Math.round((n / s.answers) * 100)}%` : "–");

  return (
    <Page
      title="Citations"
      description={`The sources AI engines cite when they answer your prompts, over the last ${DAYS} days`}
    >
      {s.answers === 0 || s.domains.length === 0 ? (
        <EmptyState
          icon={<Link2 />}
          title="No citations yet"
          description="After a run, this shows which sites and pages the engines cite: yours, your competitors', and the review sites in between. Those are the pages worth getting onto."
          action={{ href: "/runs", label: "See runs" }}
        />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Stat
              label="Cite your site"
              value={pct(s.citingOwned)}
              sub={`of ${s.answers.toLocaleString("en-US")} answers`}
            />
            <Stat
              label="Cite a competitor's site"
              value={pct(s.citingCompetitor)}
              sub="of the same answers"
            />
            <Stat label="Cite any source" value={pct(s.withSources)} sub="of the same answers" />
          </div>
          <SourcesTable domains={s.domains} answers={s.answers} />
        </>
      )}
    </Page>
  );
}
