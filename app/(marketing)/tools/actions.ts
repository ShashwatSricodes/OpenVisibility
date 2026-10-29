"use server";

import { headers } from "next/headers";
import { defaultNet } from "@/core/geo/fetch";
import { getProvider } from "@/core/providers";
import { FakeProvider } from "@/core/providers/fake";
import type { Provider } from "@/core/providers/types";
import { contentCheck, crawlabilityCheck } from "@/core/tools/checks";
import { entityCheck } from "@/core/tools/entity";
import { pollFanOut, startFanOut, visitorOf } from "@/core/tools/fanout";
import { getDb } from "@/db/client";

/* The free tools' server side. No account needed, so each tool is limited
   per visitor; the visitor is a salted hash of their address, never stored raw. */

async function visitor() {
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "local";
  return visitorOf(ip);
}

const hits = new Map<string, { start: number; n: number }>();
async function limited(tool: string, perHour: number) {
  const key = `${tool}:${await visitor()}`;
  const now = Date.now();
  const w = hits.get(key);
  if (!w || now - w.start > 3_600_000) {
    hits.set(key, { start: now, n: 1 });
    return false;
  }
  return ++w.n > perHour;
}
const SLOW_DOWN = {
  ok: false as const,
  message: "That's a lot of checks in an hour; give it a few minutes.",
};

export async function checkCrawlability(url: string) {
  if (await limited("crawl", 20)) return SLOW_DOWN;
  return crawlabilityCheck(url, defaultNet());
}

export async function checkContent(url: string, brand: string) {
  if (await limited("content", 20)) return SLOW_DOWN;
  return contentCheck(url, brand, defaultNet());
}

export async function checkEntity(name: string, domain: string) {
  if (await limited("entity", 10)) return SLOW_DOWN;
  return entityCheck(name, domain, defaultNet());
}

/* development: answers instantly, with made-up searches, and says so */
const state = globalThis as unknown as { __ovToolFake?: FakeProvider };
function fanOutProvider(): Provider | null {
  if (process.env.OV_FAKE_ANSWERS === "1")
    return (state.__ovToolFake ??= new FakeProvider({
      pendingChecks: 2,
      reply: (input) => ({
        text: `(Development answer) For "${input.prompt}", popular options include Zoho Invoice, FreshBooks and Ledgerly.`,
        citations: [
          { url: "https://www.g2.com/categories/invoicing", title: "Best Invoicing Software" },
          { url: "https://zapier.com/blog/best-invoicing-app/", title: "The best invoicing apps" },
        ],
        raw: {
          web_search_query: [
            `${input.prompt.toLowerCase().replace(/[?]/g, "")} 2026`,
            "best invoicing software reviews",
          ],
        },
      }),
    }));
  try {
    return getProvider("chatgpt");
  } catch {
    return null;
  }
}

export async function startQueryFanOut(prompt: string, country: string) {
  const provider = fanOutProvider();
  if (!provider)
    return {
      ok: false as const,
      message: "This server has no Bright Data key, so it can't ask ChatGPT.",
    };
  return startFanOut(getDb(), provider, { prompt, country }, await visitor());
}

export async function pollQueryFanOut(id: string) {
  const provider = fanOutProvider();
  if (!provider || !/^[0-9a-f-]{36}$/.test(id)) return { status: "missing" as const };
  return pollFanOut(getDb(), provider, id);
}
