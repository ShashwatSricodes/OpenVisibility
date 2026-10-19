import { PGlite } from "@electric-sql/pglite";
import { MockLanguageModelV4 } from "ai/test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it, vi } from "vitest";
import * as schema from "@/db/schema";
import { isBranded, withAutoTags } from "./prompt-rules";
import { suggestPrompts, templateSuggestions, type SuggestContext } from "./prompt-suggest";
import { addPrompts, deletePrompts, listBrandPrompts, updatePrompt } from "./prompts";

const ctx: SuggestContext = {
  brand: "Ledgerly",
  aliases: ["Ledgerly.app"],
  category: "invoicing software",
  audience: "freelancers",
  description: "Invoicing and GST billing for freelancers.",
  competitors: ["Zoho Invoice", "FreshBooks", "Wave"],
};

describe("tagging", () => {
  it("spots the brand as a word, in any case, and not inside other words", () => {
    expect(isBranded("Is ledgerly any good?", ["Ledgerly"])).toBe(true);
    expect(isBranded("ledgerly.app reviews", ["Ledgerly.app"])).toBe(true);
    expect(isBranded("Ledgerlyx vs Wave", ["Ledgerly"])).toBe(false);
    expect(isBranded("best invoicing software", ["Ledgerly"])).toBe(false);
  });

  it("keeps the branded tag in step with the text", () => {
    expect(withAutoTags("Is Ledgerly good?", ["Reviews", "non-branded"], ["Ledgerly"])).toEqual([
      "reviews",
      "branded",
    ]);
  });
});

describe("template suggestions", () => {
  it("writes about 20 prompts, mostly non-branded, naming the competitors", () => {
    const s = templateSuggestions(ctx);
    expect(s.length).toBeGreaterThanOrEqual(15);
    expect(s.length).toBeLessThanOrEqual(20);
    const branded = s.filter((p) => p.tags.includes("branded")).length;
    expect(branded).toBeGreaterThan(0);
    expect(branded).toBeLessThan(s.length / 2);
    expect(s.map((p) => p.text)).toContain("What is the best invoicing software for freelancers?");
    expect(s.map((p) => p.text)).toContain("Ledgerly vs FreshBooks: which is better?");
    expect(new Set(s.map((p) => p.text.toLowerCase())).size).toBe(s.length);
    // no "a invoicing software" or "a free invoicing software"
    expect(s.some((p) => /\ban? (free )?invoicing software\b/i.test(p.text))).toBe(false);
  });

  it("works with no audience or competitors", () => {
    const s = templateSuggestions({ ...ctx, audience: null, competitors: [] });
    expect(s.length).toBeGreaterThanOrEqual(10);
    expect(s.some((p) => p.text.includes("undefined"))).toBe(false);
  });
});

describe("suggestPrompts", () => {
  const usage = {
    inputTokens: { total: 300, noCache: 300, cacheRead: undefined, cacheWrite: undefined },
    outputTokens: { total: 400, text: 400, reasoning: undefined },
  };
  const modelReturning = (json: unknown) =>
    new MockLanguageModelV4({
      doGenerate: async () => ({
        content: [{ type: "text", text: JSON.stringify(json) }],
        finishReason: { unified: "stop", raw: undefined },
        usage,
        warnings: [],
      }),
    });

  it("uses templates when there's no model", async () => {
    const r = await suggestPrompts(ctx, null);
    expect(r.source).toBe("templates");
  });

  it("uses the model's prompts, tagged and cleaned", async () => {
    const prompts = [
      { text: "best   invoicing app for freelance designers", intent: "discovery" },
      { text: "Ledgerly or Wave for a two-person agency?", intent: "comparison" },
      { text: "how to send GST invoices", intent: "how-to" },
      { text: "Best invoicing app for freelance designers", intent: "discovery" },
      { text: "is Ledgerly safe", intent: "reviews" },
      { text: "invoicing tools that take UPI", intent: "discovery" },
    ];
    vi.spyOn(console, "info").mockImplementation(() => {});
    const r = await suggestPrompts(ctx, modelReturning({ prompts }));
    expect(r.source).toBe("ai");
    expect(r.suggestions).toHaveLength(5); // the duplicate is dropped
    expect(r.suggestions[0]).toEqual({
      text: "best invoicing app for freelance designers",
      tags: ["discovery", "non-branded"],
    });
    expect(r.suggestions[1].tags).toEqual(["comparison", "branded"]);
  });

  it("falls back to templates when the model fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const broken = new MockLanguageModelV4({
      doGenerate: async () => {
        throw new Error("gateway down");
      },
    });
    const r = await suggestPrompts(ctx, broken);
    expect(r.source).toBe("templates");
    expect(r.note).toMatch(/couldn't be reached/);
    expect(r.suggestions.length).toBeGreaterThan(10);
  });
});

describe("prompt manager", () => {
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let workspaceId: string;
  let otherWorkspaceId: string;
  let brandId: string;

  beforeAll(async () => {
    db = drizzle(new PGlite(), { schema });
    await migrate(db, { migrationsFolder: "db/migrations" });
    [{ id: workspaceId }, { id: otherWorkspaceId }] = await db
      .insert(schema.workspaces)
      .values([{ name: "Mine" }, { name: "Someone else's" }])
      .returning();
    [{ id: brandId }] = await db
      .insert(schema.brands)
      .values({ workspaceId, name: "Ledgerly" })
      .returning();
  }, 60_000);

  it("adds prompts in order, tagged, skipping ones already tracked", async () => {
    const first = await addPrompts(db, brandId, templateSuggestions(ctx).slice(0, 12));
    expect(first).toEqual({ ok: true, value: { added: 12, skipped: 0 } });
    const again = await addPrompts(db, brandId, [
      { text: "WHAT IS THE BEST INVOICING SOFTWARE?" },
      { text: "Invoice apps with UPI", countries: ["in", "XX"] },
    ]);
    expect(again).toEqual({ ok: true, value: { added: 1, skipped: 1 } });

    const rows = await listBrandPrompts(db, brandId);
    expect(rows).toHaveLength(13);
    expect(rows[0].text).toBe("What is the best invoicing software?");
    expect(rows.at(-1)).toMatchObject({ countries: ["IN"], tags: ["non-branded"] });
  });

  it("refuses a prompt that isn't a question at all", async () => {
    expect(await addPrompts(db, brandId, [{ text: "a" }])).toMatchObject({ ok: false });
  });

  it("edits text and re-tags it, pauses, and refuses duplicates", async () => {
    const [p] = await listBrandPrompts(db, brandId);
    expect(
      await updatePrompt(db, workspaceId, p.id, {
        text: "Is Ledgerly the best invoicing software?",
      }),
    ).toEqual({ ok: true, value: undefined });
    const [after] = await db.select().from(schema.prompts).where(eq(schema.prompts.id, p.id));
    expect(after.tags).toContain("branded");

    await updatePrompt(db, workspaceId, p.id, { active: false });
    const [paused] = await db.select().from(schema.prompts).where(eq(schema.prompts.id, p.id));
    expect(paused.active).toBe(false);

    const rows = await listBrandPrompts(db, brandId);
    expect(await updatePrompt(db, workspaceId, rows[1].id, { text: rows[2].text })).toMatchObject({
      ok: false,
      message: /already track/,
    });
  });

  it("won't let another workspace touch these prompts", async () => {
    const [p] = await listBrandPrompts(db, brandId);
    expect(await updatePrompt(db, otherWorkspaceId, p.id, { active: true })).toMatchObject({
      ok: false,
    });
    expect(await deletePrompts(db, otherWorkspaceId, [p.id])).toBe(0);
    expect(await deletePrompts(db, workspaceId, [p.id])).toBe(1);
    expect(await listBrandPrompts(db, brandId)).toHaveLength(12);
  });
});
