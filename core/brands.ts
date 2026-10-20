/**
 * A workspace's brand and competitors: read for onboarding, and saved from it.
 *
 * Onboarding sets up one brand per workspace (several brands, for agencies,
 * come later). Competitors are matched by name when saved, so renaming
 * nothing and adding one keeps every existing competitor's history; only a
 * competitor removed from the list is deleted, with its mentions.
 */

import { and, asc, eq, notInArray } from "drizzle-orm";
import type { AnyDb } from "@/db/client";
import { brandAliases, brands, competitors } from "@/db/schema";
import { reanalyzeBrand } from "./analysis";
import type { BrandSetup, CompetitorSetup } from "./brand-setup";

export type BrandWithCompetitors = {
  brand: (BrandSetup & { id: string }) | null;
  competitors: (CompetitorSetup & { id: string })[];
};

/** The workspace's first brand, with its aliases and competitors. */
export async function getBrandSetup(db: AnyDb, workspaceId: string): Promise<BrandWithCompetitors> {
  const [brand] = await db
    .select()
    .from(brands)
    .where(eq(brands.workspaceId, workspaceId))
    .orderBy(asc(brands.createdAt))
    .limit(1);
  if (!brand) return { brand: null, competitors: [] };

  const [aliasRows, competitorRows] = await Promise.all([
    db
      .select({ alias: brandAliases.alias })
      .from(brandAliases)
      .where(eq(brandAliases.brandId, brand.id)),
    db
      .select()
      .from(competitors)
      .where(eq(competitors.brandId, brand.id))
      .orderBy(asc(competitors.createdAt), asc(competitors.name)),
  ]);

  return {
    brand: {
      id: brand.id,
      name: brand.name,
      description: brand.description,
      category: brand.category ?? "",
      audience: brand.audience,
      domains: brand.domains,
      aliases: aliasRows.map((a) => a.alias),
    },
    competitors: competitorRows.map((c) => ({
      id: c.id,
      name: c.name,
      domains: c.domains,
      aliases: c.aliases,
    })),
  };
}

/** Create the workspace's brand, or update it. Returns the brand's ID. */
export async function saveBrand(
  db: AnyDb,
  workspaceId: string,
  input: BrandSetup,
): Promise<string> {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: brands.id })
      .from(brands)
      .where(eq(brands.workspaceId, workspaceId))
      .orderBy(asc(brands.createdAt))
      .limit(1);

    const values = {
      name: input.name,
      description: input.description,
      category: input.category,
      audience: input.audience,
      domains: input.domains,
    };
    const brandId = existing
      ? (await tx.update(brands).set(values).where(eq(brands.id, existing.id)).returning())[0].id
      : (
          await tx
            .insert(brands)
            .values({ workspaceId, ...values })
            .returning()
        )[0].id;

    await tx.delete(brandAliases).where(eq(brandAliases.brandId, brandId));
    if (input.aliases.length)
      await tx.insert(brandAliases).values(input.aliases.map((alias) => ({ brandId, alias })));
    // names may have changed: find mentions in past answers again
    if (existing) await reanalyzeBrand(tx, brandId);
    return brandId;
  });
}

/**
 * Make the brand's competitors exactly this list. Existing ones (same name,
 * any case) are updated in place and keep their history.
 */
export async function saveCompetitors(db: AnyDb, brandId: string, list: CompetitorSetup[]) {
  await db.transaction(async (tx) => {
    const existing = await tx
      .select({ id: competitors.id, name: competitors.name })
      .from(competitors)
      .where(eq(competitors.brandId, brandId));
    const byName = new Map(existing.map((c) => [c.name.toLowerCase(), c.id]));

    const kept: string[] = [];
    // rows inserted in one transaction share now(); a millisecond apart keeps the order they were entered
    const base = Date.now();
    for (const [i, c] of list.entries()) {
      const id = byName.get(c.name.toLowerCase());
      const values = { name: c.name, aliases: c.aliases, domains: c.domains };
      if (id) {
        await tx.update(competitors).set(values).where(eq(competitors.id, id));
        kept.push(id);
      } else {
        const [row] = await tx
          .insert(competitors)
          .values({ brandId, ...values, createdAt: new Date(base + i) })
          .returning();
        kept.push(row.id);
      }
    }

    await tx
      .delete(competitors)
      .where(
        kept.length
          ? and(eq(competitors.brandId, brandId), notInArray(competitors.id, kept))
          : eq(competitors.brandId, brandId),
      );
    await reanalyzeBrand(tx, brandId);
  });
}

/** Whether the workspace has set up a brand yet. */
export async function hasBrand(db: AnyDb, workspaceId: string) {
  const [row] = await db
    .select({ id: brands.id })
    .from(brands)
    .where(eq(brands.workspaceId, workspaceId))
    .limit(1);
  return Boolean(row);
}
