/** Saving, resolving and removing a workspace's own key, on PGlite. */

import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import * as schema from "@/db/schema";
import { encrypt } from "./crypto";
import {
  deleteCredential,
  getCredentialInfo,
  resolveProviderKeys,
  saveCredential,
  testBrightDataKey,
  validateKeyShape,
} from "./credentials";
import { getProvider } from "./providers";

const KEY = "0123456789abcdef0123456789abcdef";

let db: ReturnType<typeof drizzle<typeof schema>>;
let workspaceId: string;

beforeAll(async () => {
  db = drizzle(new PGlite(), { schema });
  await migrate(db, { migrationsFolder: "db/migrations" });
  [{ id: workspaceId }] = await db
    .insert(schema.workspaces)
    .values({ name: "Keys test" })
    .returning();
}, 60_000);

describe("workspace keys", () => {
  it("stores the key encrypted and shows only the last four characters", async () => {
    await saveCredential(db, { workspaceId, key: KEY, verified: true });
    const [row] = await db
      .select()
      .from(schema.providerCredentials)
      .where(eq(schema.providerCredentials.workspaceId, workspaceId));
    expect(row.encryptedKey).not.toContain(KEY);
    expect(row.last4).toBe("cdef");

    const info = await getCredentialInfo(db, workspaceId);
    expect(info).toMatchObject({ last4: "cdef" });
    expect(info?.verifiedAt).toBeInstanceOf(Date);
    expect(JSON.stringify(info)).not.toContain(KEY);
  });

  it("prefers the workspace's key over the server's", async () => {
    const { keys, source } = await resolveProviderKeys(db, workspaceId, "server-key");
    expect(keys.brightData).toBe(KEY);
    expect(source.brightData).toBe("workspace");
  });

  it("replaces the key instead of adding a second one", async () => {
    await saveCredential(db, { workspaceId, key: "ffffffffffffffffffffffff9999" });
    const rows = await db
      .select()
      .from(schema.providerCredentials)
      .where(eq(schema.providerCredentials.workspaceId, workspaceId));
    expect(rows).toHaveLength(1);
    expect(rows[0].last4).toBe("9999");
    expect(rows[0].verifiedAt).toBeNull();
  });

  it("falls back to the server's key once the workspace key is removed", async () => {
    await deleteCredential(db, workspaceId);
    expect(await getCredentialInfo(db, workspaceId)).toBeNull();
    const { keys, source } = await resolveProviderKeys(db, workspaceId, "server-key");
    expect(keys.brightData).toBe("server-key");
    expect(source.brightData).toBe("server");
  });

  it("with no key anywhere, getProvider says how to add one", async () => {
    const { keys, source } = await resolveProviderKeys(db, workspaceId, undefined);
    expect(source.brightData).toBeNull();
    expect(() => getProvider("chatgpt", keys)).toThrow(/Settings/);
  });

  it("explains a key that can't be decrypted any more", async () => {
    await db.insert(schema.providerCredentials).values({
      workspaceId,
      provider: "brightdata",
      encryptedKey: encrypt(KEY, workspaceId, "an-old-encryption-key-that-was-rotated-away"),
      last4: "cdef",
    });
    await expect(resolveProviderKeys(db, workspaceId)).rejects.toMatchObject({
      kind: "auth",
      message: /ENCRYPTION_KEY/,
    });
    await deleteCredential(db, workspaceId);
  });
});

describe("checking a key", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("rejects obviously wrong pastes before calling Bright Data", () => {
    expect(validateKeyShape("short")).toMatch(/too short/);
    expect(validateKeyShape(`${KEY} ${KEY}`)).toMatch(/spaces/);
    expect(validateKeyShape(KEY)).toBeNull();
  });

  it("tests a key with a free call and explains a refusal", async () => {
    const fetch = vi.fn(async (url: string) =>
      url.includes("/snapshots?")
        ? new Response("Invalid credentials", { status: 401 })
        : new Response("", { status: 500 }),
    );
    vi.stubGlobal("fetch", fetch);
    expect(await testBrightDataKey(KEY)).toMatch(/didn't accept this key/);
    expect(fetch).toHaveBeenCalledTimes(1);

    vi.stubGlobal("fetch", async () => Response.json([]));
    expect(await testBrightDataKey(KEY)).toBeNull();
  });
});
