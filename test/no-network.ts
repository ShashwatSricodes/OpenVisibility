/**
 * Tests never touch the network: a real request fails the test that made it.
 * Tests that need a response stub `fetch` themselves (vi.stubGlobal).
 */

globalThis.fetch = (async (input: RequestInfo | URL) => {
  throw new Error(`Tests must not use the network (tried ${String(input)}). Stub fetch instead.`);
}) as typeof fetch;
