/**
 * The provider contract. The worker, the analysis and the dashboard reach AI
 * engines only through this, so adding a data source means one new adapter
 * in core/providers and nothing else.
 *
 * Providers work as jobs because the consumer-app scrapers do: submit a
 * batch, check on it, collect the answers. The job ID is stored on each run
 * item (`run_items.external_id`), so a restarted worker picks up a job it
 * already paid for instead of asking again.
 */

import type { answerSource, engine } from "@/db/schema";
import type { ProviderErrorKind } from "./errors";

export type EngineId = (typeof engine.enumValues)[number];
export type AnswerSource = (typeof answerSource.enumValues)[number];

export type QueryInput = {
  prompt: string;
  /** two-letter country code, e.g. "US" or "IN" */
  country?: string;
};

export type Citation = { url: string; title?: string; position?: number };

/** Why one answer in a batch failed. Plain data, so it can be stored as is. */
export type ItemError = { kind: ProviderErrorKind; message: string; retryable: boolean };

export type QueryResult = {
  engine: EngineId;
  source: AnswerSource;
  prompt: string;
  country?: string;
  /** position of the input in the batch it was submitted with */
  index: number;
  ok: boolean;
  error?: ItemError;
  text: string;
  /** the sources the engine cites */
  citations: Citation[];
  /** links inside the answer text, separate from the cited sources */
  links: Citation[];
  /** model the app used, when the provider reports it */
  model?: string;
  /** whether the engine searched the web, when the provider reports it */
  webSearchTriggered?: boolean;
  /** AI Overviews only: whether Google showed an overview for this query */
  shown?: boolean;
  /** what this answer costs at list price; failed answers aren't billed */
  costUsd: number;
  /** the provider's record, minus bulky HTML; kept for debugging and re-parsing */
  raw: Record<string, unknown>;
};

export type JobState =
  | { state: "pending"; detail?: string }
  | { state: "ready" }
  | { state: "failed"; error: ItemError };

export interface Provider {
  readonly id: string;
  readonly source: AnswerSource;
  supports(engine: EngineId): boolean;
  /** Start answering a batch of prompts on one engine. Returns the job ID. */
  submit(engine: EngineId, inputs: QueryInput[]): Promise<string>;
  /** Where a job has got to. Cheap enough to call every few seconds. */
  check(jobId: string): Promise<JobState>;
  /**
   * The answers of a ready job: exactly one result per input, in input order.
   * An input the provider lost comes back as a failed, retryable result.
   */
  collect(engine: EngineId, jobId: string, inputs: QueryInput[]): Promise<QueryResult[]>;
}
