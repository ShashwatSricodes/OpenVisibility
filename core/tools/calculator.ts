/**
 * The prompt calculator: how many times to ask each prompt for a mention
 * rate you can trust, and what tracking that many prompts costs.
 *
 * A mention rate from n answers is a proportion; its margin of error at 95%
 * confidence is about 1.96·√(p(1−p)/n). The worst case is p = 50%, so that's
 * what "samples for ±m" plans for unless you know your rate.
 */

import { BRIGHT_DATA_PRICING } from "../providers/registry";

const Z95 = 1.96;

/** Answers needed so the mention rate is within ±margin (0–1) of the truth, 95% of the time. */
export function answersFor(margin: number, expected = 0.5) {
  const p = Math.min(Math.max(expected, 0.01), 0.99);
  return Math.ceil((Z95 * Z95 * p * (1 - p)) / (margin * margin));
}

/** The margin of error (0–1) of a mention rate measured from n answers. */
export function marginOf(n: number, expected = 0.5) {
  if (n <= 0) return 1;
  const p = Math.min(Math.max(expected, 0.01), 0.99);
  return Z95 * Math.sqrt((p * (1 - p)) / n);
}

export type Plan = {
  prompts: number;
  engines: number;
  countries: number;
  /** times each prompt is asked per run */
  samples: number;
  runsPerMonth: number;
};

export function costOf(plan: Plan) {
  const perRun = plan.prompts * plan.engines * plan.countries * plan.samples;
  const perMonth = perRun * plan.runsPerMonth;
  const paid = Math.max(0, perMonth - BRIGHT_DATA_PRICING.freeAnswersPerMonth);
  return {
    perRun,
    perMonth,
    /** at Bright Data's pay-as-you-go price, after the free answers */
    usd: paid * BRIGHT_DATA_PRICING.perAnswerUsd,
    withinFreeTier: perMonth <= BRIGHT_DATA_PRICING.freeAnswersPerMonth,
    /**
     * Answers behind one engine's overall mention rate in a month: every
     * prompt, country and sample of that engine.
     */
    answersPerEngine: plan.prompts * plan.countries * plan.samples * plan.runsPerMonth,
  };
}
