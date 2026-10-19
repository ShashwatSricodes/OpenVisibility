/**
 * The full magic-link flow against PGlite, through Better Auth's real
 * request handler: ask for a link, open it, end up signed in with a
 * workspace you own.
 */

import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { getWorkspaceForUser } from "./session";
import type { Email } from "../email";
import { createAuth, type Auth } from "./auth";

const BASE = "http://localhost:3000";

let db: ReturnType<typeof drizzle<typeof schema>>;
let auth: Auth;
const outbox: Email[] = [];

beforeAll(async () => {
  db = drizzle(new PGlite(), { schema });
  await migrate(db, { migrationsFolder: "db/migrations" });
  auth = createAuth({
    db,
    secret: "test-secret-test-secret-test-secret-1234",
    baseURL: BASE,
    send: async (email) => {
      outbox.push(email);
    },
  });
}, 60_000);

/** Ask for a link through the HTTP API, as the login page does. */
async function requestLink(email: string) {
  const res = await auth.handler(
    new Request(`${BASE}/api/auth/sign-in/magic-link`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: BASE },
      body: JSON.stringify({ email, callbackURL: "/dashboard" }),
    }),
  );
  expect(res.status).toBe(200);
  const sent = outbox.at(-1)!;
  expect(sent.to).toBe(email);
  const link = sent.text.match(/https?:\/\/\S+/)?.[0];
  expect(link).toBeTruthy();
  return link!;
}

describe("magic-link sign-in", () => {
  it("signs a new user in and gives them a workspace they own", async () => {
    const link = await requestLink("priya@example.com");

    const res = await auth.handler(new Request(link, { headers: { Origin: BASE } }));
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`${BASE}/dashboard`);
    const cookie = res.headers.get("set-cookie");
    expect(cookie).toMatch(/session_token=/);

    const [user] = await db
      .select()
      .from(schema.user)
      .where(eq(schema.user.email, "priya@example.com"));
    expect(user).toBeTruthy();

    const membership = await getWorkspaceForUser(user.id, db);
    expect(membership?.role).toBe("owner");
    expect(membership?.workspace.name).toBe("priya's workspace");

    // the cookie from the redirect is a valid session
    const session = await auth.api.getSession({
      headers: new Headers({ cookie: cookie!.split(";")[0] }),
    });
    expect(session?.user.email).toBe("priya@example.com");
  });

  it("refuses a link that has already been used", async () => {
    const link = await requestLink("once@example.com");
    await auth.handler(new Request(link, { headers: { Origin: BASE } }));
    const again = await auth.handler(new Request(link, { headers: { Origin: BASE } }));
    expect(again.headers.get("location")).toMatch(/error/);
  });

  it("does not create a second workspace when the user signs in again", async () => {
    for (let i = 0; i < 2; i++) {
      const link = await requestLink("repeat@example.com");
      await auth.handler(new Request(link, { headers: { Origin: BASE } }));
    }
    const [user] = await db
      .select()
      .from(schema.user)
      .where(eq(schema.user.email, "repeat@example.com"));
    const rows = await db
      .select()
      .from(schema.memberships)
      .where(eq(schema.memberships.userId, user.id));
    expect(rows).toHaveLength(1);
  });
});
