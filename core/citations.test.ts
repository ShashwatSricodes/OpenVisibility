import { describe, expect, it } from "vitest";
import { citationRows, classify, normalizeUrl, type Owners } from "./citations";

describe("normalizeUrl", () => {
  it("strips tracking, highlights and www, and lowercases the host", () => {
    expect(
      normalizeUrl(
        "https://WWW.Zoho.com/invoice/Pricing?utm_source=chatgpt.com&plan=pro&gclid=1#:~:text=free",
      ),
    ).toEqual({ url: "https://zoho.com/invoice/Pricing?plan=pro", domain: "zoho.com" });
  });

  it("keeps parameters that may change the page", () => {
    expect(normalizeUrl("https://github.com/x/y?ref=main&tab=readme")?.url).toBe(
      "https://github.com/x/y?ref=main&tab=readme",
    );
  });

  it("drops default ports and an empty query", () => {
    expect(normalizeUrl("https://example.com:443/?utm_medium=x")?.url).toBe("https://example.com/");
  });

  it("rejects things that aren't web pages", () => {
    expect(normalizeUrl("mailto:hi@zoho.com")).toBeNull();
    expect(normalizeUrl("not a url")).toBeNull();
  });
});

const owners: Owners = {
  owned: ["ledgerly.app"],
  competitors: [
    { id: "zoho", domains: ["zoho.com"] },
    { id: "fresh", domains: ["freshbooks.com"] },
  ],
};

describe("classify", () => {
  it("labels own, competitor and third-party domains, subdomains included", () => {
    expect(classify("help.ledgerly.app", owners)).toEqual({ kind: "owned", competitorId: null });
    expect(classify("zoho.com", owners)).toEqual({ kind: "competitor", competitorId: "zoho" });
    expect(classify("g2.com", owners)).toEqual({ kind: "third_party", competitorId: null });
    expect(classify("notzoho.com", owners).kind).toBe("third_party");
  });
});

describe("citationRows", () => {
  it("cleans, labels and counts each page once", () => {
    const rows = citationRows(
      [
        { url: "https://www.g2.com/compare?utm_source=x", title: " G2 " },
        { url: "https://g2.com/compare" },
        { url: "https://freshbooks.com/", position: 2 },
        { url: "javascript:void(0)" },
      ],
      owners,
    );
    expect(rows).toEqual([
      {
        url: "https://g2.com/compare",
        domain: "g2.com",
        title: "G2",
        position: 1,
        kind: "third_party",
        competitorId: null,
      },
      {
        url: "https://freshbooks.com/",
        domain: "freshbooks.com",
        title: null,
        position: 2,
        kind: "competitor",
        competitorId: "fresh",
      },
    ]);
  });
});
