/**
 * Encryption for secrets stored in the database (workspaces' API keys).
 *
 * AES-256-GCM with a fresh random IV per value. The key comes from
 * ENCRYPTION_KEY; each value is also bound to a context (the workspace ID),
 * so a ciphertext copied into another workspace's row won't decrypt.
 *
 * Stored format: v1.<iv>.<auth tag>.<ciphertext>, each part base64url.
 */

import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { env } from "./env";

const DEV_SECRET = "dev-only-encryption-key-change-me-in-production";

export class DecryptError extends Error {
  constructor() {
    super("Couldn't decrypt the stored value. Was ENCRYPTION_KEY changed?");
    this.name = "DecryptError";
  }
}

/** A 32-byte key derived from the secret, so any long random string works. */
function deriveKey(secret: string) {
  return Buffer.from(hkdfSync("sha256", secret, "openvisibility", "credentials-v1", 32));
}

function secretFromEnv() {
  const e = env();
  if (e.ENCRYPTION_KEY) return e.ENCRYPTION_KEY;
  if (e.NODE_ENV === "production")
    throw new Error(
      "ENCRYPTION_KEY is not set. Generate one with `openssl rand -base64 32` and add it to your environment.",
    );
  return DEV_SECRET;
}

export function encrypt(plain: string, context: string, secret = secretFromEnv()) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(secret), iv);
  cipher.setAAD(Buffer.from(context));
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv, cipher.getAuthTag(), body]
    .map((p) => (typeof p === "string" ? p : p.toString("base64url")))
    .join(".");
}

export function decrypt(stored: string, context: string, secret = secretFromEnv()) {
  const [version, iv, tag, body] = stored.split(".");
  if (version !== "v1" || !iv || !tag || body === undefined) throw new DecryptError();
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      deriveKey(secret),
      Buffer.from(iv, "base64url"),
    );
    decipher.setAAD(Buffer.from(context));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(body, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new DecryptError();
  }
}
