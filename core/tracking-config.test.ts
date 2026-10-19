import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { getTrackingConfig, saveTrackingConfig } from "./tracking-config";
import { answersPerPrompt, trackingWarnings, validateTrackingConfig } from "./tracking-rules";

describe("validateTrackingConfig", () => {
  it("accepts a valid choice, in registry order, without duplicates", () => {
    const r = validateTrackingConfig({
      engines: ["ai_mode", "chatgpt", "chatgpt"],
      countries: ["in", "US", "IN"],
      samples: 3,
    });
    expect(r).toEqual({
      ok: true,
      config: { engines: ["chatgpt", "ai_mode"], countries: ["IN", "US"], samples: 3 },
    });
  });

  it("refuses engines with no data source, and unknown values", () => {
    expect(
      validateTrackingConfig({ engines: ["claude"], countries: ["US"], samples: 3 }),
    ).toMatchObject({
      ok: false,
      message: /Claude can't be tracked yet/,
    });
    expect(validateTrackingConfig({ engines: ["bing"], countries: ["US"], samples: 3 }).ok).toBe(
      false,
    );
    expect(validateTrackingConfig({ engines: ["chatgpt"], countries: ["XX"], samples: 3 }).ok).toBe(
      false,
    );
  });

  it("needs at least one engine and one country, and at most ten countries", () => {
    expect(validateTrackingConfig({ engines: [], countries: ["US"], samples: 3 }).ok).toBe(false);
    expect(validateTrackingConfig({ engines: ["chatgpt"], countries: [], samples: 3 }).ok).toBe(
      false,
    );
    const eleven = ["US", "GB", "IN", "CA", "AU", "DE", "FR", "ES", "IT", "NL", "SE"];
    expect(validateTrackingConfig({ engines: ["chatgpt"], countries: eleven, samples: 3 }).ok).toBe(
      false,
    );
  });
});

describe("trackingWarnings", () => {
  it("warns about countries an engine hasn't been tested in", () => {
    const w = trackingWarnings({
      engines: ["chatgpt", "ai_mode"],
      countries: ["US", "IN"],
      samples: 3,
    });
    expect(w).toEqual([expect.stringMatching(/Google AI Mode hasn't been tested in India/)]);
  });

  it("warns about unreliable engines", () => {
    const w = trackingWarnings({ engines: ["perplexity"], countries: ["US"], samples: 3 });
    expect(w).toEqual([expect.stringMatching(/Perplexity often fails/)]);
  });

  it("stays quiet for tested choices", () => {
    expect(
      trackingWarnings({ engines: ["chatgpt", "gemini"], countries: ["US", "IN"], samples: 3 }),
    ).toEqual([]);
  });

  it("counts answers per prompt", () => {
    expect(
      answersPerPrompt({ engines: ["chatgpt", "gemini"], countries: ["US", "IN"], samples: 3 }),
    ).toBe(12);
  });

  it("asks each prompt 1 to 10 times", () => {
    const base = { engines: ["chatgpt"], countries: ["US"] };
    expect(validateTrackingConfig({ ...base, samples: 0 }).ok).toBe(false);
    expect(validateTrackingConfig({ ...base, samples: 11 }).ok).toBe(false);
    expect(validateTrackingConfig({ ...base, samples: 2.5 }).ok).toBe(false);
    expect(validateTrackingConfig({ ...base, samples: 10 }).ok).toBe(true);
  });
});

describe("stored tracking config", () => {
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let workspaceId: string;

  beforeAll(async () => {
    db = drizzle(new PGlite(), { schema });
    await migrate(db, { migrationsFolder: "db/migrations" });
    [{ id: workspaceId }] = await db
      .insert(schema.workspaces)
      .values({ name: "Config test" })
      .returning();
  }, 60_000);

  it("gives a new workspace the default engines in the US", async () => {
    expect(await getTrackingConfig(db, workspaceId)).toEqual({
      engines: ["chatgpt", "gemini", "ai_mode", "ai_overviews"],
      countries: ["US"],
      samples: 3,
    });
  });

  it("saves and reads back a choice", async () => {
    await saveTrackingConfig(db, workspaceId, {
      engines: ["gemini"],
      countries: ["IN", "GB"],
      samples: 5,
    });
    expect(await getTrackingConfig(db, workspaceId)).toEqual({
      engines: ["gemini"],
      countries: ["IN", "GB"],
      samples: 5,
    });
  });

  it("drops engines that lost their data source", async () => {
    await db
      .update(schema.workspaces)
      .set({ engines: ["copilot", "chatgpt"] })
      .where(eq(schema.workspaces.id, workspaceId));
    expect((await getTrackingConfig(db, workspaceId)).engines).toEqual(["chatgpt"]);
  });
});
