import { describe, expect, it } from "vitest";
import { BrightDataProvider } from "./brightdata";
import { FakeProvider } from "./fake";
import { ENGINES, ProviderError, getProvider, query } from "./index";

describe("getProvider", () => {
  it("uses Bright Data for the consumer apps", () => {
    expect(getProvider("chatgpt", { brightData: "key" })).toBeInstanceOf(BrightDataProvider);
  });

  it("explains a missing key", () => {
    // an empty key, so the test doesn't depend on .env.local
    expect(() => getProvider("gemini", { brightData: "" })).toThrow(/BRIGHT_DATA_API_KEY/);
  });

  it("says when an engine has no data source yet", () => {
    for (const engine of ["claude", "copilot", "grok"] as const) {
      expect(() => getProvider(engine, { brightData: "key" })).toThrow(ProviderError);
    }
  });

  it("has a provider for every engine the registry doesn't mark unavailable", () => {
    for (const info of Object.values(ENGINES)) {
      if (info.status === "unavailable") expect(info.provider).toBeNull();
      else expect(getProvider(info.id, { brightData: "key" }).supports(info.id)).toBe(true);
    }
  });
});

describe("query", () => {
  it("submits, waits and collects one result per input", async () => {
    const provider = new FakeProvider({ pendingChecks: 2 });
    const states: string[] = [];
    const { jobId, results } = await query(
      provider,
      "chatgpt",
      [{ prompt: "a" }, { prompt: "b", country: "IN" }],
      { pollMs: 0, onState: (s) => states.push(s) },
    );
    expect(jobId).toBe("fake-1");
    expect(states).toEqual(["running", "running", "ready"]);
    expect(results.map((r) => [r.prompt, r.country, r.ok])).toEqual([
      ["a", undefined, true],
      ["b", "IN", true],
    ]);
  });

  it("times out with the job ID, so the job can be checked again later", async () => {
    const provider = new FakeProvider({ pendingChecks: 100 });
    await expect(
      query(provider, "gemini", [{ prompt: "a" }], { pollMs: 1, timeoutMs: 5 }),
    ).rejects.toMatchObject({ kind: "timeout", retryable: true, message: /fake-1/ });
  });

  it("passes failed answers through without throwing", async () => {
    const provider = new FakeProvider({
      reply: (input) =>
        input.prompt === "b"
          ? { error: { kind: "blocked", message: "Sign in page shown", retryable: true } }
          : { text: "fine" },
    });
    const { results } = await query(provider, "chatgpt", [{ prompt: "a" }, { prompt: "b" }], {
      pollMs: 0,
    });
    expect(results.map((r) => r.ok)).toEqual([true, false]);
    expect(results[1].text).toBe("");
  });
});
