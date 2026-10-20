/**
 * Finding mentions in stored answers. The worker runs analyzePending every
 * tick: any answer not analyzed yet (new, reused, or reset because the brand's
 * names changed) gets its mentions found and stored. Rerunning is safe: an
 * answer's mentions are replaced, never added twice.
 */

import { asc, eq, inArray, isNull } from "drizzle-orm";
import type { AnyDb } from "@/db/client";
import { answers, brandAliases, brands, competitors, mentions, runItems, runs } from "@/db/schema";
import { detectMentions, type Entity } from "./mentions";

/** The brand and its competitors, as detectMentions wants them, per brand id. */
export async function loadEntities(db: AnyDb, brandIds: string[]): Promise<Map<string, Entity[]>> {
  const out = new Map<string, Entity[]>();
  if (!brandIds.length) return out;
  const [brandRows, aliasRows, rivalRows] = await Promise.all([
    db
      .select({ id: brands.id, name: brands.name, domains: brands.domains })
      .from(brands)
      .where(inArray(brands.id, brandIds)),
    db
      .select({ brandId: brandAliases.brandId, alias: brandAliases.alias })
      .from(brandAliases)
      .where(inArray(brandAliases.brandId, brandIds)),
    db
      .select()
      .from(competitors)
      .where(inArray(competitors.brandId, brandIds))
      .orderBy(asc(competitors.createdAt)),
  ]);
  for (const b of brandRows)
    out.set(b.id, [
      {
        competitorId: null,
        name: b.name,
        aliases: aliasRows.filter((a) => a.brandId === b.id).map((a) => a.alias),
        domains: b.domains,
      },
      ...rivalRows
        .filter((c) => c.brandId === b.id)
        .map((c) => ({
          competitorId: c.id,
          name: c.name,
          aliases: c.aliases,
          domains: c.domains,
        })),
    ]);
  return out;
}

/** Analyze up to `limit` waiting answers; returns how many were done. */
export async function analyzePending(db: AnyDb, { limit = 200, now = new Date() } = {}) {
  const pending = await db
    .select({ id: answers.id, text: answers.text, brandId: runs.brandId })
    .from(answers)
    .innerJoin(runItems, eq(answers.runItemId, runItems.id))
    .innerJoin(runs, eq(runItems.runId, runs.id))
    .where(isNull(answers.analyzedAt))
    .limit(limit);
  if (!pending.length) return 0;

  const entities = await loadEntities(db, [...new Set(pending.map((p) => p.brandId))]);
  await db.transaction(async (tx) => {
    const ids = pending.map((p) => p.id);
    await tx.delete(mentions).where(inArray(mentions.answerId, ids));
    const rows = pending.flatMap((p) =>
      detectMentions(p.text, entities.get(p.brandId) ?? []).map((m) => ({
        answerId: p.id,
        competitorId: m.competitorId,
        position: m.position,
        snippet: m.snippet,
      })),
    );
    for (let i = 0; i < rows.length; i += 500)
      await tx.insert(mentions).values(rows.slice(i, i + 500));
    await tx.update(answers).set({ analyzedAt: now }).where(inArray(answers.id, ids));
  });
  return pending.length;
}

/** After a brand's names or competitors change, find its mentions again. */
export async function reanalyzeBrand(db: AnyDb, brandId: string) {
  const ids = db
    .select({ id: answers.id })
    .from(answers)
    .innerJoin(runItems, eq(answers.runItemId, runItems.id))
    .innerJoin(runs, eq(runItems.runId, runs.id))
    .where(eq(runs.brandId, brandId));
  await db.update(answers).set({ analyzedAt: null }).where(inArray(answers.id, ids));
}
