/**
 * The outreach agent's list: pages on other sites that AI cites when it
 * names competitors but not you (core/gaps.ts), kept with what the agent
 * learns about each. Syncing adds new ones and refreshes the numbers;
 * the worker researches a couple per tick (core/outreach/research.ts) and
 * finds who to write to (core/outreach/contacts.ts).
 *
 * Nothing here sends anything: pitches and sending come with Days O2–O3,
 * and every email is approved by a person first.
 */

import { and, asc, desc, eq, inArray, lt, sql } from "drizzle-orm";
import type { AnyDb } from "@/db/client";
import { brands, outreachTargets } from "@/db/schema";
import { loadEntities } from "../analysis";
import { classify, ownersOf } from "../citations";
import { outreachTargets as findTargets } from "../gaps";
import { readContent } from "../geo/content";
import { safeGet, type Net } from "../geo/fetch";
import { visibleText } from "../geo/page";
import { TOP, topResults } from "../search/serp";
import type { AnalysisModel } from "../sentiment";
import { authorOf, contactPages, emailsIn, pickContact, type Contact } from "./contacts";
import { researchByModel, researchByRules, type Brand, type Research } from "./research";

export const MAX_TARGETS = 40;
const MAX_ATTEMPTS = 3;

export type Evidence = {
  /** answers that cite it and name a competitor but not you (last 30 days) */
  answers: number;
  prompts: string[];
  engines: string[];
  rivals: string[];
  withYou: number;
  /** where it ranks on Google for your prompts (top 5, latest weekly search) */
  ranks?: { prompt: string; country: string; position: number }[];
};

/**
 * How much a page matters: answers that cite it without you, how high it
 * ranks on Google for how many prompts, and how many prompts it touches.
 */
export function scoreOf(e: Evidence) {
  const ranks = e.ranks ?? [];
  const prompts = new Set([...e.prompts, ...ranks.map((r) => r.prompt)]);
  return (
    e.answers * 8 +
    ranks.reduce((n, r) => n + (TOP + 1 - Math.min(r.position, TOP)) * 3, 0) +
    prompts.size * 4
  );
}

/**
 * Add new targets and refresh the numbers on known ones, from two sources:
 * pages AI cited in the last 30 days in answers that left you out, and
 * Google's top results for your prompts. Your own pages and competitors'
 * are never targets.
 */
export async function syncTargets(db: AnyDb, workspaceId: string, today = new Date()) {
  const [cited, ranked, brand] = await Promise.all([
    findTargets(db, workspaceId, { range: "30d" }, today, { limit: 100 }),
    topResults(db, workspaceId),
    brandOf(db, workspaceId),
  ]);
  const merged = new Map<
    string,
    { url: string; domain: string; title: string | null; e: Evidence }
  >();
  for (const t of cited.filter((t) => t.kind === "third_party"))
    merged.set(t.url, {
      url: t.url,
      domain: t.domain,
      title: t.title,
      e: {
        answers: t.answers,
        prompts: t.prompts,
        engines: t.engines,
        rivals: t.rivals,
        withYou: t.withYou,
        ranks: [],
      },
    });
  for (const r of ranked) {
    const kind = brand ? classify(r.domain, brand.owners).kind : "third_party";
    if (kind !== "third_party") continue;
    const m = merged.get(r.url) ?? {
      url: r.url,
      domain: r.domain,
      title: r.title,
      e: { answers: 0, prompts: [], engines: [], rivals: [], withYou: 0, ranks: [] },
    };
    m.e.ranks!.push({ prompt: r.prompt, country: r.country, position: r.position });
    m.title ??= r.title;
    merged.set(r.url, m);
  }
  const found = [...merged.values()]
    .sort((a, b) => scoreOf(b.e) - scoreOf(a.e) || a.url.localeCompare(b.url))
    .slice(0, MAX_TARGETS);
  if (!found.length) return { added: 0, total: 0 };
  const before = await db
    .select({ url: outreachTargets.url })
    .from(outreachTargets)
    .where(eq(outreachTargets.workspaceId, workspaceId));
  const known = new Set(before.map((b) => b.url));
  for (const t of found) {
    t.e.ranks!.sort((a, b) => a.position - b.position);
    await db
      .insert(outreachTargets)
      .values({ workspaceId, url: t.url, domain: t.domain, title: t.title, evidence: t.e })
      .onConflictDoUpdate({
        target: [outreachTargets.workspaceId, outreachTargets.url],
        set: { evidence: t.e, updatedAt: new Date() },
      });
  }
  return { added: found.filter((t) => !known.has(t.url)).length, total: found.length };
}

export async function brandOf(db: AnyDb, workspaceId: string) {
  const [b] = await db.select().from(brands).where(eq(brands.workspaceId, workspaceId)).limit(1);
  if (!b) return null;
  const entities = (await loadEntities(db, [b.id])).get(b.id) ?? [];
  const own = entities.find((e) => e.competitorId === null);
  return {
    brand: {
      name: b.name,
      description: b.description,
      category: b.category,
      audience: b.audience,
      domains: b.domains,
    } satisfies Brand,
    names: [b.name, ...(own?.aliases ?? [])],
    /** each competitor's names, to see who a page mentions */
    rivals: entities
      .filter((e) => e.competitorId !== null)
      .map((e) => ({ name: e.name, names: [e.name, ...e.aliases] })),
    owners: ownersOf(entities),
  };
}

const headingsOf = (html: string) =>
  [...html.matchAll(/<h([1-3])[^>]*>([\s\S]*?)<\/h\1>/gi)]
    .map((m) => visibleText(m[2]))
    .filter(Boolean);

/** Read one target and decide what it is, who to write to, and what happens next. */
export async function researchTarget(
  page: { url: string; domain: string; title: string | null; evidence: Evidence },
  brand: { brand: Brand; names: string[]; rivals?: { name: string; names: string[] }[] },
  net: Net,
  model: AnalysisModel | null,
): Promise<{
  status: "ready" | "no_contact" | "task" | "skipped";
  research: Research | null;
  contact: Contact | null;
  note: string | null;
  costUsd: number;
}> {
  const got = await safeGet(page.url, net);
  if (got.error || !got.status || got.status >= 400)
    return {
      status: "no_contact",
      research: null,
      contact: null,
      note: `The page couldn't be read (${got.error ?? `HTTP ${got.status}`}).`,
      costUsd: 0,
    };

  const html = got.body;
  const facts = readContent(html, brand.names);
  const title = facts.title ?? page.title;
  // the competitors the page itself names (a page found on Google has no answer to say)
  const onPage = (brand.rivals ?? [])
    .filter((r) => readContent(html, r.names).brandMentions > 0)
    .map((r) => r.name);
  const rivals = page.evidence.rivals.length ? page.evidence.rivals : onPage;
  let research: Research = {
    ...researchByRules(
      { url: page.url, domain: page.domain, title, namesBrand: facts.brandMentions > 0 },
      brand.brand,
      rivals,
    ),
    rivalsOnPage: onPage,
  };
  let costUsd = 0;
  if (model && research.kind !== "directory" && research.kind !== "community") {
    const byModel = await researchByModel(
      model,
      { url: page.url, title, headings: headingsOf(html), text: visibleText(html) },
      brand.brand,
      rivals,
      [...page.evidence.prompts, ...(page.evidence.ranks ?? []).map((r) => r.prompt)],
    );
    if (byModel) {
      costUsd = byModel.costUsd;
      // the model reads the page; counting the brand's name in it is the rules' job
      research = {
        ...byModel.research,
        namesBrand: research.namesBrand || byModel.research.namesBrand,
        rivalsOnPage: onPage,
      };
    }
  }

  if (research.namesBrand)
    return {
      status: "skipped",
      research,
      contact: null,
      note: `The page already names ${brand.brand.name}; answers leave it out for other reasons.`,
      costUsd,
    };
  if (research.kind === "directory" || research.kind === "community")
    return { status: "task", research, contact: null, note: research.opening, costUsd };
  if (!research.fit)
    return {
      status: "skipped",
      research,
      contact: null,
      note: `Not a fit: ${research.reason}`,
      costUsd,
    };

  // who to write to: the page first, then the site's own contact pages
  const author = authorOf(html);
  const found: { email: string; source: Contact["source"]; foundOn: string }[] = emailsIn(html).map(
    (email) => ({
      email,
      source: "page" as const,
      foundOn: got.finalUrl,
    }),
  );
  let contact = pickContact(found, page.domain, author);
  if (!contact || contact.role === "general") {
    for (const url of contactPages(html, got.finalUrl)) {
      const c = await safeGet(url, net, { maxBytes: 500_000 });
      if (c.status && c.status < 400)
        found.push(
          ...emailsIn(c.body).map((email) => ({
            email,
            source: "contact_page" as const,
            foundOn: c.finalUrl,
          })),
        );
      contact = pickContact(found, page.domain, author);
      if (contact && contact.role !== "general") break;
    }
  }
  return {
    status: contact ? "ready" : "no_contact",
    research,
    contact,
    note: contact
      ? null
      : `${page.domain} publishes no email address on the page or its contact pages; a contact form may be the way in.`,
    costUsd,
  };
}

/** The worker step: research a few new targets. Returns how many. */
export async function researchPending(
  db: AnyDb,
  net: Net,
  model: AnalysisModel | null,
  { limit = 2 } = {},
) {
  const todo = await db
    .select()
    .from(outreachTargets)
    .where(
      and(eq(outreachTargets.status, "found"), lt(outreachTargets.researchAttempts, MAX_ATTEMPTS)),
    )
    .orderBy(asc(outreachTargets.createdAt))
    .limit(limit);
  const brands = new Map<string, Awaited<ReturnType<typeof brandOf>>>();
  for (const t of todo) {
    if (!brands.has(t.workspaceId)) brands.set(t.workspaceId, await brandOf(db, t.workspaceId));
    const brand = brands.get(t.workspaceId);
    if (!brand) continue;
    await db
      .update(outreachTargets)
      .set({ researchAttempts: sql`${outreachTargets.researchAttempts} + 1` })
      .where(eq(outreachTargets.id, t.id));
    try {
      const r = await researchTarget(
        { url: t.url, domain: t.domain, title: t.title, evidence: t.evidence as Evidence },
        brand,
        net,
        model,
      );
      await db
        .update(outreachTargets)
        .set({
          status: r.status,
          research: r.research,
          contact: r.contact,
          note: r.note,
          researchedAt: new Date(),
          costUsd: sql`${outreachTargets.costUsd} + ${r.costUsd}`,
          updatedAt: new Date(),
        })
        // the user may have skipped it meanwhile
        .where(and(eq(outreachTargets.id, t.id), eq(outreachTargets.status, "found")));
    } catch (err) {
      console.error(`Outreach: researching ${t.url} failed:`, err);
    }
  }
  return todo.length;
}

/** The list for the Outreach page: ready first, then tasks, then the rest. */
export async function listTargets(db: AnyDb, workspaceId: string) {
  const rows = await db
    .select()
    .from(outreachTargets)
    .where(eq(outreachTargets.workspaceId, workspaceId))
    .orderBy(desc(sql`(${outreachTargets.evidence} ->> 'answers')::int`), asc(outreachTargets.url));
  const order = [
    "ready",
    "task",
    "found",
    "no_contact",
    "drafted",
    "approved",
    "sent",
    "replied",
    "won",
    "skipped",
  ];
  return rows
    .map((r) => ({
      ...r,
      evidence: r.evidence as Evidence,
      research: r.research as Research | null,
      contact: r.contact as Contact | null,
      score: scoreOf(r.evidence as Evidence),
    }))
    .sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status) || b.score - a.score);
}

/** Set a target aside, or bring it back to be researched again. */
export async function setSkipped(db: AnyDb, workspaceId: string, ids: string[], skip: boolean) {
  if (!ids.length) return;
  await db
    .update(outreachTargets)
    .set(
      skip
        ? { status: "skipped", note: "Skipped by you.", updatedAt: new Date() }
        : { status: "found", note: null, researchAttempts: 0, updatedAt: new Date() },
    )
    .where(and(eq(outreachTargets.workspaceId, workspaceId), inArray(outreachTargets.id, ids)));
}

/**
 * Coverage: of the pages that rank in Google's top results for your
 * prompts (other than competitors' own), how many name you. Your own pages
 * count as covered. Without search results, the pages AI cites stand in.
 */
export async function coverage(db: AnyDb, workspaceId: string) {
  const [ranked, brand, targets] = await Promise.all([
    topResults(db, workspaceId),
    brandOf(db, workspaceId),
    listTargets(db, workspaceId),
  ]);
  const byUrl = new Map(targets.map((t) => [t.url, t]));
  const state = (url: string) => {
    const t = byUrl.get(url);
    if (!t || t.status === "found") return "pending" as const;
    return t.research?.namesBrand ? ("covered" as const) : ("missing" as const);
  };
  if (ranked.length) {
    const pages = new Map<string, "yours" | "covered" | "missing" | "pending">();
    for (const r of ranked) {
      const kind = brand ? classify(r.domain, brand.owners).kind : "third_party";
      if (kind === "competitor") continue;
      pages.set(r.url, kind === "owned" ? "yours" : state(r.url));
    }
    const count = (s: string) => [...pages.values()].filter((v) => v === s).length;
    return {
      basis: "search" as const,
      total: pages.size,
      yours: count("yours"),
      covered: count("covered"),
      missing: count("missing"),
      pending: count("pending"),
    };
  }
  const cited = targets.filter((t) => t.evidence.answers > 0);
  return {
    basis: "citations" as const,
    total: cited.length,
    yours: 0,
    covered: cited.filter((t) => t.research?.namesBrand).length,
    missing: cited.filter((t) => t.status !== "found" && !t.research?.namesBrand).length,
    pending: cited.filter((t) => t.status === "found").length,
  };
}
