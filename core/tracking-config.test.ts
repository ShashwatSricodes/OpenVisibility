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
    });
    expect(r).toEqual({
      ok: true,
      config: { engines: ["chatgpt", "ai_mode"], countries: ["IN", "US"] },
    });
  });

  it("refuses engines with no data source, and unknown values", () => {
    expect(validateTrackingConfig({ engines: ["claude"], countries: ["US"] })).toMatchObject({
      ok: false,
      message: /Claude can't be tracked yet/,
    });
    expect(validateTrackingConfig({ engines: ["bing"], countries: ["US"] }).ok).toBe(false);
    expect(validateTrackingConfig({ engines: ["chatgpt"], countries: ["XX"] }).ok).toBe(false);
  });

  it("needs at least one engine and one country, and at most ten countries", () => {
    expect(validateTrackingConfig({ engines: [], countries: ["US"] }).ok).toBe(false);
    expect(validateTrackingConfig({ engines: ["chatgpt"], countries: [] }).ok).toBe(false);
    const eleven = ["US", "GB", "IN", "CA", "AU", "DE", "FR", "ES", "IT", "NL", "SE"];
    expect(validateTrackingConfig({ engines: ["chatgpt"], countries: eleven }).ok).toBe(false);
  });
});

describe("trackingWarnings", () => {
  it("warns about countries an engine hasn't been tested in", () => {
    const w = trackingWarnings({ engines: ["chatgpt", "ai_mode"], countries: ["US", "IN"] });
    expect(w).toEqual([expect.stringMatching(/Google AI Mode hasn't been tested in India/)]);
  });

  it("warns about unreliable engines", () => {
    const w = trackingWarnings({ engines: ["perplexity"], countries: ["US"] });
    expect(w).toEqual([expect.stringMatching(/Perplexity often fails/)]);
  });

  it("stays quiet for tested choices", () => {
    expect(trackingWarnings({ engines: ["chatgpt", "gemini"], countries: ["US", "IN"] })).toEqual(
      [],
    );
  });

  it("counts answers per prompt", () => {
    expect(answersPerPrompt({ engines: ["chatgpt", "gemini"], countries: ["US", "IN"] })).toBe(4);
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
    });
  });

  it("saves and reads back a choice", async () => {
    await saveTrackingConfig(db, workspaceId, { engines: ["gemini"], countries: ["IN", "GB"] });
    expect(await getTrackingConfig(db, workspaceId)).toEqual({
      engines: ["gemini"],
      countries: ["IN", "GB"],
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
