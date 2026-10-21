"use server";

import { revalidatePath } from "next/cache";
import { requireWorkspace } from "@/core/auth/session";
import { requestBrief } from "@/core/outreach/brief";
import { setSkipped, syncTargets } from "@/core/outreach/targets";
import { getDb } from "@/db/client";

type Result = { ok: true; message?: string } | { ok: false; message: string };

async function owner() {
  const { workspace, role } = await requireWorkspace();
  return role === "owner" ? workspace.id : null;
}

/** Add the latest pages to get onto; the worker then researches them. */
export async function findTargetsAction(): Promise<Result> {
  const ws = await owner();
  if (!ws) return { ok: false, message: "Only the workspace owner can do this." };
  const r = await syncTargets(getDb(), ws);
  revalidatePath("/outreach");
  return {
    ok: true,
    message: r.total
      ? r.added
        ? `Added ${r.added} new ${r.added === 1 ? "page" : "pages"}.`
        : "No new pages; the numbers are updated."
      : "No pages to get onto yet: run your prompts first.",
  };
}

export async function skipTargetAction(id: string, skip: boolean): Promise<Result> {
  const ws = await owner();
  if (!ws) return { ok: false, message: "Only the workspace owner can do this." };
  await setSkipped(getDb(), ws, [id], skip);
  revalidatePath("/outreach");
  return { ok: true };
}

export async function requestBriefAction(promptId: string): Promise<Result> {
  const ws = await owner();
  if (!ws) return { ok: false, message: "Only the workspace owner can do this." };
  await requestBrief(getDb(), ws, promptId);
  revalidatePath(`/recommendations/brief/${promptId}`);
  return { ok: true };
}
