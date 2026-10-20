import { PGlite } from "@electric-sql/pglite";
import { MockLanguageModelV4 } from "ai/test";
import { count, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { ProviderError } from "../providers/errors";
import { FakeProvider } from "../providers/fake";
import type { QueryInput } from "../providers/types";
import { createRun, createTestRun } from "./create";
import { reanalyzeBrand } from "../analysis";
import { fanOut, getAnswer, listAnswers } from "../answer-archive";
import { saveCompetitors } from "../brands";
import { citationSummary, citationsByEngine, ownedPages, pageTrends } from "../citation-stats";
import { env } from "../env";
import { brandMetrics, metricsBy } from "../metrics-query";
import { getOverview, periods, validateNote } from "../overview";
import { promptDetail, promptTable } from "../prompt-results";
import { getRunDetail } from "../run-detail";
import { analysisModel } from "../sentiment";
import { fireDueSchedules, getSchedule, saveSchedule } from "./schedule";
import { tick } from "./worker";

let db: ReturnType<typeof drizzle<typeof schema>>;
let workspaceId: string;
let promptIds: string[];

/* a fresh database per test: runs and their items are the whole subject here */
beforeEach(async () => {
  db = drizzle(new PGlite(), { schema });
  await migrate(db, { migrationsFolder: "db/migrations" });
  [{ id: workspaceId }] = await db
    .insert(schema.workspaces)
    .values({
      name: "Runs",
      engines: ["chatgpt", "gemini"],
      defaultCountries: ["US", "GB"],
      samples: 2,
    })
    .returning();
  const [brand] = await db
    .insert(schema.brands)
    .values({ workspaceId, name: "Ledgerly", domains: ["ledgerly.app"] })
    .returning();
  await db
    .insert(schema.competitors)
    .values({ brandId: brand.id, name: "Zoho", domains: ["zoho.com"] });
  const rows = await db
    .insert(schema.prompts)
    .values([
      { brandId: brand.id, text: "best invoicing app", createdAt: new Date(1) },
      {
        brandId: brand.id,
        text: "invoice app with UPI",
        countries: ["IN"],
        createdAt: new Date(2),
      },
      { brandId: brand.id, text: "paused one", active: false, createdAt: new Date(3) },
    ])
    .returning();
  promptIds = rows.map((r) => r.id);
}, 60_000);

const itemsOf = (runId: string) =>
  db.select().from(schema.runItems).where(eq(schema.runItems.runId, runId));
const runOf = async (runId: string) =>
  (await db.select().from(schema.runs).where(eq(schema.runs.id, runId)))[0];
const answerCount = async () => (await db.select({ n: count() }).from(schema.answers))[0].n;

describe("createRun", () => {
  it("fans out active prompts × engines × countries × samples", async () => {
    const r = await createRun(db, workspaceId);
    expect(r).toMatchObject({ ok: true, items: 12 }); // 2×2×2 + 2×1×2
    if (!r.ok) return;
    const items = await itemsOf(r.runId);
    expect(
      items.filter((i) => i.promptText === "invoice app with UPI").map((i) => i.country),
    ).toEqual(["IN", "IN", "IN", "IN"]);
    expect(items.some((i) => i.promptText === "paused one")).toBe(false);
    expect(new Set(items.map((i) => i.sampleIndex))).toEqual(new Set([0, 1]));
    expect((await runOf(r.runId)).estimatedCost).toBe("0.018000");
  });

  it("allows one run at a time", async () => {
    await createRun(db, workspaceId);
    expect(await createRun(db, workspaceId)).toMatchObject({
      ok: false,
      message: /already in progress/,
    });
  });

  it("can run a subset, for a small test run", async () => {
    const r = await createRun(db, workspaceId, { promptIds: [promptIds[0]], engines: ["gemini"] });
    expect(r).toMatchObject({ ok: true, items: 4 }); // 1 prompt × gemini × 2 countries × 2
  });
});

describe("the worker", () => {
  const replying = (
    reply?: NonNullable<ConstructorParameters<typeof FakeProvider>[0]>["reply"],
  ) => {
    const provider = new FakeProvider({
      reply:
        reply ??
        (() => ({
          text: "Try Ledgerly or Zoho.",
          citations: [
            { url: "https://www.ledgerly.app/pricing", title: "Ledgerly" },
            { url: "https://zoho.com/invoice", title: "Zoho" },
            { url: "https://example.com/guide", title: "Guide" },
          ],
        })),
    });
    return { provider, providerFor: async () => provider };
  };

  it("drains a run: one batch per engine, answers stored, run completed", async () => {
    const r = await createRun(db, workspaceId);
    if (!r.ok) throw new Error(r.message);
    const { provider, providerFor } = replying();

    const report = await tick({ db, providerFor });
    expect(report).toMatchObject({ submitted: 12, collected: 12, finished: [r.runId] });
    expect(provider.submitted.map((s) => [s.engine, s.inputs.length])).toEqual([
      ["chatgpt", 6],
      ["gemini", 6],
    ]);
    expect(await runOf(r.runId)).toMatchObject({ status: "completed", doneItems: 12 });
    expect(await answerCount()).toBe(12);

    const kinds = await db
      .select({ kind: schema.citations.kind, domain: schema.citations.domain })
      .from(schema.citations);
    expect(kinds.slice(0, 3)).toEqual([
      { kind: "owned", domain: "ledgerly.app" },
      { kind: "competitor", domain: "zoho.com" },
      { kind: "third_party", domain: "example.com" },
    ]);
  });

  it("re-asks failed answers, and finishes partial when some never succeed", async () => {
    const r = await createRun(db, workspaceId, { engines: ["chatgpt"] });
    if (!r.ok) throw new Error(r.message);
    const tries = new Map<string, number>();
    const { providerFor } = replying((input: QueryInput) => {
      const key = `${input.prompt}:${input.country}`;
      tries.set(key, (tries.get(key) ?? 0) + 1);
      // the UPI prompt is always refused; the GB ones fail once, then work
      if (input.prompt.includes("UPI"))
        return { error: { kind: "bad_input", message: "dead page", retryable: false } };
      if (input.country === "GB" && tries.get(key)! <= 2)
        return { error: { kind: "upstream", message: "Browser disconnected", retryable: true } };
      return { text: "Ledgerly is good." };
    });

    const first = await tick({ db, providerFor });
    expect(first.requeued).toBe(2);
    await tick({ db, providerFor });
    const run = await runOf(r.runId);
    expect(run.status).toBe("partial");
    const items = await itemsOf(r.runId);
    expect(items.filter((i) => i.status === "done")).toHaveLength(4);
    expect(items.filter((i) => i.status === "failed").map((i) => i.error)).toEqual([
      "dead page",
      "dead page",
    ]);
    expect(items.find((i) => i.country === "GB")?.attempts).toBe(2);
  });

  it("fails a run whose key is refused, saying why", async () => {
    const r = await createRun(db, workspaceId);
    if (!r.ok) throw new Error(r.message);
    const providerFor = async () =>
      new FakeProvider({
        submitError: new ProviderError("auth", "Bright Data didn't accept the key"),
      });
    await tick({ db, providerFor });
    const run = await runOf(r.runId);
    expect(run.status).toBe("failed");
    expect(run.note).toMatch(/didn't accept the key/);
  });

  it("never stores an answer twice, even if a batch is collected again", async () => {
    const r = await createRun(db, workspaceId, { engines: ["gemini"] });
    if (!r.ok) throw new Error(r.message);
    const { providerFor } = replying();
    await tick({ db, providerFor });
    expect(await answerCount()).toBe(6);
    // pretend the worker died after storing but before marking items done
    await db
      .update(schema.runItems)
      .set({ status: "running" })
      .where(eq(schema.runItems.runId, r.runId));
    await db.update(schema.runs).set({ status: "running" }).where(eq(schema.runs.id, r.runId));
    await tick({ db, providerFor });
    expect(await answerCount()).toBe(6);
    expect((await db.select().from(schema.citations)).length).toBe(18);
    expect((await runOf(r.runId)).status).toBe("completed");
  });

  it("gives up on a batch that never finishes, and asks again", async () => {
    const r = await createRun(db, workspaceId, { engines: ["gemini"], promptIds: [promptIds[0]] });
    if (!r.ok) throw new Error(r.message);
    const provider = new FakeProvider({ pendingChecks: 1_000 });
    const providerFor = async () => provider;
    let now = new Date("2026-10-19T10:00:00Z");
    await tick({ db, providerFor, now: () => now });
    now = new Date("2026-10-19T11:00:00Z");
    const report = await tick({ db, providerFor, now: () => now, staleAfterMs: 30 * 60_000 });
    expect(report.requeued).toBe(4);
    expect((await itemsOf(r.runId)).every((i) => i.error?.includes("No answer"))).toBe(true);
  });
});

describe("test runs and polling", () => {
  it("a test run asks 3 prompts once, on the first engine and country", async () => {
    const r = await createTestRun(db, workspaceId);
    // only 2 active prompts exist here; one engine (chatgpt), one country (US), once each
    expect(r).toMatchObject({ ok: true, items: 2 });
    if (!r.ok) return;
    const items = await itemsOf(r.runId);
    expect(new Set(items.map((i) => `${i.engine}:${i.country}:${i.sampleIndex}`))).toEqual(
      new Set(["chatgpt:US:0"]),
    );
  });

  it("checks a slow batch only every so often", async () => {
    const r = await createRun(db, workspaceId, { engines: ["gemini"], promptIds: [promptIds[0]] });
    if (!r.ok) throw new Error(r.message);
    const provider = new FakeProvider({ pendingChecks: 1_000 });
    let checks = 0;
    const check = provider.check.bind(provider);
    provider.check = async (id: string) => {
      checks++;
      return check(id);
    };
    const providerFor = async () => provider;
    let t = Date.parse("2026-10-20T10:00:00Z");
    for (let i = 0; i < 6; i++) {
      await tick({ db, providerFor, now: () => new Date(t), checkEveryMs: 15_000 });
      t += 5_000; // a tick every 5 seconds
    }
    // 30 seconds of ticks, checked at 0s, 15s and 30s... minus the submit tick's own check
    expect(checks).toBeLessThanOrEqual(3);
  });
});

describe("the monthly answer limit", () => {
  const setCap = (cap: number | null) =>
    db
      .update(schema.workspaces)
      .set({ monthlyAnswerCap: cap })
      .where(eq(schema.workspaces.id, workspaceId));

  it("refuses a run that won't fit", async () => {
    await setCap(10);
    expect(await createRun(db, workspaceId)).toMatchObject({
      ok: false,
      message: /needs 12 answers, but only 10 are left under your monthly limit of 10/,
    });
    await setCap(null);
    expect((await createRun(db, workspaceId)).ok).toBe(true);
  });

  it("counts answers already billed this month", async () => {
    await setCap(14);
    const first = await createRun(db, workspaceId, {
      engines: ["gemini"],
      promptIds: [promptIds[0]],
    });
    if (!first.ok) throw new Error(first.message);
    // bill 4 answers to this workspace, as a finished run would
    const items = await itemsOf(first.runId);
    await db
      .insert(schema.answers)
      .values(items.map((i) => ({ runItemId: i.id, text: "x", costUsd: "0.0015" })));
    await db
      .update(schema.runItems)
      .set({ status: "done" })
      .where(eq(schema.runItems.runId, first.runId));
    await db
      .update(schema.runs)
      .set({ status: "completed" })
      .where(eq(schema.runs.id, first.runId));
    expect(await createRun(db, workspaceId)).toMatchObject({
      ok: false,
      message: /only 10 are left/,
    });
  });

  it("stops a run in progress at the limit, and says so", async () => {
    const r = await createRun(db, workspaceId, { engines: ["chatgpt"] });
    if (!r.ok) throw new Error(r.message);
    await setCap(4); // lowered after the run started
    const provider = new FakeProvider();
    await tick({ db, providerFor: async () => provider });
    expect(provider.submitted[0].inputs).toHaveLength(4);
    const run = await runOf(r.runId);
    expect(run.status).toBe("partial");
    expect(run.note).toMatch(/monthly limit of 4 answers; 2 not asked/);
    const items = await itemsOf(r.runId);
    expect(items.filter((i) => i.status === "skipped")).toHaveLength(2);
  });
});

describe("schedules", () => {
  const schedule = { frequency: "daily", minute: 9 * 60, weekday: 1, timezone: "UTC" } as const;
  const runsOf = () =>
    db.select().from(schema.runs).where(eq(schema.runs.workspaceId, workspaceId));

  it("starts a run when due, once, and moves the next time forward", async () => {
    const next = await saveSchedule(db, workspaceId, schedule, new Date("2026-10-20T08:00:00Z"));
    expect(next).toEqual(new Date("2026-10-20T09:00:00Z"));

    expect(await fireDueSchedules(db, new Date("2026-10-20T08:59:00Z"))).toEqual([]);
    const fired = await fireDueSchedules(db, new Date("2026-10-20T09:00:05Z"));
    expect(fired).toHaveLength(1);
    expect(fired[0].runId).toBeTruthy();
    // a second worker in the same minute finds nothing to do
    expect(await fireDueSchedules(db, new Date("2026-10-20T09:00:06Z"))).toEqual([]);

    const [run] = await runsOf();
    expect(run).toMatchObject({ trigger: "scheduled", status: "queued", totalItems: 12 });
    expect((await getSchedule(db, workspaceId)).nextAt).toEqual(new Date("2026-10-21T09:00:00Z"));
  });

  it("skips a run that would break the monthly limit, and records why", async () => {
    await db
      .update(schema.workspaces)
      .set({ monthlyAnswerCap: 5 })
      .where(eq(schema.workspaces.id, workspaceId));
    await saveSchedule(db, workspaceId, schedule, new Date("2026-10-20T08:00:00Z"));
    const [f] = await fireDueSchedules(db, new Date("2026-10-20T09:00:00Z"));
    expect(f.skipped).toMatch(/needs 12 answers/);
    const [run] = await runsOf();
    expect(run.status).toBe("skipped");
    expect(run.note).toMatch(/^Scheduled run skipped\. This needs 12 answers/);
    expect(await itemsOf(run.id)).toHaveLength(0);
  });

  it("skips while the previous run is still going", async () => {
    await createRun(db, workspaceId);
    await saveSchedule(db, workspaceId, schedule, new Date("2026-10-20T08:00:00Z"));
    const [f] = await fireDueSchedules(db, new Date("2026-10-20T09:00:00Z"));
    expect(f.skipped).toBe("The previous run was still in progress.");
  });

  it("does nothing when off", async () => {
    const next = await saveSchedule(db, workspaceId, { ...schedule, frequency: "off" });
    expect(next).toBeNull();
    expect(await fireDueSchedules(db, new Date("2030-01-01T00:00:00Z"))).toEqual([]);
  });
});

describe("saving answers", () => {
  const setWs = (values: Partial<typeof schema.workspaces.$inferInsert>) =>
    db.update(schema.workspaces).set(values).where(eq(schema.workspaces.id, workspaceId));
  const ledgerly = () =>
    new FakeProvider({
      reply: () => ({
        text: "Try Ledgerly.",
        citations: [{ url: "https://ledgerly.app/pricing", title: "Ledgerly" }],
      }),
    });
  const drained = async (provider = ledgerly()) => {
    const r = await createRun(db, workspaceId);
    if (!r.ok) throw new Error(r.message);
    await tick({ db, providerFor: async () => provider });
    return r;
  };

  it("reuses recent answers instead of asking again, at no cost", async () => {
    const first = await drained();
    await setWs({ cacheHours: 24, monthlyAnswerCap: 12 }); // the limit is already spent
    const again = await createRun(db, workspaceId);
    if (!again.ok) throw new Error(again.message);
    expect(again).toMatchObject({ items: 12, reused: 12 });

    const provider = new FakeProvider();
    await tick({ db, providerFor: async () => provider });
    expect(provider.submitted).toHaveLength(0);
    expect(await runOf(again.runId)).toMatchObject({
      status: "completed",
      doneItems: 12,
      reusedItems: 12,
      actualCost: "0.000000",
      estimatedCost: "0.000000",
    });

    // each sample gets a different earlier answer, and the citations come along
    const copies = await db
      .select({ from: schema.answers.reusedFromId, cost: schema.answers.costUsd })
      .from(schema.answers)
      .innerJoin(schema.runItems, eq(schema.answers.runItemId, schema.runItems.id))
      .where(eq(schema.runItems.runId, again.runId));
    expect(new Set(copies.map((c) => c.from)).size).toBe(12);
    const firstAnswers = await db
      .select({ id: schema.answers.id })
      .from(schema.answers)
      .innerJoin(schema.runItems, eq(schema.answers.runItemId, schema.runItems.id))
      .where(eq(schema.runItems.runId, first.runId));
    expect(copies.every((c) => firstAnswers.some((a) => a.id === c.from))).toBe(true);
    expect((await db.select({ n: count() }).from(schema.citations))[0].n).toBe(24);
  });

  it("asks again once answers are older than the limit", async () => {
    await drained();
    await setWs({ cacheHours: 2 });
    const later = await createRun(db, workspaceId, { now: new Date(Date.now() + 3 * 3_600_000) });
    expect(later).toMatchObject({ ok: true, reused: 0 });
  });

  it("is off for scheduled runs and test runs unless asked", async () => {
    await drained();
    await setWs({ cacheHours: 24 });
    const scheduled = await createRun(db, workspaceId, { trigger: "scheduled" });
    expect(scheduled).toMatchObject({ ok: true, reused: 0 });
    await db.delete(schema.runs).where(eq(schema.runs.trigger, "scheduled"));

    expect(await createTestRun(db, workspaceId)).toMatchObject({ ok: true, reused: 0 });
    await db.delete(schema.runs).where(eq(schema.runs.status, "queued"));

    await setWs({ cacheScheduled: true });
    expect(await createRun(db, workspaceId, { trigger: "scheduled" })).toMatchObject({
      ok: true,
      reused: 12,
    });
  });

  it("smart sampling: asks two samples, skips the rest when they agree", async () => {
    await setWs({ samples: 4, smartSampling: true });
    const r = await createRun(db, workspaceId);
    if (!r.ok) throw new Error(r.message);
    const provider = ledgerly();
    const providerFor = async () => provider;

    await tick({ db, providerFor }); // samples 0 and 1 asked and answered
    expect(provider.submitted.flatMap((s) => s.inputs)).toHaveLength(12);
    await tick({ db, providerFor }); // agreed: 2 and 3 skipped
    expect(provider.submitted.flatMap((s) => s.inputs)).toHaveLength(12);

    const run = await runOf(r.runId);
    expect(run).toMatchObject({ status: "completed", doneItems: 12, sampledOutItems: 12 });
    const skipped = (await itemsOf(r.runId)).filter((i) => i.status === "skipped");
    expect(skipped).toHaveLength(12);
    expect(skipped.every((i) => i.skipReason === "sampling" && i.inferredMentioned)).toBe(true);
    expect(skipped.every((i) => i.sampleIndex >= 2)).toBe(true);
  });

  it("smart sampling: asks the rest when the first two disagree", async () => {
    await setWs({ samples: 3, smartSampling: true });
    const r = await createRun(db, workspaceId, { engines: ["chatgpt"], promptIds: [promptIds[0]] });
    if (!r.ok) throw new Error(r.message);
    // per country: the first answer names Ledgerly, the next doesn't
    const asked = new Map<string, number>();
    const provider = new FakeProvider({
      reply: ({ country = "" }) => {
        asked.set(country, (asked.get(country) ?? 0) + 1);
        return { text: asked.get(country) === 1 ? "Try Ledgerly." : "Try Zoho." };
      },
    });
    const providerFor = async () => provider;
    await tick({ db, providerFor });
    await tick({ db, providerFor });
    expect(provider.submitted.map((s) => s.inputs.length)).toEqual([4, 2]);
    expect(await runOf(r.runId)).toMatchObject({ status: "completed", sampledOutItems: 0 });
  });

  it("smart sampling is ignored with two samples or fewer", async () => {
    await setWs({ smartSampling: true }); // samples: 2
    const r = await createRun(db, workspaceId);
    if (!r.ok) throw new Error(r.message);
    expect((await runOf(r.runId)).smartSampling).toBe(false);
  });
});

describe("a run's page", () => {
  it("totals per engine, the answers by prompt, and nothing from other workspaces", async () => {
    const r = await createRun(db, workspaceId);
    if (!r.ok) throw new Error(r.message);
    const provider = new FakeProvider({
      reply: () => ({ text: "Try Ledgerly.", citations: [{ url: "https://ledgerly.app/a" }] }),
    });
    await tick({ db, providerFor: async () => provider });

    const detail = await getRunDetail(db, workspaceId, r.runId);
    expect(detail?.engines).toEqual([
      { engine: "chatgpt", planned: 6, done: 6, cost: "0.000000" },
      { engine: "gemini", planned: 6, done: 6, cost: "0.000000" },
    ]);
    expect(detail?.byPrompt.map((p) => [p.prompt, p.answers.length])).toEqual([
      ["best invoicing app", 8],
      ["invoice app with UPI", 4],
    ]);
    expect(detail?.byPrompt[0].answers[0].sources).toEqual([
      { url: "https://ledgerly.app/a", title: null, domain: "ledgerly.app" },
    ]);

    const [other] = await db.insert(schema.workspaces).values({ name: "Other" }).returning();
    expect(await getRunDetail(db, other.id, r.runId)).toBeNull();
  });
});

describe("mentions", () => {
  it("are found in new answers, once, and found again when names change", async () => {
    const r = await createRun(db, workspaceId, { engines: ["chatgpt"], promptIds: [promptIds[0]] });
    if (!r.ok) throw new Error(r.message);
    const provider = new FakeProvider({
      reply: () => ({ text: "1. **Zoho**: free\n2. **Ledgerly**: simple\n\nSee zoho.com." }),
    });
    const report = await tick({ db, providerFor: async () => provider });
    expect(report.analyzed).toBe(4);

    const found = await db
      .select({
        competitorId: schema.mentions.competitorId,
        position: schema.mentions.position,
        snippet: schema.mentions.snippet,
      })
      .from(schema.mentions);
    expect(found).toHaveLength(8);
    const [zoho] = await db.select().from(schema.competitors);
    expect(found.filter((m) => m.competitorId === zoho.id).every((m) => m.position === 1)).toBe(
      true,
    );
    expect(found.filter((m) => m.competitorId === null)[0]).toMatchObject({
      position: 2,
      snippet: "Ledgerly: simple",
    });

    // nothing left to do: a second tick doesn't add any
    expect((await tick({ db, providerFor: async () => provider })).analyzed).toBe(0);
    expect((await db.select({ n: count() }).from(schema.mentions))[0].n).toBe(8);

    // rename the competitor: past answers are checked again
    const [brand] = await db.select().from(schema.brands);
    await saveCompetitors(db, brand.id, [{ name: "Wave", domains: [], aliases: [] }]);
    expect((await tick({ db, providerFor: async () => provider })).analyzed).toBe(4);
    const after = await db.select().from(schema.mentions);
    expect(after.map((m) => [m.competitorId, m.position])).toEqual(
      Array.from({ length: 4 }, () => [null, 1]),
    );
  });
});

describe("sentiment", () => {
  const usage = {
    inputTokens: { total: 1000, noCache: 1000, cacheRead: undefined, cacheWrite: undefined },
    outputTokens: { total: 200, text: 200, reasoning: undefined },
  };
  /** a model that rates every listed brand: Ledgerly glowing and recommended, others lukewarm */
  const ratingModel = (calls: string[]) =>
    new MockLanguageModelV4({
      doGenerate: async ({ prompt }) => {
        const text = JSON.stringify(prompt);
        calls.push(text);
        const n = (text.match(/### Answer/g) ?? []).length;
        const json = {
          answers: Array.from({ length: n }, (_, i) => ({
            answer: i + 1,
            brands: [
              { name: "ledgerly", sentiment: 1.4, recommended: true },
              { name: "Zoho", sentiment: -0.2, recommended: false },
              { name: "Not asked about", sentiment: 1, recommended: true },
            ],
          })),
        };
        return {
          content: [{ type: "text", text: JSON.stringify(json) }],
          finishReason: { unified: "stop", raw: undefined },
          usage,
          warnings: [],
        };
      },
    });
  const analysis = (model: MockLanguageModelV4) => ({
    model,
    batch: 5,
    priceInput: 0.1,
    priceOutput: 0.4,
  });
  const ranked = new FakeProvider({
    reply: () => ({ text: "1. **Zoho**: free\n2. **Ledgerly**: the best pick for freelancers" }),
  });
  const runOne = async () => {
    const r = await createRun(db, workspaceId, { engines: ["chatgpt"], promptIds: [promptIds[0]] });
    if (!r.ok) throw new Error(r.message);
    return r.runId;
  };

  it("is off without a model: mentions stay unrated", async () => {
    await runOne();
    const report = await tick({ db, providerFor: async () => ranked, analysis: null });
    expect(report.rated).toBe(0);
    const found = await db.select().from(schema.mentions);
    expect(found).toHaveLength(8);
    expect(found.every((m) => m.sentiment === null && m.recommended === null)).toBe(true);
  });

  it("rates each mention after detection, and adds the cost to the run", async () => {
    const runId = await runOne();
    const calls: string[] = [];
    const report = await tick({
      db,
      providerFor: async () => ranked,
      analysis: analysis(ratingModel(calls)),
    });
    expect(report).toMatchObject({ collected: 4, analyzed: 4, rated: 4 });
    expect(calls).toHaveLength(1); // the 4 answers fit in one call
    expect(calls[0]).toContain("Brands: Zoho; Ledgerly");

    const found = await db
      .select({
        c: schema.mentions.competitorId,
        s: schema.mentions.sentiment,
        r: schema.mentions.recommended,
      })
      .from(schema.mentions);
    expect(found.filter((m) => m.c === null).every((m) => m.s === 1 && m.r === true)).toBe(true);
    expect(found.filter((m) => m.c !== null).every((m) => m.s === -0.2 && m.r === false)).toBe(
      true,
    );

    // 1,000 in × $0.10/M + 200 out × $0.40/M = $0.00018 per call
    const run = await runOf(runId);
    expect(Number(run.actualCost)).toBeCloseTo(0.00018, 6);
    // nothing left: no more calls
    await tick({ db, providerFor: async () => ranked, analysis: analysis(ratingModel(calls)) });
    expect(calls).toHaveLength(1);
  });

  it("doesn't call the model for answers that name no tracked brand", async () => {
    await runOne();
    const calls: string[] = [];
    const nobody = new FakeProvider({ reply: () => ({ text: "Use a spreadsheet." }) });
    const report = await tick({
      db,
      providerFor: async () => nobody,
      analysis: analysis(ratingModel(calls)),
    });
    expect(report.rated).toBe(0);
    expect(calls).toHaveLength(0);
    const rows = await db.select({ ratedAt: schema.answers.ratedAt }).from(schema.answers);
    expect(rows.every((a) => a.ratedAt !== null)).toBe(true);
  });

  it("retries a failing model a few times, then gives up", async () => {
    await runOne();
    let calls = 0;
    const broken = new MockLanguageModelV4({
      doGenerate: async () => {
        calls++;
        throw new Error("rate limited");
      },
    });
    const opts = { db, providerFor: async () => ranked, analysis: analysis(broken) };
    for (let i = 0; i < 5; i++) await tick(opts);
    expect(calls).toBe(3);
    const rows = await db.select({ a: schema.answers.ratingAttempts }).from(schema.answers);
    expect(rows.every((r) => r.a === 3)).toBe(true);
  });

  it("is set up from the environment, with or without a key", () => {
    expect(analysisModel({ ...env({}), ANALYSIS_MODEL: "x" })).toBeNull();
    const local = analysisModel(
      env({ ANALYSIS_BASE_URL: "http://localhost:11434/v1", ANALYSIS_MODEL: "qwen3:8b" }),
    );
    expect(local).toMatchObject({ batch: 5, priceInput: 0, priceOutput: 0 });
  });
});

describe("citations", () => {
  const citing = new FakeProvider({
    reply: () => ({
      text: "Try Ledgerly.",
      citations: [
        { url: "https://www.g2.com/categories/invoicing?utm_source=chatgpt.com", title: "G2" },
        { url: "https://g2.com/categories/invoicing#:~:text=best" },
        { url: "https://zoho.com/invoice" },
        { url: "https://ledgerly.app/pricing" },
      ],
    }),
  });

  it("lists the most-cited domains for a run, each page once per answer", async () => {
    const r = await createRun(db, workspaceId);
    if (!r.ok) throw new Error(r.message);
    await tick({ db, providerFor: async () => citing });

    const s = await citationSummary(db, workspaceId, { runId: r.runId });
    expect(s).toMatchObject({
      answers: 12,
      withSources: 12,
      citingOwned: 12,
      citingCompetitor: 12,
    });
    const [zoho] = await db.select().from(schema.competitors);
    expect(s.domains.map((d) => [d.domain, d.kind, d.competitor, d.answers, d.citations])).toEqual([
      ["g2.com", "third_party", null, 12, 12],
      ["ledgerly.app", "owned", null, 12, 12],
      ["zoho.com", "competitor", zoho.name, 12, 12],
    ]);
    expect(s.domains[0].pages).toEqual([
      { url: "https://g2.com/categories/invoicing", title: "G2", answers: 12 },
    ]);

    // another workspace sees nothing
    const [other] = await db.insert(schema.workspaces).values({ name: "Other" }).returning();
    expect((await citationSummary(db, other.id, { runId: r.runId })).domains).toEqual([]);
  });

  it("relabels past citations when domains change", async () => {
    const r = await createRun(db, workspaceId, { engines: ["chatgpt"], promptIds: [promptIds[0]] });
    if (!r.ok) throw new Error(r.message);
    await tick({ db, providerFor: async () => citing });

    const [brand] = await db.select().from(schema.brands);
    await saveCompetitors(db, brand.id, [{ name: "G2", domains: ["g2.com"], aliases: [] }]);
    await tick({ db, providerFor: async () => citing });

    const s = await citationSummary(db, workspaceId, { runId: r.runId });
    expect(Object.fromEntries(s.domains.map((d) => [d.domain, d.competitor ?? d.kind]))).toEqual({
      "g2.com": "G2",
      "ledgerly.app": "owned",
      "zoho.com": "third_party",
    });
  });
});

describe("metrics", () => {
  const today = new Date().toISOString().slice(0, 10);
  // ChatGPT ranks Zoho then Ledgerly and cites zoho.com and g2.com; Gemini names only Zoho
  const byEngine = new FakeProvider({
    reply: (_input, engine) =>
      engine === "chatgpt"
        ? {
            text: "1. **Zoho**: free\n2. **Ledgerly**: simple",
            citations: [{ url: "https://zoho.com/invoice" }, { url: "https://g2.com/x" }],
          }
        : { text: "Zoho is a good choice.", citations: [{ url: "https://g2.com/x" }] },
  });

  it("match a hand calculation, from the daily rollup", async () => {
    const r = await createRun(db, workspaceId);
    if (!r.ok) throw new Error(r.message);
    const report = await tick({ db, providerFor: async () => byEngine, analysis: null });
    expect(report.rolledUp).toBe(1);

    // 12 samples: 6 on ChatGPT (both brands), 6 on Gemini (Zoho only)
    const [ours, zoho] = await brandMetrics(db, workspaceId, { from: today, to: today });
    expect(ours).toMatchObject({
      competitorId: null,
      name: "Ledgerly",
      samples: 12,
      mentionRate: 0.5,
      averagePosition: 2,
      citationShare: 0,
      coverage: 1,
      sentiment: null,
    });
    expect(ours.shareOfVoice).toBeCloseTo(6 / 18);
    expect(ours.visibilityIndex).toBeCloseTo(100 * (0.25 + 0.125 + 0.25 / 3), 6);
    expect(zoho).toMatchObject({ name: "Zoho", mentionRate: 1, averagePosition: 1, coverage: 1 });
    expect(zoho.shareOfVoice).toBeCloseTo(12 / 18);
    expect(zoho.citationShare).toBeCloseTo(6 / 18);

    const engines = await metricsBy(db, workspaceId, { from: today, to: today }, "engine", null);
    expect(engines.map((e) => [e.key, e.mentionRate])).toEqual([
      ["chatgpt", 1],
      ["gemini", 0],
    ]);
    const filtered = await brandMetrics(db, workspaceId, {
      from: today,
      to: today,
      countries: ["IN"],
    });
    expect(filtered[0].samples).toBe(4);
  });

  it("are rebuilt when answers are analyzed again, and ignore runs still going", async () => {
    const r = await createRun(db, workspaceId);
    if (!r.ok) throw new Error(r.message);
    const slow = new FakeProvider({ pendingChecks: 1, reply: () => ({ text: "Ledgerly." }) });
    await tick({ db, providerFor: async () => slow, analysis: null });
    expect(await brandMetrics(db, workspaceId, { from: today, to: today })).toEqual([]);
    await tick({ db, providerFor: async () => slow, analysis: null });
    expect((await brandMetrics(db, workspaceId, { from: today, to: today }))[0].mentionRate).toBe(
      1,
    );

    // the brand is renamed: no answer names it any more
    const [brand] = await db.select().from(schema.brands);
    await db
      .update(schema.brands)
      .set({ name: "Invoicely", domains: [] })
      .where(eq(schema.brands.id, brand.id));
    await reanalyzeBrand(db, brand.id);
    const report = await tick({ db, providerFor: async () => slow, analysis: null });
    expect(report.rolledUp).toBe(1);
    const [ours] = await brandMetrics(db, workspaceId, { from: today, to: today });
    expect(ours).toMatchObject({ name: "Invoicely", mentionRate: 0 });
  });
});

describe("the overview", () => {
  const now = new Date();
  const day = (offset: number) => new Date(now.getTime() - offset * 86_400_000);
  const iso = (d: Date) => d.toISOString().slice(0, 10);

  it("periods: this one and the one before, the same length", () => {
    const p = periods("7d", new Date("2026-10-20T15:00:00Z"));
    expect(p.current).toEqual({ from: "2026-10-14", to: "2026-10-20" });
    expect(p.previous).toEqual({ from: "2026-10-07", to: "2026-10-13" });
    expect(p.days).toHaveLength(7);
  });

  it("compares with the previous period, per engine and per prompt", async () => {
    // eight days ago nobody named Ledgerly; today ChatGPT does
    const before = await createRun(db, workspaceId);
    if (!before.ok) throw new Error(before.message);
    await db
      .update(schema.runs)
      .set({ createdAt: day(8) })
      .where(eq(schema.runs.id, before.runId));
    const nobody = new FakeProvider({ reply: () => ({ text: "Try Zoho." }) });
    await tick({ db, providerFor: async () => nobody, analysis: null });
    const r = await createRun(db, workspaceId);
    if (!r.ok) throw new Error(r.message);
    const chatgptOnly = new FakeProvider({
      reply: (_i, engine) => ({ text: engine === "chatgpt" ? "Ledgerly is best." : "Zoho." }),
    });
    await tick({ db, providerFor: async () => chatgptOnly, analysis: null });

    const o = await getOverview(db, workspaceId, { range: "7d" }, now);
    expect(o.hasData).toBe(true);
    expect(o.samples).toBe(12);
    expect(o.kpis.find((k) => k.id === "mention")).toEqual({
      id: "mention",
      value: 50,
      previous: 0,
    });
    expect(o.engines).toEqual(["chatgpt", "gemini"]);
    const todayPoint = o.trend.mention.find((p) => p.date === iso(now))!;
    expect(todayPoint).toMatchObject({ chatgpt: 100, gemini: 0 });
    expect(o.trend.mention).toHaveLength(7);
    // 30 days, but results only from 8 days ago: the chart starts there
    const month = await getOverview(db, workspaceId, { range: "30d" }, now);
    expect(month.trend.mention[0].date).toBe(iso(day(8)));
    expect(o.byEngine.map((e) => [e.engine, e.rate])).toEqual([
      ["chatgpt", 100],
      ["gemini", 0],
    ]);
    expect(o.prompts.map((p) => [p.text, p.rate])).toEqual([
      ["best invoicing app", 50],
      ["invoice app with UPI", 50],
    ]);

    // filtered to Gemini: no change, nothing named
    const gemini = await getOverview(db, workspaceId, { range: "7d", engine: "gemini" }, now);
    expect(gemini.kpis.find((k) => k.id === "mention")).toMatchObject({ value: 0, previous: 0 });
    expect(gemini.engines).toEqual(["gemini"]);
  });

  it("validates chart notes", () => {
    expect(validateNote("2026-10-20", "Published a comparison page")).toBeNull();
    expect(validateNote("20/10/2026", "x")).toMatch(/date/);
    expect(validateNote("2026-10-20", "  ")).toMatch(/what changed/);
    expect(validateNote("2026-10-20", "x".repeat(201))).toMatch(/200/);
  });
});

describe("prompt results", () => {
  it("a table row per prompt and a page per prompt, from the metrics", async () => {
    const r = await createRun(db, workspaceId);
    if (!r.ok) throw new Error(r.message);
    const provider = new FakeProvider({
      reply: (_i, engine) => ({
        text: engine === "chatgpt" ? "1. Zoho\n2. Ledgerly" : "Zoho only.",
      }),
    });
    await tick({ db, providerFor: async () => provider, analysis: null });
    const [brand] = await db.select().from(schema.brands);

    const t = await promptTable(db, workspaceId, brand.id, "7d");
    expect(t.engines).toEqual(["chatgpt", "gemini"]);
    expect(t.rows.map((x) => [x.text, x.mentionRate, x.byEngine, x.averagePosition])).toEqual([
      ["best invoicing app", 50, { chatgpt: 100, gemini: 0 }, 2],
      ["invoice app with UPI", 50, { chatgpt: 100, gemini: 0 }, 2],
      // paused, never asked: last, without results
      ["paused one", null, { chatgpt: null, gemini: null }, null],
    ]);
    expect(t.rows[0].spark.at(-1)).toBe(50);

    const d = await promptDetail(db, workspaceId, promptIds[0], "7d");
    expect(d?.own).toMatchObject({ mentionRate: 0.5, averagePosition: 2, samples: 8 });
    expect(d?.ranking.map((b) => [b.name, b.mentionRate])).toEqual([
      ["Ledgerly", 0.5],
      ["Zoho", 1],
    ]);
    expect(d?.cells.map((c) => [c.a, c.b, c.mentionRate])).toEqual([
      ["chatgpt", "GB", 1],
      ["chatgpt", "US", 1],
      ["gemini", "GB", 0],
      ["gemini", "US", 0],
    ]);
    expect(d?.answers).toHaveLength(8);
    const chatgpt = d!.answers.find((a) => a.engine === "chatgpt")!;
    expect(chatgpt.named).toEqual([
      { name: "Zoho", own: false },
      { name: "Ledgerly", own: true },
    ]);
    expect(chatgpt.excerpt).toBe("Ledgerly");

    const [other] = await db.insert(schema.workspaces).values({ name: "Other" }).returning();
    expect(await promptDetail(db, other.id, promptIds[0], "7d")).toBeNull();
  });
});

describe("the answer archive", () => {
  it("filters, searches and opens answers, only in their workspace", async () => {
    const r = await createRun(db, workspaceId);
    if (!r.ok) throw new Error(r.message);
    const provider = new FakeProvider({
      reply: (_i, engine) =>
        engine === "chatgpt"
          ? {
              text: "1. Zoho\n2. Ledgerly, see ledgerly.app",
              citations: [
                { url: "https://zoho.com/x", title: "Zoho" },
                { url: "https://g2.com/y" },
              ],
            }
          : { text: "Spreadsheets are fine." },
    });
    await tick({ db, providerFor: async () => provider, analysis: null });

    expect((await listAnswers(db, workspaceId, {})).total).toBe(12);
    const named = await listAnswers(db, workspaceId, { named: "yes" });
    expect(named.total).toBe(6);
    expect(named.rows.every((a) => a.engine === "chatgpt" && a.namesYou)).toBe(true);
    expect(named.rows[0].named).toEqual(["Zoho", null]);
    expect((await listAnswers(db, workspaceId, { named: "no" })).total).toBe(6);
    expect((await listAnswers(db, workspaceId, { engine: "gemini", country: "IN" })).total).toBe(2);
    expect((await listAnswers(db, workspaceId, { q: "spreadsheet" })).total).toBe(6);
    expect((await listAnswers(db, workspaceId, { q: "UPI" })).total).toBe(4); // the prompt's words
    expect((await listAnswers(db, workspaceId, { q: "50%_" })).total).toBe(0);
    expect((await listAnswers(db, workspaceId, { promptId: promptIds[1] })).total).toBe(4);

    const id = named.rows[0].id;
    const a = await getAnswer(db, workspaceId, id);
    expect(a?.named.map((m) => [m.name, m.position])).toEqual([
      ["Zoho", 1],
      ["Ledgerly", 2],
    ]);
    expect(a?.cited.map((c) => [c.domain, c.kind, c.competitor])).toEqual([
      ["zoho.com", "competitor", "Zoho"],
      ["g2.com", "third_party", null],
    ]);
    // every place a tracked brand is named, for highlighting: Zoho, Ledgerly and its domain
    expect(a?.matches.map((m) => a.text.slice(m.start, m.end))).toEqual([
      "Zoho",
      "Ledgerly",
      "ledgerly.app",
    ]);

    const [other] = await db.insert(schema.workspaces).values({ name: "Other" }).returning();
    expect((await listAnswers(db, other.id, {})).total).toBe(0);
    expect(await getAnswer(db, other.id, id)).toBeNull();
  });

  it("reads ChatGPT's searches from the raw answer", () => {
    expect(
      fanOut({ web_search_query: ["best invoicing app 2026", "zoho invoice pricing"] }),
    ).toEqual(["best invoicing app 2026", "zoho invoice pricing"]);
    expect(fanOut({ web_search_query: "invoicing apps" })).toEqual(["invoicing apps"]);
    expect(fanOut({ web_search_query: null })).toEqual([]);
    expect(fanOut(null)).toEqual([]);
  });
});

describe("the citations page", () => {
  it("splits by engine, ranks pages by place, and finds your pages that dropped out", async () => {
    const r = await createRun(db, workspaceId);
    if (!r.ok) throw new Error(r.message);
    // ChatGPT cites g2 first and your pricing page second; Gemini cites only zoho.com
    const provider = new FakeProvider({
      reply: (_i, engine) => ({
        text: "Ledgerly.",
        citations:
          engine === "chatgpt"
            ? [
                { url: "https://g2.com/best" },
                { url: "https://ledgerly.app/pricing", title: "Pricing" },
              ]
            : [{ url: "https://zoho.com/invoice" }],
      }),
    });
    await tick({ db, providerFor: async () => provider, analysis: null });
    const since = new Date(Date.now() - 86_400_000);

    expect(
      (await citationsByEngine(db, workspaceId, { since })).map((e) => [
        e.engine,
        e.answers,
        e.owned,
        e.competitor,
        e.thirdParty,
      ]),
    ).toEqual([
      ["chatgpt", 6, 6, 0, 6],
      ["gemini", 6, 0, 6, 0],
    ]);

    const s = await citationSummary(db, workspaceId, { since });
    expect(Object.fromEntries(s.domains.map((d) => [d.domain, d.engines]))).toEqual({
      "g2.com": ["chatgpt"],
      "ledgerly.app": ["chatgpt"],
      "zoho.com": ["gemini"],
    });
    const geminiOnly = await citationSummary(db, workspaceId, { since, engine: "gemini" });
    expect(geminiOnly.domains.map((d) => d.domain)).toEqual(["zoho.com"]);

    const pages = await pageTrends(db, workspaceId, { since });
    const pricing = pages.find((p) => p.url === "https://ledgerly.app/pricing")!;
    expect(pricing).toMatchObject({ kind: "owned", answers: 6, position: 2, title: "Pricing" });
    expect(pricing.byDay).toEqual([{ day: new Date().toISOString().slice(0, 10), position: 2 }]);

    expect(await ownedPages(db, workspaceId, { since })).toEqual([
      expect.objectContaining({ url: "https://ledgerly.app/pricing", inPeriod: 6, allTime: 6 }),
    ]);
    // a later period without citations: the page shows as dropped out
    const later = await ownedPages(db, workspaceId, { since: new Date(Date.now() + 86_400_000) });
    expect(later[0]).toMatchObject({ inPeriod: 0, allTime: 6 });
  });
});
