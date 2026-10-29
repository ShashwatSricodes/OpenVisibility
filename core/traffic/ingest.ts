/**
 * Getting AI traffic in: hits reported live by a site snippet, or lines from
 * an uploaded server log. Only two kinds are kept:
 * - crawlers: requests whose user agent is an AI crawler or agent, with the
 *   address (to verify against the company's published ranges);
 * - referrals: people arriving from an AI assistant (by Referer, or the
 *   utm_source assistants add to links), without their address, and with
 *   the query string dropped from the page.
 * Everything else is thrown away. Each visit gets a fingerprint, so the same
 * log uploaded twice counts once.
 */

import { createHash } from "node:crypto";
import type { AnyDb } from "@/db/client";
import { aiVisits } from "@/db/schema";
import { agentOf, assistantOf } from "./agents";
import { fetchRanges, verify, type RangeSource } from "./verify";

export type Hit = {
  at?: string | number | Date;
  ua?: string | null;
  ip?: string | null;
  path?: string | null;
  host?: string | null;
  status?: number | string | null;
  referer?: string | null;
};

export type Classified =
  { kind: "crawler"; agent: string } | { kind: "referral"; agent: string } | null;

export function classify(h: Hit): Classified {
  const crawler = h.ua ? agentOf(h.ua) : null;
  if (crawler) return { kind: "crawler", agent: crawler.name };
  const assistant = assistantOf(h.referer, h.path ?? "");
  return assistant ? { kind: "referral", agent: assistant } : null;
}

function when(at: Hit["at"], now: Date) {
  if (at === undefined || at === null || at === "") return now;
  if (at instanceof Date) return at;
  if (typeof at === "number") {
    // seconds, milliseconds or Cloudflare's nanoseconds
    const ms = at > 1e17 ? at / 1e6 : at > 1e12 ? at : at * 1000;
    return new Date(ms);
  }
  if (/^\d+$/.test(at)) return when(Number(at), now);
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? now : d;
}

const fingerprint = (...parts: (string | number | null | undefined)[]) =>
  createHash("sha1")
    .update(parts.map((p) => p ?? "").join("|"))
    .digest("hex");

export async function ingest(
  db: AnyDb,
  workspaceId: string,
  hits: Hit[],
  source: "snippet" | "log",
  { now = new Date(), ranges = fetchRanges }: { now?: Date; ranges?: RangeSource } = {},
) {
  const rows: (typeof aiVisits.$inferInsert)[] = [];
  const checked = new Map<string, boolean | null>();
  let ignored = 0;
  for (const h of hits) {
    const c = classify(h);
    const at = when(h.at, now);
    // a stray future timestamp would sit on top of every chart
    if (!c || at.getTime() > now.getTime() + 3_600_000) {
      ignored++;
      continue;
    }
    const rawPath = (h.path || "/").slice(0, 500);
    const path = c.kind === "referral" ? rawPath.split(/[?#]/)[0] || "/" : rawPath;
    const status =
      h.status === null || h.status === undefined || h.status === "" ? null : Number(h.status);
    const host = h.host?.toLowerCase().slice(0, 200) || null;
    let ip: string | null = null;
    let verified: boolean | null = null;
    if (c.kind === "crawler" && h.ip) {
      ip = h.ip.trim().slice(0, 64);
      const key = `${c.agent}|${ip}`;
      if (!checked.has(key)) checked.set(key, await verify(c.agent, ip, ranges));
      verified = checked.get(key)!;
    }
    rows.push({
      workspaceId,
      kind: c.kind,
      at,
      agent: c.agent,
      host,
      path,
      status: Number.isFinite(status) ? status : null,
      ip,
      verified,
      source,
      fingerprint: fingerprint(
        c.kind,
        at.toISOString(),
        c.agent,
        ip,
        host,
        rawPath,
        h.referer ?? null,
      ),
    });
  }
  let stored = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const done = await db
      .insert(aiVisits)
      .values(rows.slice(i, i + 500))
      .onConflictDoNothing()
      .returning({ id: aiVisits.id });
    stored += done.length;
  }
  return { stored, duplicates: rows.length - stored, ignored };
}

/* ── server logs ──────────────────────────────────────────── */

const MONTHS: Record<string, string> = {
  Jan: "01",
  Feb: "02",
  Mar: "03",
  Apr: "04",
  May: "05",
  Jun: "06",
  Jul: "07",
  Aug: "08",
  Sep: "09",
  Oct: "10",
  Nov: "11",
  Dec: "12",
};

/** "10/Oct/2026:13:55:36 +0000" → ISO */
function clfDate(s: string) {
  const m = /^(\d{2})\/(\w{3})\/(\d{4}):(\d{2}:\d{2}:\d{2}) ([+-]\d{2})(\d{2})$/.exec(s);
  return m ? `${m[3]}-${MONTHS[m[2]] ?? "01"}-${m[1]}T${m[4]}${m[5]}:${m[6]}` : s;
}

/** Nginx and Apache's "combined" format, with an optional vhost in front. */
const COMBINED =
  /^(?:(\S+)\s+)?(\S+) \S+ \S+ \[([^\]]+)\] "(?:[A-Z]+) (\S+)[^"]*" (\d{3}) \S+ "([^"]*)" "([^"]*)"/;

const pick = (o: Record<string, unknown>, ...keys: string[]) => {
  for (const k of keys) {
    const v = o[k];
    if (v !== undefined && v !== null && v !== "") return v as string | number;
  }
  return null;
};

/**
 * One log line as a hit: Nginx/Apache combined format, or a JSON line
 * (Cloudflare Logpush, Vercel and most JSON loggers, by common field names).
 */
export function parseLine(line: string): Hit | null {
  const t = line.trim();
  if (!t) return null;
  if (t.startsWith("{")) {
    let o: Record<string, unknown>;
    try {
      o = JSON.parse(t);
    } catch {
      return null;
    }
    const uri = pick(
      o,
      "ClientRequestURI",
      "ClientRequestPath",
      "path",
      "url",
      "request_uri",
      "uri",
    );
    return {
      at: pick(o, "EdgeStartTimestamp", "timestamp", "time", "@timestamp", "date") ?? undefined,
      ua: String(
        pick(o, "ClientRequestUserAgent", "userAgent", "user_agent", "http_user_agent", "ua") ?? "",
      ),
      ip: (pick(o, "ClientIP", "ip", "clientIp", "remote_addr", "client_ip") as string) ?? null,
      path: uri === null ? "/" : String(uri).replace(/^https?:\/\/[^/]+/, "") || "/",
      host: (pick(o, "ClientRequestHost", "host", "hostname") as string) ?? null,
      status: pick(o, "EdgeResponseStatus", "status", "statusCode", "status_code") ?? null,
      referer:
        (pick(o, "ClientRequestReferer", "referer", "referrer", "http_referer") as string) ?? null,
    };
  }
  const m = COMBINED.exec(t);
  if (!m) return null;
  // with a vhost in front, the first field is the host and the second the address
  const [host, ip] =
    m[2] && /^[\d.:a-f]+$/i.test(m[2]) ? [m[1] ?? null, m[2]] : [null, m[1] ?? m[2]];
  return {
    at: clfDate(m[3]),
    ip,
    host,
    path: m[4],
    status: Number(m[5]),
    referer: m[6] === "-" ? null : m[6],
    ua: m[7],
  };
}

/** Quick pre-filter, so huge logs only parse the lines that can matter. */
const WORTH_PARSING =
  /bot|gpt|claude|perplexity|google|bing|apple|meta|amazon|bytespider|cohere|mistral|duckassist|chatgpt|gemini|copilot|deepseek|grok|you\.com|phind|utm_source/i;

/** Read a log a line at a time and ingest it in batches. */
export async function ingestLog(
  db: AnyDb,
  workspaceId: string,
  lines: AsyncIterable<string> | Iterable<string>,
  opts: { now?: Date; ranges?: RangeSource } = {},
) {
  const total = { lines: 0, unreadable: 0, stored: 0, duplicates: 0, ignored: 0 };
  let batch: Hit[] = [];
  const flush = async () => {
    if (!batch.length) return;
    const r = await ingest(db, workspaceId, batch, "log", opts);
    total.stored += r.stored;
    total.duplicates += r.duplicates;
    total.ignored += r.ignored;
    batch = [];
  };
  for await (const line of lines) {
    if (!line.trim()) continue;
    total.lines++;
    if (!WORTH_PARSING.test(line)) {
      total.ignored++;
      continue;
    }
    const hit = parseLine(line);
    if (!hit) {
      total.unreadable++;
      continue;
    }
    batch.push(hit);
    if (batch.length >= 1000) await flush();
  }
  await flush();
  return total;
}

/** Lines from a stream of bytes, without holding the whole file. */
export async function* linesOf(stream: ReadableStream<Uint8Array>) {
  const decoder = new TextDecoder();
  const reader = stream.getReader();
  let rest = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    rest += decoder.decode(value, { stream: true });
    const parts = rest.split(/\r?\n/);
    rest = parts.pop() ?? "";
    yield* parts;
  }
  rest += decoder.decode();
  if (rest) yield rest;
}
