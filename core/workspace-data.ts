/**
 * Read queries for the product pages. Every query is scoped to one
 * workspace, so a page can never show another workspace's rows.
 */

import { and, asc, count, desc, eq } from "drizzle-orm";
import type { AnyDb } from "@/db/client";
import { answers, brands, competitors, prompts, runItems, runs } from "@/db/schema";

export async function listBrands(db: AnyDb, workspaceId: string) {
  return db
    .select({ id: brands.id, name: brands.name, domains: brands.domains })
    .from(brands)
    .where(eq(brands.workspaceId, workspaceId))
    .orderBy(asc(brands.createdAt));
}

export async function listPrompts(db: AnyDb, workspaceId: string) {
  return db
    .select({
      id: prompts.id,
      text: prompts.text,
      tags: prompts.tags,
      countries: prompts.countries,
      active: prompts.active,
      brand: brands.name,
    })
    .from(prompts)
    .innerJoin(brands, eq(prompts.brandId, brands.id))
    .where(eq(brands.workspaceId, workspaceId))
    .orderBy(desc(prompts.active), asc(prompts.createdAt));
}

export async function listCompetitors(db: AnyDb, workspaceId: string) {
  return db
    .select({
      id: competitors.id,
      name: competitors.name,
      aliases: competitors.aliases,
      domains: competitors.domains,
      brand: brands.name,
    })
    .from(competitors)
    .innerJoin(brands, eq(competitors.brandId, brands.id))
    .where(eq(brands.workspaceId, workspaceId))
    .orderBy(asc(brands.name), asc(competitors.name));
}

/** How much tracking data the workspace has, to pick between a page and its empty state. */
export async function workspaceCounts(db: AnyDb, workspaceId: string) {
  const [[r], [a]] = await Promise.all([
    db.select({ n: count() }).from(runs).where(eq(runs.workspaceId, workspaceId)),
    db
      .select({ n: count() })
      .from(answers)
      .innerJoin(runItems, eq(answers.runItemId, runItems.id))
      .innerJoin(runs, and(eq(runItems.runId, runs.id), eq(runs.workspaceId, workspaceId))),
  ]);
  return { runs: r?.n ?? 0, answers: a?.n ?? 0 };
}
