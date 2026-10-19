/**
 * Authentication: passwordless sign-in by email (magic links), via Better Auth.
 *
 * A new user gets their own workspace, with them as owner, the moment their
 * account is created. `createAuth` takes the database and email sender as
 * arguments so tests can run it against PGlite and capture the link.
 */

import { betterAuth } from "better-auth";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { magicLink } from "better-auth/plugins";
import { getDb, type AnyDb } from "@/db/client";
import * as schema from "@/db/schema";
import { sendEmail, type Email } from "../email";
import { env } from "../env";

/**
 * Sign-in requests are only accepted from trusted addresses (CSRF protection).
 * In development, any address on this machine or the local network is
 * trusted, so the app works at 127.0.0.1, on another port, or at the network
 * address `next dev` prints. In production only BETTER_AUTH_URL is, plus any
 * listed in BETTER_AUTH_TRUSTED_ORIGINS (comma-separated; Better Auth reads it).
 *
 * The address is parsed, not wildcard-matched: "http://172.*" would also
 * trust a domain like 172.evil.com.
 */
export function isLocalOrigin(origin: string): boolean {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  const host = url.hostname;
  if (host === "localhost" || host === "[::1]") return true;
  const ip = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!ip) return false;
  const [a, b] = [Number(ip[1]), Number(ip[2])];
  return a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
}

/** Trusts the request's own origin when it's local. */
const trustLocalOrigin = (request?: Request) => {
  const origin = request?.headers.get("origin");
  return origin && isLocalOrigin(origin) ? [new URL(origin).origin] : [];
};

/** Name a new user's first workspace after them, falling back to their email. */
function workspaceName(user: { name?: string | null; email: string }) {
  const who = user.name?.trim() || user.email.split("@")[0];
  return `${who}'s workspace`;
}

export function createAuth({
  db,
  send = sendEmail,
  secret,
  baseURL,
}: {
  db: AnyDb;
  send?: (email: Email) => Promise<void>;
  secret?: string;
  baseURL?: string;
}) {
  const e = env();
  const resolvedSecret = secret ?? e.BETTER_AUTH_SECRET;
  if (!resolvedSecret && e.NODE_ENV === "production") {
    throw new Error(
      "BETTER_AUTH_SECRET is not set. Generate one with `openssl rand -base64 32` and add it to your environment.",
    );
  }

  return betterAuth({
    database: drizzleAdapter(db, { provider: "pg", schema }),
    secret: resolvedSecret ?? "dev-only-secret-change-me-in-production-000000",
    baseURL: baseURL ?? e.BETTER_AUTH_URL,
    trustedOrigins: e.NODE_ENV === "production" ? [] : trustLocalOrigin,
    advanced: { database: { generateId: "uuid" } },
    plugins: [
      magicLink({
        expiresIn: 15 * 60,
        sendMagicLink: async ({ email, url }) => {
          await send({
            to: email,
            subject: "Your OpenVisibility sign-in link",
            text: `Sign in to OpenVisibility:\n\n${url}\n\nThe link works once and expires in 15 minutes. If you didn't ask for it, ignore this email.`,
            html: `<p>Sign in to OpenVisibility:</p><p><a href="${url}">Sign in</a></p><p>The link works once and expires in 15 minutes. If you didn't ask for it, ignore this email.</p>`,
          });
        },
      }),
    ],
    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            const [workspace] = await db
              .insert(schema.workspaces)
              .values({ name: workspaceName(user) })
              .returning();
            await db.insert(schema.memberships).values({
              userId: user.id,
              workspaceId: workspace.id,
              role: "owner",
            });
          },
        },
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;

/* one instance per process; created on first use so builds don't need a database */
const globalForAuth = globalThis as unknown as { __ovAuth?: Auth };

export function getAuth(): Auth {
  globalForAuth.__ovAuth ??= createAuth({ db: getDb() });
  return globalForAuth.__ovAuth;
}
