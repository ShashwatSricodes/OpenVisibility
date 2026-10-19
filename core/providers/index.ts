/**
 * The one way into the providers: `getProvider(engine)` picks the data
 * source for an engine, and `query()` runs a batch from start to finish.
 * The worker uses submit / check / collect directly so it can survive restarts.
 */

import { env } from "../env";
import { BrightDataProvider } from "./brightdata";
import { ProviderError } from "./errors";
import { ENGINES } from "./registry";
import type { EngineId, Provider, QueryInput, QueryResult } from "./types";

export * from "./errors";
export * from "./registry";
export type * from "./types";

export type ProviderKeys = {
  /** the workspace's own key; falls back to BRIGHT_DATA_API_KEY */
  brightData?: string;
};

export function getProvider(engine: EngineId, keys: ProviderKeys = {}): Provider {
  const info = ENGINES[engine];
  if (!info) throw new ProviderError("bad_input", `Unknown engine "${engine}"`);

  switch (info.provider) {
    case "brightdata": {
      const key = keys.brightData ?? env().BRIGHT_DATA_API_KEY;
      if (!key)
        throw new ProviderError(
          "auth",
          `${info.name} answers come from Bright Data, and no Bright Data key is set. Add your key in Settings, or set BRIGHT_DATA_API_KEY in .env.local (the free tier covers 5,000 answers a month).`,
        );
      return new BrightDataProvider(key);
    }
    case null:
      throw new ProviderError(
        "unavailable",
        `${info.name} isn't available yet. ${info.note ?? ""}`,
      );
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Submit a batch, wait for it and return one result per input. On timeout
 * the error carries the job ID, because the job may still finish and
 * checking it again costs nothing.
 */
export async function query(
  provider: Provider,
  engine: EngineId,
  inputs: QueryInput[],
  {
    pollMs = 10_000,
    timeoutMs = 15 * 60_000,
    onState,
  }: { pollMs?: number; timeoutMs?: number; onState?: (state: string, jobId: string) => void } = {},
): Promise<{ jobId: string; results: QueryResult[] }> {
  const jobId = await provider.submit(engine, inputs);
  const deadline = Date.now() + timeoutMs;

  while (true) {
    const job = await provider.check(jobId);
    onState?.(job.state === "pending" ? (job.detail ?? "pending") : job.state, jobId);
    if (job.state === "ready") break;
    if (job.state === "failed") throw new ProviderError(job.error.kind, job.error.message);
    if (Date.now() + pollMs > deadline)
      throw new ProviderError(
        "timeout",
        `Job ${jobId} not ready after ${Math.round(timeoutMs / 1000)}s; check it again later`,
      );
    await sleep(pollMs);
  }

  return { jobId, results: await provider.collect(engine, jobId, inputs) };
}
