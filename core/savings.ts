/**
 * Ways to use fewer paid answers: reusing recent identical answers (the
 * cache) and smart sampling. Both are off until turned on in Settings.
 */

import { eq } from "drizzle-orm";
import type { AnyDb } from "@/db/client";
import { workspaces } from "@/db/schema";

export type SavingsSettings = {
  /** reuse answers this many hours old or newer; null: off */
  cacheHours: number | null;
  /** scheduled runs reuse answers too */
  cacheScheduled: boolean;
  smartSampling: boolean;
};

export const DEFAULT_CACHE_HOURS = 24;
export const MAX_CACHE_HOURS = 24 * 7;
/** smart sampling decides from this many samples, so it needs more than this to save anything */
export const SAMPLING_DECIDES_FROM = 2;

export function validateSavings(s: SavingsSettings): string | null {
  if (
    s.cacheHours !== null &&
    (!Number.isInteger(s.cacheHours) || s.cacheHours < 1 || s.cacheHours > MAX_CACHE_HOURS)
  )
    return `Reuse answers between 1 and ${MAX_CACHE_HOURS} hours old.`;
  return null;
}

export async function getSavings(db: AnyDb, workspaceId: string): Promise<SavingsSettings> {
  const [row] = await db
    .select({
      cacheHours: workspaces.cacheHours,
      cacheScheduled: workspaces.cacheScheduled,
      smartSampling: workspaces.smartSampling,
    })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId));
  if (!row) throw new Error(`No workspace ${workspaceId}`);
  return row;
}

export async function saveSavings(db: AnyDb, workspaceId: string, s: SavingsSettings) {
  await db.update(workspaces).set(s).where(eq(workspaces.id, workspaceId));
}
