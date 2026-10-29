/**
 * API keys for the MCP server: one per person or tool, made and revoked in
 * Settings. A key is "ov_" + 40 random characters; only its SHA-256 is
 * stored (it's long and random, so a fast hash is enough), and it's shown
 * once. Looking a key up by its hash is constant-time in what matters: no
 * comparison of secrets character by character.
 */

import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import type { AnyDb } from "@/db/client";
import { apiKeys } from "@/db/schema";

export type Access = "read" | "write";
export type KeyContext = { workspaceId: string; keyId: string; access: Access; name: string };

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

export const hashKey = (key: string) => createHash("sha256").update(key).digest("hex");

export function newKey() {
  const bytes = randomBytes(40);
  let body = "";
  for (const b of bytes) body += ALPHABET[b % ALPHABET.length];
  return `ov_${body}`;
}

export async function createKey(
  db: AnyDb,
  workspaceId: string,
  { name, access, createdBy }: { name: string; access: Access; createdBy: string },
) {
  const clean = name.trim().slice(0, 60);
  if (!clean) return { ok: false as const, message: "Name the key, like “Claude Desktop”." };
  const key = newKey();
  const [row] = await db
    .insert(apiKeys)
    .values({
      workspaceId,
      name: clean,
      prefix: key.slice(0, 9),
      hash: hashKey(key),
      access,
      createdBy,
    })
    .returning({ id: apiKeys.id });
  // the only time the key exists outside its owner's hands
  return { ok: true as const, id: row.id, key };
}

export async function listKeys(db: AnyDb, workspaceId: string) {
  return db
    .select({
      id: apiKeys.id,
      name: apiKeys.name,
      prefix: apiKeys.prefix,
      access: apiKeys.access,
      createdBy: apiKeys.createdBy,
      createdAt: apiKeys.createdAt,
      lastUsedAt: apiKeys.lastUsedAt,
    })
    .from(apiKeys)
    .where(and(eq(apiKeys.workspaceId, workspaceId), isNull(apiKeys.revokedAt)))
    .orderBy(desc(apiKeys.createdAt));
}

export async function revokeKey(db: AnyDb, workspaceId: string, id: string) {
  await db
    .update(apiKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiKeys.workspaceId, workspaceId), eq(apiKeys.id, id)));
}

/** The workspace and access a key grants, or null; marks the key as used (at most once a minute). */
export async function verifyKey(
  db: AnyDb,
  key: string,
  now = new Date(),
): Promise<KeyContext | null> {
  if (!/^ov_[A-Za-z0-9]{40}$/.test(key)) return null;
  const [row] = await db
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.hash, hashKey(key)), isNull(apiKeys.revokedAt)))
    .limit(1);
  if (!row) return null;
  if (!row.lastUsedAt || now.getTime() - row.lastUsedAt.getTime() > 60_000)
    await db.update(apiKeys).set({ lastUsedAt: now }).where(eq(apiKeys.id, row.id));
  return { workspaceId: row.workspaceId, keyId: row.id, access: row.access, name: row.name };
}

/** A key from an Authorization header ("Bearer ov_…"). */
export const bearer = (header: string | null) => header?.match(/^Bearer\s+(\S+)$/i)?.[1] ?? null;

/* A small per-key rate limit: enough for an agent, not for a scraper. */
const windows = new Map<string, { start: number; n: number }>();
export const RATE_LIMIT = 120;

export function allow(keyId: string, now = Date.now()) {
  const w = windows.get(keyId);
  if (!w || now - w.start > 60_000) {
    windows.set(keyId, { start: now, n: 1 });
    return true;
  }
  w.n++;
  return w.n <= RATE_LIMIT;
}
