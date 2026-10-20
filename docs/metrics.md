# Metrics

Every number on the dashboard comes from these definitions. They're computed
for your brand and for each competitor the same way, so they can be compared
side by side, and they can be cut by day, engine, country and prompt.

Code: `core/metrics.ts` (definitions), `core/rollup.ts` (daily counters).

## What gets counted

- **Sample:** one question asked of one engine, in one country, once. A prompt
  asked 3 times on ChatGPT in the US is 3 samples. A run's samples are dated by
  the day the run started (UTC).
- **Asked sample:** a sample with an answer. Failed samples, and samples
  skipped at the monthly limit, aren't counted anywhere: they have no answer.
- **Inferred sample:** a sample smart sampling skipped because the first two
  agreed on whether your brand was named. It counts towards your brand's
  mention rate and coverage with the agreed result. It has no text, so it
  counts nowhere else, and not at all for competitors (smart sampling only
  decides about your brand).
- **Mention:** a tracked brand named in an answer, found by mention detection
  (`core/mentions.ts`). At most one per brand per answer.
- **Rated mention:** a mention the analysis model gave a sentiment to. Without
  an analysis model, nothing is rated and the sentiment metrics are empty.

## Definitions

For a brand B (yours or a competitor's), over whatever is selected:

| Metric | Definition | Range |
|---|---|---|
| **Mention rate** | samples naming B ÷ samples. For your brand, both include inferred samples; for a competitor, only asked samples. | 0–100% |
| **Average position** | the mean of B's position across asked samples that name B. 1 is named first. Empty when B is never named. | 1 or more; lower is better |
| **Share of voice** | B's mentions ÷ mentions of all tracked brands (yours and competitors'), in asked samples. | 0–100%; all brands add up to 100% |
| **Citation share** | citations of B's pages ÷ all citations, in asked samples. For your brand this is the *owned citation share*. | 0–100% |
| **Sentiment** | the mean sentiment of B's rated mentions. | −1 to 1 |
| **Net Sentiment Score** | (positive − negative) ÷ rated mentions × 100, where positive is a sentiment of 0.25 or more and negative is −0.25 or less. | −100 to 100 |
| **Coverage** | prompts where B is named at least once ÷ prompts with at least one sample. | 0–100% |
| **Brand Visibility Index** | 100 × (0.5 × mention rate + 0.25 × position score + 0.25 × share of voice), where position score is the mean of 1 ÷ position across asked samples that name B (1 when always first, 0.5 when always second). | 0–100 |

Notes:

- **Brand Visibility Index** is one number to watch over time and to compare
  with competitors. Mention rate carries half the weight because being named
  at all matters most; being named early and taking a larger share of the
  conversation make up the rest. The weights are fixed, so scores stay
  comparable from day to day.
- Only *tracked* brands count: share of voice and positions ignore brands you
  haven't added as competitors. Add competitors to make them count.
- Ratios are computed from summed counts, never by averaging daily ratios, so a
  quiet day doesn't weigh as much as a busy one.

## Worked example

Two samples of one prompt on ChatGPT, tracking Ledgerly (yours) and Zoho:

1. "1. Zoho … 2. Ledgerly …", citing zoho.com and g2.com. Ledgerly is rated
   +0.8, Zoho 0.
2. "Zoho is a good choice", citing g2.com. Zoho is rated −0.5.

| | Ledgerly | Zoho |
|---|---|---|
| Mention rate | 1 ÷ 2 = 50% | 2 ÷ 2 = 100% |
| Average position | 2 | 1 |
| Share of voice | 1 ÷ 3 = 33% | 2 ÷ 3 = 67% |
| Citation share | 0 ÷ 3 = 0% | 1 ÷ 3 = 33% |
| Sentiment | 0.8 | (0 − 0.5) ÷ 2 = −0.25 |
| Net Sentiment Score | (1 − 0) ÷ 1 × 100 = 100 | (0 − 1) ÷ 2 × 100 = −50 |
| Coverage | 1 ÷ 1 = 100% | 100% |
| Brand Visibility Index | 100 × (0.5 × 0.5 + 0.25 × 0.5 + 0.25 × 0.333) = 45.8 | 100 × (0.5 × 1 + 0.25 × 1 + 0.25 × 0.667) = 91.7 |

These numbers are checked in `core/metrics.test.ts`.

## Daily rollup

The dashboard reads from `metrics_daily`, not from answers. It holds counters,
not ratios, for every workspace × day × engine × country × prompt × tracked
brand, so any selection is a sum. The worker rebuilds a day's rows when a run
from that day finishes, and again when its answers are re-analyzed or rated.
