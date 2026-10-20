/**
 * Fetching pages for the audit: one request at a time per URL, redirects
 * followed by hand (so each hop is checked and counted), a timeout, and a
 * cap on how much is read.
 *
 * Domains are typed in by users, so a fetch could be pointed at the
 * server's own network ("intranet.local", 169.254.169.254). Every host is
 * resolved first and private, loopback and link-local addresses are refused.
 * OV_AUDIT_PRIVATE=1 lifts that, for self-hosters auditing an internal site.
 */

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export const AUDIT_USER_AGENT =
  "Mozilla/5.0 (compatible; OpenVisibility-Audit/1.0; +https://github.com/ShashwatSricodes/OpenVisibility)";

export type Net = {
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  /** the addresses a host name resolves to */
  resolve: (host: string) => Promise<string[]>;
  allowPrivate?: boolean;
  timeoutMs?: number;
};

export const defaultNet = (): Net => ({
  fetch: (url, init) => fetch(url, init),
  resolve: async (host) => (await lookup(host, { all: true })).map((a) => a.address),
  allowPrivate: process.env.OV_AUDIT_PRIVATE === "1",
});

/** Loopback, private, link-local, carrier-grade NAT and unique-local addresses. */
export function isPrivateAddress(ip: string): boolean {
  const v4 = ip.startsWith("::ffff:") ? ip.slice(7) : ip;
  if (isIP(v4) === 4) {
    const [a, b] = v4.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }
  const v6 = ip.toLowerCase();
  return (
    v6 === "::" ||
    v6 === "::1" ||
    v6.startsWith("fc") ||
    v6.startsWith("fd") ||
    v6.startsWith("fe8") ||
    v6.startsWith("fe9") ||
    v6.startsWith("fea") ||
    v6.startsWith("feb")
  );
}

export type Fetched = {
  /** the URL asked for, and where it ended up after redirects */
  url: string;
  finalUrl: string;
  /** every URL redirected through, in order */
  redirects: string[];
  status: number | null;
  headers: Headers | null;
  body: string;
  ms: number;
  /** why there's no response: timeout, refused address, network error */
  error: string | null;
};

async function readCapped(res: Response, maxBytes: number) {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (size < maxBytes) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.length;
  }
  await reader.cancel().catch(() => {});
  const all = new Uint8Array(Math.min(size, maxBytes));
  let at = 0;
  for (const c of chunks) {
    const part = c.subarray(0, Math.max(0, all.length - at));
    all.set(part, at);
    at += part.length;
  }
  return new TextDecoder().decode(all);
}

export async function safeGet(
  url: string,
  net: Net,
  { maxBytes = 2_000_000, maxRedirects = 5, accept = "text/html,*/*;q=0.8" } = {},
): Promise<Fetched> {
  const started = Date.now();
  const redirects: string[] = [];
  let current = url;
  const fail = (error: string, status: number | null = null): Fetched => ({
    url,
    finalUrl: current,
    redirects,
    status,
    headers: null,
    body: "",
    ms: Date.now() - started,
    error,
  });

  for (let hop = 0; hop <= maxRedirects; hop++) {
    let u: URL;
    try {
      u = new URL(current);
    } catch {
      return fail("Not a valid URL");
    }
    if (u.protocol !== "http:" && u.protocol !== "https:") return fail("Not a web address");
    if (!net.allowPrivate) {
      const host = u.hostname.replace(/^\[|\]$/g, "");
      let addresses: string[];
      try {
        addresses = isIP(host) ? [host] : await net.resolve(host);
      } catch {
        return fail("The domain doesn't resolve");
      }
      if (!addresses.length || addresses.some(isPrivateAddress))
        return fail("The domain points to a private address");
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), net.timeoutMs ?? 10_000);
    let res: Response;
    try {
      res = await net.fetch(current, {
        redirect: "manual",
        signal: controller.signal,
        headers: { "User-Agent": AUDIT_USER_AGENT, Accept: accept },
      });
    } catch (e) {
      clearTimeout(timer);
      return fail(controller.signal.aborted ? "Timed out" : `Couldn't connect (${String(e)})`);
    }

    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) {
      clearTimeout(timer);
      await res.body?.cancel().catch(() => {});
      redirects.push(current);
      current = new URL(location, current).toString();
      continue;
    }
    try {
      const body = await readCapped(res, maxBytes);
      return {
        url,
        finalUrl: current,
        redirects,
        status: res.status,
        headers: res.headers,
        body,
        ms: Date.now() - started,
        error: null,
      };
    } catch {
      return fail(controller.signal.aborted ? "Timed out" : "The page stopped loading");
    } finally {
      clearTimeout(timer);
    }
  }
  return fail("Too many redirects");
}
