/**
 * Run one batch from start to finish: submit, wait, collect.
 */

import { ProviderError } from "./errors";
import type { EngineId, Provider, QueryInput, QueryResult } from "./types";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Submit a batch, wait for it and return one result per input. On timeout
 * the error carries the job ID, because the job may still finish and
 * checking it again costs nothing: pass it back as `jobId` to resume
 * instead of submitting (and paying for) the batch again.
 */
export async function query(
  provider: Provider,
  engine: EngineId,
  inputs: QueryInput[],
  {
    pollMs = 10_000,
    timeoutMs = 15 * 60_000,
    onState,
    jobId: resume,
    sleep: wait = sleep,
  }: {
    pollMs?: number;
    timeoutMs?: number;
    onState?: (state: string, jobId: string) => void;
    /** an existing job for these same inputs, to resume */
    jobId?: string;
    sleep?: (ms: number) => Promise<void>;
  } = {},
): Promise<{ jobId: string; results: QueryResult[] }> {
  const jobId = resume ?? (await provider.submit(engine, inputs));
  const deadline = Date.now() + timeoutMs;

  while (true) {
    const job = await provider.check(jobId);
    onState?.(job.state === "pending" ? (job.detail ?? "pending") : job.state, jobId);
    if (job.state === "ready") break;
    if (job.state === "failed")
      throw new ProviderError(job.error.kind, job.error.message, undefined, jobId);
    if (Date.now() + pollMs > deadline)
      throw new ProviderError(
        "timeout",
        `Job ${jobId} not ready after ${Math.round(timeoutMs / 1000)}s; check it again later`,
        undefined,
        jobId,
      );
    await wait(pollMs);
  }

  return { jobId, results: await provider.collect(engine, jobId, inputs) };
}
