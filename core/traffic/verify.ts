/**
 * Is a request from GPTBot really from OpenAI? User agents are easy to fake;
 * the IP ranges each company publishes aren't. Lists are fetched once a day
 * and kept in memory; when a list can't be fetched, visits are recorded as
 * unverified (null) rather than as fakes.
 */

import { isIP } from "node:net";
import { agentNamed } from "./agents";

type Range = { v6: boolean; base: bigint; bits: number };

// the build targets ES2017, without BigInt literals
const [B0, B1, B8, B16] = [BigInt(0), BigInt(1), BigInt(8), BigInt(16)];

function toBigInt(ip: string): { v6: boolean; n: bigint } | null {
  const plain = ip.trim().replace(/^\[|\]$/g, "");
  const mapped = plain.toLowerCase().startsWith("::ffff:") && isIP(plain.slice(7)) === 4;
  const v = mapped ? plain.slice(7) : plain;
  const kind = isIP(v);
  if (kind === 4)
    return { v6: false, n: v.split(".").reduce((n, p) => (n << B8) + BigInt(Number(p)), B0) };
  if (kind !== 6) return null;
  const [head, tail = ""] = v.split("::");
  const h = head ? head.split(":") : [];
  const t = v.includes("::") ? (tail ? tail.split(":") : []) : [];
  const groups = v.includes("::") ? [...h, ...Array(8 - h.length - t.length).fill("0"), ...t] : h;
  if (groups.length !== 8) return null;
  return { v6: true, n: groups.reduce((n, g) => (n << B16) + BigInt(parseInt(g || "0", 16)), B0) };
}

export function parseCidr(cidr: string): Range | null {
  const [addr, bitsRaw] = cidr.split("/");
  const ip = toBigInt(addr);
  if (!ip) return null;
  const width = ip.v6 ? 128 : 32;
  const bits = bitsRaw === undefined ? width : Number(bitsRaw);
  if (!Number.isInteger(bits) || bits < 0 || bits > width) return null;
  const mask = bits === 0 ? B0 : ((B1 << BigInt(bits)) - B1) << BigInt(width - bits);
  return { v6: ip.v6, base: ip.n & mask, bits };
}

export function inRanges(ip: string, ranges: Range[]) {
  const a = toBigInt(ip);
  if (!a) return false;
  const width = a.v6 ? 128 : 32;
  return ranges.some((r) => {
    if (r.v6 !== a.v6) return false;
    const mask = r.bits === 0 ? B0 : ((B1 << BigInt(r.bits)) - B1) << BigInt(width - r.bits);
    return (a.n & mask) === r.base;
  });
}

/** The prefixes in one of the companies' range files. */
export function parseRangeFile(json: unknown): Range[] {
  const prefixes = (json as { prefixes?: { ipv4Prefix?: string; ipv6Prefix?: string }[] })
    ?.prefixes;
  if (!Array.isArray(prefixes)) return [];
  return prefixes.flatMap((p) => {
    const r = parseCidr(p.ipv4Prefix ?? p.ipv6Prefix ?? "");
    return r ? [r] : [];
  });
}

export type RangeSource = (url: string) => Promise<Range[] | null>;

const DAY = 86_400_000;
const cache = new Map<string, { at: number; ranges: Range[] | null }>();

/** Fetch a range file, keeping it for a day (and a failure for an hour). */
export const fetchRanges: RangeSource = async (url) => {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < (hit.ranges ? DAY : DAY / 24)) return hit.ranges;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    const ranges = res.ok ? parseRangeFile(await res.json()) : null;
    cache.set(url, { at: Date.now(), ranges: ranges?.length ? ranges : null });
  } catch {
    cache.set(url, { at: Date.now(), ranges: null });
  }
  return cache.get(url)!.ranges;
};

/**
 * true: the address is in the agent's published ranges; false: it claims to
 * be the agent but isn't; null: the agent publishes no ranges, the list
 * couldn't be fetched, or there's no address.
 */
export async function verify(
  agent: string,
  ip: string | null | undefined,
  source: RangeSource = fetchRanges,
) {
  const a = agentNamed(agent);
  if (!a?.ranges?.length || !ip || !toBigInt(ip)) return null;
  const lists = await Promise.all(a.ranges.map(source));
  if (lists.every((l) => l === null)) return null;
  return lists.some((l) => l && inRanges(ip, l));
}
