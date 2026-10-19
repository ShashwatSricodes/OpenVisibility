"use server";

import { revalidatePath } from "next/cache";
import { requireWorkspace } from "@/core/auth/session";
import {
  validateBrand,
  validateCompetitors,
  type BrandInput,
  type CompetitorInput,
} from "@/core/brand-setup";
import { getBrandSetup, saveBrand, saveCompetitors } from "@/core/brands";
import { suggestPrompts, type Suggestion } from "@/core/prompt-suggest";
import { addPrompts, listBrandPrompts, type PromptDraft } from "@/core/prompts";
import { checkFreeTier, daysLeftInMonth, type FreeTierCheck } from "@/core/estimate";
import { getTrackingConfig } from "@/core/tracking-config";
import { trackingWarnings, type TrackingConfig } from "@/core/tracking-rules";
import { estimateWorkspaceRun, getFreeTierUsage, type FreeTierUsage } from "@/core/usage";
import { getDb } from "@/db/client";

export type StepResult = { ok: true } | { ok: false; message: string };

const OWNERS_ONLY = { ok: false as const, message: "Only the workspace owner can change this." };

export async function saveBrandAction(input: BrandInput): Promise<StepResult> {
  const { workspace, role } = await requireWorkspace();
  if (role !== "owner") return OWNERS_ONLY;
  const checked = validateBrand(input);
  if (!checked.ok) return checked;
  await saveBrand(getDb(), workspace.id, checked.value);
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function saveCompetitorsAction(list: CompetitorInput[]): Promise<StepResult> {
  const { workspace, role } = await requireWorkspace();
  if (role !== "owner") return OWNERS_ONLY;
  const db = getDb();
  const { brand } = await getBrandSetup(db, workspace.id);
  if (!brand) return { ok: false, message: "Save your brand first." };
  const checked = validateCompetitors(brand.name, list);
  if (!checked.ok) return checked;
  await saveCompetitors(db, brand.id, checked.value);
  revalidatePath("/", "layout");
  return { ok: true };
}

export type SuggestionsResult =
  | {
      ok: true;
      suggestions: Suggestion[];
      source: "templates" | "ai";
      note?: string;
      /** prompts the brand already tracks; suggestions skip these */
      existing: number;
    }
  | { ok: false; message: string };

/** Suggest prompts for the brand, leaving out ones it already tracks. */
export async function suggestPromptsAction(): Promise<SuggestionsResult> {
  const { workspace } = await requireWorkspace();
  const db = getDb();
  const { brand, competitors } = await getBrandSetup(db, workspace.id);
  if (!brand) return { ok: false, message: "Save your brand first." };
  if (!brand.category)
    return { ok: false, message: "Add your brand's category in step 1 to get suggestions." };

  const [result, existing] = await Promise.all([
    suggestPrompts({
      brand: brand.name,
      aliases: brand.aliases,
      category: brand.category,
      audience: brand.audience,
      description: brand.description,
      competitors: competitors.map((c) => c.name),
    }),
    listBrandPrompts(db, brand.id),
  ]);
  const tracked = new Set(existing.map((p) => p.text.toLowerCase()));
  return {
    ok: true,
    suggestions: result.suggestions.filter((s) => !tracked.has(s.text.toLowerCase())),
    source: result.source,
    note: result.note,
    existing: existing.length,
  };
}

export async function savePromptsAction(
  drafts: PromptDraft[],
): Promise<{ ok: true; added: number; total: number } | { ok: false; message: string }> {
  const { workspace, role } = await requireWorkspace();
  if (role !== "owner") return OWNERS_ONLY;
  const db = getDb();
  const { brand } = await getBrandSetup(db, workspace.id);
  if (!brand) return { ok: false, message: "Save your brand first." };
  const r = await addPrompts(db, brand.id, drafts);
  if (!r.ok) return r;
  revalidatePath("/", "layout");
  return { ok: true, added: r.value.added, total: (await listBrandPrompts(db, brand.id)).length };
}

export type Review = {
  brand: { name: string; category: string; audience: string | null; domains: string[] };
  competitors: string[];
  prompts: { active: number; nonBranded: number };
  config: TrackingConfig;
  warnings: string[];
  answersPerRun: number;
  daysLeft: number;
  usage: FreeTierUsage;
  oneRun: FreeTierCheck | null;
  daily: FreeTierCheck | null;
};

/** Everything set up so far, and what a run will use, for the last step of setup. */
export async function reviewAction(): Promise<Review | null> {
  const { workspace } = await requireWorkspace();
  const db = getDb();
  const { brand, competitors } = await getBrandSetup(db, workspace.id);
  if (!brand) return null;
  const [prompts, config, usage, estimate] = await Promise.all([
    listBrandPrompts(db, brand.id),
    getTrackingConfig(db, workspace.id),
    getFreeTierUsage(db, workspace.id),
    estimateWorkspaceRun(db, workspace.id),
  ]);
  const active = prompts.filter((p) => p.active);
  const daysLeft = daysLeftInMonth();
  const used = usage.used;
  return {
    brand: {
      name: brand.name,
      category: brand.category,
      audience: brand.audience,
      domains: brand.domains,
    },
    competitors: competitors.map((c) => c.name),
    prompts: {
      active: active.length,
      nonBranded: active.filter((p) => p.tags.includes("non-branded")).length,
    },
    config,
    warnings: trackingWarnings(config),
    answersPerRun: estimate.answers,
    daysLeft,
    usage,
    oneRun: used === null ? null : checkFreeTier(estimate.answers, used, usage.limit),
    daily: used === null ? null : checkFreeTier(estimate.answers * daysLeft, used, usage.limit),
  };
}
