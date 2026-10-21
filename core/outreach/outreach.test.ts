import { PGlite } from "@electric-sql/pglite";
import { MockLanguageModelV4 } from "ai/test";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { readContent } from "../geo/content";
import type { Net } from "../geo/fetch";
import { briefFromPages, briefPending, getBrief, onTopic, requestBrief } from "./brief";
import { authorOf, contactPages, emailsIn, pickContact } from "./contacts";
import { kindOf, researchByModel, researchByRules, type Brand } from "./research";
import {
  coverage,
  listTargets,
  researchPending,
  researchTarget,
  setSkipped,
  syncTargets,
} from "./targets";

const brand: Brand = {
  name: "Ledgerly",
  description: "invoicing with UPI and GST built in",
  category: "invoicing software",
  audience: "Indian freelancers",
  domains: ["ledgerly.app"],
};
const evidence = {
  answers: 6,
  prompts: ["best invoicing app", "invoice app with UPI"],
  engines: ["chatgpt"],
  rivals: ["Zoho", "FreshBooks"],
  withYou: 0,
};

/** a few websites, served without the network */
function web(pages: Record<string, string | { status: number }>): Net {
  return {
    resolve: async () => ["93.184.216.34"],
    fetch: async (url) => {
      const p = pages[url];
      if (p === undefined) return new Response("Not found", { status: 404 });
      if (typeof p !== "string") return new Response("", { status: p.status });
      return new Response(p, { headers: { "content-type": "text/html" } });
    },
  };
}

const listicle = `<html><head><title>The 9 best invoicing apps for freelancers</title>
<script type="application/ld+json">{"@type":"Article","author":{"@type":"Person","name":"Priya Nair"}}</script></head>
<body><h1>The 9 best invoicing apps</h1><h2>1. Zoho Invoice</h2><p>Free and solid.</p><h2>2. FreshBooks</h2>
<p>Great for agencies.</p><footer><a href="/about">About</a> <a href="/write-for-us">Write for us</a>
<a href="https://twitter.com/blog">Twitter</a> <a href="mailto:support@bestapps.blog">Support</a></footer></body></html>`;

describe("finding who to write to", () => {
  it("collects published addresses, and drops the ones that reach no one", () => {
    expect(
      emailsIn(
        `<a href="mailto:Editor@BestApps.blog?subject=Hi">Mail</a> priya&#64;bestapps.blog
         logo@2x.png noreply@bestapps.blog support@bestapps.blog o123.ingest@sentry.io`,
      ),
    ).toEqual(["editor@bestapps.blog", "priya@bestapps.blog"]);
  });

  it("finds the author and the site's own contact pages", () => {
    expect(authorOf(listicle)).toBe("Priya Nair");
    expect(authorOf(`<meta content="Sam Lee" name="author">`)).toBe("Sam Lee");
    expect(contactPages(listicle, "https://bestapps.blog/invoicing")).toEqual([
      "https://bestapps.blog/write-for-us",
      "https://bestapps.blog/about",
    ]);
  });

  it("prefers the author, then the editors, then a general inbox; never another site's", () => {
    const at = (email: string, source: "page" | "contact_page" = "page") => ({
      email,
      source,
      foundOn: "https://bestapps.blog/x",
    });
    const pick = (emails: string[], author: string | null = "Priya Nair") =>
      pickContact(
        emails.map((e) => at(e)),
        "bestapps.blog",
        author,
      )?.email ?? null;
    expect(pick(["hello@bestapps.blog", "editor@bestapps.blog", "priya@bestapps.blog"])).toBe(
      "priya@bestapps.blog",
    );
    expect(pick(["hello@bestapps.blog", "editor@bestapps.blog"])).toBe("editor@bestapps.blog");
    expect(pick(["hello@bestapps.blog"])).toBe("hello@bestapps.blog");
    // someone else's address on the page: not this site's to give
    expect(pick(["partners@zoho.com"])).toBeNull();
    // the author's own gmail is fine when their name says it's theirs
    expect(pickContact([at("priya.nair@gmail.com")], "bestapps.blog", "Priya Nair")).toMatchObject({
      email: "priya.nair@gmail.com",
      name: "Priya Nair",
      role: "author",
    });
  });
});

describe("researching a page", () => {
  it("knows platforms, forums and the shape of an article", () => {
    expect(kindOf("g2.com", "https://g2.com/categories/invoicing", null)).toBe("directory");
    expect(kindOf("old.reddit.com", "https://old.reddit.com/r/freelance/x", null)).toBe(
      "community",
    );
    expect(kindOf("bestapps.blog", "https://bestapps.blog/x", "The 9 best invoicing apps")).toBe(
      "list",
    );
    expect(kindOf("site.com", "https://site.com/zoho-vs-freshbooks", null)).toBe("comparison");
    expect(kindOf("site.com", "https://site.com/freshbooks-review", null)).toBe("review");
    expect(kindOf("site.com", "https://site.com/how-to-invoice", "How to invoice")).toBe("article");
  });

  it("says what's missing and why the brand fits, from the brand's own facts", () => {
    const r = researchByRules(
      {
        url: "https://bestapps.blog/x",
        domain: "bestapps.blog",
        title: "The 9 best invoicing apps",
        namesBrand: false,
      },
      brand,
      ["Zoho", "FreshBooks"],
    );
    expect(r).toEqual({
      kind: "list",
      opening: "The list names Zoho and FreshBooks but not Ledgerly.",
      reason: "Ledgerly: invoicing with UPI and GST built in, for Indian freelancers.",
      fit: true,
      namesBrand: false,
      source: "rules",
    });
  });

  it("uses the model's reading when there is one, and counts its cost", async () => {
    const seen: string[] = [];
    const model = new MockLanguageModelV4({
      doGenerate: async ({ prompt }) => {
        seen.push(JSON.stringify(prompt));
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                kind: "list",
                opening: "The list of 9 invoicing apps for freelancers doesn't include Ledgerly.",
                reason: "Its readers are freelancers; Ledgerly handles UPI and GST invoices.",
                fit: true,
                namesBrand: false,
              }),
            },
          ],
          finishReason: { unified: "stop", raw: undefined },
          usage: {
            inputTokens: {
              total: 2000,
              noCache: 2000,
              cacheRead: undefined,
              cacheWrite: undefined,
            },
            outputTokens: { total: 100, text: 100, reasoning: undefined },
          },
          warnings: [],
        };
      },
    });
    const r = await researchByModel(
      { model, batch: 5, priceInput: 0.1, priceOutput: 0.4 },
      {
        url: "https://bestapps.blog/x",
        title: "The 9 best",
        headings: ["1. Zoho"],
        text: "Zoho is free.",
      },
      brand,
      ["Zoho"],
      ["best invoicing app"],
    );
    expect(r?.research).toMatchObject({ source: "model", fit: true });
    expect(r?.costUsd).toBeCloseTo((2000 * 0.1 + 100 * 0.4) / 1e6);
    expect(seen[0]).toContain("Never invent features");
    expect(seen[0]).toContain("Indian freelancers");
  });

  const run = (
    pages: Parameters<typeof web>[0],
    url = "https://bestapps.blog/invoicing",
    domain = "bestapps.blog",
  ) =>
    researchTarget(
      { url, domain, title: null, evidence },
      { brand, names: ["Ledgerly"] },
      web(pages),
      null,
    );

  it("finds an editor on the write-for-us page when the article has no address", async () => {
    const r = await run({
      "https://bestapps.blog/invoicing": listicle,
      "https://bestapps.blog/write-for-us": `<p>Pitches to <a href="mailto:editor@bestapps.blog">our editors</a></p>`,
      "https://bestapps.blog/about": `<p>hello@bestapps.blog</p>`,
    });
    expect(r.status).toBe("ready");
    expect(r.contact).toEqual({
      email: "editor@bestapps.blog",
      name: null,
      source: "contact_page",
      foundOn: "https://bestapps.blog/write-for-us",
      role: "editorial",
    });
    expect(r.research?.opening).toBe("The list names Zoho and FreshBooks but not Ledgerly.");
  });

  it("sets platforms aside as tasks, skips pages that already name the brand, and says when there's no contact", async () => {
    const g2 = await run(
      { "https://g2.com/categories/invoicing": "<h1>Invoicing</h1>" },
      "https://g2.com/categories/invoicing",
      "g2.com",
    );
    expect(g2).toMatchObject({ status: "task", contact: null });
    expect(g2.note).toMatch(/up to you to create or claim/);

    const named = await run({
      "https://bestapps.blog/invoicing": `${listicle}<p>Ledgerly too.</p>`,
    });
    expect(named.status).toBe("skipped");
    expect(named.note).toMatch(/already names Ledgerly/);

    const quiet = await run({ "https://bestapps.blog/invoicing": listicle });
    expect(quiet).toMatchObject({ status: "no_contact", contact: null });

    const gone = await run({ "https://bestapps.blog/invoicing": { status: 404 } });
    expect(gone.status).toBe("no_contact");
    expect(gone.note).toMatch(/couldn't be read \(HTTP 404\)/);
  });
});

describe("the target list", () => {
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let workspaceId: string;
  let promptId: string;

  beforeEach(async () => {
    db = drizzle(new PGlite(), { schema });
    await migrate(db, { migrationsFolder: "db/migrations" });
    [{ id: workspaceId }] = await db
      .insert(schema.workspaces)
      .values({ name: "Outreach" })
      .returning();
    const [b] = await db
      .insert(schema.brands)
      .values({
        workspaceId,
        name: "Ledgerly",
        domains: ["ledgerly.app"],
        description: brand.description,
      })
      .returning();
    const [zoho] = await db
      .insert(schema.competitors)
      .values({ brandId: b.id, name: "Zoho", domains: ["zoho.com"] })
      .returning();
    [{ id: promptId }] = await db
      .insert(schema.prompts)
      .values({ brandId: b.id, text: "best invoicing app" })
      .returning();
    const [run] = await db
      .insert(schema.runs)
      .values({ workspaceId, brandId: b.id, trigger: "manual" })
      .returning();
    // three answers name Zoho, not you, and cite the listicle and g2
    for (let i = 0; i < 3; i++) {
      const [item] = await db
        .insert(schema.runItems)
        .values({
          runId: run.id,
          promptId,
          promptText: "best invoicing app",
          engine: "chatgpt",
          source: "consumer_app",
          sampleIndex: i,
        })
        .returning();
      const [a] = await db
        .insert(schema.answers)
        .values({ runItemId: item.id, text: "Zoho." })
        .returning();
      await db
        .insert(schema.mentions)
        .values({ answerId: a.id, competitorId: zoho.id, position: 1 });
      await db.insert(schema.citations).values([
        {
          answerId: a.id,
          url: "https://bestapps.blog/invoicing",
          domain: "bestapps.blog",
          kind: "third_party" as const,
          position: 1,
        },
        {
          answerId: a.id,
          url: "https://g2.com/categories/invoicing",
          domain: "g2.com",
          kind: "third_party" as const,
          position: 2,
        },
        {
          answerId: a.id,
          url: "https://zoho.com/invoice",
          domain: "zoho.com",
          kind: "competitor" as const,
          competitorId: zoho.id,
          position: 3,
        },
      ]);
    }
  }, 60_000);

  it("syncs targets, researches them in the worker, and keeps your choices", async () => {
    expect(await syncTargets(db, workspaceId)).toEqual({ added: 2, total: 2 });
    expect(await syncTargets(db, workspaceId)).toEqual({ added: 0, total: 2 });
    const net = web({
      "https://bestapps.blog/invoicing": listicle,
      "https://bestapps.blog/write-for-us": `<a href="mailto:editor@bestapps.blog">x</a>`,
      "https://g2.com/categories/invoicing": "<h1>Invoicing software</h1>",
    });
    expect(await researchPending(db, net, null)).toBe(2);
    expect(await researchPending(db, net, null)).toBe(0);

    const list = await listTargets(db, workspaceId);
    expect(list.map((t) => [t.domain, t.status, t.contact?.email ?? null])).toEqual([
      ["bestapps.blog", "ready", "editor@bestapps.blog"],
      ["g2.com", "task", null],
    ]);
    expect(list[0].evidence).toMatchObject({
      answers: 3,
      rivals: ["Zoho"],
      prompts: ["best invoicing app"],
    });

    // skipping sticks through a sync; bringing it back researches it again
    await setSkipped(db, workspaceId, [list[0].id], true);
    await syncTargets(db, workspaceId);
    expect((await listTargets(db, workspaceId)).find((t) => t.id === list[0].id)?.status).toBe(
      "skipped",
    );
    await setSkipped(db, workspaceId, [list[0].id], false);
    expect((await listTargets(db, workspaceId)).find((t) => t.id === list[0].id)?.status).toBe(
      "found",
    );
  });

  it("adds Google's top pages, never yours or competitors', and counts coverage", async () => {
    const at = (position: number, url: string) => ({
      workspaceId,
      promptId,
      country: "US",
      position,
      url,
      domain: new URL(url).hostname,
      title: null,
    });
    await db.insert(schema.searchResults).values([
      at(1, "https://bestapps.blog/invoicing"), // also cited by AI
      at(2, "https://ledgerly.app/pricing"), // yours
      at(3, "https://zoho.com/invoice"), // a competitor's
      at(4, "https://guide.example/invoices"), // ranks, not cited yet
    ]);
    expect(await syncTargets(db, workspaceId)).toEqual({ added: 3, total: 3 });
    const list = await listTargets(db, workspaceId);
    // cited and ranked first; ranked only after cited only (three answers outweigh rank 4)
    expect(list.map((t) => [t.domain, t.score])).toEqual([
      ["bestapps.blog", 3 * 8 + 5 * 3 + 4],
      ["g2.com", 3 * 8 + 4],
      ["guide.example", 2 * 3 + 4],
    ]);
    expect(list[0].evidence.ranks).toEqual([
      { prompt: "best invoicing app", country: "US", position: 1 },
    ]);

    const net = web({
      "https://bestapps.blog/invoicing": listicle,
      "https://g2.com/categories/invoicing": "<h1>Invoicing</h1>",
      // the ranking guide already names you, and Zoho
      "https://guide.example/invoices": "<h1>Invoicing</h1><p>Ledgerly and Zoho both work.</p>",
    });
    await researchPending(db, net, null, { limit: 5 });
    const guide = (await listTargets(db, workspaceId)).find((t) => t.domain === "guide.example")!;
    expect(guide.status).toBe("skipped");
    expect(guide.research?.rivalsOnPage).toEqual(["Zoho"]);

    // of the three top pages that aren't a competitor's: one is yours, one names you, one doesn't
    expect(await coverage(db, workspaceId)).toEqual({
      basis: "search",
      total: 3,
      yours: 1,
      covered: 1,
      missing: 1,
      pending: 0,
    });
  });

  it("writes a content brief from the pages AI cites for a prompt", async () => {
    await requestBrief(db, workspaceId, promptId);
    expect(await getBrief(db, workspaceId, promptId)).toEqual({ status: "queued", brief: null });
    const article = (words: number, extra = "") =>
      `<title>Best invoicing apps</title><h2>What is the best invoicing app?</h2><h2>How much does it cost?</h2>
       <p>${"word ".repeat(words)}</p><ul><li>a</li><li>b</li><li>c</li></ul>${extra}`;
    const net = web({
      "https://bestapps.blog/invoicing": article(
        1180,
        "<table><tr><td>a</td></tr><tr><td>b</td></tr></table>",
      ),
      "https://g2.com/categories/invoicing": article(2040),
    });
    expect(await briefPending(db, net, null)).toBe(1);
    const got = await getBrief(db, workspaceId, promptId);
    expect(got?.status).toBe("done");
    expect(got?.brief).toMatchObject({
      prompt: "best invoicing app",
      questions: ["How much does it cost?", "What is the best invoicing app?"],
      formats: ["a list of the options or steps", "a comparison table"],
      sources: ["bestapps.blog", "g2.com"],
      source: "rules",
    });
    expect(got?.brief?.words).toBe(2100);
  });
});

describe("briefs from pages", () => {
  it("keeps the questions about the prompt, not a home page's other articles", () => {
    const prompt = "What is the best invoicing software for freelancers?";
    // real headings from a cited home page, 20 October 2026
    expect(onTopic("Can I send branded, professional invoices with Tally Crow?", prompt)).toBe(
      true,
    );
    expect(onTopic("How much does it cost?", prompt)).toBe(true);
    expect(onTopic("ClickUp vs Asana 2026: Which Project Management Tool Wins?", prompt)).toBe(
      false,
    );
    expect(onTopic("Coda Review 2026: Is It Worth It for Small Businesses?", prompt)).toBe(false);
    expect(onTopic("Is there a free plan or trial available?", prompt)).toBe(true);
    expect(onTopic("Ready to own page one?", prompt)).toBe(false);
    expect(onTopic("What we never do", prompt)).toBe(false);
    expect(onTopic("What to look for in an SEO agency before you sign anything", prompt)).toBe(
      false,
    );
  });

  it("takes what most cited pages share", () => {
    const page = (html: string) => ({
      url: "https://x.com/a",
      facts: readContent(html, []),
      headings: [...html.matchAll(/<h2>(.*?)<\/h2>/g)].map((m) => m[1]),
    });
    const b = briefFromPages("q", [
      page("<h2>Is it free?</h2><p>a b c</p>"),
      page("<h2>is it free</h2><h2>Pricing</h2>"),
      page("<h2>Who is it for?</h2>"),
    ]);
    expect(b.questions).toEqual(["Is it free?", "Who is it for?"]);
    expect(b.words).toBe(300); // never less than a few hundred
    expect(b.formats).toEqual([]);
  });
});
