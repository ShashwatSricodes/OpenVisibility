import { describe, expect, it } from "vitest";
import { env, requireEnv } from "./env";

describe("env", () => {
  it("treats empty keys as unset and applies defaults", () => {
    const e = env({ BRIGHT_DATA_API_KEY: "  ", NODE_ENV: "test" });
    expect(e.BRIGHT_DATA_API_KEY).toBeUndefined();
    expect(e.PERPLEXITY_DIRECT_MODEL).toBe("sonar-pro");
  });

  it("rejects an invalid NODE_ENV", () => {
    expect(() => env({ NODE_ENV: "staging" })).toThrow(/NODE_ENV/);
  });
});

describe("requireEnv", () => {
  it("returns a set key", () => {
    expect(requireEnv("BRIGHT_DATA_API_KEY", { BRIGHT_DATA_API_KEY: "abc" })).toBe("abc");
  });

  it("explains where to get a missing key", () => {
    expect(() => requireEnv("AI_GATEWAY_API_KEY", {})).toThrow(/AI Gateway/);
  });
});
