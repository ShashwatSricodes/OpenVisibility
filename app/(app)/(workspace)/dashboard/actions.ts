"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { requireWorkspace } from "@/core/auth/session";
import { validateNote } from "@/core/overview";
import { getDb } from "@/db/client";
import { annotations } from "@/db/schema";

export type NoteResult = { ok: true } | { ok: false; message: string };

/** Mark a day on the trend chart with what changed. */
export async function addNoteAction(day: string, text: string): Promise<NoteResult> {
  const { user, workspace } = await requireWorkspace();
  const problem = validateNote(day, text);
  if (problem) return { ok: false, message: problem };
  await getDb()
    .insert(annotations)
    .values({ workspaceId: workspace.id, day, text: text.trim(), createdBy: user.id });
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function deleteNoteAction(id: string): Promise<NoteResult> {
  const { workspace } = await requireWorkspace();
  await getDb()
    .delete(annotations)
    .where(and(eq(annotations.id, id), eq(annotations.workspaceId, workspace.id)));
  revalidatePath("/dashboard");
  return { ok: true };
}
