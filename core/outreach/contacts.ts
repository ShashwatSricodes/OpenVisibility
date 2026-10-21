/**
 * Who to write to about a page, found only where the site itself publishes
 * it: the page (mailto links, the text, schema.org markup) and the site's
 * own contact, "write for us" and about pages. No paid lookups, and no
 * guessed addresses (firstname@domain): writing to an address nobody
 * published is how outreach turns into spam.
 */

export type Contact = {
  email: string;
  /** a person's name when the page gives one */
  name: string | null;
  /** where the address was found */
  source: "page" | "contact_page";
  foundOn: string;
  /** how the address reads: a person (the author), an editorial desk, or a general inbox */
  role: "author" | "editorial" | "general";
};

/** Addresses that never reach an editor, or belong to tools embedded in the page. */
const NEVER = [
  /^(no-?reply|do-?not-?reply|mailer-daemon|postmaster|bounce)/,
  /^(support|help|billing|invoices?|accounts?|sales|jobs|careers|hr|privacy|legal|abuse|security|dpo|gdpr|unsubscribe|webmaster)@/,
];
const TOOL_DOMAINS = [
  "sentry.io",
  "wixpress.com",
  "sentry-next.wixpress.com",
  "example.com",
  "example.org",
  "domain.com",
  "email.com",
  "yourdomain.com",
  "godaddy.com",
];
const EDITORIAL =
  /^(editor|editors|editorial|edit|news|newsroom|tips|press|pr|media|submissions?|submit|contribute|contributors?|content|pitches|pitch|stories|writers?|reviews?)@/;
const GENERAL = /^(hello|hi|contact|info|team|office|enquiries|inquiries|mail)@/;

const decode = (s: string) =>
  s
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&amp;/g, "&")
    .replace(/%40/g, "@");

/** Every published address in a page, lower-cased, with the tools' and no-reply ones dropped. */
export function emailsIn(html: string): string[] {
  const text = decode(html);
  const found = new Set<string>();
  for (const m of text.matchAll(/mailto:([^"'?\s>]+)/gi)) found.add(m[1]);
  for (const m of text.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,24}/g))
    found.add(m[0]);
  return [...found]
    .map((e) => e.trim().toLowerCase().replace(/\.$/, ""))
    .filter((e) => {
      const [local, domain] = e.split("@");
      if (!local || !domain || e.length > 80) return false;
      // "logo@2x.png" and friends
      if (/\.(png|jpe?g|gif|svg|webp|avif|css|js)$/.test(domain)) return false;
      if (TOOL_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`))) return false;
      return !NEVER.some((re) => re.test(e));
    });
}

/** The author's name, from schema.org, a meta tag or a rel=author link. */
export function authorOf(html: string): string | null {
  const ld = /"author"\s*:\s*(?:\[\s*)?\{[^{}]*?"name"\s*:\s*"([^"]{2,80})"/.exec(html)?.[1];
  const meta = /<meta[^>]+name\s*=\s*["']author["'][^>]*content\s*=\s*["']([^"']{2,80})["']/i.exec(
    html,
  )?.[1];
  const meta2 = /<meta[^>]+content\s*=\s*["']([^"']{2,80})["'][^>]*name\s*=\s*["']author["']/i.exec(
    html,
  )?.[1];
  const rel = /<a[^>]+rel\s*=\s*["'][^"']*author[^"']*["'][^>]*>([^<]{2,80})<\/a>/i.exec(html)?.[1];
  const name = ld ?? meta ?? meta2 ?? rel;
  return name ? decode(name).trim() : null;
}

const PAGE_KINDS: [RegExp, number][] = [
  [/write[-_ ]?for[-_ ]?us|contribut|guest[-_ ]?post|submit|pitch/i, 0],
  [/editorial|editors?\b|newsroom|press|media/i, 1],
  [/contact/i, 2],
  [/about|team|staff|masthead/i, 3],
];

/** Links to the site's own pages that usually publish an address, best first (at most 3). */
export function contactPages(html: string, pageUrl: string): string[] {
  let base: URL;
  try {
    base = new URL(pageUrl);
  } catch {
    return [];
  }
  const out: { url: string; rank: number }[] = [];
  for (const m of html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    let u: URL;
    try {
      u = new URL(decode(m[1]), base);
    } catch {
      continue;
    }
    if (u.protocol !== "https:" && u.protocol !== "http:") continue;
    const sameSite = u.hostname.replace(/^www\./, "") === base.hostname.replace(/^www\./, "");
    if (!sameSite) continue;
    const label = `${u.pathname} ${m[2].replace(/<[^>]+>/g, " ")}`;
    const kind = PAGE_KINDS.find(([re]) => re.test(label));
    if (!kind) continue;
    u.hash = "";
    if (!out.some((o) => o.url === u.toString())) out.push({ url: u.toString(), rank: kind[1] });
  }
  return out
    .sort((a, b) => a.rank - b.rank)
    .slice(0, 3)
    .map((o) => o.url);
}

const siteOf = (domain: string) =>
  domain
    .replace(/^www\./, "")
    .split(".")
    .slice(-2)
    .join(".");

/**
 * The best address among those found: the author's own, then an editorial
 * desk, then a general inbox. Addresses on the site's own domain win; others
 * (a writer's gmail) only when they come with the author's name.
 */
export function pickContact(
  found: { email: string; source: Contact["source"]; foundOn: string }[],
  domain: string,
  author: string | null,
): Contact | null {
  const site = siteOf(domain);
  const authorParts = (author ?? "")
    .toLowerCase()
    .split(/\s+/)
    .filter((p) => p.length >= 3);
  const scored = found.map((f) => {
    const [local, host] = f.email.split("@");
    const own = siteOf(host) === site;
    const isAuthor = authorParts.some((p) => local.includes(p));
    const role: Contact["role"] = isAuthor
      ? "author"
      : EDITORIAL.test(f.email)
        ? "editorial"
        : "general";
    const score =
      (own ? 10 : isAuthor ? 4 : -100) +
      (role === "author" ? 12 : role === "editorial" ? 8 : GENERAL.test(f.email) ? 4 : 2) +
      (f.source === "page" ? 1 : 0);
    return { ...f, role, score, isAuthor };
  });
  const best = scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score)[0];
  if (!best) return null;
  return {
    email: best.email,
    name: best.isAuthor ? author : null,
    source: best.source,
    foundOn: best.foundOn,
    role: best.role,
  };
}
