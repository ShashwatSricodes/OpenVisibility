import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import * as schema from "@/db/schema";
import { checkFreeTier, daysLeftInMonth, estimateRun, monthWindow } from "./estimate";
import { saveCredential } from "./credentials";
import { accountAnswersThisMonth, estimateWorkspaceRun, getFreeTierUsage } from "./usage";

const NOW = new Date("2026-10-19T12:00:00Z");

describe("estimate", () => {
  const config = { engines: ["chatgpt", "gemini"] as const, countries: ["US", "IN"] };

  it("counts engines × countries × samples for each prompt, honouring a prompt's own countries", () => {
    const e = estimateRun([{ countries: [] }, { countries: ["IN"] }], {
      engines: [...config.engines],
      countries: config.countries,
    });
    // 2 engines × 2 countries × 3 + 2 engines × 1 country × 3
    expect(e).toEqual({ prompts: 2, answers: 18 });
  });

  it("checks a run against what's left of the free tier", () => {
    expect(checkFreeTier(100, 4_800, 5_000)).toMatchObject({
      remaining: 200,
      after: 100,
      fits: true,
      overBy: 0,
    });
    expect(checkFreeTier(300, 4_800, 5_000)).toMatchObject({
      fits: false,
      overBy: 100,
      costUsd: 0.15,
    });
    expect(checkFreeTier(10, 6_000, 5_000)).toMatchObject({ remaining: 0, overBy: 10 });
  });

  it("knows when the month resets", () => {
    expect(monthWindow(NOW).start.toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(monthWindow(NOW).resetsAt.toISOString()).toBe("2026-11-01T00:00:00.000Z");
    expect(daysLeftInMonth(NOW)).toBe(13);
    expect(daysLeftInMonth(new Date("2026-12-31T23:00:00Z"))).toBe(1);
  });
});

describe("accountAnswersThisMonth", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("adds up what Bright Data delivered this month across scrapers, and caches it", async () => {
    const fetch = vi.fn(async (url: string) => {
      expect(url).toContain(`from_date=${encodeURIComponent("2026-10-01T00:00:00.000Z")}`);
      if (url.includes("gd_m7aof0k82r803d5bjm"))
        return Response.json([
          { id: "a", created: "2026-10-18", dataset_size: 3 },
          { id: "b", created: "2026-10-19", dataset_size: 1 },
        ]);
      // an error-only snapshot has no size and isn't billed
      if (url.includes("gd_m7dhdot1vw9a7gc1n"))
        return Response.json([{ id: "c", created: "2026-10-19", errors: 1 }]);
      if (url.includes("gd_mfz5x93lmsjjjylob")) return new Response("not found", { status: 404 });
      return Response.json([{ id: "d", created: "2026-10-02", dataset_size: 2 }]);
    });
    vi.stubGlobal("fetch", fetch);

    // 4 + 0 + 0 + 2 × 3 other scrapers
    expect(await accountAnswersThisMonth("key-one-for-caching-test", NOW)).toBe(10);
    const calls = fetch.mock.calls.length;
    expect(await accountAnswersThisMonth("key-one-for-caching-test", NOW)).toBe(10);
    expect(fetch.mock.calls.length).toBe(calls);
  });
});

describe("getFreeTierUsage", () => {
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let workspaceId: string;

  beforeAll(async () => {
    db = drizzle(new PGlite(), { schema });
    await migrate(db, { migrationsFolder: "db/migrations" });
    [{ id: workspaceId }] = await db
      .insert(schema.workspaces)
      .values({ name: "Usage test", engines: ["chatgpt"], defaultCountries: ["US"] })
      .returning();
    const [brand] = await db
      .insert(schema.brands)
      .values({ workspaceId, name: "Acme" })
      .returning();
    const [prompt] = await db
      .insert(schema.prompts)
      .values([
        { brandId: brand.id, text: "p1" },
        { brandId: brand.id, text: "p2", countries: ["IN", "GB"] },
        { brandId: brand.id, text: "paused", active: false },
      ])
      .returning();
    const [run] = await db
      .insert(schema.runs)
      .values({ workspaceId, brandId: brand.id, trigger: "manual" })
      .returning();
    // three answers: billed this month, failed (free), billed last month
    const items = await db
      .insert(schema.runItems)
      .values(
        [0, 1, 2].map((i) => ({
          runId: run.id,
          promptId: prompt.id,
          promptText: "p1",
          engine: "chatgpt" as const,
          source: "consumer_app" as const,
          sampleIndex: i,
        })),
      )
      .returning();
    await db.insert(schema.answers).values([
      { runItemId: items[0].id, text: "a", costUsd: "0.0015", createdAt: NOW },
      { runItemId: items[1].id, text: "", costUsd: "0", createdAt: NOW },
      {
        runItemId: items[2].id,
        text: "old",
        costUsd: "0.0015",
        createdAt: new Date("2026-09-30T23:00:00Z"),
      },
    ]);
  }, 60_000);

  // tests don't load .env.local, so there's no server key here either
  it("says when there's no key at all", async () => {
    const u = await getFreeTierUsage(db, workspaceId, { now: NOW, countAccount: async () => 0 });
    expect(u).toMatchObject({ keySource: null, used: null, limit: 5_000 });
  });

  it("reports the account's usage and this workspace's billed answers this month", async () => {
    await saveCredential(db, { workspaceId, key: "0123456789abcdef0123456789abcdef" });
    const u = await getFreeTierUsage(db, workspaceId, {
      now: NOW,
      countAccount: async () => 1_348,
    });
    expect(u).toEqual({
      keySource: "workspace",
      used: 1_348,
      limit: 5_000,
      resetsAt: "2026-11-01T00:00:00.000Z",
      workspaceUsed: 1,
    });
  });

  it("keeps working when Bright Data can't be asked", async () => {
    const u = await getFreeTierUsage(db, workspaceId, {
      now: NOW,
      countAccount: async () => {
        throw new Error("network down");
      },
    });
    expect(u.used).toBeNull();
    expect(u.error).toMatch(/network down/);
  });

  it("estimates a run from the active prompts and the workspace's choices", async () => {
    // p1: 1 engine × 1 country × 3; p2: 1 engine × 2 own countries × 3; paused skipped
    expect(await estimateWorkspaceRun(db, workspaceId)).toEqual({ prompts: 2, answers: 9 });
  });
});
