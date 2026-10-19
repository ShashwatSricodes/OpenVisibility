/**
 * Demo data: a workspace tracking the fictional "Ledgerly" invoicing app
 * against real competitors. Safe to re-run; existing rows are kept.
 *
 *   npm run db:seed
 *
 * With the embedded database, stop the dev server first: only one process
 * can open it at a time.
 */

import { and, eq } from "drizzle-orm";
import { getDb, prepareDb, type AnyDb } from "./client";
import { brandAliases, brands, competitors, prompts, workspaces } from "./schema";

const WORKSPACE = { name: "Demo workspace", defaultCountries: ["US", "IN"] };

const BRAND = {
  name: "Ledgerly",
  description: "Invoicing and GST billing software for freelancers and small agencies.",
  domains: ["ledgerly.app"],
  aliases: ["Ledgerly Invoicing", "Ledgerly.app"],
};

const COMPETITORS = [
  { name: "Zoho Invoice", aliases: ["Zoho"], domains: ["zoho.com"] },
  { name: "FreshBooks", aliases: [], domains: ["freshbooks.com"] },
  { name: "Wave", aliases: ["Wave Invoicing", "Wave Financial"], domains: ["waveapps.com"] },
  { name: "Refrens", aliases: [], domains: ["refrens.com"] },
  { name: "Invoice2go", aliases: [], domains: ["invoice2go.com"] },
];

const PROMPTS: { text: string; tags: string[]; countries?: string[] }[] = [
  { text: "What is the best invoicing software for freelancers?", tags: ["discovery"] },
  { text: "Free invoice generator with GST support", tags: ["discovery"], countries: ["IN"] },
  { text: "Ledgerly vs FreshBooks", tags: ["comparison"] },
  { text: "How do I send recurring invoices to clients?", tags: ["how-to"] },
  { text: "Invoicing app that accepts UPI payments", tags: ["features"], countries: ["IN"] },
  { text: "Alternatives to Zoho Invoice", tags: ["comparison"] },
  { text: "Best app to track unpaid invoices", tags: ["discovery"] },
  { text: "Multi-currency invoicing software for agencies", tags: ["features"] },
  { text: "Invoice software with built-in time tracking", tags: ["features"] },
  { text: "Is Ledgerly safe to use?", tags: ["brand"] },
];

/** Create or top up the demo data. Returns what the demo brand now has. */
export async function seed(db: AnyDb) {
  let [workspace] = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.name, WORKSPACE.name))
    .limit(1);
  if (!workspace) {
    [workspace] = await db.insert(workspaces).values(WORKSPACE).returning();
  }

  await db
    .insert(brands)
    .values({
      workspaceId: workspace.id,
      name: BRAND.name,
      description: BRAND.description,
      domains: BRAND.domains,
    })
    .onConflictDoNothing();
  const [brand] = await db
    .select()
    .from(brands)
    .where(and(eq(brands.workspaceId, workspace.id), eq(brands.name, BRAND.name)))
    .limit(1);

  await db
    .insert(brandAliases)
    .values(BRAND.aliases.map((alias) => ({ brandId: brand.id, alias })))
    .onConflictDoNothing();

  await db
    .insert(competitors)
    .values(COMPETITORS.map((c) => ({ ...c, brandId: brand.id })))
    .onConflictDoNothing();

  await db
    .insert(prompts)
    .values(
      PROMPTS.map((p) => ({
        brandId: brand.id,
        text: p.text,
        tags: p.tags,
        countries: p.countries ?? [],
      })),
    )
    .onConflictDoNothing();

  const competitorCount = (
    await db.select().from(competitors).where(eq(competitors.brandId, brand.id))
  ).length;
  const promptCount = (await db.select().from(prompts).where(eq(prompts.brandId, brand.id))).length;
  return { workspace, brand, competitors: competitorCount, prompts: promptCount };
}

async function main() {
  await prepareDb();
  const result = await seed(getDb());
  console.log(
    `Seeded "${result.workspace.name}" → ${result.brand.name}: ${result.competitors} competitors, ${result.prompts} prompts.`,
  );
  process.exit(0);
}

// run only when executed directly (npm run db:seed), not when imported by tests
if (process.argv[1]?.replace(/\\/g, "/").endsWith("db/seed.ts")) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
