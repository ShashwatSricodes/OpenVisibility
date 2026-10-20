/**
 * Citations: cleaning up cited URLs and saying whose they are.
 *
 * The same page is often cited under different URLs: with tracking
 * parameters, Google's "#:~:text=" highlight, "www." or not, a capitalised
 * host. normalizeUrl reduces them to one, so a page is counted once.
 * classify says whether a domain is the brand's own, a competitor's, or a
 * third party's (review sites, blogs, directories), matching subdomains too.
 */

import type { Entity } from "./mentions";

/** Query parameters that only track clicks; anything else may change the page. */
const TRACKING = [
  /^utm_/i,
  /^(gclid|gclsrc|dclid|gbraid|wbraid|fbclid|msclkid|yclid|twclid|ttclid|li_fat_id|igshid|mc_cid|mc_eid|_ga|_gl|srsltid|ved|ei|sca_esv|sxsrf|rlz|oq|aqs|sourceid)$/i,
  /^ref_src$/i,
];

export function normalizeUrl(raw: string): { url: string; domain: string } | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  u.hostname = u.hostname
    .toLowerCase()
    .replace(/^www\./, "")
    .replace(/\.$/, "");
  u.username = "";
  u.password = "";
  if ((u.protocol === "https:" && u.port === "443") || (u.protocol === "http:" && u.port === "80"))
    u.port = "";
  for (const key of [...u.searchParams.keys()])
    if (TRACKING.some((re) => re.test(key))) u.searchParams.delete(key);
  // "#:~:text=…" highlights a passage; other fragments are kept off too, as they're the same page
  u.hash = "";
  let url = u.toString();
  // "https://zoho.com/?" and "https://zoho.com/" are the same page
  if (url.endsWith("?")) url = url.slice(0, -1);
  return { url, domain: u.hostname };
}

export type Owners = {
  owned: string[];
  competitors: { id: string; domains: string[] }[];
};

const matches = (domain: string, list: string[]) =>
  list.some((d) => domain === d || domain.endsWith(`.${d}`));

export function classify(
  domain: string,
  owners: Owners,
):
  | { kind: "owned"; competitorId: null }
  | { kind: "competitor"; competitorId: string }
  | { kind: "third_party"; competitorId: null } {
  if (matches(domain, owners.owned)) return { kind: "owned", competitorId: null };
  const rival = owners.competitors.find((c) => matches(domain, c.domains));
  if (rival) return { kind: "competitor", competitorId: rival.id };
  return { kind: "third_party", competitorId: null };
}

/** Owners from the brand and competitors as mention detection has them. */
export function ownersOf(entities: Entity[]): Owners {
  return {
    owned: entities.filter((e) => e.competitorId === null).flatMap((e) => e.domains),
    competitors: entities.flatMap((e) =>
      e.competitorId ? [{ id: e.competitorId, domains: e.domains }] : [],
    ),
  };
}

/**
 * Cited links ready to store: cleaned, labelled, and each page once (the
 * first time it's cited). Links that aren't web pages are dropped.
 */
export function citationRows(
  cited: { url: string; title?: string | null; position?: number | null }[],
  owners: Owners,
) {
  const seen = new Set<string>();
  return cited.flatMap((c) => {
    const n = normalizeUrl(c.url);
    if (!n || seen.has(n.url)) return [];
    seen.add(n.url);
    return [
      {
        url: n.url,
        domain: n.domain,
        title: c.title?.trim() || null,
        position: c.position ?? null,
        ...classify(n.domain, owners),
      },
    ];
  });
}
