/**
 * The metric definitions (docs/metrics.md), as pure functions of summed
 * counters. The rollup (rollup.ts) stores the counters per day, engine,
 * country, prompt and brand; any selection is a sum of rows, and these turn
 * the sum into ratios. Never average ratios: sum counters, then divide.
 */

/** Counters for one tracked brand over some selection of samples. */
export type Counters = {
  /** samples counted for this brand: asked, plus inferred for your own brand */
  samples: number;
  /** asked samples (with an answer) */
  asked: number;
  /** samples naming the brand, inferred ones included */
  mentioned: number;
  /** asked samples naming the brand: its mentions */
  mentions: number;
  /** asked samples naming it with a position */
  positioned: number;
  positionSum: number;
  /** sum of 1 / position over positioned samples */
  reciprocalSum: number;
  /** mentions of every tracked brand in the same asked samples */
  allMentions: number;
  /** citations of this brand's pages, and all citations, in asked samples */
  citations: number;
  allCitations: number;
  rated: number;
  sentimentSum: number;
  positive: number;
  negative: number;
};

export const ZERO: Counters = {
  samples: 0,
  asked: 0,
  mentioned: 0,
  mentions: 0,
  positioned: 0,
  positionSum: 0,
  reciprocalSum: 0,
  allMentions: 0,
  citations: 0,
  allCitations: 0,
  rated: 0,
  sentimentSum: 0,
  positive: 0,
  negative: 0,
};

export const POSITIVE_FROM = 0.25;
export const NEGATIVE_FROM = -0.25;

export function add(a: Counters, b: Partial<Counters>): Counters {
  const out = { ...a };
  for (const k of Object.keys(ZERO) as (keyof Counters)[]) out[k] += Number(b[k] ?? 0);
  return out;
}

export type Metrics = {
  samples: number;
  /** 0–1 */
  mentionRate: number | null;
  averagePosition: number | null;
  /** 0–1 */
  shareOfVoice: number | null;
  /** 0–1 */
  citationShare: number | null;
  /** -1 to 1 */
  sentiment: number | null;
  /** -100 to 100 */
  netSentiment: number | null;
  /** 0–100 */
  visibilityIndex: number | null;
};

const ratio = (a: number, b: number) => (b > 0 ? a / b : null);

export function metricsOf(c: Counters): Metrics {
  const mentionRate = ratio(c.mentioned, c.samples);
  const shareOfVoice = ratio(c.mentions, c.allMentions);
  const positionScore = ratio(c.reciprocalSum, c.positioned);
  return {
    samples: c.samples,
    mentionRate,
    averagePosition: ratio(c.positionSum, c.positioned),
    shareOfVoice,
    citationShare: ratio(c.citations, c.allCitations),
    sentiment: ratio(c.sentimentSum, c.rated),
    netSentiment: c.rated ? ((c.positive - c.negative) / c.rated) * 100 : null,
    visibilityIndex:
      mentionRate === null
        ? null
        : 100 * (0.5 * mentionRate + 0.25 * (positionScore ?? 0) + 0.25 * (shareOfVoice ?? 0)),
  };
}

/**
 * Coverage: prompts naming the brand at least once ÷ prompts with samples.
 * Takes the brand's counters per prompt.
 */
export function coverageOf(perPrompt: Counters[]): number | null {
  const tracked = perPrompt.filter((c) => c.samples > 0);
  return ratio(tracked.filter((c) => c.mentioned > 0).length, tracked.length);
}
