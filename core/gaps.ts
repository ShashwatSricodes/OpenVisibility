/**
 * Where you're missing, and what to do about it.
 *
 * - Content gaps: prompts where an engine names a competitor much more often
 *   than you, from the daily metrics, with the sources those answers cite.
 * - Outreach targets: pages on other sites cited in answers that name a
 *   competitor but not you. AI already trusts them for your prompts, so
 *   getting onto them is often quicker than writing a new page. The outreach
 *   agent (Days O1–O4) works from this list.
 * - Recommendations: the most useful next steps from both, plus owned pages
 *   failing the site audit and engines where your mention rate is falling.
 *
 * Everything comes from your own runs; nothing here calls a model.
 */

import { and, eq, exists, gte, inArray, isNotNull, isNull, lte, not, sql } from "drizzle-orm";
import type { AnyDb } from "@/db/client";
import {
  answers,
  brands,
  citations,
  competitors,
  mentions,
  metricsDaily,
  prompts,
  runItems,
  runs,
} from "@/db/schema";
import { filterHref, filterWindow, type ViewFilter } from "./filters";
import { getAudit } from "./geo/audit";
import { metricsBy } from "./metrics-query";
import { ENGINES, isEngineId } from "./providers/registry";
import type { EngineId } from "./providers/types";

/** A competitor must be this far ahead (0–1) for a prompt to count as a gap. */
export const GAP_MIN = 0.2;
/** …and named in at least this share of answers. */
export const RIVAL_MIN = 0.3;
/** An engine's mention rate falling this far (0–1) on the previous period is news. */
export const SLIP_MIN = 0.1;

const host = (url: string) => {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, "") + (u.pathname === "/" ? "" : u.pathname);
  } catch {
    return url;
  }
};

/* ── answers that name a competitor but not you ───────────── */

async function missedAnswers(db: AnyDb, workspaceId: string, f: ViewFilter, since: Date) {
  const named = (own: boolean) =>
    exists(
      db
        .select({ id: mentions.id })
        .from(mentions)
        .where(
          and(
            eq(mentions.answerId, answers.id),
            own ? isNull(mentions.competitorId) : isNotNull(mentions.competitorId),
          ),
        ),
    );
  const scope = and(
    eq(runs.workspaceId, workspaceId),
    gte(answers.createdAt, since),
    f.engine ? eq(runItems.engine, f.engine) : undefined,
    f.country ? eq(runItems.country, f.country) : undefined,
  );
  const [missed, withYou] = await Promise.all([
    db
      .select({ id: answers.id, promptId: runItems.promptId, engine: runItems.engine })
      .from(answers)
      .innerJoin(runItems, eq(answers.runItemId, runItems.id))
      .innerJoin(runs, eq(runItems.runId, runs.id))
      .where(and(scope, named(false), not(named(true)))),
    // pages cited when you are named: those already work for you
    db
      .select({ url: citations.url, n: sql<number>`count(distinct ${citations.answerId})::int` })
      .from(citations)
      .innerJoin(answers, eq(citations.answerId, answers.id))
      .innerJoin(runItems, eq(answers.runItemId, runItems.id))
      .innerJoin(runs, eq(runItems.runId, runs.id))
      .where(and(scope, named(true)))
      .groupBy(citations.url),
  ]);
  const ids = missed.map((m) => m.id);
  const [rivals, cited] = ids.length
    ? await Promise.all([
        db
          .select({ answerId: mentions.answerId, name: competitors.name })
          .from(mentions)
          .innerJoin(competitors, eq(mentions.competitorId, competitors.id))
          .where(inArray(mentions.answerId, ids)),
        db
          .select({
            answerId: citations.answerId,
            url: citations.url,
            domain: citations.domain,
            title: citations.title,
            kind: citations.kind,
          })
          .from(citations)
          .where(and(inArray(citations.answerId, ids), sql`${citations.kind} <> 'owned'`)),
      ])
    : [[], []];
  return { missed, rivals, cited, withYou: new Map(withYou.map((w) => [w.url, w.n])) };
}

/* ── content gaps ─────────────────────────────────────────── */

export type Gap = {
  promptId: string;
  prompt: string;
  engine: EngineId;
  samples: number;
  /** 0–1 */
  yours: number;
  rival: string;
  theirs: number;
  /** domains cited in this prompt's answers that name a competitor but not you */
  sources: { domain: string; answers: number }[];
};

export async function contentGaps(
  db: AnyDb,
  workspaceId: string,
  f: ViewFilter,
  today = new Date(),
): Promise<Gap[]> {
  const w = filterWindow(f, today);
  const cells = await db
    .select({
      promptId: metricsDaily.promptId,
      engine: metricsDaily.engine,
      competitorId: metricsDaily.competitorId,
      samples: sql<number>`sum(${metricsDaily.samples})::int`,
      mentioned: sql<number>`sum(${metricsDaily.mentioned})::int`,
    })
    .from(metricsDaily)
    .where(
      and(
        eq(metricsDaily.workspaceId, workspaceId),
        gte(metricsDaily.day, w.current.from),
        lte(metricsDaily.day, w.current.to),
        f.engine ? eq(metricsDaily.engine, f.engine) : undefined,
        f.country ? eq(metricsDaily.country, f.country) : undefined,
        isNotNull(metricsDaily.promptId),
      ),
    )
    .groupBy(metricsDaily.promptId, metricsDaily.engine, metricsDaily.competitorId);

  const [names, texts, raw] = await Promise.all([
    db
      .select({ id: competitors.id, name: competitors.name })
      .from(competitors)
      .innerJoin(brands, eq(competitors.brandId, brands.id))
      .where(eq(brands.workspaceId, workspaceId)),
    db
      .select({ id: prompts.id, text: prompts.text })
      .from(prompts)
      .innerJoin(brands, eq(prompts.brandId, brands.id))
      .where(eq(brands.workspaceId, workspaceId)),
    missedAnswers(db, workspaceId, f, w.since),
  ]);

  const gaps: Gap[] = [];
  const keys = new Set(cells.map((c) => `${c.promptId}|${c.engine}`));
  for (const key of keys) {
    const [promptId, engine] = key.split("|");
    const here = cells.filter((c) => c.promptId === promptId && c.engine === engine);
    const own = here.find((c) => c.competitorId === null);
    if (!own?.samples || !isEngineId(engine)) continue;
    const yours = own.mentioned / own.samples;
    const best = here
      .filter((c) => c.competitorId !== null && c.samples)
      .map((c) => ({ ...c, rate: c.mentioned / c.samples }))
      .sort((a, b) => b.rate - a.rate)[0];
    if (!best || best.rate < RIVAL_MIN || best.rate - yours < GAP_MIN) continue;
    const answerIds = new Set(
      raw.missed.filter((m) => m.promptId === promptId && m.engine === engine).map((m) => m.id),
    );
    const byDomain = new Map<string, Set<string>>();
    for (const c of raw.cited)
      if (answerIds.has(c.answerId))
        byDomain.set(c.domain, (byDomain.get(c.domain) ?? new Set()).add(c.answerId));
    gaps.push({
      promptId,
      prompt: texts.find((t) => t.id === promptId)?.text ?? "(deleted prompt)",
      engine,
      samples: own.samples,
      yours,
      rival: names.find((n) => n.id === best.competitorId)?.name ?? "A competitor",
      theirs: best.rate,
      sources: [...byDomain]
        .map(([domain, set]) => ({ domain, answers: set.size }))
        .sort((a, b) => b.answers - a.answers || a.domain.localeCompare(b.domain))
        .slice(0, 5),
    });
  }
  // biggest gap first; more answers behind it breaks ties
  return gaps.sort((a, b) => b.theirs - b.yours - (a.theirs - a.yours) || b.samples - a.samples);
}

/* ── outreach targets ─────────────────────────────────────── */

export type Target = {
  url: string;
  domain: string;
  title: string | null;
  /** a third party's page, or a competitor's own (shown, but not worth pitching) */
  kind: "third_party" | "competitor";
  /** answers citing it that name a competitor but not you */
  answers: number;
  prompts: string[];
  engines: EngineId[];
  /** competitors named in those answers, most often first */
  rivals: string[];
  /** answers citing it that do name you: it already works for you sometimes */
  withYou: number;
};

export async function outreachTargets(
  db: AnyDb,
  workspaceId: string,
  f: ViewFilter,
  today = new Date(),
  { limit = 25 } = {},
): Promise<Target[]> {
  const w = filterWindow(f, today);
  const [raw, texts] = await Promise.all([
    missedAnswers(db, workspaceId, f, w.since),
    db
      .select({ id: prompts.id, text: prompts.text })
      .from(prompts)
      .innerJoin(brands, eq(prompts.brandId, brands.id))
      .where(eq(brands.workspaceId, workspaceId)),
  ]);
  const answerOf = new Map(raw.missed.map((m) => [m.id, m]));
  const pages = new Map<string, { c: (typeof raw.cited)[number]; answers: Set<string> }>();
  for (const c of raw.cited) {
    const p = pages.get(c.url) ?? { c, answers: new Set<string>() };
    p.answers.add(c.answerId);
    if (!p.c.title && c.title) p.c = c;
    pages.set(c.url, p);
  }
  return [...pages.values()]
    .map(({ c, answers: ids }) => {
      const rivalCount = new Map<string, number>();
      for (const r of raw.rivals)
        if (ids.has(r.answerId)) rivalCount.set(r.name, (rivalCount.get(r.name) ?? 0) + 1);
      const asked = [...ids].map((id) => answerOf.get(id)!);
      return {
        url: c.url,
        domain: c.domain,
        // some providers give the domain as the title: that's no title
        title: c.title && !/^(www\.)?[\w-]+(\.[\w-]+)+$/i.test(c.title.trim()) ? c.title : null,
        kind: c.kind === "competitor" ? ("competitor" as const) : ("third_party" as const),
        answers: ids.size,
        // the prompts it's cited for, most answers first
        prompts: [
          ...asked
            .map((a) => texts.find((t) => t.id === a.promptId)?.text ?? "(deleted prompt)")
            .reduce((m, t) => m.set(t, (m.get(t) ?? 0) + 1), new Map<string, number>()),
        ]
          .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
          .map(([text]) => text),
        engines: [...new Set(asked.map((a) => a.engine))].sort(
          (a, b) => Object.keys(ENGINES).indexOf(a) - Object.keys(ENGINES).indexOf(b),
        ),
        rivals: [...rivalCount].sort((a, b) => b[1] - a[1]).map(([name]) => name),
        withYou: raw.withYou.get(c.url) ?? 0,
      };
    })
    .sort(
      (a, b) =>
        Number(a.kind === "competitor") - Number(b.kind === "competitor") ||
        b.answers - a.answers ||
        a.url.localeCompare(b.url),
    )
    .slice(0, limit);
}

/* ── recommendations ──────────────────────────────────────── */

export type Recommendation = {
  id: string;
  kind: "gap" | "target" | "page" | "slipping";
  /** higher first; comparable across kinds */
  priority: number;
  title: string;
  /** the numbers behind it */
  evidence: string;
  /** what to do */
  action: string;
  href: string;
  external?: boolean;
};

const pct = (v: number) => `${Math.round(v * 100)}%`;
const list = (xs: string[]) =>
  xs.length <= 2 ? xs.join(" and ") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`;

export async function recommendations(
  db: AnyDb,
  workspaceId: string,
  f: ViewFilter,
  today = new Date(),
  { limit = 10 } = {},
): Promise<{ items: Recommendation[]; gaps: Gap[]; targets: Target[] }> {
  const w = filterWindow(f, today);
  const [gaps, targets, audit, now, before, [brand]] = await Promise.all([
    contentGaps(db, workspaceId, f, today),
    outreachTargets(db, workspaceId, f, today),
    getAudit(db, workspaceId, today),
    metricsBy(db, workspaceId, w.metrics, "engine", null),
    metricsBy(db, workspaceId, { ...w.metrics, ...w.previous }, "engine", null),
    db
      .select({ name: brands.name })
      .from(brands)
      .where(eq(brands.workspaceId, workspaceId))
      .limit(1),
  ]);
  const you = brand?.name ?? "your brand";
  const items: Recommendation[] = [];

  for (const g of gaps.slice(0, 5)) {
    const sources = g.sources.slice(0, 3).map((s) => s.domain);
    items.push({
      id: `gap:${g.promptId}:${g.engine}`,
      kind: "gap",
      priority: (g.theirs - g.yours) * 100 + Math.min(g.samples, 20),
      title: `Get named for “${g.prompt}” on ${ENGINES[g.engine].name}`,
      evidence: `${g.rival} is named in ${pct(g.theirs)} of answers, ${you} in ${pct(g.yours)} (${g.samples} answers).`,
      action: sources.length
        ? `Those answers cite ${list(sources)}: get ${you} onto those pages.`
        : `Those answers cite no sources: make sure your own page answers this question plainly.`,
      href: filterHref(`/prompts/${g.promptId}`, { range: f.range }),
    });
  }

  for (const t of targets.filter((t) => t.kind === "third_party").slice(0, 5)) {
    items.push({
      id: `target:${t.url}`,
      kind: "target",
      priority: t.answers * 8 + t.prompts.length * 4,
      title: `Get onto ${host(t.url)}`,
      evidence: `Cited in ${t.answers} ${t.answers === 1 ? "answer" : "answers"} that name ${list(t.rivals.slice(0, 3))} but not ${you}, for ${t.prompts.length} ${t.prompts.length === 1 ? "prompt" : "prompts"} on ${list(t.engines.map((e) => ENGINES[e].name))}.`,
      action: `Ask the site to include ${you}${t.title ? ` in “${t.title}”` : ""}, or to review it.`,
      href: t.url,
      external: true,
    });
  }

  for (const site of audit)
    for (const p of site.pages) {
      const problem = p.issues.find((i) => i.severity === "problem");
      if (!problem && (p.score === null || p.score >= 40)) continue;
      const path = host(p.url);
      items.push({
        id: `page:${p.url}`,
        kind: "page",
        priority: problem ? 70 : 40 - (p.score ?? 0) / 2,
        title: `Fix ${path}`,
        evidence: problem
          ? problem.text + "."
          : `Its content score is ${p.score}/100${p.source === "cited" ? ", and answers already cite it" : ""}.`,
        action: p.fixes[0]?.fix ?? "Open the site audit for the details.",
        href: "/audit",
      });
    }

  for (const e of now) {
    if (!e.key || !isEngineId(e.key) || e.mentionRate === null) continue;
    const prev = before.find((b) => b.key === e.key)?.mentionRate;
    if (prev == null || prev - e.mentionRate < SLIP_MIN) continue;
    items.push({
      id: `slipping:${e.key}`,
      kind: "slipping",
      priority: (prev - e.mentionRate) * 150,
      title: `${ENGINES[e.key].name} names ${you} less often`,
      evidence: `${pct(prev)} of answers in the previous period, ${pct(e.mentionRate)} now.`,
      action: `Read its recent answers that leave ${you} out, to see who replaced you and which sources it used.`,
      href: `/answers?engine=${e.key}&named=no${f.range === "30d" ? "" : `&range=${f.range}`}`,
    });
  }

  return {
    items: items.sort((a, b) => b.priority - a.priority).slice(0, limit),
    gaps,
    targets,
  };
}
