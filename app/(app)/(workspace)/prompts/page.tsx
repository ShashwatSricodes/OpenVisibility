import type { Metadata } from "next";
import { ListChecks } from "lucide-react";
import { requireWorkspace } from "@/core/auth/session";
import { countryName } from "@/core/countries";
import { listPrompts } from "@/core/workspace-data";
import { getDb } from "@/db/client";
import { cn } from "../../_lib/cn";
import { EmptyState, Page } from "../../_components/page-frame";

export const metadata: Metadata = { title: "Prompts" };

const chip = "rounded px-1.5 py-px text-[11px] font-medium";

export default async function PromptsPage() {
  const { workspace } = await requireWorkspace();
  const rows = await listPrompts(getDb(), workspace.id);
  const active = rows.filter((p) => p.active).length;

  return (
    <Page
      title="Prompts"
      description={
        rows.length
          ? `${active} active of ${rows.length} · the questions each run asks every engine`
          : "The questions each run asks every engine"
      }
    >
      {rows.length === 0 ? (
        <EmptyState
          icon={<ListChecks />}
          title="No prompts yet"
          description="Prompts are the questions your customers ask AI, like “best invoicing app for freelancers”. Setup will suggest 15–20 from your brand description, and you can add your own."
          action={{ href: "/settings", label: "Review tracking settings" }}
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="w-full min-w-[640px] text-left text-[13px]">
            <thead className="border-b border-line bg-hover text-xs text-fg-subtle">
              <tr>
                <th className="px-4 py-2 font-medium">Prompt</th>
                <th className="px-4 py-2 font-medium">Brand</th>
                <th className="px-4 py-2 font-medium">Countries</th>
                <th className="px-4 py-2 font-medium">Tags</th>
                <th className="px-4 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((p) => (
                <tr key={p.id} className={cn(!p.active && "text-fg-subtle")}>
                  <td className="px-4 py-2.5">{p.text}</td>
                  <td className="px-4 py-2.5 text-fg-subtle">{p.brand}</td>
                  <td className="px-4 py-2.5 text-fg-subtle">
                    {p.countries.length
                      ? p.countries.map(countryName).join(", ")
                      : "Workspace default"}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="flex flex-wrap gap-1">
                      {p.tags.map((t) => (
                        <span key={t} className={cn(chip, "bg-pressed text-fg-default")}>
                          {t}
                        </span>
                      ))}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <span
                      className={cn(
                        chip,
                        p.active
                          ? "bg-[color-mix(in_srgb,var(--good)_12%,transparent)] text-good"
                          : "bg-pressed text-fg-subtle",
                      )}
                    >
                      {p.active ? "Active" : "Paused"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Page>
  );
}
