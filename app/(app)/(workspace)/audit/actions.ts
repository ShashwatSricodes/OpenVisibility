"use server";

import { revalidatePath } from "next/cache";
import { requireWorkspace } from "@/core/auth/session";
import { queueAudits } from "@/core/geo/audit";
import { getDb } from "@/db/client";

/** Queue an audit of every owned domain; the worker does the fetching. */
export async function runAuditAction(): Promise<{ ok: true } | { ok: false; message: string }> {
  const { workspace, role } = await requireWorkspace();
  if (role !== "owner")
    return { ok: false, message: "Only the workspace owner can run the audit." };
  const r = await queueAudits(getDb(), workspace.id);
  if (!r.ok) return r;
  revalidatePath("/audit");
  return { ok: true };
}
