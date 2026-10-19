/**
 * Server-side session helpers. Every product page and query goes through
 * these, so "who is signed in, and which workspace are they in" is decided
 * in one place.
 */

import { asc, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { cache } from "react";
import { redirect } from "next/navigation";
import { getDb, type AnyDb } from "@/db/client";
import { memberships, workspaces } from "@/db/schema";
import { getAuth } from "./auth";

/* cached per request: the layout and the page both ask, but the database is asked once */
export const getSession = cache(async () => getAuth().api.getSession({ headers: await headers() }));

/** The signed-in user; redirects to /login when there is no valid session. */
export async function requireUser() {
  const session = await getSession();
  if (!session) redirect("/login");
  return session.user;
}

/** The user's workspace: the first they joined. Workspace switching comes later. */
export async function getWorkspaceForUser(userId: string, db: AnyDb = getDb()) {
  const [row] = await db
    .select({ workspace: workspaces, role: memberships.role })
    .from(memberships)
    .innerJoin(workspaces, eq(memberships.workspaceId, workspaces.id))
    .where(eq(memberships.userId, userId))
    .orderBy(asc(memberships.createdAt))
    .limit(1);
  return row ?? null;
}

/** The signed-in user and their workspace, or a redirect to /login. Cached per request. */
export const requireWorkspace = cache(async () => {
  const user = await requireUser();
  const membership = await getWorkspaceForUser(user.id);
  // every user gets a workspace on sign-up; a missing one means data was deleted
  if (!membership) redirect("/login?error=no_workspace");
  return { user, workspace: membership.workspace, role: membership.role };
});
