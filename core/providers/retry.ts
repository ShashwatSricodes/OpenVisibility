/**
 * Retrying a batch the way a run should: only the answers that failed are
 * asked again, after a pause that doubles each time, and an engine that
 * turns the whole batch away twice running is left alone for the rest of
 * the run instead of being hammered (Perplexity does this today).
 *
 * A batch that timed out is resumed by its job ID, never resubmitted, so
 * nothing is paid for twice. Errors no retry can fix (a bad key, a bad
 * request, an engine without a data source) are thrown straight away.
 */

import { ProviderError } from "./errors";
import { query } from "./query";
import type { EngineId, ItemError, Provider, QueryInput, QueryResult } from "./types";

export type RetryOptions = NonNullable<Parameters<typeof query>[3]> & {
  /** times each input is tried, counting the first */
  maxAttempts?: number;
  /** pause before the first retry; doubles after each attempt */
  backoffMs?: number;
  onRetry?: (info: { attempt: number; waitMs: number; retrying: number; reason: string }) => void;
};

export type RetryOutcome = {
  /** one per input, in input order */
  results: QueryResult[];
  /** every provider job used, for the run's records */
  jobIds: string[];
  attempts: number;
  /** the engine refused whole batches twice in a row; skip it for this run */
  engineBlocked: boolean;
};

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const refused = (r: QueryResult) =>
  !r.ok && (r.error?.kind === "blocked" || r.error?.kind === "rate_limited");

export async function queryWithRetries(
  provider: Provider,
  engine: EngineId,
  inputs: QueryInput[],
  {
    maxAttempts = 3,
    backoffMs = 30_000,
    onRetry,
    sleep: wait = sleep,
    ...queryOpts
  }: RetryOptions = {},
): Promise<RetryOutcome> {
  const results: (QueryResult | undefined)[] = new Array(inputs.length);
  const jobIds: string[] = [];
  let pending = inputs.map((_, i) => i);
  let attempt = 0;
  let refusedStreak = 0;
  let engineBlocked = false;
  let resume: string | undefined;
  let lastError: ItemError | undefined;

  while (pending.length > 0 && attempt < maxAttempts) {
    attempt++;
    let reason: string;
    let whollyRefused = false;
    try {
      const batch = pending.map((i) => inputs[i]);
      const { jobId, results: got } = await query(provider, engine, batch, {
        ...queryOpts,
        sleep: wait,
        jobId: resume,
      });
      resume = undefined;
      if (!jobIds.includes(jobId)) jobIds.push(jobId);
      got.forEach((r, j) => (results[pending[j]] = { ...r, index: pending[j] }));

      whollyRefused = got.length > 0 && got.every(refused);
      refusedStreak = whollyRefused ? refusedStreak + 1 : 0;
      if (refusedStreak >= 2) {
        engineBlocked = true;
        break;
      }
      pending = pending.filter((i) => !results[i]!.ok && results[i]!.error?.retryable);
      reason = whollyRefused ? "the engine refused the whole batch" : "some answers failed";
    } catch (err) {
      if (!(err instanceof ProviderError) || !err.retryable) throw err;
      lastError = err.toItemError();
      // a timed-out job may still finish: check on it again rather than paying twice
      if (err.kind === "timeout" && err.jobId) resume = err.jobId;
      reason = err.message;
    }

    if (pending.length > 0 && attempt < maxAttempts) {
      // a refusal suggests the engine is pushing back, so wait longer
      const waitMs = backoffMs * 2 ** (attempt - 1) * (whollyRefused ? 2 : 1);
      onRetry?.({ attempt, waitMs, retrying: pending.length, reason });
      await wait(waitMs);
    }
  }

  return {
    results: inputs.map(
      (input, i): QueryResult =>
        results[i] ?? {
          engine,
          source: provider.source,
          prompt: input.prompt,
          country: input.country,
          index: i,
          ok: false,
          error: lastError ?? {
            kind: "upstream",
            message: "Not answered after retrying",
            retryable: true,
          },
          text: "",
          citations: [],
          links: [],
          costUsd: 0,
          raw: {},
        },
    ),
    jobIds,
    attempts: attempt,
    engineBlocked,
  };
}
