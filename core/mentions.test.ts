import { describe, expect, it } from "vitest";
import { detectMentions, snippetAt, type Entity } from "./mentions";

const brand: Entity = {
  competitorId: null,
  name: "Ledgerly",
  aliases: ["Ledgerly Invoicing"],
  domains: ["ledgerly.app"],
};
const zoho: Entity = {
  competitorId: "zoho",
  name: "Zoho Invoice",
  aliases: ["Zoho"],
  domains: ["zoho.com"],
};
const wave: Entity = { competitorId: "wave", name: "Wave", aliases: [], domains: ["waveapps.com"] };
const fresh: Entity = {
  competitorId: "fresh",
  name: "FreshBooks",
  aliases: [],
  domains: ["freshbooks.com"],
};
const all = [brand, zoho, wave, fresh];

const ids = (text: string, entities = all) =>
  detectMentions(text, entities).map((m) => m.competitorId ?? "brand");

describe("matching", () => {
  it("is case-insensitive for multi-word names and domains", () => {
    expect(ids("I like ZOHO INVOICE and ledgerly.APP")).toEqual(["zoho", "brand"]);
  });

  it("counts possessives and punctuation, not longer words", () => {
    expect(ids("Ledgerly's templates are nice.")).toEqual(["brand"]);
    expect(ids("Ledgerly’s app (FreshBooks, too).")).toEqual(["brand", "fresh"]);
    expect(ids("Ledgerlyish tools and FreshBooksPro")).toEqual([]);
  });

  it("doesn't take a common word for a brand", () => {
    expect(ids("A new wave of invoicing apps")).toEqual([]);
    expect(ids("Wave is free for small businesses.")).toEqual(["wave"]);
    expect(ids("Try **Wave** or ledgerly")).toEqual(["wave"]); // a single word must be capitalised
  });

  it("matches aliases, and the longest name when they overlap", () => {
    const found = detectMentions("Ledgerly Invoicing beats Zoho Invoice.", all);
    expect(found.map((m) => m.competitorId)).toEqual([null, "zoho"]);
    expect(found[1].index).toBe(25);
  });

  it("is Unicode-safe", () => {
    const cafe: Entity = { competitorId: "c", name: "Café Pro", aliases: [], domains: [] };
    expect(ids("Prueba Café Pro: rápido.", [cafe])).toEqual(["c"]);
    expect(ids("CaféProX", [cafe])).toEqual([]);
    const jp: Entity = { competitorId: "j", name: "フリー", aliases: [], domains: [] };
    expect(ids("おすすめは フリー です", [jp])).toEqual(["j"]);
  });

  it("names with symbols", () => {
    const cpp: Entity = { competitorId: "c", name: "C++ Builder", aliases: [], domains: [] };
    expect(ids("Use C++ Builder today", [cpp])).toEqual(["c"]);
  });
});

describe("URLs", () => {
  it("counts a link to the brand's own site", () => {
    expect(ids("See https://www.zoho.com/invoice/pricing for prices.")).toEqual(["zoho"]);
    expect(ids("[pricing](https://app.ledgerly.app/plans)")).toEqual(["brand"]);
  });

  it("ignores a brand's name in someone else's URL", () => {
    expect(ids("Read https://example.com/best-freshbooks-alternatives-wave")).toEqual([]);
    expect(ids("Source: https://blog.example.com/Ledgerly-review")).toEqual([]);
  });

  it("still counts a bare domain in the text", () => {
    expect(ids("Head to freshbooks.com to sign up.")).toEqual(["fresh"]);
  });
});

describe("position", () => {
  it("ranks by a numbered list", () => {
    const text = `Here are some options. Zoho is popular.

1. **FreshBooks**: great for freelancers
2. **Ledgerly**: simple and cheap
3. **Zoho Invoice**: free

Overall, Wave is also worth a look.`;
    const found = detectMentions(text, all);
    expect(found.map((m) => [m.competitorId ?? "brand", m.position])).toEqual([
      ["fresh", 1],
      ["brand", 2],
      ["zoho", 3],
      ["wave", 4],
    ]);
  });

  it("ranks by a bulleted list and headings", () => {
    const text = "### 1. Ledgerly\nGood.\n### 2. Wave\nFree.\n- FreshBooks: pricier";
    expect(ids(text)).toEqual(["brand", "wave", "fresh"]);
  });

  it("falls back to order of first appearance", () => {
    expect(ids("Wave and FreshBooks are fine, but Ledgerly is best. Wave again.")).toEqual([
      "wave",
      "fresh",
      "brand",
    ]);
  });

  it("gives one mention per brand", () => {
    expect(detectMentions("Ledgerly, Ledgerly, ledgerly.app", all)).toHaveLength(1);
  });
});

describe("snippets", () => {
  it("is the sentence around the first match", () => {
    const [m] = detectMentions("Intro here. I'd pick **Ledgerly** for most people! Next.", all);
    expect(m.snippet).toBe("I'd pick Ledgerly for most people!");
  });

  it("trims a long sentence around the match", () => {
    const long = `${"word ".repeat(80)}Ledgerly ${"more ".repeat(80)}`;
    const s = snippetAt(long, 400, 408, 100);
    expect(s.length).toBeLessThanOrEqual(102);
    expect(s).toContain("Ledgerly");
    expect(s.startsWith("…") && s.endsWith("…")).toBe(true);
  });
});
