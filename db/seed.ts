/**
 * Demo data: a workspace tracking the fictional "Ledgerly" invoicing app
 * against real competitors. Safe to re-run; existing rows are kept.
 *
 *   npm run db:seed
 */

import { and, eq } from "drizzle-orm";
import { getDb } from "./client";
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

async function main() {
  const db = getDb();

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

  const counts = {
    competitors: (await db.select().from(competitors).where(eq(competitors.brandId, brand.id)))
      .length,
    prompts: (await db.select().from(prompts).where(eq(prompts.brandId, brand.id))).length,
  };
  console.log(
    `Seeded "${workspace.name}" → ${BRAND.name}: ${counts.competitors} competitors, ${counts.prompts} prompts.`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
