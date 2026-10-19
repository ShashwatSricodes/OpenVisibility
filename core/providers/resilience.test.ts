/** Rate guard and run-level retries, with a fake clock and a fake provider: no network, no waiting. */

import { afterEach, describe, expect, it, vi } from "vitest";
import { BrightDataClient } from "./brightdata";
import { ProviderError } from "./errors";
import { FakeProvider } from "./fake";
import { RateGuard } from "./rate-guard";
import { queryWithRetries } from "./retry";
import type { QueryInput } from "./types";

function fakeClock() {
  let t = 1_000_000;
  const slept: number[] = [];
  return {
    now: () => t,
    sleep: async (ms: number) => {
      slept.push(ms);
      t += ms;
    },
    advance: (ms: number) => (t += ms),
    slept,
  };
}

describe("RateGuard", () => {
  it("spaces requests out, even when they arrive together", async () => {
    const clock = fakeClock();
    const guard = new RateGuard({ minGapMs: 200, now: clock.now, sleep: clock.sleep });
    await Promise.all([guard.before(), guard.before(), guard.before()]);
    expect(clock.slept).toEqual([200, 200]);
  });

  it("pauses every call after too many 429s, then lets them through again", async () => {
    const clock = fakeClock();
    const guard = new RateGuard({
      max429: 3,
      windowMs: 60_000,
      now: clock.now,
      sleep: clock.sleep,
    });
    for (let i = 0; i < 3; i++) guard.record429();
    expect(guard.paused).toBe(true);
    await expect(guard.before()).rejects.toMatchObject({ kind: "rate_limited" });
    // a refused caller doesn't jam the queue
    clock.advance(60_001);
    await expect(guard.before()).resolves.toBeUndefined();
  });

  it("forgets 429s older than the window", () => {
    const clock = fakeClock();
    const guard = new RateGuard({
      max429: 3,
      windowMs: 60_000,
      now: clock.now,
      sleep: clock.sleep,
    });
    guard.record429();
    guard.record429();
    clock.advance(61_000);
    guard.record429();
    expect(guard.paused).toBe(false);
  });
});

describe("BrightDataClient and the guard", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("counts 429s and stops calling once the guard pauses", async () => {
    const clock = fakeClock();
    const guard = new RateGuard({ minGapMs: 0, max429: 2, now: clock.now, sleep: clock.sleep });
    const fetch = vi.fn(
      async () => new Response("slow down", { status: 429, headers: { "retry-after": "0" } }),
    );
    vi.stubGlobal("fetch", fetch);
    const client = new BrightDataClient("key", guard);
    // first request: a 429, one polite retry, a second 429
    await expect(client.progress("s_1")).rejects.toMatchObject({ kind: "rate_limited" });
    expect(fetch).toHaveBeenCalledTimes(2);
    // now paused: no more requests leave the process
    await expect(client.progress("s_1")).rejects.toThrow(/paused/);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

describe("queryWithRetries", () => {
  const inputs: QueryInput[] = [{ prompt: "a" }, { prompt: "b" }, { prompt: "c" }];
  const fast = () => {
    const clock = fakeClock();
    return { clock, opts: { pollMs: 0, backoffMs: 1_000, sleep: clock.sleep } };
  };

  it("asks again only for the answers that failed, backing off", async () => {
    let calls = 0;
    const provider = new FakeProvider({
      reply: (input) => {
        calls++;
        // "b" fails on its first try only
        return input.prompt === "b" && calls <= 3
          ? { error: { kind: "upstream", message: "Browser disconnected", retryable: true } }
          : { text: `answer ${input.prompt}` };
      },
    });
    const { clock, opts } = fast();
    const out = await queryWithRetries(provider, "chatgpt", inputs, opts);

    expect(out.results.map((r) => [r.index, r.ok, r.text])).toEqual([
      [0, true, "answer a"],
      [1, true, "answer b"],
      [2, true, "answer c"],
    ]);
    expect(provider.submitted.map((s) => s.inputs.map((i) => i.prompt))).toEqual([
      ["a", "b", "c"],
      ["b"],
    ]);
    expect(out).toMatchObject({ attempts: 2, engineBlocked: false, jobIds: ["fake-1", "fake-2"] });
    expect(clock.slept).toEqual([1_000]);
  });

  it("doesn't retry answers that can't succeed", async () => {
    const provider = new FakeProvider({
      reply: () => ({ error: { kind: "bad_input", message: "dead page", retryable: false } }),
    });
    const out = await queryWithRetries(provider, "gemini", inputs, fast().opts);
    expect(provider.submitted).toHaveLength(1);
    expect(out.results.every((r) => !r.ok)).toBe(true);
  });

  it("leaves an engine alone after it refuses two whole batches", async () => {
    const provider = new FakeProvider({
      reply: () => ({
        error: { kind: "blocked", message: "too many requests", retryable: true },
      }),
    });
    const { clock, opts } = fast();
    const out = await queryWithRetries(provider, "perplexity", inputs, { ...opts, maxAttempts: 5 });
    expect(out.engineBlocked).toBe(true);
    expect(provider.submitted).toHaveLength(2);
    // a refusal doubles the usual pause
    expect(clock.slept).toEqual([2_000]);
    expect(out.results.map((r) => r.error?.kind)).toEqual(["blocked", "blocked", "blocked"]);
  });

  it("resumes a timed-out job instead of paying for it again", async () => {
    const provider = new FakeProvider({ pendingChecks: 2 });
    const out = await queryWithRetries(provider, "gemini", inputs, {
      ...fast().opts,
      pollMs: 1,
      timeoutMs: 0,
    });
    expect(provider.submitted).toHaveLength(1);
    expect(out.jobIds).toEqual(["fake-1"]);
    expect(out.attempts).toBe(3);
    expect(out.results.every((r) => r.ok)).toBe(true);
  });

  it("gives up after the last attempt with the last error", async () => {
    const provider = new FakeProvider({
      submitError: new ProviderError("upstream", "Bright Data 503"),
    });
    const out = await queryWithRetries(provider, "chatgpt", inputs, fast().opts);
    expect(out.attempts).toBe(3);
    expect(out.results.map((r) => r.error?.message)).toEqual([
      "Bright Data 503",
      "Bright Data 503",
      "Bright Data 503",
    ]);
  });

  it("throws errors no retry can fix", async () => {
    const provider = new FakeProvider({
      submitError: new ProviderError("auth", "Invalid credentials"),
    });
    await expect(queryWithRetries(provider, "chatgpt", inputs, fast().opts)).rejects.toMatchObject({
      kind: "auth",
    });
  });
});
