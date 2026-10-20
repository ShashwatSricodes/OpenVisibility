import { describe, expect, it } from "vitest";
import { mentionsBrand } from "./brand-mention";

const brand = { name: "Ledgerly", domains: ["ledgerly.app"] };

describe("mentionsBrand", () => {
  it("finds the name as a whole word, in any case", () => {
    expect(mentionsBrand("Try ledgerly or Zoho.", brand)).toBe(true);
    expect(mentionsBrand("**Ledgerly**: best for freelancers", brand)).toBe(true);
    expect(mentionsBrand("Ledgerlyish tools", brand)).toBe(false);
    expect(mentionsBrand("Try Zoho.", brand)).toBe(false);
  });

  it("finds a domain", () => {
    expect(
      mentionsBrand("See ledgerly.app/pricing", { name: "Acme", domains: ["ledgerly.app"] }),
    ).toBe(true);
  });

  it("handles names with symbols", () => {
    expect(mentionsBrand("Use C++ Builder", { name: "C++ Builder", domains: [] })).toBe(true);
  });
});
