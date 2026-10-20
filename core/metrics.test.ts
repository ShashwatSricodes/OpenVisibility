import { describe, expect, it } from "vitest";
import { ZERO, add, coverageOf, metricsOf, type Counters } from "./metrics";
import { countSample, type Sample } from "./rollup";

/** docs/metrics.md, "Worked example" */
const samples: Sample[] = [
  {
    promptId: "p",
    engine: "chatgpt",
    country: "US",
    answer: {
      mentions: [
        { competitorId: "zoho", position: 1, sentiment: 0 },
        { competitorId: null, position: 2, sentiment: 0.8 },
      ],
      citations: [
        { kind: "competitor", competitorId: "zoho" },
        { kind: "third_party", competitorId: null },
      ],
    },
  },
  {
    promptId: "p",
    engine: "chatgpt",
    country: "US",
    answer: {
      mentions: [{ competitorId: "zoho", position: 1, sentiment: -0.5 }],
      citations: [{ kind: "third_party", competitorId: null }],
    },
  },
];

const total = (brand: string | null, list = samples) =>
  list.reduce<Counters>((sum, s) => add(sum, countSample(s, [null, "zoho"]).get(brand) ?? {}), {
    ...ZERO,
  });

describe("the worked example", () => {
  it("your brand", () => {
    const m = metricsOf(total(null));
    expect(m.mentionRate).toBe(0.5);
    expect(m.averagePosition).toBe(2);
    expect(m.shareOfVoice).toBeCloseTo(1 / 3);
    expect(m.citationShare).toBe(0);
    expect(m.sentiment).toBeCloseTo(0.8);
    expect(m.netSentiment).toBe(100);
    expect(m.visibilityIndex).toBeCloseTo(45.83, 2);
    expect(coverageOf([total(null)])).toBe(1);
  });

  it("a competitor", () => {
    const m = metricsOf(total("zoho"));
    expect(m.mentionRate).toBe(1);
    expect(m.averagePosition).toBe(1);
    expect(m.shareOfVoice).toBeCloseTo(2 / 3);
    expect(m.citationShare).toBeCloseTo(1 / 3);
    expect(m.sentiment).toBeCloseTo(-0.25);
    expect(m.netSentiment).toBe(-50);
    expect(m.visibilityIndex).toBeCloseTo(91.67, 2);
  });
});

describe("edge cases", () => {
  it("counts samples smart sampling skipped for your brand only", () => {
    const inferred: Sample[] = [
      ...samples,
      { promptId: "p", engine: "chatgpt", country: "US", inferredMentioned: true },
      { promptId: "p", engine: "chatgpt", country: "US", inferredMentioned: false },
    ];
    // yours: named in 1 asked + 1 inferred of 4 samples
    expect(metricsOf(total(null, inferred)).mentionRate).toBe(0.5);
    // share of voice and position still come from asked samples only
    expect(metricsOf(total(null, inferred)).shareOfVoice).toBeCloseTo(1 / 3);
    // competitors aren't inferred: still 2 of 2
    expect(metricsOf(total("zoho", inferred)).samples).toBe(2);
  });

  it("is empty, not zero, with nothing to go on", () => {
    expect(metricsOf(ZERO)).toMatchObject({
      mentionRate: null,
      averagePosition: null,
      sentiment: null,
      netSentiment: null,
      visibilityIndex: null,
    });
    const never = metricsOf(total(null, [samples[1]]));
    expect(never).toMatchObject({ mentionRate: 0, averagePosition: null, visibilityIndex: 0 });
  });

  it("coverage counts prompts, not samples", () => {
    const seen = { ...ZERO, samples: 3, mentioned: 1 };
    const unseen = { ...ZERO, samples: 5 };
    expect(coverageOf([seen, unseen, ZERO])).toBe(0.5);
  });
});
