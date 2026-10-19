/**
 * Workspaces' own API keys: save, test, remove, and pick the key a call uses.
 *
 * Which key a call uses: the workspace's own key first, then the server's
 * BRIGHT_DATA_API_KEY (the self-hoster's key, or the platform key when
 * hosted). Plain keys never leave the server; pages get `CredentialInfo`.
 */

import { and, eq } from "drizzle-orm";
import type { AnyDb } from "@/db/client";
import { credentialProvider, providerCredentials } from "@/db/schema";
import { DecryptError, decrypt, encrypt } from "./crypto";
import { env } from "./env";
import { BrightDataClient } from "./providers/brightdata";
import { ProviderError, type ProviderKeys } from "./providers";

export type CredentialProvider = (typeof credentialProvider.enumValues)[number];

export type CredentialInfo = {
  last4: string;
  createdAt: Date;
  verifiedAt: Date | null;
};

/** Where the key a workspace's calls use comes from. */
export type KeySource = "workspace" | "server" | null;

const where = (workspaceId: string, provider: CredentialProvider) =>
  and(eq(providerCredentials.workspaceId, workspaceId), eq(providerCredentials.provider, provider));

/** Plausibility check before calling the provider: Bright Data keys are long hex/uuid-like tokens. */
export function validateKeyShape(key: string): string | null {
  if (key.length < 20) return "That key looks too short. Copy the whole key from Bright Data.";
  if (key.length > 200) return "That key looks too long. Copy just the key.";
  if (/\s/.test(key)) return "Keys don't contain spaces. Check what you pasted.";
  return null;
}

/** Test a key with a free call. Returns null when it works, or a message saying why not. */
export async function testBrightDataKey(key: string): Promise<string | null> {
  try {
    await new BrightDataClient(key).verify();
    return null;
  } catch (err) {
    if (err instanceof ProviderError && err.kind === "auth")
      return "Bright Data didn't accept this key. Check it in Bright Data → Account settings → API keys.";
    return `Couldn't reach Bright Data to check the key: ${(err as Error).message}`;
  }
}

export async function getCredentialInfo(
  db: AnyDb,
  workspaceId: string,
  provider: CredentialProvider = "brightdata",
): Promise<CredentialInfo | null> {
  const [row] = await db
    .select({
      last4: providerCredentials.last4,
      createdAt: providerCredentials.createdAt,
      verifiedAt: providerCredentials.verifiedAt,
    })
    .from(providerCredentials)
    .where(where(workspaceId, provider))
    .limit(1);
  return row ?? null;
}

/** Save (or replace) a workspace's key. Test it first; this doesn't. */
export async function saveCredential(
  db: AnyDb,
  {
    workspaceId,
    provider = "brightdata",
    key,
    userId,
    verified = false,
  }: {
    workspaceId: string;
    provider?: CredentialProvider;
    key: string;
    userId?: string;
    verified?: boolean;
  },
) {
  const values = {
    encryptedKey: encrypt(key, workspaceId),
    last4: key.slice(-4),
    createdBy: userId ?? null,
    createdAt: new Date(),
    verifiedAt: verified ? new Date() : null,
  };
  await db
    .insert(providerCredentials)
    .values({ workspaceId, provider, ...values })
    .onConflictDoUpdate({
      target: [providerCredentials.workspaceId, providerCredentials.provider],
      set: values,
    });
}

export async function markVerified(
  db: AnyDb,
  workspaceId: string,
  provider: CredentialProvider = "brightdata",
) {
  await db
    .update(providerCredentials)
    .set({ verifiedAt: new Date() })
    .where(where(workspaceId, provider));
}

export async function deleteCredential(
  db: AnyDb,
  workspaceId: string,
  provider: CredentialProvider = "brightdata",
) {
  await db.delete(providerCredentials).where(where(workspaceId, provider));
}

/**
 * The keys a workspace's calls should use, and where each came from.
 * Pass the result to `getProvider(engine, keys)`.
 */
export async function resolveProviderKeys(
  db: AnyDb,
  workspaceId: string,
  serverKey = env().BRIGHT_DATA_API_KEY,
): Promise<{ keys: ProviderKeys; source: { brightData: KeySource } }> {
  const [row] = await db
    .select({ encryptedKey: providerCredentials.encryptedKey })
    .from(providerCredentials)
    .where(where(workspaceId, "brightdata"))
    .limit(1);

  if (row) {
    try {
      return {
        keys: { brightData: decrypt(row.encryptedKey, workspaceId) },
        source: { brightData: "workspace" },
      };
    } catch (err) {
      if (err instanceof DecryptError)
        throw new ProviderError(
          "auth",
          "This workspace's saved Bright Data key can't be read, most likely because ENCRYPTION_KEY changed. Add the key again in Settings.",
        );
      throw err;
    }
  }
  // an empty string, not undefined, so getProvider doesn't fall back to the server key again
  if (serverKey) return { keys: { brightData: serverKey }, source: { brightData: "server" } };
  return { keys: { brightData: "" }, source: { brightData: null } };
}
