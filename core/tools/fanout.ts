/**
 * Query fan-out, as a free tool: ask ChatGPT one question (one Bright Data
 * answer) and show the web searches it ran to answer, and the sources it
 * cited. Those searches are what a page has to rank for to be found.
 *
 * Each run spends an answer from the server's Bright Data allowance, so
 * runs are limited per visitor and per day, counted in the database. A run
 * takes a minute or two: start() submits, poll() checks and collects.
 */

import { createHash } from "node:crypto";
import { and, eq, gte, sql } from "drizzle-orm";
import type { AnyDb } from "@/db/client";
import { toolRuns } from "@/db/schema";
import { fanOut } from "../answer-archive";
import { normalizeUrl } from "../citations";
import type { Provider } from "../providers/types";

export const PER_VISITOR_PER_DAY = 3;
export const dailyCap = () => Number(process.env.OV_FREE_TOOL_DAILY ?? 50);

/** A visitor, from their address, salted so the hash can't be reversed into it. */
export const visitorOf = (ip: string) =>
  createHash("sha256")
    .update(`${process.env.BETTER_AUTH_SECRET ?? "ov-dev"}:${ip}`)
    .digest("hex")
    .slice(0, 32);

export async function startFanOut(
  db: AnyDb,
  provider: Provider,
  input: { prompt: string; country: string },
  visitor: string,
  now = new Date(),
) {
  const prompt = input.prompt.trim().replace(/\s+/g, " ");
  if (prompt.length < 8 || prompt.length > 300)
    return { ok: false as const, message: "Ask a full question, between 8 and 300 characters." };
  const country = /^[A-Z]{2}$/.test(input.country) ? input.country : "US";
  const day = new Date(now.getTime() - 86_400_000);
  const [mine, all] = await Promise.all([
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(toolRuns)
      .where(
        and(
          eq(toolRuns.tool, "fan-out"),
          eq(toolRuns.visitor, visitor),
          gte(toolRuns.createdAt, day),
        ),
      ),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(toolRuns)
      .where(and(eq(toolRuns.tool, "fan-out"), gte(toolRuns.createdAt, day))),
  ]);
  if (mine[0].n >= PER_VISITOR_PER_DAY)
    return {
      ok: false as const,
      message: `That's ${PER_VISITOR_PER_DAY} questions today; come back tomorrow, or track your prompts with a free account.`,
    };
  if (all[0].n >= dailyCap())
    return {
      ok: false as const,
      message: "The free tool has answered all it can today; try again tomorrow.",
    };
  let jobId: string;
  try {
    jobId = await provider.submit("chatgpt", [{ prompt, country }]);
  } catch {
    return {
      ok: false as const,
      message: "ChatGPT couldn't be asked just now; try again in a few minutes.",
    };
  }
  const [row] = await db
    .insert(toolRuns)
    .values({ tool: "fan-out", input: { prompt, country }, jobId, visitor, createdAt: now })
    .returning({ id: toolRuns.id });
  return { ok: true as const, id: row.id };
}

export type FanOutResult = {
  prompt: string;
  country: string;
  searches: string[];
  sources: { url: string; domain: string; title: string | null }[];
  /** whether ChatGPT says it searched the web; null when it doesn't say */
  searched: boolean | null;
  excerpt: string;
};

export async function pollFanOut(db: AnyDb, provider: Provider, id: string) {
  const [run] = await db.select().from(toolRuns).where(eq(toolRuns.id, id)).limit(1);
  if (!run || run.tool !== "fan-out") return { status: "missing" as const };
  if (run.status === "done") return { status: "done" as const, result: run.result as FanOutResult };
  if (run.status === "failed")
    return { status: "failed" as const, message: run.error ?? "That didn't work." };
  // give up on runs stuck for more than ten minutes
  if (Date.now() - run.createdAt.getTime() > 10 * 60_000) {
    await db
      .update(toolRuns)
      .set({ status: "failed", error: "ChatGPT took too long to answer; try again." })
      .where(eq(toolRuns.id, id));
    return { status: "failed" as const, message: "ChatGPT took too long to answer; try again." };
  }
  const input = run.input as { prompt: string; country: string };
  const state = await provider.check(run.jobId!).catch(() => ({ state: "pending" as const }));
  if (state.state === "pending") return { status: "running" as const };
  if (state.state === "failed") {
    await db
      .update(toolRuns)
      .set({ status: "failed", error: state.error.message })
      .where(eq(toolRuns.id, id));
    return {
      status: "failed" as const,
      message: "ChatGPT couldn't answer that; try another question.",
    };
  }
  const [answer] = await provider.collect("chatgpt", run.jobId!, [input]);
  if (!answer?.ok) {
    await db
      .update(toolRuns)
      .set({ status: "failed", error: answer?.error?.message ?? "No answer" })
      .where(eq(toolRuns.id, id));
    return {
      status: "failed" as const,
      message: "ChatGPT didn't answer that one; try another question.",
    };
  }
  const seen = new Set<string>();
  const result: FanOutResult = {
    prompt: input.prompt,
    country: input.country,
    searches: fanOut(answer.raw),
    sources: answer.citations.flatMap((c) => {
      const n = normalizeUrl(c.url);
      if (!n || seen.has(n.url)) return [];
      seen.add(n.url);
      return [{ url: n.url, domain: n.domain, title: c.title ?? null }];
    }),
    searched: answer.webSearchTriggered ?? null,
    excerpt: answer.text.slice(0, 600),
  };
  await db.update(toolRuns).set({ status: "done", result }).where(eq(toolRuns.id, id));
  return { status: "done" as const, result };
}
