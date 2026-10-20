/**
 * Runs the worker on a timer. With the embedded development database it
 * runs inside the Next.js server (only one process can open that database);
 * with DATABASE_URL it runs as its own process: `npm run worker`.
 *
 * OV_FAKE_ANSWERS=1 answers every prompt instantly from a fake provider,
 * for trying runs without spending Bright Data answers.
 */

import { getDb } from "@/db/client";
import { resolveProviderKeys } from "../credentials";
import { env } from "../env";
import { FakeProvider } from "../providers/fake";
import { getProvider } from "../providers/index";
import type { Provider } from "../providers/types";
import { tick, type ProviderFor } from "./worker";

/* one fake provider for the process: its jobs live in memory between ticks */
let fake: FakeProvider | undefined;

export const defaultProviderFor: ProviderFor = async (workspaceId, engine): Promise<Provider> => {
  if (process.env.OV_FAKE_ANSWERS === "1") {
    fake ??= new FakeProvider({
      pendingChecks: 1,
      reply: (input) => ({
        text: `A sample answer to "${input.prompt}". Ledgerly, Zoho Invoice and FreshBooks are popular choices.`,
        citations: [{ url: "https://example.com/best-invoicing-software", title: "Example guide" }],
      }),
    });
    return fake;
  }
  const { keys } = await resolveProviderKeys(getDb(), workspaceId);
  return getProvider(engine, keys);
};

/** Where the worker should run in this process, if anywhere. */
export function workerMode(): "inline" | "off" {
  const setting = process.env.OV_WORKER;
  if (setting === "off" || setting === "inline") return setting;
  // embedded database: it has to be this process
  return env().DATABASE_URL ? "off" : "inline";
}

const state = globalThis as unknown as { __ovWorker?: { stop: () => void } };

/** Start ticking every few seconds. Ticks never overlap; errors are logged, not fatal. */
export function startWorker({ intervalMs = 5_000 }: { intervalMs?: number } = {}) {
  if (state.__ovWorker) return state.__ovWorker;
  let busy = false;
  let stopped = false;

  const run = async () => {
    if (busy || stopped) return;
    busy = true;
    try {
      const r = await tick({
        db: getDb(),
        providerFor: defaultProviderFor,
        // fake answers are instant; Bright Data batches take minutes, so don't ask every tick
        checkEveryMs: process.env.OV_FAKE_ANSWERS === "1" ? 0 : 15_000,
      });
      if (r.submitted || r.collected || r.requeued || r.finished.length)
        console.log(
          `Worker: submitted ${r.submitted}, answered ${r.collected}, retrying ${r.requeued}` +
            (r.finished.length ? `, finished ${r.finished.length} run(s)` : ""),
        );
    } catch (err) {
      console.error("Worker tick failed:", err);
    } finally {
      busy = false;
    }
  };

  const timer = setInterval(run, intervalMs);
  void run();
  state.__ovWorker = {
    stop: () => {
      stopped = true;
      clearInterval(timer);
      state.__ovWorker = undefined;
    },
  };
  console.log(
    `Worker started (every ${intervalMs / 1000}s${process.env.OV_FAKE_ANSWERS === "1" ? ", fake answers" : ""}).`,
  );
  return state.__ovWorker;
}
