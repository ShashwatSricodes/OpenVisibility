import { PGlite } from "@electric-sql/pglite";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it, vi } from "vitest";
import * as schema from "@/db/schema";
import { FakeProvider } from "../providers/fake";
import { createRun } from "../runs/create";
import { tick } from "../runs/worker";
import {
  allow,
  bearer,
  createKey,
  hashKey,
  listKeys,
  newKey,
  revokeKey,
  verifyKey,
  RATE_LIMIT,
} from "./keys";
import { buildServer, type McpContext } from "./server";

let db: ReturnType<typeof drizzle<typeof schema>>;
let workspaceId: string;
let promptId: string;

/* one workspace with a real run behind it: ChatGPT names Zoho first, then Ledgerly; Gemini only Zoho */
beforeAll(async () => {
  db = drizzle(new PGlite(), { schema });
  await migrate(db, { migrationsFolder: "db/migrations" });
  [{ id: workspaceId }] = await db
    .insert(schema.workspaces)
    .values({ name: "MCP", engines: ["chatgpt", "gemini"], defaultCountries: ["US"], samples: 2 })
    .returning();
  const [brand] = await db
    .insert(schema.brands)
    .values({
      workspaceId,
      name: "Ledgerly",
      domains: ["ledgerly.app"],
      category: "invoicing software",
    })
    .returning();
  await db
    .insert(schema.competitors)
    .values({ brandId: brand.id, name: "Zoho", domains: ["zoho.com"] });
  [{ id: promptId }] = await db
    .insert(schema.prompts)
    .values({ brandId: brand.id, text: "best invoicing app" })
    .returning();
  const r = await createRun(db, workspaceId);
  if (!r.ok) throw new Error(r.message);
  const provider = new FakeProvider({
    reply: (_i, engine) =>
      engine === "chatgpt"
        ? {
            text: "1. Zoho\n2. Ledgerly",
            citations: [{ url: "https://g2.com/best", title: "Best apps" }],
          }
        : { text: "Zoho is the one.", citations: [{ url: "https://zoho.com/invoice" }] },
  });
  await tick({ db, providerFor: async () => provider, analysis: null });
}, 60_000);

async function connect(access: McpContext["access"]) {
  const server = buildServer({ db, workspaceId, access, appUrl: "https://app.test" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "1" });
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}
const text = (r: Awaited<ReturnType<Client["callTool"]>>) =>
  (r.content as { type: string; text: string }[]).map((c) => c.text).join("\n");

describe("API keys", () => {
  it("are shown once, stored as a hash, and stop working when revoked", async () => {
    expect(newKey()).toMatch(/^ov_[A-Za-z0-9]{40}$/);
    const made = await createKey(db, workspaceId, {
      name: "Claude Desktop",
      access: "read",
      createdBy: "o@x",
    });
    if (!made.ok) throw new Error();
    const [row] = await db.select().from(schema.apiKeys).where(eq(schema.apiKeys.id, made.id));
    expect(row.hash).toBe(hashKey(made.key));
    expect(JSON.stringify(row)).not.toContain(made.key);
    expect(row.prefix).toBe(made.key.slice(0, 9));

    expect(await verifyKey(db, made.key)).toMatchObject({
      workspaceId,
      access: "read",
      name: "Claude Desktop",
    });
    expect((await listKeys(db, workspaceId)).map((k) => k.name)).toContain("Claude Desktop");
    expect(Object.keys((await listKeys(db, workspaceId))[0])).not.toContain("hash");
    expect(await verifyKey(db, "ov_" + "x".repeat(40))).toBeNull();
    expect(await verifyKey(db, "not a key")).toBeNull();

    await revokeKey(db, workspaceId, made.id);
    expect(await verifyKey(db, made.key)).toBeNull();
    expect(
      await createKey(db, workspaceId, { name: " ", access: "read", createdBy: "o@x" }),
    ).toMatchObject({ ok: false });
  });

  it("reads the Authorization header, and limits each key to a rate", () => {
    expect(bearer("Bearer ov_abc")).toBe("ov_abc");
    expect(bearer("Basic xyz")).toBeNull();
    const t = 1_000_000;
    for (let i = 0; i < RATE_LIMIT; i++) expect(allow("k1", t)).toBe(true);
    expect(allow("k1", t)).toBe(false);
    expect(allow("k2", t)).toBe(true);
    expect(allow("k1", t + 61_000)).toBe(true);
  });
});

describe("the MCP server", () => {
  it("lists its tools, marking which only read and which change things", async () => {
    const c = await connect("read");
    const { tools } = await c.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        "add_chart_note",
        "add_prompts",
        "compare_competitors",
        "delete_prompts",
        "find_outreach_targets",
        "get_answer",
        "get_citations",
        "get_content_brief",
        "get_content_gaps",
        "get_outreach",
        "get_prompt",
        "get_recommendations",
        "get_runs_and_usage",
        "get_site_audit",
        "get_trend",
        "get_visibility",
        "get_workspace",
        "list_prompts",
        "request_content_brief",
        "run_site_audit",
        "search_answers",
        "start_run",
        "update_prompt",
      ].sort(),
    );
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
    expect(byName.get_visibility.annotations?.readOnlyHint).toBe(true);
    expect(byName.delete_prompts.annotations?.destructiveHint).toBe(true);
    expect(byName.start_run.annotations?.readOnlyHint).toBe(false);
    // nothing can approve or send outreach email
    expect(names.some((n) => /approve|send/.test(n))).toBe(false);
    expect(c.getInstructions()).toMatch(/logged-out visitor/);
  });

  it("answers how visible we are, and who beats us, from the run's data", async () => {
    const c = await connect("read");
    const v = await c.callTool({ name: "get_visibility", arguments: { range: "7d" } });
    expect(v.isError).toBeFalsy();
    expect(text(v)).toContain("Based on 4 answers");
    expect(text(v)).toMatch(/\| Mention rate \| 50% \|/);
    expect(text(v)).toMatch(/\| ChatGPT \| 100% \| #2\.0 \|/);
    expect(text(v)).toMatch(/\| Gemini \| 0% \|/);
    expect(v.structuredContent).toMatchObject({ samples: 4 });

    const gemini = await c.callTool({
      name: "get_visibility",
      arguments: { range: "7d", engine: "gemini" },
    });
    expect(text(gemini)).toMatch(/\| Mention rate \| 0% \|/);

    const comp = await c.callTool({ name: "compare_competitors", arguments: { range: "7d" } });
    expect(text(comp)).toMatch(/\| Zoho \| \d+ \| 100% \| #1\.0 \|/);
    expect(text(comp)).toMatch(/\| best invoicing app \| Zoho \| 100% \| 50% \|/);
  });

  it("reads prompts, answers, citations, gaps and recommendations", async () => {
    const c = await connect("read");
    const list = await c.callTool({ name: "list_prompts", arguments: { range: "7d" } });
    expect(text(list)).toContain(promptId);
    const detail = await c.callTool({
      name: "get_prompt",
      arguments: { prompt_id: promptId, range: "7d" },
    });
    expect(text(detail)).toContain("“best invoicing app”");
    expect(text(detail)).toMatch(/Zoho \| 100%/);

    const found = await c.callTool({
      name: "search_answers",
      arguments: { names_you: "no", range: "7d" },
    });
    expect(text(found)).toMatch(/^2 answers match/);
    const id = (found.structuredContent as { answers: { id: string }[] }).answers[0].id;
    const full = await c.callTool({ name: "get_answer", arguments: { answer_id: id } });
    expect(text(full)).toContain("Zoho is the one.");
    expect(text(full)).toContain("https://zoho.com/invoice");

    expect(text(await c.callTool({ name: "get_citations", arguments: { range: "7d" } }))).toMatch(
      /\| g2\.com \| third party \| 2 \|/,
    );
    expect(
      text(await c.callTool({ name: "get_content_gaps", arguments: { range: "7d" } })),
    ).toMatch(
      /\| best invoicing app \| [0-9a-f-]{36} \| Gemini \| 0% \| Zoho 100% \| zoho\.com \|/,
    );
    expect(
      text(await c.callTool({ name: "get_recommendations", arguments: { range: "7d" } })),
    ).toMatch(/Get named for “best invoicing app” on Gemini/);
    expect(text(await c.callTool({ name: "get_workspace", arguments: {} }))).toMatch(/^# Ledgerly/);
    expect(text(await c.callTool({ name: "get_runs_and_usage", arguments: {} }))).toContain(
      "completed",
    );
    expect(text(await c.callTool({ name: "get_site_audit", arguments: {} }))).toMatch(
      /No site audit yet/,
    );
  });

  it("refuses changes with a read key, and makes them with a write key", async () => {
    const reader = await connect("read");
    const denied = await reader.callTool({
      name: "add_prompts",
      arguments: { prompts: [{ text: "invoice app with GST" }] },
    });
    expect(denied.isError).toBe(true);
    expect(text(denied)).toMatch(/needs a key with write access/);

    const writer = await connect("write");
    const added = await writer.callTool({
      name: "add_prompts",
      arguments: { prompts: [{ text: "invoice app with GST" }, { text: "best invoicing app" }] },
    });
    expect(text(added)).toBe(
      "Added 1 prompt(s); 1 already tracked. They're asked from the next run.",
    );
    const [gst] = await db
      .select()
      .from(schema.prompts)
      .where(eq(schema.prompts.text, "invoice app with GST"));
    await writer.callTool({
      name: "update_prompt",
      arguments: { prompt_id: gst.id, active: false },
    });
    expect(
      (await db.select().from(schema.prompts).where(eq(schema.prompts.id, gst.id)))[0].active,
    ).toBe(false);

    const note = await writer.callTool({
      name: "add_chart_note",
      arguments: { date: "2026-10-20", text: "Launched the pricing page" },
    });
    expect(text(note)).toBe("Noted on 2026-10-20.");
    expect(
      text(
        await writer.callTool({
          name: "add_chart_note",
          arguments: { date: "2026-10-20", text: " " },
        }),
      ),
    ).toBe("Write what changed.");

    // a run needs a Bright Data key; without one it says so instead of starting
    const run = await writer.callTool({ name: "start_run", arguments: {} });
    expect(run.isError).toBe(true);
    expect(text(run)).toMatch(/No Bright Data key/);

    // bad input is caught before anything runs
    const bad = await writer.callTool({ name: "get_prompt", arguments: { prompt_id: "nope" } });
    expect(bad.isError).toBe(true);
  });

  it("offers resources and ready-made prompts", async () => {
    const c = await connect("read");
    const prompts = await c.readResource({ uri: "openvisibility://prompts" });
    expect((prompts.contents[0] as { text: string }).text).toContain("best invoicing app");
    const report = await c.readResource({ uri: "openvisibility://report" });
    expect((report.contents[0] as { text: string }).text).toMatch(/^# AI visibility report/);
    const [a] = await db.select().from(schema.answers).limit(1);
    const answer = await c.readResource({ uri: `openvisibility://answers/${a.id}` });
    expect((answer.contents[0] as { text: string }).text).toContain(a.text);

    const { prompts: list } = await c.listPrompts();
    expect(list.map((p) => p.name).sort()).toEqual([
      "beat_competitor",
      "find_new_prompts",
      "weekly_review",
    ]);
    const beat = await c.getPrompt({ name: "beat_competitor", arguments: { competitor: "Zoho" } });
    expect((beat.messages[0].content as { text: string }).text).toMatch(
      /^Find where Zoho is named/,
    );
  });

  it("only ever sees its own workspace", async () => {
    const [other] = await db.insert(schema.workspaces).values({ name: "Other" }).returning();
    const server = buildServer({
      db,
      workspaceId: other.id,
      access: "write",
      appUrl: "https://app.test",
    });
    const [a, b] = InMemoryTransport.createLinkedPair();
    const c = new Client({ name: "test", version: "1" });
    await Promise.all([server.connect(a), c.connect(b)]);
    expect(
      text(
        await c.callTool({ name: "get_prompt", arguments: { prompt_id: promptId, range: "7d" } }),
      ),
    ).toBe("No prompt with that id in this workspace.");
    const [ans] = await db.select().from(schema.answers).limit(1);
    expect(
      (await c.callTool({ name: "get_answer", arguments: { answer_id: ans.id } })).isError,
    ).toBe(true);
    expect(text(await c.callTool({ name: "get_visibility", arguments: {} }))).toMatch(
      /^No results/,
    );
  });
});

describe("the HTTP endpoint", () => {
  it("needs a valid key, then speaks MCP over HTTP", async () => {
    vi.doMock("@/db/client", () => ({ getDb: () => db }));
    const { POST } = await import("@/app/api/mcp/route");
    const call = (body: unknown, key?: string) =>
      POST(
        new Request("http://localhost:3000/api/mcp", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json, text/event-stream",
            ...(key ? { authorization: `Bearer ${key}` } : {}),
          },
          body: JSON.stringify(body),
        }),
      );
    const init = {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "curl", version: "1" },
      },
    };
    const none = await call(init);
    expect(none.status).toBe(401);
    expect(none.headers.get("www-authenticate")).toMatch(/^Bearer/);
    expect((await call(init, "ov_" + "z".repeat(40))).status).toBe(401);

    const made = await createKey(db, workspaceId, {
      name: "HTTP",
      access: "read",
      createdBy: "o@x",
    });
    if (!made.ok) throw new Error();
    const res = await call(init, made.key);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result.serverInfo.name).toBe("openvisibility");

    const tool = await call(
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "get_visibility", arguments: { range: "7d" } },
      },
      made.key,
    );
    const out = await tool.json();
    expect(out.result.content[0].text).toContain("Based on 4 answers");
    vi.doUnmock("@/db/client");
  });
});
