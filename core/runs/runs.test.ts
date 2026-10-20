import { PGlite } from "@electric-sql/pglite";
import { count, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { ProviderError } from "../providers/errors";
import { FakeProvider } from "../providers/fake";
import type { QueryInput } from "../providers/types";
import { createRun, createTestRun } from "./create";
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
