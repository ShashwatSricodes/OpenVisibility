/**
 * Bright Data free-tier usage: 5,000 answers per account per month.
 *
 * The free tier belongs to a Bright Data account, not a workspace, so the
 * count comes from Bright Data itself (the records each snapshot delivered
 * this month), which includes answers asked outside OpenVisibility. It's
 * cached for a few minutes so page loads never strain Bright Data's rate
 * limit. The workspace's own share comes from the answers it stored.
 */

import { createHash } from "node:crypto";
import { and, eq, gt, gte, sql } from "drizzle-orm";
import type { AnyDb } from "@/db/client";
import { answers, brands, prompts, runItems, runs } from "@/db/schema";
import { resolveProviderKeys, type KeySource } from "./credentials";
import { estimateRun, monthWindow, type RunEstimate } from "./estimate";
import { BRIGHT_DATA_DATASETS, BrightDataClient } from "./providers/brightdata";
import { BRIGHT_DATA_PRICING } from "./providers/registry";
import { getTrackingConfig } from "./tracking-config";

const CACHE_MS = 5 * 60_000;

const cache = ((
  globalThis as unknown as { __ovUsage?: Map<string, { at: number; used: number }> }
).__ovUsage ??= new Map());

/** Answers this Bright Data account was billed for this month, across every scraper we use. */
export async function accountAnswersThisMonth(key: string, now = new Date()): Promise<number> {
  const { start } = monthWindow(now);
  // never keep the key itself as a cache key
  const id = `${createHash("sha256").update(key).digest("hex").slice(0, 16)}:${start.toISOString()}`;
  const hit = cache.get(id);
  if (hit && now.getTime() - hit.at < CACHE_MS) return hit.used;

  const client = new BrightDataClient(key);
  const ids = [...new Set(Object.values(BRIGHT_DATA_DATASETS).map((d) => d.datasetId))];
  const lists = await Promise.all(ids.map((d) => client.listSnapshots(d, start)));
  const used = lists.flat().reduce((sum, s) => sum + s.size, 0);
  cache.set(id, { at: now.getTime(), used });
  return used;
}

/** Answers this workspace stored this month that Bright Data billed for. */
export async function workspaceAnswersThisMonth(
  db: AnyDb,
  workspaceId: string,
  now = new Date(),
): Promise<number> {
  const { start } = monthWindow(now);
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(answers)
    .innerJoin(runItems, eq(answers.runItemId, runItems.id))
    .innerJoin(runs, eq(runItems.runId, runs.id))
    .where(
      and(
        eq(runs.workspaceId, workspaceId),
        eq(runItems.source, "consumer_app"),
        gt(answers.costUsd, "0"),
        gte(answers.createdAt, start),
      ),
    );
  return row?.n ?? 0;
}

export type FreeTierUsage = {
  /** whose Bright Data account the workspace uses */
  keySource: KeySource;
  /** answers the account used this month; null when Bright Data couldn't be asked */
  used: number | null;
  limit: number;
  /** ISO time of the next reset */
  resetsAt: string;
  /** this workspace's share of `used` */
  workspaceUsed: number;
  error?: string;
};

export async function getFreeTierUsage(
  db: AnyDb,
  workspaceId: string,
  {
    now = new Date(),
    countAccount = accountAnswersThisMonth,
  }: { now?: Date; countAccount?: typeof accountAnswersThisMonth } = {},
): Promise<FreeTierUsage> {
  const base = {
    limit: BRIGHT_DATA_PRICING.freeAnswersPerMonth,
    resetsAt: monthWindow(now).resetsAt.toISOString(),
    workspaceUsed: await workspaceAnswersThisMonth(db, workspaceId, now),
  };
  let keys, source;
  try {
    ({ keys, source } = await resolveProviderKeys(db, workspaceId));
  } catch (err) {
    return { ...base, keySource: "workspace", used: null, error: (err as Error).message };
  }
  if (!source.brightData) return { ...base, keySource: null, used: null };
  try {
    return {
      ...base,
      keySource: source.brightData,
      used: await countAccount(keys.brightData!, now),
    };
  } catch (err) {
    return {
      ...base,
      keySource: source.brightData,
      used: null,
      error: `Couldn't get usage from Bright Data: ${(err as Error).message}`,
    };
  }
}

/** What one run of this workspace's active prompts would use. */
export async function estimateWorkspaceRun(db: AnyDb, workspaceId: string): Promise<RunEstimate> {
  const [config, active] = await Promise.all([
    getTrackingConfig(db, workspaceId),
    db
      .select({ countries: prompts.countries })
      .from(prompts)
      .innerJoin(brands, eq(prompts.brandId, brands.id))
      .where(and(eq(brands.workspaceId, workspaceId), eq(prompts.active, true))),
  ]);
  return estimateRun(active, config);
}
