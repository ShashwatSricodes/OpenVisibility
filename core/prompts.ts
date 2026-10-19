/**
 * A brand's prompts: add, edit, pause and delete. Every function checks the
 * prompt belongs to the workspace, so one workspace can't touch another's.
 *
 * Deleting a prompt keeps its past answers: run items keep the prompt's text
 * (run_items.prompt_text) and only lose the link to it.
 */

import { and, asc, count, eq, inArray } from "drizzle-orm";
import type { AnyDb } from "@/db/client";
import { brandAliases, brands, prompts } from "@/db/schema";
import { isCountryCode } from "./countries";
import {
  MAX_PROMPTS_PER_BRAND,
  checkPromptText,
  cleanPromptText,
  withAutoTags,
} from "./prompt-rules";

export type PromptDraft = { text: string; tags?: string[]; countries?: string[] };

type Result<T = void> = { ok: true; value: T } | { ok: false; message: string };

/** The brand's name and other names, for tagging prompts branded or not. */
async function brandNames(db: AnyDb, brandId: string) {
  const [[brand], aliases] = await Promise.all([
    db.select({ name: brands.name }).from(brands).where(eq(brands.id, brandId)),
    db
      .select({ alias: brandAliases.alias })
      .from(brandAliases)
      .where(eq(brandAliases.brandId, brandId)),
  ]);
  return [brand?.name ?? "", ...aliases.map((a) => a.alias)];
}

function cleanCountries(list: string[] = []) {
  return [...new Set(list.map((c) => c.toUpperCase()))].filter(isCountryCode);
}

/** Add prompts, skipping ones the brand already has (same text, any case). Returns how many were added. */
export async function addPrompts(
  db: AnyDb,
  brandId: string,
  drafts: PromptDraft[],
): Promise<Result<{ added: number; skipped: number }>> {
  for (const d of drafts) {
    const problem = checkPromptText(d.text);
    if (problem) return { ok: false, message: `“${d.text.slice(0, 60)}”: ${problem}` };
  }
  const existing = await db
    .select({ text: prompts.text, createdAt: prompts.createdAt })
    .from(prompts)
    .where(eq(prompts.brandId, brandId));
  const seen = new Set(existing.map((p) => p.text.toLowerCase()));
  const names = await brandNames(db, brandId);

  const fresh = drafts
    .map((d) => ({ ...d, text: cleanPromptText(d.text) }))
    .filter((d) => {
      const key = d.text.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  if (existing.length + fresh.length > MAX_PROMPTS_PER_BRAND)
    return {
      ok: false,
      message: `A brand can track up to ${MAX_PROMPTS_PER_BRAND} prompts; this would make ${existing.length + fresh.length}.`,
    };

  if (fresh.length) {
    // a millisecond apart and after every existing prompt, so they list in the order they were added
    const newest = Math.max(0, ...existing.map((p) => p.createdAt.getTime()));
    const base = Math.max(Date.now(), newest + 1);
    await db.insert(prompts).values(
      fresh.map((d, i) => ({
        brandId,
        text: d.text,
        tags: withAutoTags(d.text, d.tags ?? [], names),
        countries: cleanCountries(d.countries),
        createdAt: new Date(base + i),
      })),
    );
  }
  return { ok: true, value: { added: fresh.length, skipped: drafts.length - fresh.length } };
}

/** Find a prompt only if it belongs to this workspace. */
async function ownedPrompt(db: AnyDb, workspaceId: string, promptId: string) {
  const [row] = await db
    .select({ id: prompts.id, brandId: prompts.brandId })
    .from(prompts)
    .innerJoin(brands, eq(prompts.brandId, brands.id))
    .where(and(eq(prompts.id, promptId), eq(brands.workspaceId, workspaceId)));
  return row ?? null;
}

export async function updatePrompt(
  db: AnyDb,
  workspaceId: string,
  promptId: string,
  patch: { text?: string; tags?: string[]; countries?: string[]; active?: boolean },
): Promise<Result> {
  const prompt = await ownedPrompt(db, workspaceId, promptId);
  if (!prompt) return { ok: false, message: "That prompt doesn't exist any more." };

  const set: Partial<typeof prompts.$inferInsert> = {};
  if (patch.text !== undefined) {
    const problem = checkPromptText(patch.text);
    if (problem) return { ok: false, message: problem };
    set.text = cleanPromptText(patch.text);
    const all = await db
      .select({ id: prompts.id, text: prompts.text })
      .from(prompts)
      .where(eq(prompts.brandId, prompt.brandId));
    if (all.some((p) => p.id !== promptId && p.text.toLowerCase() === set.text!.toLowerCase()))
      return { ok: false, message: "You already track that prompt." };
  }
  if (patch.text !== undefined || patch.tags !== undefined) {
    const [current] = await db
      .select({ text: prompts.text, tags: prompts.tags })
      .from(prompts)
      .where(eq(prompts.id, promptId));
    set.tags = withAutoTags(
      set.text ?? current.text,
      patch.tags ?? current.tags,
      await brandNames(db, prompt.brandId),
    );
  }
  if (patch.countries !== undefined) set.countries = cleanCountries(patch.countries);
  if (patch.active !== undefined) set.active = patch.active;

  if (Object.keys(set).length) await db.update(prompts).set(set).where(eq(prompts.id, promptId));
  return { ok: true, value: undefined };
}

export async function deletePrompts(db: AnyDb, workspaceId: string, promptIds: string[]) {
  if (!promptIds.length) return 0;
  const owned = await db
    .select({ id: prompts.id })
    .from(prompts)
    .innerJoin(brands, eq(prompts.brandId, brands.id))
    .where(and(inArray(prompts.id, promptIds), eq(brands.workspaceId, workspaceId)));
  if (!owned.length) return 0;
  await db.delete(prompts).where(
    inArray(
      prompts.id,
      owned.map((p) => p.id),
    ),
  );
  return owned.length;
}

export async function countPrompts(db: AnyDb, brandId: string) {
  const [row] = await db.select({ n: count() }).from(prompts).where(eq(prompts.brandId, brandId));
  return row?.n ?? 0;
}

export async function listBrandPrompts(db: AnyDb, brandId: string) {
  return db
    .select()
    .from(prompts)
    .where(eq(prompts.brandId, brandId))
    .orderBy(asc(prompts.createdAt));
}
