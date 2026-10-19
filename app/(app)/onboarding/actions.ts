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
