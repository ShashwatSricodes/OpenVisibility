/**
 * The monthly answer limit: the most Bright Data answers a workspace may use
 * in a calendar month (UTC). Checked when a run is created, and again before
 * every batch is sent, so a run in progress stops at the limit instead of
 * going past it.
 */

import { and, count, eq } from "drizzle-orm";
import type { AnyDb } from "@/db/client";
import { runItems, runs, workspaces } from "@/db/schema";
import { workspaceAnswersThisMonth } from "./usage";

export const MAX_CAP = 1_000_000;

export type Budget = {
  /** null: no limit */
  cap: number | null;
  /** answers billed this month */
  used: number;
  /** answers sent and not back yet: they'll be billed */
  inFlight: number;
  /** answers that can still be sent this month; Infinity without a limit */
  left: number;
};

export async function getBudget(db: AnyDb, workspaceId: string, now = new Date()): Promise<Budget> {
  const [[ws], used, [flight]] = await Promise.all([
    db
      .select({ cap: workspaces.monthlyAnswerCap })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId)),
    workspaceAnswersThisMonth(db, workspaceId, now),
    db
      .select({ n: count() })
      .from(runItems)
      .innerJoin(runs, eq(runItems.runId, runs.id))
      .where(and(eq(runs.workspaceId, workspaceId), eq(runItems.status, "running"))),
  ]);
  const cap = ws?.cap ?? null;
  const inFlight = flight?.n ?? 0;
  return {
    cap,
    used,
    inFlight,
    left: cap === null ? Infinity : Math.max(0, cap - used - inFlight),
  };
}

/** Null when `answers` more fit under the limit, or a message saying why not. */
export function capProblem(budget: Budget, answers: number): string | null {
  if (budget.cap === null || answers <= budget.left) return null;
  const n = (v: number) => v.toLocaleString("en-US");
  return `This needs ${n(answers)} answers, but only ${n(budget.left)} are left under your monthly limit of ${n(budget.cap)}. Raise the limit in Settings, or run fewer prompts.`;
}

/** Null clears the limit. */
export function validateCap(cap: number | null): string | null {
  if (cap === null) return null;
  if (!Number.isInteger(cap) || cap < 1 || cap > MAX_CAP)
    return `Set a limit between 1 and ${MAX_CAP.toLocaleString("en-US")} answers, or none.`;
  return null;
}

export async function saveCap(db: AnyDb, workspaceId: string, cap: number | null) {
  await db.update(workspaces).set({ monthlyAnswerCap: cap }).where(eq(workspaces.id, workspaceId));
}
