import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import {
  brightDataSearch,
  googleUrl,
  keywordForm,
  mergeHits,
  parseSerp,
  queryForms,
  searchPending,
  searchStatus,
  topResults,
  type Search,
} from "./serp";

describe("searching Google for a prompt", () => {
  it("searches the question as asked and as people type it", () => {
    expect(keywordForm("What is the best invoicing software for freelancers?")).toBe(
      "best invoicing software for freelancers",
    );
    expect(keywordForm("Is there any free invoicing software that's actually good?")).toBe(
      "free invoicing software that's actually good",
    );
    expect(keywordForm("best invoicing app")).toBe("best invoicing app");
    expect(queryForms("best invoicing app")).toEqual(["best invoicing app"]);
    expect(googleUrl("best invoicing app", "DE")).toBe(
      "https://www.google.com/search?q=best+invoicing+app&hl=de&num=10&gl=de",
    );
    expect(googleUrl("x", "")).toBe("https://www.google.com/search?q=x&hl=en&num=10");
  });

  it("reads both response shapes Bright Data documents", () => {
    expect(
      parseSerp(
        JSON.stringify({
          organic: [
            { link: "https://b.com/2", title: "B", global_rank: 2 },
            { link: "https://a.com/1", title: "A", global_rank: 1 },
            { title: "no link" },
          ],
        }),
      ),
    ).toEqual([
      { url: "https://a.com/1", title: "A", position: 1 },
      { url: "https://b.com/2", title: "B", position: 2 },
    ]);
    expect(
      parseSerp({
        results: [
          { type: "ad", url: "https://ad.com" },
          { type: "organic", url: "https://c.com", position: 1 },
        ],
      }),
    ).toEqual([{ url: "https://c.com", title: null, position: 1 }]);
    expect(parseSerp("<html>blocked</html>")).toEqual([]);
  });

  it("asks the SERP API with the zone and the account's key", async () => {
    const sent: { url: string; init: RequestInit }[] = [];
    const search = brightDataSearch(
      async () => "key-123",
      "serp_zone",
      async (url, init) => {
        sent.push({ url: String(url), init: init! });
        return new Response(
          JSON.stringify({ organic: [{ link: "https://a.com", global_rank: 1 }] }),
        );
      },
    );
    expect(await search("best invoicing app", "US", "ws")).toEqual([
      { url: "https://a.com", title: null, position: 1 },
    ]);
    expect(sent[0].url).toBe("https://api.brightdata.com/request");
    expect((sent[0].init.headers as Record<string, string>).Authorization).toBe("Bearer key-123");
    expect(JSON.parse(String(sent[0].init.body))).toEqual({
      zone: "serp_zone",
      url: "https://www.google.com/search?q=best+invoicing+app&hl=en&num=10&gl=us",
      format: "raw",
      data_format: "parsed_light",
    });
    const failing = brightDataSearch(
      async () => "k",
      "z",
      async () => new Response("", { status: 401 }),
    );
    await expect(failing("q", "US", "ws")).rejects.toThrow("HTTP 401");
    await expect(brightDataSearch(async () => null, "z")("q", "US", "ws")).rejects.toThrow(
      "No Bright Data key",
    );
  });

  it("keeps each page once, at its best place across both searches", () => {
    const top = mergeHits([
      [
        { url: "https://www.a.com/x?utm_source=g", title: "A", position: 3 },
        { url: "https://b.com", title: "B", position: 1 },
      ],
      [
        { url: "https://a.com/x", title: null, position: 1 },
        { url: "https://c.com", title: "C", position: 2 },
      ],
    ]);
    expect(top.map((h) => [h.url, h.position, h.title])).toEqual([
      ["https://a.com/x", 1, "A"],
      ["https://b.com/", 2, "B"],
      ["https://c.com/", 3, "C"],
    ]);
  });
});

describe("the weekly search", () => {
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let workspaceId: string;

  beforeEach(async () => {
    db = drizzle(new PGlite(), { schema });
    await migrate(db, { migrationsFolder: "db/migrations" });
    [{ id: workspaceId }] = await db
      .insert(schema.workspaces)
      .values({ name: "Search", defaultCountries: ["US"] })
      .returning();
    const [b] = await db
      .insert(schema.brands)
      .values({ workspaceId, name: "Ledgerly", domains: ["ledgerly.app"] })
      .returning();
    await db.insert(schema.prompts).values([
      { brandId: b.id, text: "What is the best invoicing app?", createdAt: new Date(1) },
      { brandId: b.id, text: "invoice app with UPI", countries: ["IN"], createdAt: new Date(2) },
      { brandId: b.id, text: "paused", active: false, createdAt: new Date(3) },
    ]);
  }, 60_000);

  const asked: string[] = [];
  const google: Search = async (query, country) => {
    asked.push(`${country}:${query}`);
    return [
      { url: `https://${country.toLowerCase()}-guide.com/top`, title: "Guide", position: 1 },
      { url: "https://g2.com/invoicing", title: "G2", position: 2 },
    ];
  };

  it("searches each active prompt in its countries, then waits a week", async () => {
    const now = new Date("2026-10-21T00:00:00Z");
    asked.length = 0;
    expect(await searchPending(db, google, { limit: 10, now })).toEqual([workspaceId]);
    expect(asked.sort()).toEqual([
      "IN:invoice app with UPI",
      "US:What is the best invoicing app?",
      "US:best invoicing app",
    ]);
    const results = await topResults(db, workspaceId);
    expect(results.map((r) => [r.country, r.position, r.url]).sort()).toEqual([
      ["IN", 1, "https://in-guide.com/top"],
      ["IN", 2, "https://g2.com/invoicing"],
      ["US", 1, "https://us-guide.com/top"],
      ["US", 2, "https://g2.com/invoicing"],
    ]);
    // not due again until a week has passed; then the snapshot is replaced
    expect(
      await searchPending(db, google, { limit: 10, now: new Date(now.getTime() + 86_400_000) }),
    ).toEqual([]);
    expect(
      await searchPending(db, google, { limit: 10, now: new Date(now.getTime() + 8 * 86_400_000) }),
    ).toEqual([workspaceId]);
    expect(await topResults(db, workspaceId)).toHaveLength(4);
    expect((await searchStatus(db, workspaceId)).last).toEqual(
      new Date(now.getTime() + 8 * 86_400_000),
    );
  });

  it("records failures and tries again an hour later, not every tick", async () => {
    const now = new Date("2026-10-21T00:00:00Z");
    const broken: Search = async () => {
      throw new Error("Bright Data SERP API: HTTP 403");
    };
    expect(await searchPending(db, broken, { limit: 10, now })).toEqual([]);
    expect(await searchStatus(db, workspaceId)).toMatchObject({ failing: 2 });
    expect((await searchStatus(db, workspaceId)).error).toMatch(/HTTP 403/);
    asked.length = 0;
    await searchPending(db, google, { limit: 10, now: new Date(now.getTime() + 60_000) });
    expect(asked).toEqual([]);
    await searchPending(db, google, { limit: 10, now: new Date(now.getTime() + 2 * 3_600_000) });
    expect(asked.length).toBe(3);
    expect((await searchStatus(db, workspaceId)).failing).toBe(0);
  });
});
