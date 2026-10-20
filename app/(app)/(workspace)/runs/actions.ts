"use server";

import { revalidatePath } from "next/cache";
import { requireWorkspace } from "@/core/auth/session";
import { checkFreeTier } from "@/core/estimate";
import { createRun, createTestRun } from "@/core/runs/create";
import { estimateWorkspaceRun, getFreeTierUsage } from "@/core/usage";
import { getDb } from "@/db/client";

export type RunNowResult =
  | { ok: true; runId: string; items: number }
  | { ok: false; message: string }
  /** the run would go past the free tier: ask before spending */
  | { ok: false; confirm: string };

export async function runNowAction(force = false): Promise<RunNowResult> {
  const { workspace, role } = await requireWorkspace();
  if (role !== "owner") return { ok: false, message: "Only the workspace owner can start runs." };
  const db = getDb();

  if (!force) {
    const [estimate, usage] = await Promise.all([
      estimateWorkspaceRun(db, workspace.id),
      getFreeTierUsage(db, workspace.id),
    ]);
    if (!usage.keySource && process.env.OV_FAKE_ANSWERS !== "1")
      return { ok: false, message: "Add a Bright Data key in Settings first." };
    if (usage.used !== null) {
      const check = checkFreeTier(estimate.answers, usage.used, usage.limit);
      if (!check.fits)
        return {
          ok: false,
          confirm: `This run uses ${estimate.answers.toLocaleString("en-US")} answers, ${check.overBy.toLocaleString("en-US")} more than your free tier has left this month (about $${check.costUsd.toFixed(2)} at Bright Data's pay-as-you-go price). Run it anyway?`,
        };
    }
  }

  const r = await createRun(db, workspace.id);
  if (!r.ok) return { ok: false, message: r.message };
  revalidatePath("/", "layout");
  return { ok: true, runId: r.runId, items: r.items };
}

/** A cheap first run: 3 prompts, one engine and country, asked once. */
export async function testRunAction(): Promise<RunNowResult> {
  const { workspace, role } = await requireWorkspace();
  if (role !== "owner") return { ok: false, message: "Only the workspace owner can start runs." };
  const r = await createTestRun(getDb(), workspace.id);
  if (!r.ok) return { ok: false, message: r.message };
  revalidatePath("/", "layout");
  return { ok: true, runId: r.runId, items: r.items };
}
