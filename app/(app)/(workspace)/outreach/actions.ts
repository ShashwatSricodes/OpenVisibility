"use server";

import { revalidatePath } from "next/cache";
import { requireWorkspace } from "@/core/auth/session";
import { requestBrief } from "@/core/outreach/brief";
import {
  approve,
  block,
  saveMessage,
  saveSender,
  skipPitch,
  unapprove,
  unblock,
} from "@/core/outreach/pitch";
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

/* ── pitches (Day O2): nothing here sends; approval only marks a message sendable ── */

async function ownerAndUser() {
  const { workspace, role, user } = await requireWorkspace();
  return role === "owner" ? { ws: workspace.id, email: user.email } : null;
}

export async function saveSenderAction(form: {
  senderName: string;
  senderEmail: string;
  company: string;
  address: string;
  website: string;
  dailyCap: number;
}): Promise<Result> {
  const o = await ownerAndUser();
  if (!o) return { ok: false, message: "Only the workspace owner can do this." };
  await saveSender(getDb(), o.ws, form);
  revalidatePath("/outreach", "layout");
  return { ok: true, message: "Saved." };
}

export async function blockAction(value: string): Promise<Result> {
  const o = await ownerAndUser();
  if (!o) return { ok: false, message: "Only the workspace owner can do this." };
  const r = await block(getDb(), o.ws, value, "Added by you");
  revalidatePath("/outreach", "layout");
  return r.ok ? { ok: true, message: `${r.value} won't be emailed.` } : r;
}

export async function unblockAction(id: string): Promise<Result> {
  const o = await ownerAndUser();
  if (!o) return { ok: false, message: "Only the workspace owner can do this." };
  await unblock(getDb(), o.ws, id);
  revalidatePath("/outreach", "layout");
  return { ok: true };
}

export async function saveMessageAction(
  id: string,
  edit: { to?: string; subject: string; body: string },
): Promise<Result> {
  const o = await ownerAndUser();
  if (!o) return { ok: false, message: "Only the workspace owner can do this." };
  const r = await saveMessage(getDb(), o.ws, id, edit);
  revalidatePath("/outreach", "layout");
  return r.ok
    ? { ok: true, message: r.unapproved ? "Saved. It needs approving again." : "Saved." }
    : r;
}

export async function approveAction(targetId: string): Promise<Result & { problems?: string[] }> {
  const o = await ownerAndUser();
  if (!o) return { ok: false, message: "Only the workspace owner can approve emails." };
  const r = await approve(getDb(), o.ws, targetId, o.email);
  revalidatePath("/outreach", "layout");
  return r.ok
    ? { ok: true, message: "Approved." }
    : { ok: false, message: "Not approved yet.", problems: r.problems };
}

export async function unapproveAction(targetId: string): Promise<Result> {
  const o = await ownerAndUser();
  if (!o) return { ok: false, message: "Only the workspace owner can do this." };
  await unapprove(getDb(), o.ws, targetId);
  revalidatePath("/outreach", "layout");
  return { ok: true, message: "Back to draft." };
}

export async function skipPitchAction(targetId: string): Promise<Result> {
  const o = await ownerAndUser();
  if (!o) return { ok: false, message: "Only the workspace owner can do this." };
  await skipPitch(getDb(), o.ws, targetId);
  revalidatePath("/outreach", "layout");
  return { ok: true };
}
