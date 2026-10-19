import type { Metadata } from "next";
import { Clock } from "lucide-react";
import { requireWorkspace } from "@/core/auth/session";
import { getTrackingConfig } from "@/core/tracking-config";
import { estimateWorkspaceRun } from "@/core/usage";
import { workspaceCounts } from "@/core/workspace-data";
import { getDb } from "@/db/client";
import { EmptyState, Page } from "../../_components/page-frame";

export const metadata: Metadata = { title: "Runs" };

export default async function RunsPage() {
  const { workspace } = await requireWorkspace();
  const db = getDb();
  const [counts, estimate, config] = await Promise.all([
    workspaceCounts(db, workspace.id),
    estimateWorkspaceRun(db, workspace.id),
    getTrackingConfig(db, workspace.id),
  ]);

  return (
    <Page title="Runs" description="Each run asks every active prompt on every engine you track">
      <EmptyState
        icon={<Clock />}
        title={counts.runs ? `${counts.runs} runs` : "No runs yet"}
        description={
          estimate.prompts === 0
            ? "Add prompts first. Then runs go out on a schedule or when you press Run now, and each one is listed here with its progress and cost."
            : `When runs start, each one is listed here with its progress and cost. A run of your ${estimate.prompts} active prompts on ${config.engines.length} engines uses about ${estimate.answers.toLocaleString("en-US")} Bright Data answers.`
        }
        action={{ href: "/settings", label: "Check usage and settings" }}
        secondary={estimate.prompts === 0 ? undefined : { href: "/prompts", label: "See prompts" }}
      />
    </Page>
  );
}
