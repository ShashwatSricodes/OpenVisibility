import type { Metadata } from "next";
import { Swords } from "lucide-react";
import { requireWorkspace } from "@/core/auth/session";
import { listCompetitors } from "@/core/workspace-data";
import { getDb } from "@/db/client";
import { EmptyState, Page } from "../../_components/page-frame";

export const metadata: Metadata = { title: "Competitors" };

export default async function CompetitorsPage() {
  const { workspace } = await requireWorkspace();
  const rows = await listCompetitors(getDb(), workspace.id);

  return (
    <Page
      title="Competitors"
      description={
        rows.length
          ? `${rows.length} tracked · how often AI names them next to you`
          : "The brands you're compared with in AI answers"
      }
    >
      {rows.length === 0 ? (
        <EmptyState
          icon={<Swords />}
          title="No competitors yet"
          description="Add the brands customers compare you with. Each run counts how often AI answers name them, where they rank, and which sources they're cited from."
          action={{ href: "/settings", label: "Review tracking settings" }}
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((c) => (
            <div key={c.id} className="rounded-xl border border-line bg-panel p-4">
              <div className="flex items-center gap-2.5">
                {c.domains[0] ? (
                  <img
                    src={`https://www.google.com/s2/favicons?domain=${c.domains[0]}&sz=32`}
                    alt=""
                    width={16}
                    height={16}
                    className="size-4 shrink-0"
                    loading="lazy"
                  />
                ) : (
                  <span className="size-4 shrink-0 rounded bg-pressed" />
                )}
                <p className="truncate text-[13px] font-semibold">{c.name}</p>
              </div>
              <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                <dt className="text-fg-muted">Domains</dt>
                <dd className="truncate text-fg-default">{c.domains.join(", ") || "None"}</dd>
                <dt className="text-fg-muted">Also called</dt>
                <dd className="truncate text-fg-default">{c.aliases.join(", ") || "None"}</dd>
                <dt className="text-fg-muted">Against</dt>
                <dd className="truncate text-fg-default">{c.brand}</dd>
              </dl>
            </div>
          ))}
        </div>
      )}
    </Page>
  );
}
