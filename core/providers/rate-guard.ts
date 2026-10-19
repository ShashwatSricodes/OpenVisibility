/**
 * Process-wide protection for one Bright Data account's API.
 *
 * Bright Data blocks the calling IP after 25 HTTP 429 responses within
 * 5 minutes, and only its support can lift the block. Every request for a
 * key goes through one guard, which spaces requests out and, after
 * `max429` rate-limit responses in the window, refuses further calls until
 * the window has passed: the run pauses instead of getting the server banned.
 */

import { createHash } from "node:crypto";
import { ProviderError } from "./errors";

export type RateGuardOptions = {
  /** minimum time between two requests */
  minGapMs: number;
  /** 429 responses within the window before calls stop */
  max429: number;
  windowMs: number;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
};

const DEFAULTS: RateGuardOptions = {
  minGapMs: 200,
  // well under Bright Data's 25, leaving room for anything else on this IP
  max429: 10,
  windowMs: 5 * 60_000,
  now: () => Date.now(),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
};

export class RateGuard {
  private readonly opts: RateGuardOptions;
  private last = -Infinity;
  private hits: number[] = [];
  private openUntil = 0;
  /** requests queue up here, so concurrent callers still keep their distance */
  private queue: Promise<void> = Promise.resolve();

  constructor(opts: Partial<RateGuardOptions> = {}) {
    this.opts = { ...DEFAULTS, ...opts };
  }

  /** Wait for a turn to call the API. Throws `rate_limited` while calls are paused. */
  before(): Promise<void> {
    const turn = this.queue.then(async () => {
      const { now, sleep, minGapMs } = this.opts;
      if (now() < this.openUntil) {
        const seconds = Math.ceil((this.openUntil - now()) / 1000);
        throw new ProviderError(
          "rate_limited",
          `Calls to Bright Data are paused for ${seconds}s after ${this.opts.max429} rate-limit responses in 5 minutes, to stay clear of Bright Data's IP block.`,
        );
      }
      const wait = this.last + minGapMs - now();
      if (wait > 0) await sleep(wait);
      this.last = now();
    });
    // a refused turn mustn't block the queue for the callers after it
    this.queue = turn.catch(() => {});
    return turn;
  }

  /** Note a 429. Enough of them pause every call for the rest of the window. */
  record429() {
    const { now, windowMs, max429 } = this.opts;
    const t = now();
    this.hits = this.hits.filter((h) => t - h < windowMs);
    this.hits.push(t);
    if (this.hits.length >= max429) this.openUntil = t + windowMs;
  }

  get paused() {
    return this.opts.now() < this.openUntil;
  }
}

const guards = ((globalThis as unknown as { __ovGuards?: Map<string, RateGuard> }).__ovGuards ??=
  new Map());

/** The one guard for this key in this process. */
export function guardFor(apiKey: string): RateGuard {
  const id = createHash("sha256").update(apiKey).digest("hex").slice(0, 16);
  let guard = guards.get(id);
  if (!guard) guards.set(id, (guard = new RateGuard()));
  return guard;
}
