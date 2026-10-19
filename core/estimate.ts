/**
 * How many Bright Data answers a run uses, and whether that fits in what's
 * left of the free tier. No database code, so pages can call it directly.
 */

import { BRIGHT_DATA_PRICING } from "./providers/registry";
import type { TrackingConfig } from "./tracking-rules";

/** How many times each prompt is asked per engine and country, to smooth out answer variance. */
export const DEFAULT_SAMPLES = 3;

export type RunEstimate = {
  prompts: number;
  /** answers one run uses */
  answers: number;
};

/**
 * Answers for one run: for each active prompt, engines × countries × samples.
 * A prompt's own countries replace the workspace's.
 */
export function estimateRun(
  prompts: { countries: string[] }[],
  config: TrackingConfig,
  samples = DEFAULT_SAMPLES,
): RunEstimate {
  const answers = prompts.reduce(
    (sum, p) =>
      sum + config.engines.length * (p.countries.length || config.countries.length) * samples,
    0,
  );
  return { prompts: prompts.length, answers };
}

export type FreeTierCheck = {
  /** free answers left before the run */
  remaining: number;
  /** free answers left after it */
  after: number;
  fits: boolean;
  /** answers past the free tier */
  overBy: number;
  /** what the answers past the free tier cost at pay-as-you-go prices */
  costUsd: number;
};

export function checkFreeTier(answers: number, used: number, limit: number): FreeTierCheck {
  const remaining = Math.max(0, limit - used);
  const overBy = Math.max(0, answers - remaining);
  return {
    remaining,
    after: Math.max(0, remaining - answers),
    fits: overBy === 0,
    overBy,
    costUsd: Number((overBy * BRIGHT_DATA_PRICING.perAnswerUsd).toFixed(4)),
  };
}

/** Start of this month and the moment the free tier resets (the 1st, UTC). */
export function monthWindow(now = new Date()) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const resetsAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { start, resetsAt };
}

/** Days left in the month, counting today: how many daily runs remain before the reset. */
export function daysLeftInMonth(now = new Date()) {
  const { resetsAt } = monthWindow(now);
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((resetsAt.getTime() - today) / 86_400_000);
}
