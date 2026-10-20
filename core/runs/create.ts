/**
 * Starting a run: expand the workspace's setup into run items, one per
 * prompt × engine × country × sample. The worker (worker.ts) then works
 * through them. Prompt text is copied onto each item, so history stays
 * readable even if the prompt is later edited or deleted.
 */

import { and, asc, eq, inArray } from "drizzle-orm";
import type { AnyDb } from "@/db/client";
import { brands, prompts, runItems, runs } from "@/db/schema";
import { BRIGHT_DATA_PRICING, ENGINES } from "../providers/registry";
import type { EngineId } from "../providers/types";
import { capProblem, getBudget } from "../budget";
import { getTrackingConfig } from "../tracking-config";

export type CreateRunResult =
  { ok: true; runId: string; items: number } | { ok: false; message: string; runId?: string };

export const TEST_RUN = { prompts: 3, samples: 1 } as const;

/**
 * A cheap first run to check the key and setup: the first few active prompts,
 * on the first engine, in the first country, asked once (about 3 answers).
 */
export async function createTestRun(db: AnyDb, workspaceId: string): Promise<CreateRunResult> {
  const [brand] = await db
    .select({ id: brands.id })
    .from(brands)
    .where(eq(brands.workspaceId, workspaceId))
    .orderBy(asc(brands.createdAt))
    .limit(1);
  if (!brand) return { ok: false, message: "Set up your brand first." };
  const config = await getTrackingConfig(db, workspaceId);
  const first = await db
    .select({ id: prompts.id })
    .from(prompts)
    .where(and(eq(prompts.brandId, brand.id), eq(prompts.active, true)))
    .orderBy(asc(prompts.createdAt))
    .limit(TEST_RUN.prompts);
  return createRun(db, workspaceId, {
    promptIds: first.map((p) => p.id),
    engines: config.engines.slice(0, 1),
    countries: config.countries.slice(0, 1),
    samples: TEST_RUN.samples,
  });
}

/** A run is in progress while it's queued or running; only one at a time per workspace. */
export async function activeRun(db: AnyDb, workspaceId: string) {
  const [row] = await db
    .select({ id: runs.id, status: runs.status })
    .from(runs)
    .where(and(eq(runs.workspaceId, workspaceId), inArray(runs.status, ["queued", "running"])))
    .limit(1);
  return row ?? null;
}

export async function createRun(
  db: AnyDb,
  workspaceId: string,
  {
    trigger = "manual",
    promptIds,
    engines: onlyEngines,
    samples: samplesOverride,
    countries: countriesOverride,
  }: {
    trigger?: "manual" | "scheduled";
    /** run just these prompts (a test run); default every active prompt */
    promptIds?: string[];
    /** run just these engines; default the workspace's */
    engines?: EngineId[];
    /** ask each prompt this many times instead of the workspace's setting */
    samples?: number;
    /** ask in just these countries instead of each prompt's or the workspace's */
    countries?: string[];
  } = {},
): Promise<CreateRunResult> {
  const busy = await activeRun(db, workspaceId);
  if (busy)
    return {
      ok: false,
      message: "A run is already in progress. Wait for it to finish.",
      runId: busy.id,
    };

  const [brand] = await db
    .select({ id: brands.id })
    .from(brands)
    .where(eq(brands.workspaceId, workspaceId))
    .orderBy(asc(brands.createdAt))
    .limit(1);
  if (!brand) return { ok: false, message: "Set up your brand first." };

  const config = await getTrackingConfig(db, workspaceId);
  const engines = onlyEngines
    ? config.engines.filter((e) => onlyEngines.includes(e))
    : config.engines;
  if (!engines.length) return { ok: false, message: "No engines to ask. Pick some in Settings." };

  const chosen = await db
    .select({ id: prompts.id, text: prompts.text, countries: prompts.countries })
    .from(prompts)
    .where(
      and(
        eq(prompts.brandId, brand.id),
        eq(prompts.active, true),
        promptIds ? inArray(prompts.id, promptIds) : undefined,
      ),
    )
    .orderBy(asc(prompts.createdAt));
  if (!chosen.length) return { ok: false, message: "No active prompts to ask. Add some first." };

  const items = chosen.flatMap((p) =>
    engines.flatMap((engine) =>
      (countriesOverride ?? (p.countries.length ? p.countries : config.countries)).flatMap(
        (country) =>
          Array.from({ length: samplesOverride ?? config.samples }, (_, sampleIndex) => ({
            promptId: p.id,
            promptText: p.text,
            engine,
            source: ENGINES[engine].source,
            country,
            sampleIndex,
          })),
      ),
    ),
  );

  const over = capProblem(await getBudget(db, workspaceId), items.length);
  if (over) return { ok: false, message: over };

  const runId = await db.transaction(async (tx) => {
    const [run] = await tx
      .insert(runs)
      .values({
        workspaceId,
        brandId: brand.id,
        trigger,
        totalItems: items.length,
        // list price; the free tier is checked separately before starting
        estimatedCost: (items.length * BRIGHT_DATA_PRICING.perAnswerUsd).toFixed(6),
      })
      .returning({ id: runs.id });
    // inserted in chunks: a big workspace can fan out to thousands of items
    for (let i = 0; i < items.length; i += 500)
      await tx
        .insert(runItems)
        .values(items.slice(i, i + 500).map((it) => ({ ...it, runId: run.id })));
    return run.id;
  });

  return { ok: true, runId, items: items.length };
}
