import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BrightDataProvider, matchRecords, normalize, type BrightDataEngine } from "./brightdata";

/* real records captured by the Day 1 spike on 18 October 2026 */
function fixture(engine: BrightDataEngine): Record<string, unknown> {
  const file = join(__dirname, "..", "..", "scripts", "fixtures", `brightdata-${engine}.json`);
  const data = JSON.parse(readFileSync(file, "utf8")) as {
    answers: { raw: Record<string, unknown> }[];
  };
  return data.answers[0].raw;
}

describe("normalize", () => {
  it("recovers ChatGPT's source chip when citations are empty", () => {
    const a = normalize("chatgpt", fixture("chatgpt"));
    expect(a.ok).toBe(true);
    expect(a.text).toMatch(/Zoho Invoice/);
    expect(a.citations).toEqual([
      { url: "https://indietoolkit.in", title: "indietoolkit.in", position: 1 },
    ]);
    expect(a.links.map((l) => new URL(l.url).hostname)).toContain("www.zoho.com");
    expect(a.webSearchTriggered).toBe(false);
  });

  it("reports Gemini's logged-out model", () => {
    const a = normalize("gemini", fixture("gemini"));
    expect(a.ok).toBe(true);
    expect(a.model).toBe("Flash-Lite");
  });

  it("reads Google AI Mode citations", () => {
    const a = normalize("ai_mode", fixture("ai_mode"));
    expect(a.ok).toBe(true);
    expect(a.citations.length).toBe(16);
  });

  it("cleans Google's labels from AI Overviews", () => {
    const a = normalize("ai_overviews", fixture("ai_overviews"));
    expect(a.ok).toBe(true);
    expect(a.shown).toBe(true);
    expect(a.text.startsWith("The best invoicing software")).toBe(true);
    expect(a.citations.length).toBe(18);
    expect(a.citations.every((c) => !c.title?.includes("Opens in new tab"))).toBe(true);
  });

  it("treats a missing AI Overview as a result, not an error", () => {
    const a = normalize("ai_overviews", {
      keyword: "q",
      index: 0,
      aio_text: null,
      aio_citations: null,
    });
    expect(a.ok).toBe(true);
    expect(a.shown).toBe(false);
  });

  it("surfaces scraper errors", () => {
    const a = normalize("perplexity", fixture("perplexity"));
    expect(a.ok).toBe(false);
    expect(a.error).toMatchObject({ kind: "blocked", retryable: true });
    expect(a.error?.message).toMatch(/too many requests/);
    expect(a.prompt).toMatch(/invoicing software/);
    expect(a.costUsd).toBe(0);
  });

  it("drops the bulky HTML fields", () => {
    const a = normalize("chatgpt", {
      ...fixture("chatgpt"),
      answer_html: "<p>huge</p>",
      page_html: "x",
    });
    expect(a.raw).not.toHaveProperty("answer_html");
    expect(a.raw).not.toHaveProperty("page_html");
  });
});

describe("matchRecords", () => {
  const inputs = [
    { prompt: "best invoicing app", country: "US" },
    { prompt: "best invoicing app", country: "IN" },
    { prompt: "invoice with GST", country: "IN" },
  ];

  it("pairs records with inputs by the echoed index, in any order", () => {
    const results = matchRecords("chatgpt", inputs, [
      { index: 2, prompt: "invoice with GST", answer_text: "C" },
      { index: 0, prompt: "best invoicing app", answer_text: "A" },
      { index: 1, prompt: "best invoicing app", answer_text: "B" },
    ]);
    expect(results.map((r) => r.text)).toEqual(["A", "B", "C"]);
    expect(results.map((r) => r.country)).toEqual(["US", "IN", "IN"]);
  });

  it("falls back to prompt and country when the index isn't echoed", () => {
    const results = matchRecords("ai_overviews", inputs, [
      { keyword: "best invoicing app", country: "IN", aio_text: "India", input: { index: "" } },
      { keyword: "best invoicing app", country: "US", aio_text: "US", input: { index: "" } },
    ]);
    expect(results[0].text).toBe("US");
    expect(results[1].text).toBe("India");
  });

  it("reads failed records from their echoed input", () => {
    const [first] = matchRecords("chatgpt", inputs.slice(0, 1), [
      {
        error: "Sign in page shown",
        error_code: "blocked",
        input: { prompt: "best invoicing app", country: "US", index: 0 },
      },
    ]);
    expect(first.ok).toBe(false);
    expect(first.error?.kind).toBe("blocked");
  });

  it("reports inputs with no record as failed and retryable, one result per input", () => {
    const results = matchRecords("chatgpt", inputs, [
      { index: 0, prompt: "best invoicing app", answer_text: "A" },
      { index: 9, prompt: "a prompt from another batch", answer_text: "?" },
    ]);
    expect(results).toHaveLength(3);
    expect(results[0].ok).toBe(true);
    expect(results[1]).toMatchObject({ ok: false, index: 1, error: { retryable: true } });
    expect(results[2].prompt).toBe("invoice with GST");
  });

  it("bills delivered answers and not failed ones", () => {
    const [ok, bad] = matchRecords("chatgpt", inputs.slice(0, 2), [
      { index: 0, prompt: "best invoicing app", answer_text: "A" },
      { index: 1, prompt: "best invoicing app", error: "Browser disconnected" },
    ]);
    expect(ok.costUsd).toBeGreaterThan(0);
    expect(bad.costUsd).toBe(0);
  });
});

describe("BrightDataProvider", () => {
  afterEach(() => vi.unstubAllGlobals());

  /** Answer Bright Data's API from a script, recording each request. */
  function stubApi(routes: Record<string, () => Response>) {
    const calls: { url: string; body?: unknown }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
        const route = Object.keys(routes).find((r) => url.includes(r));
        return route ? routes[route]() : new Response("not found", { status: 404 });
      }),
    );
    return calls;
  }

  it("sends one batch with uppercase countries and web search allowed", async () => {
    const calls = stubApi({ "/trigger": () => Response.json({ snapshot_id: "s_1" }) });
    const provider = new BrightDataProvider("key");
    const id = await provider.submit("chatgpt", [{ prompt: "a", country: "us" }, { prompt: "b" }]);
    expect(id).toBe("s_1");
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain("dataset_id=gd_m7aof0k82r803d5bjm");
    expect(calls[0].body).toEqual({
      input: [
        { url: "https://chatgpt.com/", prompt: "a", index: 0, country: "US", web_search: true },
        { url: "https://chatgpt.com/", prompt: "b", index: 1, web_search: true },
      ],
    });
  });

  it("maps progress to job states", async () => {
    let status = "running";
    stubApi({ "/progress/": () => Response.json({ status, error_message: "boom" }) });
    const provider = new BrightDataProvider("key");
    expect(await provider.check("s_1")).toEqual({ state: "pending", detail: "running" });
    status = "ready";
    expect(await provider.check("s_1")).toEqual({ state: "ready" });
    status = "failed";
    expect(await provider.check("s_1")).toMatchObject({ state: "failed" });
  });

  it("turns a rejected key into an auth error", async () => {
    stubApi({ "/trigger": () => new Response("invalid token", { status: 401 }) });
    await expect(
      new BrightDataProvider("bad").submit("gemini", [{ prompt: "a" }]),
    ).rejects.toMatchObject({ kind: "auth", retryable: false });
  });

  it("refuses engines it can't answer", async () => {
    const provider = new BrightDataProvider("key");
    expect(provider.supports("copilot")).toBe(false);
    await expect(provider.submit("claude", [{ prompt: "a" }])).rejects.toMatchObject({
      kind: "unavailable",
    });
  });
});
