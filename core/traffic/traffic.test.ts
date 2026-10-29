import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/db/schema";
import { createKey } from "../mcp/keys";
import { assistantOf, agentOf, SNIPPET_AGENTS, SNIPPET_REFERRERS } from "./agents";
import { classify, ingest, ingestLog, parseLine } from "./ingest";
import { citedPagesCrawled, crawlerSummary, perDay, referrals, topCrawled } from "./stats";
import { inRanges, parseCidr, parseRangeFile, verify, type RangeSource } from "./verify";

const GPTBOT_UA =
  "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.2; +https://openai.com/gptbot";
const SEARCH_UA =
  "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot";
const CHROME =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

/* OpenAI's lists, as their files shape them */
const RANGES: Record<string, ReturnType<typeof parseRangeFile>> = {
  "https://openai.com/gptbot.json": parseRangeFile({
    prefixes: [{ ipv4Prefix: "132.196.86.0/24" }],
  }),
  "https://openai.com/searchbot.json": parseRangeFile({
    prefixes: [{ ipv4Prefix: "104.210.140.128/28" }, { ipv6Prefix: "2a03:2880:f800::/48" }],
  }),
};
const ranges: RangeSource = async (url) => RANGES[url] ?? null;

describe("verifying crawlers", () => {
  it("matches addresses against published ranges, IPv4 and IPv6", () => {
    const r = [parseCidr("132.196.86.0/24")!, parseCidr("2a03:2880:f800::/48")!];
    expect(inRanges("132.196.86.17", r)).toBe(true);
    expect(inRanges("132.196.87.1", r)).toBe(false);
    expect(inRanges("::ffff:132.196.86.200", r)).toBe(true);
    expect(inRanges("2a03:2880:f800:1::5", r)).toBe(true);
    expect(inRanges("2a03:2880:f801::5", r)).toBe(false);
    expect(inRanges("not an ip", r)).toBe(false);
    expect(parseCidr("10.0.0.0/33")).toBeNull();
  });

  it("is true, false or can't tell", async () => {
    expect(await verify("GPTBot", "132.196.86.17", ranges)).toBe(true);
    expect(await verify("GPTBot", "45.12.1.9", ranges)).toBe(false); // a fake
    expect(await verify("CCBot", "45.12.1.9", ranges)).toBeNull(); // publishes no ranges
    expect(await verify("ClaudeBot", "45.12.1.9", ranges)).toBeNull(); // list unavailable
    expect(await verify("GPTBot", null, ranges)).toBeNull();
  });
});

describe("recognising AI traffic", () => {
  it("knows the crawlers, and the assistants people come from", () => {
    expect(agentOf(GPTBOT_UA)?.name).toBe("GPTBot");
    expect(agentOf(SEARCH_UA)?.name).toBe("OAI-SearchBot");
    expect(
      agentOf("Mozilla/5.0 (compatible; ChatGPT-User/1.0; +https://openai.com/bot)")?.name,
    ).toBe("ChatGPT-User");
    expect(
      agentOf("Mozilla/5.0 (compatible; Claude-User/1.0; +Claude-User@anthropic.com)")?.name,
    ).toBe("Claude-User");
    expect(agentOf(CHROME)).toBeNull();
    expect(assistantOf("https://chatgpt.com/", "/pricing")).toBe("ChatGPT");
    expect(assistantOf(null, "/pricing?utm_source=chatgpt.com")).toBe("ChatGPT");
    expect(assistantOf("https://www.perplexity.ai/search?q=x", "/")).toBe("Perplexity");
    expect(assistantOf("https://www.google.com/", "/")).toBeNull();
    expect(
      classify({ ua: CHROME, referer: "https://news.ycombinator.com/", path: "/" }),
    ).toBeNull();
    // the snippets' filters match what the server keeps
    expect(new RegExp(SNIPPET_AGENTS, "i").test(GPTBOT_UA)).toBe(true);
    expect(new RegExp(SNIPPET_AGENTS, "i").test("Googlebot/2.1")).toBe(false);
    expect(new RegExp(SNIPPET_REFERRERS, "i").test("https://gemini.google.com/app")).toBe(true);
  });

  it("reads Nginx, Apache and Cloudflare log lines", () => {
    expect(
      parseLine(
        `132.196.86.17 - - [28/Oct/2026:09:15:02 +0000] "GET /pricing?plan=pro HTTP/1.1" 200 5120 "-" "${GPTBOT_UA}"`,
      ),
    ).toEqual({
      at: "2026-10-28T09:15:02+00:00",
      ip: "132.196.86.17",
      host: null,
      path: "/pricing?plan=pro",
      status: 200,
      referer: null,
      ua: GPTBOT_UA,
    });
    // with the virtual host first
    expect(
      parseLine(
        `ledgerly.app 203.0.113.9 - - [28/Oct/2026:10:00:00 +0530] "GET / HTTP/2.0" 200 1 "https://chatgpt.com/" "${CHROME}"`,
      ),
    ).toMatchObject({
      host: "ledgerly.app",
      ip: "203.0.113.9",
      referer: "https://chatgpt.com/",
      at: "2026-10-28T10:00:00+05:30",
    });
    expect(
      parseLine(
        JSON.stringify({
          ClientIP: "104.210.140.130",
          ClientRequestHost: "ledgerly.app",
          ClientRequestURI: "/blog/gst-invoices",
          ClientRequestUserAgent: SEARCH_UA,
          EdgeResponseStatus: 404,
          EdgeStartTimestamp: 1793178000000000000,
        }),
      ),
    ).toMatchObject({
      ip: "104.210.140.130",
      path: "/blog/gst-invoices",
      status: 404,
      at: 1793178000000000000,
    });
    expect(parseLine("garbage")).toBeNull();
  });
});

describe("storing and counting", () => {
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let workspaceId: string;
  const now = new Date("2026-10-29T12:00:00Z");

  beforeEach(async () => {
    db = drizzle(new PGlite(), { schema });
    await migrate(db, { migrationsFolder: "db/migrations" });
    [{ id: workspaceId }] = await db
      .insert(schema.workspaces)
      .values({ name: "Traffic" })
      .returning();
  }, 60_000);

  const hits = [
    {
      at: "2026-10-28T09:00:00Z",
      ua: GPTBOT_UA,
      ip: "132.196.86.17",
      path: "/pricing",
      status: 200,
    },
    { at: "2026-10-28T09:01:00Z", ua: GPTBOT_UA, ip: "45.12.1.9", path: "/admin", status: 404 }, // fake
    {
      at: "2026-10-28T10:00:00Z",
      ua: SEARCH_UA,
      ip: "104.210.140.130",
      path: "/blog/gst-invoices",
      status: 500,
    },
    {
      at: "2026-10-28T11:00:00Z",
      ua: CHROME,
      ip: "203.0.113.9",
      path: "/pricing?email=a@b.c",
      referer: "https://chatgpt.com/",
    },
    { at: "2026-10-28T11:05:00Z", ua: CHROME, ip: "203.0.113.10", path: "/" }, // an ordinary visit
    { at: "2026-11-30T00:00:00Z", ua: GPTBOT_UA, ip: "132.196.86.17", path: "/" }, // from the future
  ];

  it("keeps AI visits, drops the rest, and never keeps a person's address", async () => {
    expect(await ingest(db, workspaceId, hits, "snippet", { now, ranges })).toEqual({
      stored: 4,
      duplicates: 0,
      ignored: 2,
    });
    const rows = await db.select().from(schema.aiVisits);
    const referral = rows.find((r) => r.kind === "referral")!;
    expect(referral).toMatchObject({
      agent: "ChatGPT",
      path: "/pricing",
      ip: null,
      verified: null,
    });
    expect(rows.find((r) => r.ip === "45.12.1.9")?.verified).toBe(false);
    expect(rows.find((r) => r.agent === "OAI-SearchBot")?.verified).toBe(true);
    // the same visits again: counted once
    expect(await ingest(db, workspaceId, hits, "snippet", { now, ranges })).toMatchObject({
      stored: 0,
      duplicates: 4,
    });
  });

  it("reads a whole log, and counts fakes apart", async () => {
    const log = [
      `132.196.86.17 - - [28/Oct/2026:09:15:02 +0000] "GET /pricing HTTP/1.1" 200 5120 "-" "${GPTBOT_UA}"`,
      `45.12.1.9 - - [28/Oct/2026:09:16:00 +0000] "GET /wp-login.php HTTP/1.1" 404 0 "-" "${GPTBOT_UA}"`,
      `203.0.113.9 - - [28/Oct/2026:09:17:00 +0000] "GET /about HTTP/1.1" 200 10 "-" "${CHROME}"`,
      "not a log line about anybot",
      "",
    ];
    expect(await ingestLog(db, workspaceId, log, { now, ranges })).toEqual({
      lines: 4,
      unreadable: 1,
      stored: 2,
      duplicates: 0,
      ignored: 1,
    });
    await ingest(db, workspaceId, hits, "snippet", { now, ranges });
    const since = new Date("2026-10-01T00:00:00Z");
    const summary = await crawlerSummary(db, workspaceId, since);
    expect(summary.map((s) => [s.agent, s.visits, s.verified, s.fake, s.errors])).toEqual([
      ["GPTBot", 2, 2, 2, 0],
      ["OAI-SearchBot", 1, 1, 0, 1],
    ]);
    expect(summary[0]).toMatchObject({ owner: "OpenAI", purpose: "training", checkable: true });
    expect(await perDay(db, workspaceId, since)).toEqual([
      { day: "2026-10-28", crawlers: 3, referrals: 1 },
    ]);
    expect((await topCrawled(db, workspaceId, since)).map((p) => [p.path, p.visits])).toEqual([
      ["/pricing", 2],
      ["/blog/gst-invoices", 1],
    ]);
    expect(await referrals(db, workspaceId, since)).toEqual({
      byAssistant: [{ assistant: "ChatGPT", visits: 1 }],
      landing: [{ path: "/pricing", visits: 1, assistants: ["ChatGPT"] }],
    });
  });

  it("shows when an AI crawler last fetched the pages AI cites", async () => {
    const [brand] = await db
      .insert(schema.brands)
      .values({ workspaceId, name: "Ledgerly", domains: ["ledgerly.app"] })
      .returning();
    const [run] = await db
      .insert(schema.runs)
      .values({ workspaceId, brandId: brand.id, trigger: "manual" })
      .returning();
    const [item] = await db
      .insert(schema.runItems)
      .values({ runId: run.id, promptText: "p", engine: "chatgpt", source: "consumer_app" })
      .returning();
    const [a] = await db
      .insert(schema.answers)
      .values({ runItemId: item.id, text: "x" })
      .returning();
    await db.insert(schema.citations).values([
      {
        answerId: a.id,
        url: "https://ledgerly.app/blog/gst-invoices",
        domain: "ledgerly.app",
        kind: "owned",
      },
      {
        answerId: a.id,
        url: "https://ledgerly.app/pricing",
        domain: "ledgerly.app",
        kind: "owned",
      },
    ]);
    await ingest(db, workspaceId, hits, "snippet", { now, ranges });
    const pages = await citedPagesCrawled(db, workspaceId);
    // /pricing was only fetched by GPTBot, a training crawler: it doesn't count
    expect(pages.map((p) => [p.url, p.by, p.lastCrawled?.toISOString() ?? null])).toEqual([
      ["https://ledgerly.app/blog/gst-invoices", ["OAI-SearchBot"], "2026-10-28T10:00:00.000Z"],
      ["https://ledgerly.app/pricing", [], null],
    ]);
  });

  it("takes visits from a site key, and only a site key", async () => {
    vi.doMock("@/db/client", () => ({ getDb: () => db }));
    const { POST } = await import("@/app/api/ingest/visits/route");
    const site = await createKey(db, workspaceId, {
      name: "Cloudflare",
      access: "ingest",
      createdBy: "o",
    });
    const read = await createKey(db, workspaceId, { name: "MCP", access: "read", createdBy: "o" });
    if (!site.ok || !read.ok) throw new Error();
    const send = (key: string, body: unknown) =>
      POST(
        new Request("http://localhost/api/ingest/visits", {
          method: "POST",
          headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
      );
    const visit = {
      at: Date.parse("2026-10-28T09:00:00Z"),
      ua: CHROME,
      path: "/",
      referer: "https://claude.ai/chat/1",
    };
    expect((await send(read.key, { visits: [visit] })).status).toBe(401);
    const ok = await send(site.key, { visits: [visit] });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ stored: 1, duplicates: 0, ignored: 0 });
    expect((await send(site.key, { nope: true })).status).toBe(400);

    // and a site key can't use the MCP server
    const mcp = await import("@/app/api/mcp/route");
    const res = await mcp.POST(
      new Request("http://localhost/api/mcp", {
        method: "POST",
        headers: {
          authorization: `Bearer ${site.key}`,
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      }),
    );
    expect(res.status).toBe(401);
    vi.doUnmock("@/db/client");
  });
});
