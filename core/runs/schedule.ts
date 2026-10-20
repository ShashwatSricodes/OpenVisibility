/**
 * Scheduled runs. The worker loop calls fireDueSchedules every tick; each due
 * workspace is claimed by moving its next time forward first, so two workers
 * never start the same run. A run that can't start (over the monthly limit,
 * one still in progress, no prompts) is recorded as skipped with the reason.
 * If the server was down for a while, missed times collapse into one run.
 */

import { and, asc, eq, lte, ne } from "drizzle-orm";
import type { AnyDb } from "@/db/client";
import { brands, runs, workspaces } from "@/db/schema";
import { nextRunAt, type Schedule } from "../schedule-rules";
import { createRun } from "./create";

const columns = {
  frequency: workspaces.scheduleFrequency,
  minute: workspaces.scheduleMinute,
  weekday: workspaces.scheduleWeekday,
  timezone: workspaces.scheduleTimezone,
};

export async function getSchedule(
  db: AnyDb,
  workspaceId: string,
): Promise<Schedule & { nextAt: Date | null }> {
  const [row] = await db
    .select({ ...columns, nextAt: workspaces.scheduleNextAt })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId));
  if (!row) throw new Error(`No workspace ${workspaceId}`);
  return row;
}

/** Save a schedule (already validated) and work out its next run. */
export async function saveSchedule(db: AnyDb, workspaceId: string, s: Schedule, now = new Date()) {
  const nextAt = nextRunAt(s, now);
  await db
    .update(workspaces)
    .set({
      scheduleFrequency: s.frequency,
      scheduleMinute: s.minute,
      scheduleWeekday: s.weekday,
      scheduleTimezone: s.timezone,
      scheduleNextAt: nextAt,
    })
    .where(eq(workspaces.id, workspaceId));
  return nextAt;
}

export type Fired = { workspaceId: string; runId?: string; skipped?: string };

export async function fireDueSchedules(db: AnyDb, now = new Date()): Promise<Fired[]> {
  const due = await db
    .select({ id: workspaces.id, ...columns, nextAt: workspaces.scheduleNextAt })
    .from(workspaces)
    .where(and(ne(workspaces.scheduleFrequency, "off"), lte(workspaces.scheduleNextAt, now)));

  const fired: Fired[] = [];
  for (const ws of due) {
    // claim: only the worker that moves nextAt forward starts the run
    const claimed = await db
      .update(workspaces)
      .set({ scheduleNextAt: nextRunAt(ws, now) })
      .where(and(eq(workspaces.id, ws.id), eq(workspaces.scheduleNextAt, ws.nextAt!)))
      .returning({ id: workspaces.id });
    if (!claimed.length) continue;

    const r = await createRun(db, ws.id, { trigger: "scheduled" });
    if (r.ok) {
      fired.push({ workspaceId: ws.id, runId: r.runId });
      continue;
    }
    // the "in progress" message tells a person to wait; here the run is just skipped
    const reason = r.runId ? "The previous run was still in progress." : r.message;
    fired.push({ workspaceId: ws.id, skipped: reason });
    await recordSkipped(db, ws.id, reason, now);
  }
  return fired;
}

/** A row on the Runs page saying a scheduled run didn't start, and why. */
async function recordSkipped(db: AnyDb, workspaceId: string, reason: string, now: Date) {
  const [brand] = await db
    .select({ id: brands.id })
    .from(brands)
    .where(eq(brands.workspaceId, workspaceId))
    .orderBy(asc(brands.createdAt))
    .limit(1);
  // without a brand there's nowhere to show it; the schedule simply waits
  if (!brand) return;
  await db.insert(runs).values({
    workspaceId,
    brandId: brand.id,
    trigger: "scheduled",
    status: "skipped",
    note: `Scheduled run skipped. ${reason}`,
    startedAt: now,
    finishedAt: now,
  });
}
