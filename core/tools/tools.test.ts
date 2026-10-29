import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import type { Net } from "../geo/fetch";
import { ProviderError } from "../providers/errors";
import { FakeProvider } from "../providers/fake";
import { answersFor, costOf, marginOf } from "./calculator";
import { contentCheck, crawlabilityCheck, normalizeInput } from "./checks";
import { entityCheck, organizationOf } from "./entity";
import { PER_VISITOR_PER_DAY, pollFanOut, startFanOut, visitorOf } from "./fanout";

/** a website served without the network */
function web(
  pages: Record<string, string | { status: number; body?: string; type?: string }>,
): Net {
  return {
    resolve: async () => ["93.184.216.34"],
    fetch: async (url) => {
      const p = pages[url];
      if (p === undefined) return new Response("Not found", { status: 404 });
      if (typeof p === "string")
        return new Response(p, { headers: { "content-type": "text/html" } });
      return new Response(p.body ?? "", {
        status: p.status,
        headers: { "content-type": p.type ?? "text/html" },
      });
    },
  };
}

describe("the prompt calculator", () => {
  it("works out answers for a margin, and the margin of a plan", () => {
    expect(answersFor(0.05)).toBe(385); // the classic ±5 points at 95%
    expect(answersFor(0.1)).toBe(97);
    expect(answersFor(0.05, 0.1)).toBe(139); // rarer rates need fewer
    expect(marginOf(385)).toBeCloseTo(0.05, 3);
    expect(marginOf(0)).toBe(1);
    expect(costOf({ prompts: 20, engines: 4, countries: 1, samples: 3, runsPerMonth: 4 })).toEqual({
      perRun: 240,
      perMonth: 960,
      usd: 0,
      withinFreeTier: true,
      answersPerEngine: 240,
    });
    const big = costOf({ prompts: 100, engines: 5, countries: 2, samples: 3, runsPerMonth: 30 });
    expect(big.perMonth).toBe(90_000);
    expect(big.usd).toBeCloseTo((90_000 - 5_000) * 0.0015);
  });
});

describe("checking a URL", () => {
  it("takes addresses as people type them", () => {
    expect(normalizeInput("ledgerly.app/pricing")?.toString()).toBe("https://ledgerly.app/pricing");
    expect(normalizeInput("http://x.com/#top")?.toString()).toBe("http://x.com/");
    expect(normalizeInput("localhost")).toBeNull();
    expect(normalizeInput("ftp://x.com")).toBeNull();
    expect(normalizeInput("")).toBeNull();
  });

  const site = web({
    "https://ledgerly.app/robots.txt": {
      status: 200,
      type: "text/plain",
      body: "User-agent: OAI-SearchBot\nDisallow: /app\n\nUser-agent: GPTBot\nDisallow: /",
    },
    "https://ledgerly.app/app": `<div id="root"></div><script src="/b.js"></script>`,
    "https://ledgerly.app/pricing": `<title>Ledgerly pricing</title><h1>Ledgerly pricing</h1><h2>How much does it cost?</h2><h2>Is there a free plan?</h2><p>${"Ledgerly is nine dollars a month. ".repeat(80)}</p><ul><li>a</li><li>b</li><li>c</li></ul>`,
  });

  it("says which crawlers can read a page, and what stops them", async () => {
    const r = await crawlabilityCheck("ledgerly.app/app", site);
    if (!r.ok) throw new Error(r.message);
    const verdict = Object.fromEntries(r.crawlers.map((c) => [c.agent, c.allowed]));
    expect(verdict).toMatchObject({
      "OAI-SearchBot": false,
      GPTBot: false,
      ClaudeBot: true,
      Googlebot: true,
    });
    expect(r.issues.map((i) => [i.code, i.severity])).toEqual([
      ["blocked", "problem"],
      ["needs_js", "problem"],
      ["training", "note"],
    ]);
    expect(r).toMatchObject({ robots: "found", llmsTxt: false, words: 0 });
    expect(await crawlabilityCheck("not a url", site)).toMatchObject({ ok: false });
  });

  it("scores a page, leaving out the brand check when no brand is given", async () => {
    const without = await contentCheck("ledgerly.app/pricing", "", site);
    const withBrand = await contentCheck("ledgerly.app/pricing", "Ledgerly", site);
    if (!without.ok || !withBrand.ok) throw new Error();
    expect(without.checks.some((c) => c.id === "brand")).toBe(false);
    expect(withBrand.checks.find((c) => c.id === "brand")).toMatchObject({ points: 10 });
    expect(without.score).toBeGreaterThan(40);
    expect(without.fixes[0].id).toBe("schema");
    expect(await contentCheck("ledgerly.app/missing", "", site)).toMatchObject({
      ok: false,
      message: "Couldn't read the page (HTTP 404).",
    });
  });
});

describe("the brand entity check", () => {
  const home = `<title>Ledgerly — invoicing for freelancers</title><script type="application/ld+json">${JSON.stringify(
    {
      "@context": "https://schema.org",
      "@graph": [
        { "@type": "WebSite", url: "https://ledgerly.app" },
        {
          "@type": "Organization",
          name: "Ledgerly",
          logo: "https://ledgerly.app/logo.png",
          sameAs: ["https://www.linkedin.com/company/ledgerly", "https://x.com/ledgerly"],
        },
      ],
    },
  )}</script>`;

  it("reads Organization markup", () => {
    expect(organizationOf(home)).toEqual({
      name: "Ledgerly",
      logo: true,
      sameAs: ["https://www.linkedin.com/company/ledgerly", "https://x.com/ledgerly"],
    });
    expect(organizationOf("<p>no markup</p>")).toBeNull();
  });

  it("finds Wikipedia, the right Wikidata entry, and the site's own signals", async () => {
    const wiki = async (url: string) => {
      if (url.includes("en.wikipedia.org"))
        return { query: { search: [{ title: "Ledgerly", snippet: "" }] } };
      if (url.includes("wbsearchentities")) return { search: [{ id: "Q1" }, { id: "Q2" }] };
      return {
        entities: {
          // a namesake with another website, then the real one
          Q1: {
            labels: { en: { value: "Ledgerly" } },
            claims: { P856: [{ mainsnak: { datavalue: { value: "https://ledgerly.io" } } }] },
          },
          Q2: {
            labels: { en: { value: "Ledgerly" } },
            descriptions: { en: { value: "invoicing software" } },
            claims: { P856: [{ mainsnak: { datavalue: { value: "https://www.ledgerly.app/" } } }] },
          },
        },
      };
    };
    const r = await entityCheck(
      "Ledgerly",
      "ledgerly.app",
      web({ "https://ledgerly.app/": home }),
      wiki,
    );
    if (!r.ok) throw new Error(r.message);
    expect(r.checks.map((c) => [c.id, c.ok])).toEqual([
      ["wikipedia", true],
      ["wikidata", true],
      ["schema", true],
      ["sameas", true],
      ["title", true],
    ]);
    expect(r.checks[1].detail).toBe("Ledgerly (Q2): invoicing software.");
    expect(r.score).toBe(5);
  });

  it("says what's missing, and survives Wikipedia being down", async () => {
    const down = async () => {
      throw new Error("timeout");
    };
    const r = await entityCheck(
      "Ledgerly",
      "ledgerly.app",
      web({ "https://ledgerly.app/": "<title>Home</title>" }),
      down,
    );
    if (!r.ok) throw new Error();
    expect(r.checks.map((c) => [c.id, c.ok])).toEqual([
      ["wikipedia", false],
      ["wikidata", false],
      ["schema", false],
      ["sameas", false],
      ["title", false],
    ]);
    expect(r.checks[0].detail).toMatch(/couldn't be reached/);
    expect(r.checks[4].fix).toBe("Put “Ledgerly” in the home page's <title>.");
    expect(await entityCheck("", "x.com", web({}), down)).toMatchObject({ ok: false });
  });
});

describe("query fan-out", () => {
  let db: ReturnType<typeof drizzle<typeof schema>>;
  beforeEach(async () => {
    db = drizzle(new PGlite(), { schema });
    await migrate(db, { migrationsFolder: "db/migrations" });
  }, 60_000);

  const provider = () =>
    new FakeProvider({
      pendingChecks: 1,
      reply: () => ({
        text: "Zoho Invoice and FreshBooks are popular.",
        citations: [
          {
            url: "https://www.g2.com/categories/invoicing?utm_source=chatgpt.com",
            title: "Best invoicing",
          },
          { url: "https://g2.com/categories/invoicing", title: "Dup" },
        ],
        raw: {
          web_search_query: ["best invoicing app freelancers 2026", "zoho invoice vs freshbooks"],
        },
      }),
    });

  it("asks once, then reports the searches and sources", async () => {
    const p = provider();
    const s = await startFanOut(
      db,
      p,
      { prompt: "What's the best invoicing app for freelancers?", country: "IN" },
      "v1",
    );
    if (!s.ok) throw new Error(s.message);
    expect(p.submitted[0]).toEqual({
      engine: "chatgpt",
      inputs: [{ prompt: "What's the best invoicing app for freelancers?", country: "IN" }],
    });
    expect(await pollFanOut(db, p, s.id)).toEqual({ status: "running" });
    const done = await pollFanOut(db, p, s.id);
    expect(done).toMatchObject({
      status: "done",
      result: {
        searches: ["best invoicing app freelancers 2026", "zoho invoice vs freshbooks"],
        sources: [
          { url: "https://g2.com/categories/invoicing", domain: "g2.com", title: "Best invoicing" },
        ],
        country: "IN",
      },
    });
    // stored: asking again doesn't touch the provider
    expect(await pollFanOut(db, p, s.id)).toEqual(done);
  });

  it("limits each visitor, and the day, and checks the question", async () => {
    const p = provider();
    for (let i = 0; i < PER_VISITOR_PER_DAY; i++)
      expect(
        (
          await startFanOut(
            db,
            p,
            { prompt: `best invoicing app number ${i}`, country: "US" },
            "v1",
          )
        ).ok,
      ).toBe(true);
    expect(
      await startFanOut(db, p, { prompt: "best invoicing app again", country: "US" }, "v1"),
    ).toMatchObject({
      ok: false,
      message: expect.stringMatching(/^That's 3 questions today/),
    });
    expect(
      (await startFanOut(db, p, { prompt: "best invoicing app for me", country: "US" }, "v2")).ok,
    ).toBe(true);
    process.env.OV_FREE_TOOL_DAILY = "4";
    expect(
      await startFanOut(db, p, { prompt: "best invoicing app for you", country: "US" }, "v3"),
    ).toMatchObject({
      ok: false,
      message: expect.stringMatching(/answered all it can today/),
    });
    delete process.env.OV_FREE_TOOL_DAILY;
    expect(await startFanOut(db, p, { prompt: "hi", country: "US" }, "v4")).toMatchObject({
      ok: false,
    });
    const broken = new FakeProvider({ submitError: new ProviderError("unavailable", "down") });
    expect(
      await startFanOut(db, broken, { prompt: "best invoicing app today", country: "US" }, "v5"),
    ).toMatchObject({
      ok: false,
      message: expect.stringMatching(/couldn't be asked/),
    });
    expect(visitorOf("1.2.3.4")).toMatch(/^[0-9a-f]{32}$/);
    expect(visitorOf("1.2.3.4")).not.toContain("1.2.3.4");
  });
});
