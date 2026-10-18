import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { normalize, type BrightDataEngine } from "./brightdata";

/* real records captured by `npm run spike:bd` on 18 October 2026 */
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
    expect(a.error).toMatch(/too many requests/);
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
