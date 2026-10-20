import type { Metadata } from "next";
import Link from "next/link";
import { CalendarClock, ChevronRight, Clock } from "lucide-react";
import { requireWorkspace } from "@/core/auth/session";
import { BRIGHT_DATA_PRICING } from "@/core/providers/registry";
import { getSchedule } from "@/core/runs/schedule";
import { describeSchedule, formatInZone } from "@/core/schedule-rules";
import { getTrackingConfig } from "@/core/tracking-config";
import { estimateWorkspaceRun } from "@/core/usage";
import { listRuns } from "@/core/workspace-data";
import { getDb } from "@/db/client";
import { EmptyState, Page } from "../../_components/page-frame";
import { RunNowButton, TestRunButton } from "../../_components/run-now-button";
import { cn } from "../../_lib/cn";
import { AutoRefresh } from "./auto-refresh";
import { STATUS, duration, isActive, usd, visibleNote, when } from "./run-format";

export const metadata: Metadata = { title: "Runs" };

export default async function RunsPage() {
  const { workspace } = await requireWorkspace();
  const db = getDb();
  const [runs, estimate, config, schedule] = await Promise.all([
    listRuns(db, workspace.id),
    estimateWorkspaceRun(db, workspace.id),
    getTrackingConfig(db, workspace.id),
    getSchedule(db, workspace.id),
  ]);
  const active = runs.some((r) => isActive(r.status));

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
      {estimate.prompts > 0 && (
        <p className="-mt-2 mb-4 flex flex-wrap items-center gap-1.5 text-[13px] text-fg-subtle">
          <CalendarClock className="size-3.5 shrink-0" />
          {schedule.nextAt ? (
            <>
              Next run{" "}
              <span className="font-medium text-fg">
                {formatInZone(schedule.nextAt, schedule.timezone)}
              </span>
              <span>· {describeSchedule(schedule)}</span>
            </>
          ) : (
            <span>No schedule: runs start only when you press Run now.</span>
          )}
          <Link
            href="/settings"
            className="text-fg-default underline decoration-line-strong underline-offset-2 hover:text-fg"
          >
            {schedule.nextAt ? "Change" : "Set one up"}
          </Link>
        </p>
      )}
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
                <th className="px-4 py-2 font-medium">Cost</th>
                <th className="w-8" aria-label="Open" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {runs.map((r) => {
                const s = STATUS[r.status];
                const note = visibleNote(r);
                // samples smart sampling skipped were never going to be answered
                const total = r.totalItems - r.sampledOutItems;
                const pct = total ? Math.round((r.doneItems / total) * 100) : 0;
                const saved = r.reusedItems + r.sampledOutItems;
                const linked = r.status !== "skipped";
                return (
                  <tr key={r.id} className={cn("relative align-top", linked && "hover:bg-hover")}>
                    <td className="px-4 py-3">
                      {linked ? (
                        <Link
                          href={`/runs/${r.id}`}
                          className="font-medium after:absolute after:inset-0 hover:underline"
                        >
                          {when(r.createdAt)}
                        </Link>
                      ) : (
                        when(r.createdAt)
                      )}
                      <span className="block text-xs text-fg-subtle">
                        {r.trigger === "manual" ? "Run now" : "Scheduled"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn("rounded px-1.5 py-px text-[11px] font-medium", s.style)}>
                        {s.label}
                      </span>
                      {note && (
                        <span className="mt-1 block max-w-xs text-xs text-fg-subtle">{note}</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {total > 0 ? (
                        <>
                          <span className="tabular">
                            {r.doneItems.toLocaleString("en-US")} / {total.toLocaleString("en-US")}
                          </span>
                          {isActive(r.status) && (
                            <span className="mt-1.5 block h-1 w-28 overflow-hidden rounded-full bg-pressed">
                              <span
                                className="block h-full rounded-full bg-fg"
                                style={{ width: `${pct}%` }}
                              />
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="text-fg-subtle">–</span>
                      )}
                    </td>
                    <td className="tabular px-4 py-3 text-fg-subtle">
                      {duration(r.startedAt, r.finishedAt)}
                    </td>
                    <td className="tabular px-4 py-3 text-fg-subtle">
                      {isActive(r.status) ? (
                        <>
                          {usd(r.actualCost)}
                          <span className="block text-xs">of about {usd(r.estimatedCost)}</span>
                        </>
                      ) : (
                        usd(r.actualCost)
                      )}
                      {saved > 0 && (
                        <span className="block text-xs text-good">
                          saved {usd(saved * BRIGHT_DATA_PRICING.perAnswerUsd)}
                        </span>
                      )}
                    </td>
                    <td className="w-8 py-3 pr-3 text-fg-muted">
                      {linked && <ChevronRight className="size-4" />}
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
