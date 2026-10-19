import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { normalizeDomain, validateBrand, validateCompetitors } from "./brand-setup";
import { getBrandSetup, hasBrand, saveBrand, saveCompetitors } from "./brands";

describe("brand rules", () => {
  it("reduces pasted URLs to bare domains", () => {
    expect(normalizeDomain("https://www.Zoho.com/invoice?x=1")).toBe("zoho.com");
    expect(normalizeDomain("  freshbooks.com/ ")).toBe("freshbooks.com");
    expect(normalizeDomain("http://app.ledgerly.co.uk:8080")).toBe("app.ledgerly.co.uk");
  });

  it("cleans a brand: domains, duplicate names, its own name as an alias", () => {
    const r = validateBrand({
      name: " Ledgerly ",
      description: "",
      domains: ["https://ledgerly.app", "LEDGERLY.app", ""],
      aliases: ["Ledgerly", "Ledgerly.app", "ledgerly.APP", " "],
    });
    expect(r).toEqual({
      ok: true,
      value: {
        name: "Ledgerly",
        description: null,
        domains: ["ledgerly.app"],
        aliases: ["Ledgerly.app"],
      },
    });
  });

  it("explains what's wrong", () => {
    expect(validateBrand({ name: "", description: "", domains: [], aliases: [] })).toMatchObject({
      ok: false,
      message: "Give it a name.",
    });
    expect(
      validateBrand({ name: "X", description: "", domains: ["not a domain"], aliases: [] }),
    ).toMatchObject({ ok: false, message: /isn't a domain/ });
  });

  it("refuses the brand itself, or the same competitor twice", () => {
    const c = (name: string) => ({ name, domains: [], aliases: [] });
    expect(validateCompetitors("Ledgerly", [c("ledgerly")])).toMatchObject({
      ok: false,
      message: /your own brand/,
    });
    expect(validateCompetitors("Ledgerly", [c("Wave"), c("WAVE")])).toMatchObject({
      ok: false,
      message: /listed twice/,
    });
    expect(validateCompetitors("Ledgerly", [c("Wave"), c("Zoho")]).ok).toBe(true);
  });
});

describe("saving a brand and competitors", () => {
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let workspaceId: string;

  beforeAll(async () => {
    db = drizzle(new PGlite(), { schema });
    await migrate(db, { migrationsFolder: "db/migrations" });
    [{ id: workspaceId }] = await db
      .insert(schema.workspaces)
      .values({ name: "Brand test" })
      .returning();
  }, 60_000);

  it("starts with no brand", async () => {
    expect(await hasBrand(db, workspaceId)).toBe(false);
    expect(await getBrandSetup(db, workspaceId)).toEqual({ brand: null, competitors: [] });
  });

  it("saves a brand with three competitors, and reads them back", async () => {
    const brandId = await saveBrand(db, workspaceId, {
      name: "Ledgerly",
      description: "Invoicing for freelancers.",
      domains: ["ledgerly.app"],
      aliases: ["Ledgerly.app"],
    });
    await saveCompetitors(db, brandId, [
      { name: "Zoho Invoice", domains: ["zoho.com"], aliases: ["Zoho"] },
      { name: "FreshBooks", domains: ["freshbooks.com"], aliases: [] },
      { name: "Wave", domains: ["waveapps.com"], aliases: [] },
    ]);

    const setup = await getBrandSetup(db, workspaceId);
    expect(setup.brand).toMatchObject({ name: "Ledgerly", aliases: ["Ledgerly.app"] });
    expect(setup.competitors.map((c) => c.name)).toEqual(["Zoho Invoice", "FreshBooks", "Wave"]);
    expect(await hasBrand(db, workspaceId)).toBe(true);
  });

  it("updates the same brand instead of adding a second one", async () => {
    await saveBrand(db, workspaceId, {
      name: "Ledgerly Invoicing",
      description: null,
      domains: ["ledgerly.app"],
      aliases: [],
    });
    const rows = await db
      .select()
      .from(schema.brands)
      .where(eq(schema.brands.workspaceId, workspaceId));
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("Ledgerly Invoicing");
    expect((await getBrandSetup(db, workspaceId)).brand?.aliases).toEqual([]);
  });

  it("keeps competitors that stay on the list, with their history", async () => {
    const { brand, competitors } = await getBrandSetup(db, workspaceId);
    const wave = competitors.find((c) => c.name === "Wave")!;
    // a mention of Wave from an earlier run
    const [run] = await db
      .insert(schema.runs)
      .values({ workspaceId, brandId: brand!.id, trigger: "manual" })
      .returning();
    const [item] = await db
      .insert(schema.runItems)
      .values({ runId: run.id, promptText: "q", engine: "chatgpt", source: "consumer_app" })
      .returning();
    const [answer] = await db
      .insert(schema.answers)
      .values({ runItemId: item.id, text: "Wave" })
      .returning();
    await db.insert(schema.mentions).values({ answerId: answer.id, competitorId: wave.id });

    // drop FreshBooks, rename nothing, add Refrens; "wave" in another case is still Wave
    await saveCompetitors(db, brand!.id, [
      { name: "Zoho Invoice", domains: ["zoho.com"], aliases: ["Zoho"] },
      { name: "wave", domains: ["waveapps.com"], aliases: ["Wave Financial"] },
      { name: "Refrens", domains: ["refrens.com"], aliases: [] },
    ]);

    const after = await getBrandSetup(db, workspaceId);
    expect(after.competitors.map((c) => c.name).sort()).toEqual([
      "Refrens",
      "Zoho Invoice",
      "wave",
    ]);
    expect(after.competitors.find((c) => c.name === "wave")?.id).toBe(wave.id);
    const mentions = await db
      .select()
      .from(schema.mentions)
      .where(eq(schema.mentions.competitorId, wave.id));
    expect(mentions).toHaveLength(1);
  });

  it("can clear the list", async () => {
    const { brand } = await getBrandSetup(db, workspaceId);
    await saveCompetitors(db, brand!.id, []);
    expect((await getBrandSetup(db, workspaceId)).competitors).toEqual([]);
  });
});
