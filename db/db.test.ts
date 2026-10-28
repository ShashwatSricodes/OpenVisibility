/**
 * Runs the real migrations and seed against PGlite: Postgres compiled to
 * WebAssembly, in memory. No Docker or database server needed.
 */

import { PGlite } from "@electric-sql/pglite";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import * as schema from "./schema";
import { seed } from "./seed";

const { answers, brands, citations, competitors, mentions, prompts, runItems, runs, workspaces } =
  schema;

let db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  db = drizzle(new PGlite(), { schema });
  await migrate(db, { migrationsFolder: "db/migrations" });
}, 60_000);

describe("migrations", () => {
  it("create every table", async () => {
    const result = await db.execute<{ table_name: string }>(
      sql`select table_name from information_schema.tables where table_schema = 'public' order by table_name`,
    );
    expect(result.rows.map((r) => r.table_name)).toEqual([
      "account",
      "annotations",
      "answers",
      "brand_aliases",
      "brands",
      "citations",
      "competitors",
      "content_briefs",
      "do_not_contact",
      "memberships",
      "mentions",
      "metrics_daily",
      "outreach_messages",
      "outreach_replies",
      "outreach_settings",
      "outreach_targets",
      "page_audits",
      "prompts",
      "provider_credentials",
      "run_items",
      "runs",
      "search_checks",
      "search_results",
      "session",
      "site_audits",
      "user",
      "verification",
      "workspaces",
    ]);
  });
});

describe("seed", () => {
  it("creates the demo brand, and re-running adds nothing", async () => {
    const first = await seed(db);
    expect(first).toMatchObject({ competitors: 5, prompts: 10 });
    const second = await seed(db);
    expect(second).toMatchObject({ competitors: 5, prompts: 10 });
    expect(second.brand.id).toBe(first.brand.id);
    expect(await db.select().from(workspaces)).toHaveLength(1);
  });
});

describe("results", () => {
  it("store exact costs and cascade when a brand is deleted", async () => {
    const [ws] = await db.insert(workspaces).values({ name: "Cascade test" }).returning();
    const [brand] = await db
      .insert(brands)
      .values({ workspaceId: ws.id, name: "Acme" })
      .returning();
    const [rival] = await db
      .insert(competitors)
      .values({ brandId: brand.id, name: "Rival" })
      .returning();
    const [prompt] = await db
      .insert(prompts)
      .values({ brandId: brand.id, text: "best acme alternative" })
      .returning();
    const [run] = await db
      .insert(runs)
      .values({ workspaceId: ws.id, brandId: brand.id, trigger: "manual" })
      .returning();
    const [item] = await db
      .insert(runItems)
      .values({
        runId: run.id,
        promptId: prompt.id,
        promptText: prompt.text,
        engine: "chatgpt",
        source: "consumer_app",
        country: "US",
      })
      .returning();
    const [answer] = await db
      .insert(answers)
      .values({ runItemId: item.id, text: "Try Acme or Rival.", costUsd: "0.0015" })
      .returning();
    await db.insert(mentions).values([
      { answerId: answer.id, position: 1 },
      { answerId: answer.id, competitorId: rival.id, position: 2 },
    ]);
    await db.insert(citations).values({
      answerId: answer.id,
      url: "https://acme.test/pricing",
      domain: "acme.test",
      kind: "owned",
    });

    // numeric(12,6) keeps fractions of a cent exactly
    expect(answer.costUsd).toBe("0.001500");

    // deleting the prompt keeps the run item, with its copy of the text
    await db.delete(prompts).where(eq(prompts.id, prompt.id));
    const [kept] = await db.select().from(runItems).where(eq(runItems.id, item.id));
    expect(kept.promptId).toBeNull();
    expect(kept.promptText).toBe("best acme alternative");

    // deleting the brand removes its runs and everything under them
    await db.delete(brands).where(eq(brands.id, brand.id));
    expect(await db.select().from(runs).where(eq(runs.id, run.id))).toHaveLength(0);
    expect(await db.select().from(answers).where(eq(answers.id, answer.id))).toHaveLength(0);
    expect(await db.select().from(mentions).where(eq(mentions.answerId, answer.id))).toHaveLength(
      0,
    );
  });
});
