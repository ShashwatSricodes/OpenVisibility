/**
 * Does AI know your brand as a thing? Models and search engines lean on a
 * few public sources to tell a company apart from a common word: Wikipedia,
 * Wikidata (with the official website on the entry), and the brand's own
 * schema.org Organization markup linking its profiles (sameAs). This checks
 * each and says what's missing. It's a signal list, not a guarantee.
 */

import { safeGet, type Net } from "../geo/fetch";
import { normalizeInput } from "./checks";

type Fetcher = (url: string) => Promise<unknown>;

const UA =
  "OpenVisibility/1.0 (https://github.com/ShashwatSricodes/OpenVisibility; brand entity check)";

/** Wikipedia and Wikidata ask for an identifying user agent. */
export const wikiFetch: Fetcher = async (url) => {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
};

const host = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
};

export type EntityCheck = { id: string; label: string; ok: boolean; detail: string; fix?: string };

/** The Organization (or similar) node in a page's JSON-LD, with its sameAs links and logo. */
export function organizationOf(html: string) {
  const nodes: Record<string, unknown>[] = [];
  const walk = (n: unknown) => {
    if (Array.isArray(n)) return n.forEach(walk);
    if (!n || typeof n !== "object") return;
    nodes.push(n as Record<string, unknown>);
    for (const v of Object.values(n)) if (typeof v === "object") walk(v);
  };
  for (const m of html.matchAll(
    /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    try {
      walk(JSON.parse(m[1].trim()));
    } catch {
      // ignored, like crawlers do
    }
  }
  const ORG =
    /^(Organization|Corporation|LocalBusiness|OnlineBusiness|OnlineStore|Brand|NGO|EducationalOrganization)$/;
  const org = nodes.find((n) => {
    const t = n["@type"];
    return (Array.isArray(t) ? t : [t]).some((x) => typeof x === "string" && ORG.test(x));
  });
  if (!org) return null;
  const same = org.sameAs;
  return {
    name: typeof org.name === "string" ? org.name : null,
    logo: !!org.logo,
    sameAs: (Array.isArray(same) ? same : typeof same === "string" ? [same] : []).filter(
      (s): s is string => typeof s === "string",
    ),
  };
}

export async function entityCheck(
  name: string,
  rawDomain: string,
  net: Net,
  wiki: Fetcher = wikiFetch,
) {
  const brand = name.trim().slice(0, 80);
  const site = normalizeInput(rawDomain);
  if (!brand) return { ok: false as const, message: "Enter your brand's name." };
  if (!site) return { ok: false as const, message: "Enter your website, like ledgerly.app." };
  const domain = site.hostname.replace(/^www\./, "");
  const checks: EntityCheck[] = [];

  // Wikipedia: an article about the brand
  try {
    const r = (await wiki(
      `https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&srlimit=5&srsearch=${encodeURIComponent(`"${brand}"`)}`,
    )) as { query?: { search?: { title: string; snippet: string }[] } };
    const hit = r.query?.search?.find(
      (s) =>
        s.title.toLowerCase() === brand.toLowerCase() ||
        s.title.toLowerCase().startsWith(`${brand.toLowerCase()} (`),
    );
    checks.push({
      id: "wikipedia",
      label: "A Wikipedia article",
      ok: !!hit,
      detail: hit
        ? `“${hit.title}” on English Wikipedia.`
        : `No English Wikipedia article titled “${brand}”.`,
      fix: hit
        ? undefined
        : "Wikipedia needs independent coverage (press, reviews) first; build that, and don't write your own article.",
    });
  } catch {
    checks.push({
      id: "wikipedia",
      label: "A Wikipedia article",
      ok: false,
      detail: "Wikipedia couldn't be reached; try again later.",
    });
  }

  // Wikidata: an entity whose official website is this domain
  try {
    const found = (await wiki(
      `https://www.wikidata.org/w/api.php?action=wbsearchentities&format=json&language=en&type=item&limit=7&search=${encodeURIComponent(brand)}`,
    )) as { search?: { id: string; label?: string; description?: string }[] };
    const ids = (found.search ?? []).map((s) => s.id);
    let match: { id: string; label: string; description: string } | null = null;
    if (ids.length) {
      const ents = (await wiki(
        `https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=claims|labels|descriptions&languages=en&ids=${ids.join("|")}`,
      )) as {
        entities?: Record<
          string,
          {
            labels?: { en?: { value: string } };
            descriptions?: { en?: { value: string } };
            claims?: { P856?: { mainsnak?: { datavalue?: { value?: string } } }[] };
          }
        >;
      };
      for (const id of ids) {
        const e = ents.entities?.[id];
        const sites = (e?.claims?.P856 ?? []).map((c) => c.mainsnak?.datavalue?.value ?? "");
        if (sites.some((s) => host(s) === domain || host(s).endsWith(`.${domain}`))) {
          match = {
            id,
            label: e?.labels?.en?.value ?? brand,
            description: e?.descriptions?.en?.value ?? "",
          };
          break;
        }
      }
    }
    checks.push({
      id: "wikidata",
      label: "A Wikidata entry with your website",
      ok: !!match,
      detail: match
        ? `${match.label} (${match.id})${match.description ? `: ${match.description}` : ""}.`
        : ids.length
          ? `Wikidata has entries named “${brand}”, but none lists ${domain} as its official website.`
          : `No Wikidata entry named “${brand}”.`,
      fix: match
        ? undefined
        : ids.length
          ? `If one of them is you, add ${domain} as its official website (P856).`
          : "Create a Wikidata item for the company with its official website (P856), if it meets Wikidata's notability rules.",
    });
  } catch {
    checks.push({
      id: "wikidata",
      label: "A Wikidata entry with your website",
      ok: false,
      detail: "Wikidata couldn't be reached; try again later.",
    });
  }

  // the brand's own home page: Organization markup, sameAs links, logo, the name in the title
  const home = await safeGet(`${site.origin}/`, net);
  if (home.error || !home.status || home.status >= 400) {
    checks.push({
      id: "schema",
      label: "Organization markup on your home page",
      ok: false,
      detail: `Couldn't load ${site.origin} (${home.error ?? `HTTP ${home.status}`}).`,
    });
  } else {
    const org = organizationOf(home.body);
    const profiles = (org?.sameAs ?? []).map(host).filter(Boolean);
    checks.push({
      id: "schema",
      label: "Organization markup on your home page",
      ok: !!org,
      detail: org
        ? `Found${org.name ? ` for “${org.name}”` : ""}${org.logo ? ", with a logo" : ", without a logo"}.`
        : "No schema.org Organization in the home page's JSON-LD.",
      fix: org
        ? org.logo
          ? undefined
          : "Add your logo to the Organization markup."
        : "Add JSON-LD with @type Organization: name, url, logo and sameAs links to your profiles.",
    });
    checks.push({
      id: "sameas",
      label: "Links to your other profiles (sameAs)",
      ok: profiles.length >= 2,
      detail: profiles.length ? `Links to ${profiles.join(", ")}.` : "None listed.",
      fix:
        profiles.length >= 2
          ? undefined
          : "List your LinkedIn, Crunchbase, X, GitHub, G2 or Wikipedia pages in sameAs, so engines can join them up.",
    });
    const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(home.body)?.[1] ?? "";
    const named = title.toLowerCase().includes(brand.toLowerCase());
    checks.push({
      id: "title",
      label: "Your name in the home page title",
      ok: named,
      detail: title
        ? `Title: “${title.replace(/\s+/g, " ").trim().slice(0, 120)}”.`
        : "The home page has no title.",
      fix: named ? undefined : `Put “${brand}” in the home page's <title>.`,
    });
  }
  return {
    ok: true as const,
    brand,
    domain,
    checks,
    score: checks.filter((c) => c.ok).length,
    of: checks.length,
  };
}
