"use server";

import { revalidatePath } from "next/cache";
import { requireWorkspace } from "@/core/auth/session";
import { createKey, revokeKey } from "@/core/mcp/keys";
import { getDb } from "@/db/client";

/** A site key: it can only report visits, nothing else. */
export async function createSiteKeyAction(
  name: string,
): Promise<{ ok: true; key: string } | { ok: false; message: string }> {
  const { workspace, role, user } = await requireWorkspace();
  if (role !== "owner")
    return { ok: false, message: "Only the workspace owner can create site keys." };
  const r = await createKey(getDb(), workspace.id, {
    name: name || "Website",
    access: "ingest",
    createdBy: user.email,
  });
  revalidatePath("/traffic");
  return r.ok ? { ok: true, key: r.key } : r;
}

export async function revokeSiteKeyAction(id: string) {
  const { workspace, role } = await requireWorkspace();
  if (role !== "owner") return { ok: false };
  await revokeKey(getDb(), workspace.id, id);
  revalidatePath("/traffic");
  return { ok: true };
}
