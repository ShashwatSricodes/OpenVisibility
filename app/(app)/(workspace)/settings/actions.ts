"use server";

import { revalidatePath } from "next/cache";
import { requireWorkspace } from "@/core/auth/session";
import { saveCap, validateCap } from "@/core/budget";
import { saveSchedule } from "@/core/runs/schedule";
import { saveSavings, validateSavings, type SavingsSettings } from "@/core/savings";
import { formatInZone, validateSchedule, type Schedule } from "@/core/schedule-rules";
import {
  deleteCredential,
  markVerified,
  resolveProviderKeys,
  saveCredential,
  testBrightDataKey,
  validateKeyShape,
} from "@/core/credentials";
import { ProviderError } from "@/core/providers";
import { saveTrackingConfig } from "@/core/tracking-config";
import { validateTrackingConfig } from "@/core/tracking-rules";
import { createKey, revokeKey } from "@/core/mcp/keys";
import { getDb } from "@/db/client";

export type KeyFormState = { ok: boolean; message: string } | null;

const OWNERS_ONLY: KeyFormState = {
  ok: false,
  message: "Only the workspace owner can change API keys.",
};

/** Test the pasted key, and save it only if Bright Data accepts it. */
export async function saveKeyAction(_prev: KeyFormState, form: FormData): Promise<KeyFormState> {
  const { user, workspace, role } = await requireWorkspace();
  if (role !== "owner") return OWNERS_ONLY;

  const key = String(form.get("key") ?? "").trim();
  const shape = validateKeyShape(key);
  if (shape) return { ok: false, message: shape };

  const problem = await testBrightDataKey(key);
  if (problem) return { ok: false, message: `${problem} The key wasn't saved.` };

  await saveCredential(getDb(), {
    workspaceId: workspace.id,
    key,
    userId: user.id,
    verified: true,
  });
  revalidatePath("/settings");
  return { ok: true, message: "Key saved. Bright Data accepted it." };
}

/** Test whichever key this workspace's runs would use right now. */
export async function testKeyAction(): Promise<KeyFormState> {
  const { workspace } = await requireWorkspace();
  const db = getDb();
  try {
    const { keys, source } = await resolveProviderKeys(db, workspace.id);
    if (!source.brightData) return { ok: false, message: "There's no key to test yet." };
    const problem = await testBrightDataKey(keys.brightData!);
    if (problem) return { ok: false, message: problem };
    if (source.brightData === "workspace") await markVerified(db, workspace.id);
    revalidatePath("/settings");
    return {
      ok: true,
      message:
        source.brightData === "workspace"
          ? "Your key works."
          : "The server's key works. Add your own key to use your own Bright Data account.",
    };
  } catch (err) {
    if (err instanceof ProviderError) return { ok: false, message: err.message };
    throw err;
  }
}

export async function removeKeyAction(): Promise<KeyFormState> {
  const { workspace, role } = await requireWorkspace();
  if (role !== "owner") return OWNERS_ONLY;
  await deleteCredential(getDb(), workspace.id);
  revalidatePath("/settings");
  return { ok: true, message: "Key removed." };
}

/** Save which engines and countries the workspace tracks. */
export async function saveTrackingAction(input: {
  engines: string[];
  countries: string[];
  samples: number;
}): Promise<KeyFormState> {
  const { workspace, role } = await requireWorkspace();
  if (role !== "owner")
    return { ok: false, message: "Only the workspace owner can change what's tracked." };
  const checked = validateTrackingConfig(input);
  if (!checked.ok) return { ok: false, message: checked.message };
  await saveTrackingConfig(getDb(), workspace.id, checked.config);
  revalidatePath("/settings");
  return { ok: true, message: "Saved. The next run uses these engines and countries." };
}

/** Set or clear the monthly answer limit. */
export async function saveCapAction(cap: number | null): Promise<KeyFormState> {
  const { workspace, role } = await requireWorkspace();
  if (role !== "owner")
    return { ok: false, message: "Only the workspace owner can change the limit." };
  const problem = validateCap(cap);
  if (problem) return { ok: false, message: problem };
  await saveCap(getDb(), workspace.id, cap);
  revalidatePath("/settings");
  return {
    ok: true,
    message:
      cap === null
        ? "Limit removed."
        : `Limit set to ${cap.toLocaleString("en-US")} answers a month.`,
  };
}

/** Turn automatic runs on or off, or move them. */
export async function saveScheduleAction(input: Schedule): Promise<KeyFormState> {
  const { workspace, role } = await requireWorkspace();
  if (role !== "owner")
    return { ok: false, message: "Only the workspace owner can change the schedule." };
  const problem = validateSchedule(input);
  if (problem) return { ok: false, message: problem };
  const next = await saveSchedule(getDb(), workspace.id, input);
  revalidatePath("/settings");
  revalidatePath("/runs");
  return {
    ok: true,
    message: next
      ? `Saved. Next run ${formatInZone(next, input.timezone)}.`
      : "Saved. Runs only start when you press Run now.",
  };
}

/** Answer reuse and smart sampling. */
export async function saveSavingsAction(input: SavingsSettings): Promise<KeyFormState> {
  const { workspace, role } = await requireWorkspace();
  if (role !== "owner") return { ok: false, message: "Only the workspace owner can change this." };
  const problem = validateSavings(input);
  if (problem) return { ok: false, message: problem };
  await saveSavings(getDb(), workspace.id, input);
  revalidatePath("/settings");
  return { ok: true, message: "Saved. The next run uses these settings." };
}

/* ── API keys for the MCP server (core/mcp/keys.ts) ───────── */

export async function createApiKeyAction(form: {
  name: string;
  access: "read" | "write";
}): Promise<{ ok: true; key: string } | { ok: false; message: string }> {
  const { workspace, role, user } = await requireWorkspace();
  if (role !== "owner")
    return { ok: false, message: "Only the workspace owner can create API keys." };
  const r = await createKey(getDb(), workspace.id, { ...form, createdBy: user.email });
  revalidatePath("/settings");
  return r.ok ? { ok: true, key: r.key } : r;
}

export async function revokeApiKeyAction(id: string): Promise<{ ok: boolean; message?: string }> {
  const { workspace, role } = await requireWorkspace();
  if (role !== "owner")
    return { ok: false, message: "Only the workspace owner can revoke API keys." };
  await revokeKey(getDb(), workspace.id, id);
  revalidatePath("/settings");
  return { ok: true };
}
