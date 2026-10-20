import type { Metadata } from "next";
import { Clock } from "lucide-react";
import { requireWorkspace } from "@/core/auth/session";
import { getTrackingConfig } from "@/core/tracking-config";
import { estimateWorkspaceRun } from "@/core/usage";
import { listRuns } from "@/core/workspace-data";
import { getDb } from "@/db/client";
import { EmptyState, Page } from "../../_components/page-frame";
import { RunNowButton, TestRunButton } from "../../_components/run-now-button";
import { cn } from "../../_lib/cn";
import { AutoRefresh } from "./auto-refresh";

export const metadata: Metadata = { title: "Runs" };

const STATUS: Record<string, { label: string; style: string }> = {
  queued: { label: "Queued", style: "bg-pressed text-fg-default" },
  running: {
    label: "Running",
    style: "bg-[color-mix(in_srgb,var(--series-1)_14%,transparent)] text-[var(--series-1)]",
  },
  completed: {
    label: "Completed",
    style: "bg-[color-mix(in_srgb,var(--good)_12%,transparent)] text-good",
  },
  partial: {
    label: "Partly done",
    style: "bg-[color-mix(in_srgb,var(--series-4)_16%,transparent)] text-[var(--series-4)]",
  },
  failed: { label: "Failed", style: "bg-[color-mix(in_srgb,var(--bad)_12%,transparent)] text-bad" },
  canceled: { label: "Canceled", style: "bg-pressed text-fg-subtle" },
};

const when = (d: Date) =>
  d.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  }) + " UTC";

function duration(start: Date | null, end: Date | null) {
  if (!start) return "–";
  const s = Math.round(((end ?? new Date()).getTime() - start.getTime()) / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

export default async function RunsPage() {
  const { workspace } = await requireWorkspace();
  const db = getDb();
  const [runs, estimate, config] = await Promise.all([
    listRuns(db, workspace.id),
    estimateWorkspaceRun(db, workspace.id),
    getTrackingConfig(db, workspace.id),
  ]);
  const active = runs.some((r) => r.status === "queued" || r.status === "running");

  return (
    <Page
      title="Runs"
      description={
        estimate.prompts
          ? `A run asks ${estimate.prompts} active prompts on ${config.engines.length} engines: about ${estimate.answers.toLocaleString("en-US")} Bright Data answers`
          : "Each run asks every active prompt on every engine you track"
      }
      actions={
        estimate.prompts ? (
          <>
            <TestRunButton />
            <RunNowButton />
          </>
        ) : undefined
      }
    >
      <AutoRefresh active={active} />
      {runs.length === 0 ? (
        <EmptyState
          icon={<Clock />}
          title="No runs yet"
          description={
            estimate.prompts === 0
              ? "Add prompts first. Then runs go out on a schedule or when you press Run now, and each one is listed here with its progress and cost."
              : "Press Run now to ask every active prompt. Bright Data answers take a few minutes per engine; this page updates as they come in."
          }
          action={estimate.prompts === 0 ? { href: "/prompts", label: "Add prompts" } : undefined}
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="w-full min-w-[720px] text-left text-[13px]">
            <thead className="border-b border-line bg-hover text-xs text-fg-subtle">
              <tr>
                <th className="px-4 py-2 font-medium">Started</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Answers</th>
                <th className="px-4 py-2 font-medium">Took</th>
                <th className="px-4 py-2 font-medium">Cost (list price)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {runs.map((r) => {
                const s = STATUS[r.status];
                const pct = r.totalItems ? Math.round((r.doneItems / r.totalItems) * 100) : 0;
                return (
                  <tr key={r.id} className="align-top">
                    <td className="px-4 py-3">
                      {when(r.createdAt)}
                      <span className="block text-xs text-fg-subtle">
                        {r.trigger === "manual" ? "Run now" : "Scheduled"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn("rounded px-1.5 py-px text-[11px] font-medium", s.style)}>
                        {s.label}
                      </span>
                      {r.note && (
                        <span className="mt-1 block max-w-xs text-xs text-fg-subtle">{r.note}</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="tabular">
                        {r.doneItems.toLocaleString("en-US")} /{" "}
                        {r.totalItems.toLocaleString("en-US")}
                      </span>
                      <span className="mt-1.5 block h-1 w-28 overflow-hidden rounded-full bg-pressed">
                        <span
                          className="block h-full rounded-full bg-fg"
                          style={{ width: `${pct}%` }}
                        />
                      </span>
                    </td>
                    <td className="tabular px-4 py-3 text-fg-subtle">
                      {duration(r.startedAt, r.finishedAt)}
                    </td>
                    <td className="tabular px-4 py-3 text-fg-subtle">
                      ${Number(r.actualCost).toFixed(4)}
                      <span className="block text-xs">
                        est. ${Number(r.estimatedCost).toFixed(4)}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Page>
  );
}
