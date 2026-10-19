/**
 * A provider that answers instantly from a script, for tests and for working
 * on the worker and dashboard without spending Bright Data answers.
 */

import { ProviderError } from "./errors";
import type { EngineId, JobState, Provider, QueryInput, QueryResult } from "./types";

type Reply = Partial<Pick<QueryResult, "text" | "citations" | "links" | "model" | "error">>;

export class FakeProvider implements Provider {
  readonly id = "fake";
  readonly source = "consumer_app" as const;
  /** every batch submitted, for assertions */
  readonly submitted: { engine: EngineId; inputs: QueryInput[] }[] = [];
  private jobs = new Map<string, { checksLeft: number; inputs: QueryInput[] }>();

  constructor(
    private readonly opts: {
      /** what to answer for a prompt; default: a short answer naming the prompt */
      reply?: (input: QueryInput, engine: EngineId) => Reply;
      /** how many checks a job stays pending */
      pendingChecks?: number;
      /** make submit fail, e.g. to test error handling */
      submitError?: ProviderError;
    } = {},
  ) {}

  supports() {
    return true;
  }

  async submit(engine: EngineId, inputs: QueryInput[]) {
    if (this.opts.submitError) throw this.opts.submitError;
    const jobId = `fake-${this.submitted.length + 1}`;
    this.submitted.push({ engine, inputs });
    this.jobs.set(jobId, { checksLeft: this.opts.pendingChecks ?? 0, inputs });
    return jobId;
  }

  async check(jobId: string): Promise<JobState> {
    const job = this.jobs.get(jobId);
    if (!job) throw new ProviderError("bad_input", `No job ${jobId}`);
    if (job.checksLeft-- > 0) return { state: "pending", detail: "running" };
    return { state: "ready" };
  }

  async collect(engine: EngineId, _jobId: string, inputs: QueryInput[]) {
    return inputs.map((input, index): QueryResult => {
      const reply = this.opts.reply?.(input, engine) ?? {
        text: `An answer to "${input.prompt}".`,
      };
      return {
        engine,
        source: this.source,
        prompt: input.prompt,
        country: input.country,
        index,
        citations: [],
        links: [],
        ...reply,
        ok: !reply.error,
        text: reply.error ? "" : (reply.text ?? ""),
        costUsd: 0,
        raw: { fake: true },
      };
    });
  }
}
