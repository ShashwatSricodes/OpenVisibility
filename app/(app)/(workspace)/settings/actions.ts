"use server";

import { revalidatePath } from "next/cache";
import { requireWorkspace } from "@/core/auth/session";
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
