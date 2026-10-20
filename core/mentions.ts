/**
 * Deterministic mention detection: which tracked brands an answer names,
 * where, and in what order. Pure, so it's easy to test and cheap to rerun.
 *
 * Rules:
 * - A brand matches by its name, an alias or one of its domains, as a whole
 *   word (letters or digits on either side mean it's part of a longer word),
 *   Unicode-aware. "Zoho's" counts; "Zohofied" doesn't.
 * - Case: multi-word names, domains and names with digits or symbols match
 *   in any case. A single plain word ("Wave", "Square", "Ledgerly") must start
 *   with a capital, so "a new wave of tools" isn't the brand Wave. Engines
 *   capitalise brand names, so real mentions still match.
 * - Inside a URL only the host counts: a link to zoho.com is a mention of
 *   Zoho, but "/best-zoho-alternatives" in some other site's path isn't.
 * - Overlaps: the longest match wins, so "Zoho Invoice" isn't also "Zoho"
 *   when both are tracked.
 * - Position: when the answer lists brands (numbered or bulleted), brands
 *   are ranked by the first list item naming them; brands named only outside
 *   the list come after, in order of first appearance. Without a list, by
 *   order of first appearance. Only tracked brands are ranked.
 */

export type Entity = {
  /** null for the workspace's own brand, else the competitor's id */
  competitorId: string | null;
  name: string;
  aliases: string[];
  domains: string[];
};

export type Mention = {
  competitorId: string | null;
  /** 1 = the first tracked brand named */
  position: number;
  /** the sentence around the first match */
  snippet: string;
  /** where the first match starts in the text */
  index: number;
};

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const URL_RE = /\bhttps?:\/\/[^\s<>()[\]"'`]+/giu;
const LIST_ITEM = /^[ \t]*(?:#{1,6}[ \t]+)?(?:\*\*)?(?:\d{1,3}[.)]|[-*•+])[ \t]+/;

/**
 * Single plain words must be capitalised; everything else matches in any
 * case. Scripts without capitals (Japanese, Arabic…) are never held to it.
 */
const caseSensitiveStart = (term: string) =>
  /^\p{L}+$/u.test(term) && term[0].toLowerCase() !== term[0].toUpperCase();

type Hit = { entity: number; start: number; end: number };

function termHits(text: string, term: string, entity: number): Hit[] {
  const t = term.trim();
  if (!t) return [];
  const re = new RegExp(`(?<![\\p{L}\\p{N}])${escape(t)}(?![\\p{L}\\p{N}])`, "giu");
  const hits: Hit[] = [];
  for (const m of text.matchAll(re)) {
    if (caseSensitiveStart(t) && !/^\p{Lu}/u.test(m[0])) continue;
    hits.push({ entity, start: m.index, end: m.index + m[0].length });
  }
  return hits;
}

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
};

/** The sentence around a match, trimmed to about `max` characters around it. */
export function snippetAt(text: string, start: number, end: number, max = 220): string {
  const before = text.slice(0, start);
  const after = text.slice(end);
  const from = Math.max(
    before.lastIndexOf("\n") + 1,
    ...[". ", "! ", "? "].map((p) => {
      const i = before.lastIndexOf(p);
      return i < 0 ? 0 : i + 2;
    }),
  );
  const stops = ["\n", ". ", "! ", "? "]
    .map((p) => after.indexOf(p))
    .filter((i) => i >= 0)
    .map((i) => end + i + 1);
  const until = stops.length ? Math.min(...stops) : text.length;

  let a = from;
  let z = until;
  if (z - a > max) {
    // a long sentence: keep the match, with context on both sides
    const room = Math.max(0, max - (end - start));
    a = Math.max(from, start - Math.floor(room / 2));
    z = Math.min(until, a + Math.max(max, end - a));
    a = Math.max(from, z - max);
  }
  const clean = (s: string) =>
    s
      .replace(/\*\*|__|`/g, "")
      .replace(/\s+/g, " ")
      .trim();
  return `${a > from ? "…" : ""}${clean(text.slice(a, z))}${z < until ? "…" : ""}`;
}

export function detectMentions(text: string, entities: Entity[]): Mention[] {
  // 1. URLs: their hosts can be mentions; the rest of the URL is blanked out
  const urlHits: Hit[] = [];
  const masked = text.replace(URL_RE, (url, offset: number) => {
    const host = hostOf(url);
    if (host)
      entities.forEach((e, i) => {
        if (e.domains.some((d) => host === d || host.endsWith(`.${d}`)))
          urlHits.push({ entity: i, start: offset, end: offset + url.length });
      });
    return " ".repeat(url.length);
  });

  // 2. names, aliases and domains in the remaining text
  let hits: Hit[] = [...urlHits];
  entities.forEach((e, i) => {
    for (const term of new Set([e.name, ...e.aliases, ...e.domains]))
      hits.push(...termHits(masked, term, i));
  });

  // 3. overlaps: earliest first, then longest; drop anything inside a kept match
  hits.sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start));
  const kept: Hit[] = [];
  for (const h of hits) if (!kept.some((k) => h.start < k.end && k.start < h.end)) kept.push(h);
  hits = kept;
  if (!hits.length) return [];

  // 4. list items: the line each hit is on, if that line is one
  const lineStarts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") lineStarts.push(i + 1);
  const lineOf = (pos: number) => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= pos) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };
  const lines = text.split("\n");
  const isItem = lines.map((l) => LIST_ITEM.test(l));

  const first = new Map<number, { hit: Hit; listLine: number | null }>();
  for (const h of hits) {
    const line = lineOf(h.start);
    const listLine = isItem[line] ? line : null;
    const seen = first.get(h.entity);
    if (!seen) first.set(h.entity, { hit: h, listLine });
    else if (seen.listLine === null && listLine !== null) seen.listLine = listLine;
  }

  const ranked = [...first.entries()].sort(([, a], [, b]) => {
    if (a.listLine !== null && b.listLine !== null)
      return a.listLine - b.listLine || a.hit.start - b.hit.start;
    if (a.listLine !== null) return -1;
    if (b.listLine !== null) return 1;
    return a.hit.start - b.hit.start;
  });

  return ranked.map(([entity, { hit }], i) => ({
    competitorId: entities[entity].competitorId,
    position: i + 1,
    snippet: snippetAt(text, hit.start, hit.end),
    index: hit.start,
  }));
}
