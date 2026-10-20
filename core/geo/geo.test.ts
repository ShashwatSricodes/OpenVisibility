import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { auditPending, getAudit, parseSitemap, pickPages, queueAudits } from "./audit";
import { isPrivateAddress, safeGet, type Net } from "./fetch";
import { headerRobots, pageIssues, readPage, visibleText, type PageCheck } from "./page";
import { parseRobots, verdict, verdictFor } from "./robots";

describe("robots.txt", () => {
  const robots = parseRobots(`
# a comment
User-agent: *
Disallow: /admin
Allow: /admin/public

User-agent: GPTBot
Disallow: /

User-agent: OAI-SearchBot
User-agent: PerplexityBot
Disallow: /private/
Allow: /private/press$
Disallow: /*.pdf$

user-agent: perplexitybot
Disallow: /drafts

Sitemap: https://ledgerly.app/sitemap.xml
`);

  it("follows the crawler's own group, or else *", () => {
    expect(verdict(robots, "GPTBot", "/pricing").allowed).toBe(false);
    expect(verdict(robots, "gptbot", "/").allowed).toBe(false); // case doesn't matter
    // OAI-SearchBot has its own group, so the * rules don't apply to it
    expect(verdict(robots, "OAI-SearchBot", "/admin").allowed).toBe(true);
    expect(verdict(robots, "ClaudeBot", "/admin").allowed).toBe(false);
    expect(verdict(robots, "ClaudeBot", "/pricing")).toEqual({
      allowed: true,
      rule: null,
      group: "*",
    });
  });

  it("longest match wins, Allow wins ties, and * and $ work", () => {
    expect(verdict(robots, "ClaudeBot", "/admin/public/x").allowed).toBe(true);
    expect(verdict(robots, "OAI-SearchBot", "/private/plans").allowed).toBe(false);
    expect(verdict(robots, "OAI-SearchBot", "/private/press").allowed).toBe(true);
    expect(verdict(robots, "OAI-SearchBot", "/private/press/2026").allowed).toBe(false);
    expect(verdict(robots, "OAI-SearchBot", "/files/report.pdf").allowed).toBe(false);
    expect(verdict(robots, "OAI-SearchBot", "/files/report.pdf?v=2").allowed).toBe(true);
    const tie = parseRobots("User-agent: *\nDisallow: /page\nAllow: /page");
    expect(verdict(tie, "x", "/page").allowed).toBe(true);
  });

  it("merges groups for the same crawler, and reads sitemaps", () => {
    expect(verdict(robots, "PerplexityBot", "/drafts/1").allowed).toBe(false);
    expect(verdict(robots, "OAI-SearchBot", "/drafts/1").allowed).toBe(true);
    expect(robots.sitemaps).toEqual(["https://ledgerly.app/sitemap.xml"]);
  });

  it("missing allows everything; unreachable blocks everything", () => {
    expect(verdictFor({ state: "missing" }, "GPTBot", "/").allowed).toBe(true);
    expect(verdictFor({ state: "unreachable", status: 503 }, "GPTBot", "/").allowed).toBe(false);
    expect(verdict(parseRobots("User-agent: *\nDisallow:"), "GPTBot", "/").allowed).toBe(true);
  });
});

describe("reading a page", () => {
  const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(" ");

  it("counts only the text a crawler sees without JavaScript", () => {
    const html = `<html><head><title>Pricing &amp; plans</title><style>.a{}</style></head>
      <body><!-- hidden --><h1>Ledgerly pricing</h1><p>Plans from &#36;9</p>
      <script>document.write("lots of words here")</script><noscript>Enable JS</noscript></body></html>`;
    expect(visibleText(html)).toBe("Ledgerly pricing Plans from $9");
    expect(readPage(html, null)).toMatchObject({ title: "Pricing & plans", words: 5, scripts: 1 });
  });

  it("finds noindex and nosnippet in meta tags and the header", () => {
    expect(readPage(`<meta name="robots" content="noindex, follow">`, null).noindex).toBe(true);
    expect(readPage(`<meta content="max-snippet:0" name="ROBOTS">`, null).nosnippet).toBe(true);
    expect(readPage(`<meta name="googlebot" content="noindex">`, null)).toMatchObject({
      noindex: false,
      noindexFor: ["googlebot"],
    });
    expect(readPage("", "noindex").noindex).toBe(true);
    expect(headerRobots("googlebot: noindex, otherbot: nofollow")).toEqual([
      { name: "googlebot", content: "noindex" },
      { name: "otherbot", content: "nofollow" },
    ]);
    expect(readPage(`<meta name="description" content="noindex">`, null).noindex).toBe(false);
  });

  it("explains what's wrong, problems first", () => {
    const base: PageCheck = {
      url: "https://ledgerly.app/app",
      finalUrl: "https://ledgerly.app/app",
      status: 200,
      error: null,
      redirects: 0,
      ms: 400,
      facts: readPage(`<div id="root"></div><script src="/app.js"></script>`, null),
      blocked: [],
      blockedTraining: ["GPTBot"],
    };
    expect(pageIssues(base).map((i) => [i.code, i.severity])).toEqual([
      ["needs_js", "problem"],
      ["training", "note"],
    ]);
    expect(
      pageIssues({
        ...base,
        facts: readPage(`<p>${words(80)}</p>`, null),
        ms: 4200,
        redirects: 2,
      }).map((i) => i.code),
    ).toEqual(["slow", "redirects", "training"]);
    expect(pageIssues({ ...base, status: 404 })).toEqual([
      expect.objectContaining({ code: "unreachable", text: expect.stringContaining("404") }),
    ]);
  });
});

/* a small website, served without the network */
type Page = { status?: number; body?: string; headers?: Record<string, string> };
function site(pages: Record<string, Page>, addresses: Record<string, string[]> = {}) {
  const asked: string[] = [];
  const net: Net = {
    resolve: async (host) => addresses[host] ?? ["93.184.216.34"],
    fetch: async (url) => {
      asked.push(url);
      const p = pages[url];
      if (!p) return new Response("Not found", { status: 404 });
      return new Response(p.body ?? "", {
        status: p.status ?? 200,
        headers: { "content-type": "text/html", ...p.headers },
      });
    },
  };
  return { net, asked };
}

describe("fetching", () => {
  it("refuses private addresses, on every redirect", async () => {
    expect(isPrivateAddress("10.1.2.3")).toBe(true);
    expect(isPrivateAddress("169.254.169.254")).toBe(true);
    expect(isPrivateAddress("::ffff:192.168.0.1")).toBe(true);
    expect(isPrivateAddress("fd00::1")).toBe(true);
    expect(isPrivateAddress("93.184.216.34")).toBe(false);

    const { net, asked } = site(
      {
        "https://ledgerly.app/go": { status: 302, headers: { location: "https://intranet.test/" } },
      },
      { "intranet.test": ["10.0.0.5"] },
    );
    const r = await safeGet("https://ledgerly.app/go", net);
    expect(r.error).toBe("The domain points to a private address");
    expect(asked).toEqual(["https://ledgerly.app/go"]); // never fetched the private one
  });

  it("follows redirects and counts them", async () => {
    const { net } = site({
      "http://ledgerly.app/a": { status: 301, headers: { location: "https://ledgerly.app/a" } },
      "https://ledgerly.app/a": { status: 308, headers: { location: "/b" } },
      "https://ledgerly.app/b": { body: "ok" },
    });
    const r = await safeGet("http://ledgerly.app/a", net);
    expect(r).toMatchObject({ status: 200, finalUrl: "https://ledgerly.app/b", body: "ok" });
    expect(r.redirects).toHaveLength(2);
  });

  it("reads sitemaps and picks pages: home, cited, then the sitemap", () => {
    expect(
      parseSitemap(
        `<urlset><url><loc>https://ledgerly.app/a?x=1&amp;y=2</loc></url><url><loc><![CDATA[https://ledgerly.app/b]]></loc></url></urlset>`,
      ),
    ).toEqual({ index: false, locs: ["https://ledgerly.app/a?x=1&y=2", "https://ledgerly.app/b"] });
    expect(
      pickPages(
        "ledgerly.app",
        ["https://ledgerly.app/pricing"],
        [
          "https://www.ledgerly.app/",
          "https://ledgerly.app/pricing?utm_source=x",
          "https://other.com/x",
          "https://blog.ledgerly.app/post",
          "https://ledgerly.app/c",
        ],
        4,
      ),
    ).toEqual([
      { url: "https://ledgerly.app/", source: "home" },
      { url: "https://ledgerly.app/pricing", source: "cited" },
      { url: "https://blog.ledgerly.app/post", source: "sitemap" },
      { url: "https://ledgerly.app/c", source: "sitemap" },
    ]);
  });
});

describe("the audit", () => {
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let workspaceId: string;

  beforeEach(async () => {
    db = drizzle(new PGlite(), { schema });
    await migrate(db, { migrationsFolder: "db/migrations" });
    [{ id: workspaceId }] = await db
      .insert(schema.workspaces)
      .values({ name: "Audit" })
      .returning();
    await db
      .insert(schema.brands)
      .values({ workspaceId, name: "Ledgerly", domains: ["ledgerly.app"] });
  }, 60_000);

  const text = (n: number) =>
    `<p>${Array.from({ length: n }, (_, i) => `Ledgerly invoicing word${i}`).join(" ")}</p>`;
  const ledgerly = () =>
    site({
      "https://ledgerly.app/": { body: `<title>Ledgerly</title>${text(40)}` },
      "https://ledgerly.app/robots.txt": {
        headers: { "content-type": "text/plain" },
        body: `User-agent: *\nAllow: /\n\nUser-agent: GPTBot\nDisallow: /\n\nUser-agent: OAI-SearchBot\nDisallow: /private/\n\nSitemap: https://ledgerly.app/sitemap-index.xml`,
      },
      "https://ledgerly.app/sitemap-index.xml": {
        body: `<sitemapindex><sitemap><loc>https://ledgerly.app/sitemap-pages.xml</loc></sitemap></sitemapindex>`,
      },
      "https://ledgerly.app/sitemap-pages.xml": {
        body: `<urlset>${["/pricing", "/app", "/private/plans", "/old"].map((p) => `<url><loc>https://ledgerly.app${p}</loc></url>`).join("")}</urlset>`,
      },
      "https://ledgerly.app/pricing": { body: text(40) },
      "https://ledgerly.app/app": {
        body: `<html><body><div id="root"></div><script src="/bundle.js"></script></body></html>`,
      },
      "https://ledgerly.app/private/plans": { body: text(40) },
      "https://ledgerly.app/old": { status: 410 },
    });

  it("flags a page blocked to a crawler and one that needs JavaScript", async () => {
    expect(await queueAudits(db, workspaceId)).toEqual({ ok: true, domains: 1 });
    expect(await queueAudits(db, workspaceId)).toMatchObject({ ok: false });
    const { net } = ledgerly();
    let checked = 0;
    for (let i = 0; i < 5; i++) checked += await auditPending(db, net, { pages: 2 });
    expect(checked).toBe(5);

    const [a] = await getAudit(db, workspaceId);
    expect(a).toMatchObject({
      status: "done",
      robotsState: "found",
      sitemapUrl: "https://ledgerly.app/sitemap-index.xml",
      llmsTxt: false,
      checked: 5,
    });
    const crawler = (agent: string) => a.crawlers.find((c) => c.agent === agent)!.verdict.allowed;
    expect([crawler("GPTBot"), crawler("OAI-SearchBot"), crawler("ClaudeBot")]).toEqual([
      false,
      true,
      true,
    ]);
    const issues = Object.fromEntries(
      a.pages.map((p) => [new URL(p.url).pathname, p.issues.map((i) => i.code)]),
    );
    expect(issues).toEqual({
      "/private/plans": ["blocked", "training"],
      "/app": ["needs_js", "training"],
      "/old": ["unreachable"],
      "/": ["training"],
      "/pricing": ["training"],
    });
    const blocked = a.pages.find((p) => p.url.endsWith("/private/plans"))!;
    expect(blocked.issues[0].text).toBe("robots.txt blocks OAI-SearchBot");
    // pages with problems come first
    expect(a.pages.slice(0, 3).every((p) => p.issues[0].severity === "problem")).toBe(true);

    // running it again starts over
    expect(await queueAudits(db, workspaceId)).toEqual({ ok: true, domains: 1 });
    expect((await getAudit(db, workspaceId))[0]).toMatchObject({ status: "queued", checked: 0 });
  });

  it("stops early when the domain can't be reached, and says why", async () => {
    await queueAudits(db, workspaceId);
    const { net } = site({}, { "ledgerly.app": ["127.0.0.1"] });
    await auditPending(db, net);
    const [a] = await getAudit(db, workspaceId);
    expect(a).toMatchObject({
      status: "done",
      error: "The domain points to a private address",
      pages: [],
    });
  });

  it("puts the pages answers cite ahead of the sitemap's", async () => {
    const [brand] = await db.select().from(schema.brands);
    const [run] = await db
      .insert(schema.runs)
      .values({ workspaceId, brandId: brand.id, trigger: "manual" })
      .returning();
    const [item] = await db
      .insert(schema.runItems)
      .values({ runId: run.id, promptText: "x", engine: "chatgpt", source: "consumer_app" })
      .returning();
    const [answer] = await db
      .insert(schema.answers)
      .values({ runItemId: item.id, text: "x" })
      .returning();
    await db.insert(schema.citations).values({
      answerId: answer.id,
      url: "https://ledgerly.app/compare",
      domain: "ledgerly.app",
      kind: "owned",
    });
    await queueAudits(db, workspaceId);
    await auditPending(db, ledgerly().net, { pages: 0 });
    const [a] = await getAudit(db, workspaceId);
    expect(a.pages.map((p) => [p.url, p.source]).slice(0, 3)).toEqual([
      ["https://ledgerly.app/", "home"],
      ["https://ledgerly.app/compare", "cited"],
      ["https://ledgerly.app/pricing", "sitemap"],
    ]);
  });
});
