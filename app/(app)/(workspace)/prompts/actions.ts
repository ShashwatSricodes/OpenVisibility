"use server";

import { revalidatePath } from "next/cache";
import { requireWorkspace } from "@/core/auth/session";
import { getBrandSetup } from "@/core/brands";
import { addPrompts, deletePrompts, updatePrompt } from "@/core/prompts";
import { getDb } from "@/db/client";

export type ActionResult = { ok: true } | { ok: false; message: string };

const OWNERS_ONLY = { ok: false as const, message: "Only the workspace owner can change prompts." };

export async function addPromptAction(text: string, countries: string[]): Promise<ActionResult> {
  const { workspace, role } = await requireWorkspace();
  if (role !== "owner") return OWNERS_ONLY;
  const db = getDb();
  const { brand } = await getBrandSetup(db, workspace.id);
  if (!brand) return { ok: false, message: "Set up your brand first." };
  const r = await addPrompts(db, brand.id, [{ text, countries }]);
  if (!r.ok) return r;
  if (r.value.added === 0) return { ok: false, message: "You already track that prompt." };
  revalidatePath("/prompts");
  return { ok: true };
}

export async function updatePromptAction(
  id: string,
  patch: { text?: string; countries?: string[]; active?: boolean },
): Promise<ActionResult> {
  const { workspace, role } = await requireWorkspace();
  if (role !== "owner") return OWNERS_ONLY;
  const r = await updatePrompt(getDb(), workspace.id, id, patch);
  if (!r.ok) return r;
  revalidatePath("/prompts");
  return { ok: true };
}

export async function deletePromptAction(id: string): Promise<ActionResult> {
  const { workspace, role } = await requireWorkspace();
  if (role !== "owner") return OWNERS_ONLY;
  await deletePrompts(getDb(), workspace.id, [id]);
  revalidatePath("/prompts");
  return { ok: true };
}
