/**
 * The OpenVisibility MCP server: a workspace's AI-visibility data and the
 * actions that matter, for Claude, ChatGPT, Cursor and any MCP client.
 *
 * One server per request, bound to the workspace and access level of the API
 * key (core/mcp/keys.ts). Every tool reads through the same core functions
 * as the app's pages, so an answer in chat matches what's on screen.
 *
 * Read tools work with any key. Tools that change something (prompts, runs,
 * audits) need a "write" key. Nothing here can approve or send outreach
 * emails: a person approves every email in the app.
 */

import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { AnyDb } from "@/db/client";
import { annotations, brands, prompts } from "@/db/schema";
import { getAnswer, listAnswers } from "../answer-archive";
import { getBrandSetup } from "../brands";
import { citationSummary, citationsByEngine } from "../citation-stats";
import { competitorView } from "../competitor-results";
import { checkFreeTier } from "../estimate";
import { describeFilter, filterOptions, filterWindow, type ViewFilter } from "../filters";
import { SOURCE_NOTE, VARIANCE_NOTE } from "../framing";
import { contentGaps, recommendations } from "../gaps";
import { getAudit, queueAudits } from "../geo/audit";
import { getBrief, requestBrief } from "../outreach/brief";
import { openReplies, pipeline } from "../outreach/replies";
import { coverage, listTargets, syncTargets } from "../outreach/targets";
import { getOverview, validateNote, type KpiId } from "../overview";
import { promptDetail, promptTable } from "../prompt-results";
import { addPrompts, deletePrompts, updatePrompt } from "../prompts";
import { ENGINES } from "../providers/registry";
import type { EngineId } from "../providers/types";
import { createRun } from "../runs/create";
import { getSchedule } from "../runs/schedule";
import { describeSchedule } from "../schedule-rules";
import { estimateWorkspaceRun, getFreeTierUsage } from "../usage";
import { citedPagesCrawled, crawlerSummary, referrals } from "../traffic/stats";
import { listRuns } from "../workspace-data";

export type McpContext = {
  db: AnyDb;
  workspaceId: string;
  access: "read" | "write";
  /** the app's address, for links back to pages */
  appUrl: string;
};

export const SERVER_INFO = { name: "openvisibility", version: "1.0.0" };

/** What every client is told about the data, so assistants describe it honestly. */
export const INSTRUCTIONS = `OpenVisibility tracks how often AI assistants (ChatGPT, Gemini, Google AI Overviews and AI Mode, Perplexity and others) name a brand when answering the questions its buyers ask ("prompts"), against its competitors, and which sources they cite.

Key metrics, all over a date range (7, 30 or 90 days) and optionally one engine or country:
- Mention rate: share of answers that name the brand.
- Average position: where the brand appears among the tracked brands an answer names (1 is first).
- Share of voice: the brand's mentions as a share of all tracked brands' mentions.
- Visibility index (0-100): mention rate, position and share of voice combined.
- Sentiment (-1 to 1): only when an analysis model is set up.
Changes are against the previous period of the same length.

How to read it: ${SOURCE_NOTE} ${VARIANCE_NOTE} Small samples move a lot; say how many answers a number rests on when it matters.

Start with get_visibility for the headline, compare_competitors for who's ahead, get_content_gaps and get_recommendations for what to do. Tools that change data need a write key. Outreach emails can't be approved or sent from here: a person approves each one in the app.`;

/* ── formatting ───────────────────────────────────────────── */

const pct = (v: number | null | undefined) =>
  v === null || v === undefined ? "–" : `${Math.round(v * 100)}%`;
const pct100 = (v: number | null | undefined) =>
  v === null || v === undefined ? "–" : `${Math.round(v)}%`;
const rank = (v: number | null | undefined) =>
  v === null || v === undefined ? "–" : `#${v.toFixed(1)}`;
const signed = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : "±"}${Math.abs(v)}`;

function table(head: string[], rows: (string | number)[][]) {
  if (!rows.length) return "_none_";
  const esc = (c: string | number) => String(c).replace(/\|/g, "\\|").replace(/\n/g, " ");
  return [
    `| ${head.join(" | ")} |`,
    `| ${head.map(() => "---").join(" | ")} |`,
    ...rows.map((r) => `| ${r.map(esc).join(" | ")} |`),
  ].join("\n");
}

type Result = {
  content: { type: "text"; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};
const ok = (text: string, data?: Record<string, unknown>): Result => ({
  content: [{ type: "text", text }],
  ...(data ? { structuredContent: data } : {}),
});
const fail = (text: string): Result => ({ content: [{ type: "text", text }], isError: true });

/* ── shared inputs ────────────────────────────────────────── */

const ENGINE_IDS = Object.keys(ENGINES) as [EngineId, ...EngineId[]];
const filterShape = {
  range: z.enum(["7d", "30d", "90d"]).default("30d").describe("the period: last 7, 30 or 90 days"),
  engine: z.enum(ENGINE_IDS).optional().describe("only this AI engine"),
  country: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .optional()
    .describe("only this country, as a two-letter code (US, GB, IN…)"),
};
const asFilter = (a: {
  range: "7d" | "30d" | "90d";
  engine?: EngineId;
  country?: string;
}): ViewFilter => ({
  range: a.range,
  engine: a.engine,
  country: a.country,
});
const uuid = z.string().uuid();

const READ = { readOnlyHint: true, openWorldHint: false } as const;

export function buildServer(ctx: McpContext) {
  const { db, workspaceId } = ctx;
  const server = new McpServer(SERVER_INFO, { instructions: INSTRUCTIONS });
  const link = (path: string) => `${ctx.appUrl.replace(/\/$/, "")}${path}`;
  const needsWrite = () =>
    ctx.access === "write"
      ? null
      : fail(
          "This needs a key with write access. Create one in OpenVisibility under Settings → API keys.",
        );
  const brandId = async () => (await getBrandSetup(db, workspaceId)).brand?.id ?? null;

  /* ── reading ─────────────────────────────────────────────── */

  server.registerTool(
    "get_workspace",
    {
      title: "Workspace setup",
      description:
        "The brand being tracked (name, description, category, audience, websites), its competitors, the engines and countries tracked, the run schedule and how many prompts there are. Call this first to know what you're looking at.",
      annotations: READ,
    },
    async () => {
      const [setup, options, schedule, prompts_] = await Promise.all([
        getBrandSetup(db, workspaceId),
        filterOptions(db, workspaceId),
        getSchedule(db, workspaceId),
        db
          .select({ id: prompts.id, active: prompts.active })
          .from(prompts)
          .innerJoin(brands, eq(prompts.brandId, brands.id))
          .where(eq(brands.workspaceId, workspaceId)),
      ]);
      if (!setup.brand)
        return ok(
          "This workspace hasn't set up a brand yet. Setup is in the app, under /onboarding.",
        );
      const b = setup.brand;
      const active = prompts_.filter((p) => p.active).length;
      const text = [
        `# ${b.name}`,
        b.description && `${b.description}`,
        `- Category: ${b.category || "–"}; audience: ${b.audience ?? "–"}`,
        `- Websites: ${b.domains.join(", ") || "–"}${b.aliases.length ? `; also known as ${b.aliases.join(", ")}` : ""}`,
        `- Competitors: ${setup.competitors.map((c) => c.name).join(", ") || "none"}`,
        `- Engines with results: ${options.engines.map((e) => e.name).join(", ") || "none yet"}`,
        `- Countries with results: ${options.countries.join(", ") || "none yet"}`,
        `- Prompts: ${active} active of ${prompts_.length}`,
        `- Schedule: ${describeSchedule(schedule)}`,
      ]
        .filter(Boolean)
        .join("\n");
      return ok(text, {
        brand: b,
        competitors: setup.competitors,
        engines: options.engines.map((e) => e.id),
        countries: options.countries,
        prompts: { active, total: prompts_.length },
      });
    },
  );

  server.registerTool(
    "get_visibility",
    {
      title: "Visibility",
      description:
        'The headline numbers for a period: mention rate, average position, share of voice, own-site citation share, sentiment and the visibility index, each with its change from the previous period, plus mention rate per engine and every tracked brand\'s share of voice. Answers "how visible are we on Gemini this week?"',
      inputSchema: filterShape,
      annotations: READ,
    },
    async (a) => {
      const f = asFilter(a);
      const o = await getOverview(db, workspaceId, f);
      if (!o.hasData || !o.samples)
        return ok(
          `No results for ${describeFilter(f)} yet. Runs fill this in; start one with start_run (write key) or from the app.`,
        );
      const label: Record<KpiId, string> = {
        mention: "Mention rate",
        position: "Average position",
        sov: "Share of voice",
        owned: "Own-site citations",
        sentiment: "Sentiment",
      };
      const fmt = (id: KpiId, v: number | null) =>
        v === null
          ? "–"
          : id === "position"
            ? rank(v)
            : id === "sentiment"
              ? v.toFixed(2)
              : pct100(v);
      const change = (id: KpiId, v: number | null, p: number | null) => {
        if (v === null || p === null) return "no earlier data";
        const d =
          id === "position" || id === "sentiment" ? Number((v - p).toFixed(2)) : Math.round(v - p);
        return id === "position"
          ? `${signed(d)} (lower is better)`
          : `${signed(d)}${id === "sentiment" ? "" : " pts"}`;
      };
      const text = [
        `# Visibility · ${describeFilter(f)}`,
        `Based on ${o.samples.toLocaleString("en-US")} answers. Visibility index: ${o.visibilityIndex === null ? "–" : Math.round(o.visibilityIndex)}/100.`,
        "",
        table(
          ["Metric", "Now", "Change"],
          o.kpis
            .filter((k) => k.id !== "sentiment" || k.value !== null)
            .map((k) => [label[k.id], fmt(k.id, k.value), change(k.id, k.value, k.previous)]),
        ),
        "",
        "## By engine",
        table(
          ["Engine", "Mention rate", "Avg. position"],
          o.byEngine.map((e) => [ENGINES[e.engine].name, pct100(e.rate), rank(e.position)]),
        ),
        "",
        "## Share of voice",
        table(
          ["Brand", "Share of voice", "Mention rate", "Visibility"],
          o.brands.map((b) => [
            b.competitorId === null ? `${b.name} (you)` : b.name,
            pct(b.shareOfVoice),
            pct(b.mentionRate),
            b.visibilityIndex === null ? "–" : Math.round(b.visibilityIndex),
          ]),
        ),
        "",
        `More: ${link("/dashboard")}`,
      ].join("\n");
      return ok(text, {
        filter: f,
        samples: o.samples,
        visibilityIndex: o.visibilityIndex,
        kpis: o.kpis,
        byEngine: o.byEngine,
        brands: o.brands.map((b) => ({
          name: b.name,
          you: b.competitorId === null,
          shareOfVoice: b.shareOfVoice,
          mentionRate: b.mentionRate,
          averagePosition: b.averagePosition,
          visibilityIndex: b.visibilityIndex,
        })),
      });
    },
  );

  server.registerTool(
    "get_trend",
    {
      title: "Trend per day",
      description:
        "One metric per day over the period, per engine: to see whether visibility is rising or falling, and when it moved. Includes the notes added to the chart.",
      inputSchema: {
        ...filterShape,
        metric: z
          .enum(["mention", "position", "sov", "owned", "sentiment"])
          .default("mention")
          .describe(
            "mention rate, average position, share of voice, own-site citations or sentiment",
          ),
      },
      annotations: READ,
    },
    async (a) => {
      const f = asFilter(a);
      const o = await getOverview(db, workspaceId, f);
      const points = o.trend[a.metric];
      const engines = o.engines;
      const cell = (v: number | null | undefined) =>
        v === null || v === undefined
          ? "–"
          : a.metric === "position"
            ? rank(v)
            : a.metric === "sentiment"
              ? v.toFixed(2)
              : pct100(v);
      const text = [
        `# ${a.metric} per day · ${describeFilter(f)}`,
        table(
          ["Day", ...engines.map((e) => ENGINES[e].name)],
          points
            .filter((p) => engines.some((e) => p[e] !== null && p[e] !== undefined))
            .map((p) => [p.date, ...engines.map((e) => cell(p[e]))]),
        ),
        o.annotations.length
          ? `\nNotes: ${o.annotations.map((n) => `${n.day}: ${n.text}`).join("; ")}`
          : "",
      ].join("\n");
      return ok(text, { metric: a.metric, engines, points, notes: o.annotations });
    },
  );

  server.registerTool(
    "compare_competitors",
    {
      title: "Compare with competitors",
      description:
        'Every tracked brand side by side for a period (visibility index, mention rate, position, share of voice and its change), head-to-head per engine, and the prompts where a competitor is named more often than you. Answers "who beats us, and where?"',
      inputSchema: filterShape,
      annotations: READ,
    },
    async (a) => {
      const f = asFilter(a);
      const v = await competitorView(db, workspaceId, f);
      if (!v.leaderboard.length) return ok(`No results for ${describeFilter(f)} yet.`);
      const name = (key: string) => v.leaderboard.find((b) => b.key === key)?.name ?? key;
      const text = [
        `# Competitors · ${describeFilter(f)}`,
        table(
          ["Brand", "Visibility", "Named in", "Position", "Share of voice", "Change in share"],
          v.leaderboard.map((b) => [
            b.competitorId === null ? `${b.name} (you)` : b.name,
            b.visibilityIndex === null ? "–" : Math.round(b.visibilityIndex),
            pct(b.mentionRate),
            rank(b.averagePosition),
            pct(b.shareOfVoice),
            b.shareOfVoice === null || b.shareOfVoiceBefore === null
              ? "–"
              : `${signed(Math.round((b.shareOfVoice - b.shareOfVoiceBefore) * 100))} pts`,
          ]),
        ),
        "",
        "## Head-to-head by engine (mention rate)",
        table(
          ["Engine", ...v.leaderboard.map((b) => name(b.key))],
          v.headToHead.map((h) => [
            ENGINES[h.engine].name,
            ...v.leaderboard.map((b) => pct(h.brands[b.key]?.mentionRate)),
          ]),
        ),
        "",
        "## Where they beat you",
        table(
          ["Prompt", "Leader", "Theirs", "Yours"],
          v.beaten.slice(0, 15).map((p) => [p.text, p.rival, pct100(p.theirs), pct100(p.you)]),
        ),
        "",
        `More: ${link("/competitors")}`,
      ].join("\n");
      return ok(text, {
        filter: f,
        leaderboard: v.leaderboard,
        headToHead: v.headToHead,
        beaten: v.beaten,
      });
    },
  );

  server.registerTool(
    "list_prompts",
    {
      title: "Prompts and their results",
      description:
        "Every tracked prompt (the questions the engines are asked) with its id, whether it's active, its tags, and how often answers name you: overall, per engine and its average position. Worst first.",
      inputSchema: filterShape,
      annotations: READ,
    },
    async (a) => {
      const id = await brandId();
      if (!id) return ok("No brand set up yet.");
      const t = await promptTable(db, workspaceId, id, asFilter(a));
      const text = [
        `# Prompts · ${describeFilter(asFilter(a))}`,
        table(
          [
            "Prompt",
            "id",
            "Active",
            "Named in",
            ...t.engines.map((e) => ENGINES[e].name),
            "Position",
          ],
          t.rows.map((r) => [
            r.text,
            r.id,
            r.active ? "yes" : "paused",
            pct100(r.mentionRate),
            ...t.engines.map((e) => pct100(r.byEngine[e])),
            rank(r.averagePosition),
          ]),
        ),
      ].join("\n");
      return ok(text, {
        prompts: t.rows.map(({ spark, ...r }) => (void spark, r)),
        engines: t.engines,
      });
    },
  );

  server.registerTool(
    "get_prompt",
    {
      title: "One prompt in detail",
      description:
        "One prompt's results per engine and country, which brands win it, and its latest answers with what they say about you. Use list_prompts to find the id.",
      inputSchema: { prompt_id: uuid, range: filterShape.range },
      annotations: READ,
    },
    async (a) => {
      const d = await promptDetail(db, workspaceId, a.prompt_id, a.range);
      if (!d) return fail("No prompt with that id in this workspace.");
      const text = [
        `# “${d.prompt.text}”`,
        `Named in ${pct(d.own?.mentionRate)} of ${d.own?.samples ?? 0} answers, average position ${rank(d.own?.averagePosition)} (${a.range}).`,
        "",
        "## Who wins it",
        table(
          ["Brand", "Named in", "Position"],
          d.ranking.map((b) => [
            b.competitorId === null ? `${b.name} (you)` : b.name,
            pct(b.mentionRate),
            rank(b.averagePosition),
          ]),
        ),
        "",
        "## By engine and country",
        table(
          ["Engine", "Country", "Named in", "Answers"],
          d.cells.map((c) => [ENGINES[c.a].name, c.b || "–", pct(c.mentionRate), c.samples]),
        ),
        "",
        "## Latest answers",
        ...d.answers
          .slice(0, 8)
          .map(
            (x) =>
              `- ${ENGINES[x.engine].name}${x.country ? ` (${x.country})` : ""}, answer ${x.answerId}: ${x.named.some((n) => n.own) ? "names you" : "doesn't name you"}. “${x.excerpt}”`,
          ),
      ].join("\n");
      return ok(text, {
        prompt: d.prompt,
        own: d.own,
        ranking: d.ranking,
        cells: d.cells,
        answers: d.answers.map(({ text: _t, ...x }) => (void _t, x)),
      });
    },
  );

  server.registerTool(
    "search_answers",
    {
      title: "Search answers",
      description:
        "Find stored AI answers: by words in the answer or prompt, engine, country, prompt, whether they name you, and how recent. Returns ids and excerpts; read one in full with get_answer.",
      inputSchema: {
        query: z.string().max(100).optional().describe("words in the answer or its prompt"),
        engine: filterShape.engine,
        country: filterShape.country,
        prompt_id: uuid.optional(),
        names_you: z
          .enum(["yes", "no"])
          .optional()
          .describe("only answers that name you, or that don't"),
        range: z.enum(["7d", "30d", "90d", "all"]).default("30d"),
        page: z.number().int().min(1).max(50).default(1),
      },
      annotations: READ,
    },
    async (a) => {
      const since = a.range === "all" ? undefined : filterWindow({ range: a.range }).since;
      const r = await listAnswers(db, workspaceId, {
        q: a.query,
        engine: a.engine,
        country: a.country,
        promptId: a.prompt_id,
        named: a.names_you,
        since,
        page: a.page,
      });
      const text = [
        `${r.total} answers match (page ${r.page} of ${r.pages}).`,
        ...r.rows.map(
          (x) =>
            `- ${x.id} · ${ENGINES[x.engine].name}${x.country ? ` (${x.country})` : ""} · ${x.at.toISOString().slice(0, 10)} · “${x.prompt}” · ${x.namesYou ? "names you" : "doesn't name you"}${x.named.filter(Boolean).length ? `; also ${x.named.filter(Boolean).join(", ")}` : ""}\n  “${x.excerpt}”`,
        ),
      ].join("\n");
      return ok(text, { total: r.total, page: r.page, pages: r.pages, answers: r.rows });
    },
  );

  server.registerTool(
    "get_answer",
    {
      title: "One answer in full",
      description:
        "An AI answer word for word, with the brands it names (position, sentiment), the sources it cites and the searches the engine ran.",
      inputSchema: { answer_id: uuid },
      annotations: READ,
    },
    async (a) => {
      const x = await getAnswer(db, workspaceId, a.answer_id);
      if (!x) return fail("No answer with that id in this workspace.");
      const text = [
        `# ${ENGINES[x.engine].name}${x.country ? ` (${x.country})` : ""}, ${x.at.toISOString().slice(0, 16).replace("T", " ")} UTC`,
        `Prompt: “${x.prompt}”`,
        "",
        x.text,
        "",
        `Brands named: ${x.named.map((n) => `${n.name}${n.position ? ` #${n.position}` : ""}${n.sentiment !== null && n.sentiment !== undefined ? ` (sentiment ${n.sentiment.toFixed(2)})` : ""}`).join(", ") || "none"}`,
        `Sources: ${x.cited.map((c) => c.url).join(" ") || "none"}`,
        x.searches.length ? `Searches it ran: ${x.searches.join("; ")}` : "",
        `\nIn the app: ${link(`/answers/${x.id}`)}`,
      ].join("\n");
      return ok(text, {
        id: x.id,
        engine: x.engine,
        country: x.country,
        prompt: x.prompt,
        at: x.at.toISOString(),
        text: x.text,
        named: x.named,
        cited: x.cited,
        searches: x.searches,
      });
    },
  );

  server.registerTool(
    "get_citations",
    {
      title: "Sources the engines cite",
      description:
        "Which sites and pages AI answers cite for your prompts: how often they cite your site, competitors' sites and third parties, per engine, and the most-cited domains with whose they are.",
      inputSchema: { ...filterShape, limit: z.number().int().min(1).max(50).default(15) },
      annotations: READ,
    },
    async (a) => {
      const f = asFilter(a);
      const scope = { since: filterWindow(f).since, engine: f.engine, country: f.country };
      const [s, perEngine] = await Promise.all([
        citationSummary(db, workspaceId, scope, { limit: a.limit, pagesPerDomain: 3 }),
        citationsByEngine(db, workspaceId, scope),
      ]);
      const share = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : "–");
      const text = [
        `# Citations · ${describeFilter(f)}`,
        `Of ${s.answers} answers: ${share(s.withSources, s.answers)} cite any source, ${share(s.citingOwned, s.answers)} cite your site, ${share(s.citingCompetitor, s.answers)} a competitor's.`,
        "",
        table(
          ["Engine", "Cite you", "Cite a competitor", "Cite third parties", "Answers"],
          perEngine.map((e) => [
            ENGINES[e.engine].name,
            share(e.owned, e.answers),
            share(e.competitor, e.answers),
            share(e.thirdParty, e.answers),
            e.answers,
          ]),
        ),
        "",
        "## Most-cited sites",
        table(
          ["Site", "Whose", "Answers citing it", "Top page"],
          s.domains.map((d) => [
            d.domain,
            d.kind === "owned"
              ? "yours"
              : d.kind === "competitor"
                ? (d.competitor ?? "competitor")
                : "third party",
            d.answers,
            d.pages[0]?.url ?? "",
          ]),
        ),
      ].join("\n");
      return ok(text, { filter: f, summary: s, byEngine: perEngine });
    },
  );

  server.registerTool(
    "get_content_gaps",
    {
      title: "Content gaps",
      description:
        "Prompts where an engine names a competitor far more often than you (20+ points, and in 30%+ of answers), biggest gap first, with the sources those answers cite: the pages to get onto or to out-write.",
      inputSchema: filterShape,
      annotations: READ,
    },
    async (a) => {
      const f = asFilter(a);
      const gaps = await contentGaps(db, workspaceId, f);
      const text = [
        `# Content gaps · ${describeFilter(f)}`,
        table(
          ["Prompt", "prompt id", "Engine", "You", "Leader", "Sources cited"],
          gaps.map((g) => [
            g.prompt,
            g.promptId,
            ENGINES[g.engine].name,
            pct(g.yours),
            `${g.rival} ${pct(g.theirs)}`,
            g.sources.map((s) => s.domain).join(", ") || "none",
          ]),
        ),
      ].join("\n");
      return ok(text, { filter: f, gaps });
    },
  );

  server.registerTool(
    "get_recommendations",
    {
      title: "Recommendations",
      description:
        "The most useful next steps from your own data, ranked: prompts to win, pages on other sites to get onto, pages of your own to fix (from the site audit) and engines where you're slipping. Each with the numbers behind it.",
      inputSchema: filterShape,
      annotations: READ,
    },
    async (a) => {
      const f = asFilter(a);
      const r = await recommendations(db, workspaceId, f, new Date(), { limit: 12 });
      const text = r.items.length
        ? [
            `# Next steps · ${describeFilter(f)}`,
            ...r.items.map(
              (x, i) => `${i + 1}. **${x.title}**\n   ${x.evidence}\n   → ${x.action}`,
            ),
          ].join("\n")
        : `Nothing stands out for ${describeFilter(f)}.`;
      return ok(text, { filter: f, recommendations: r.items });
    },
  );

  server.registerTool(
    "get_site_audit",
    {
      title: "Site audit",
      description:
        "The latest audit of your own site: which AI crawlers your robots.txt lets in, and each page's problems (blocked, noindex, needs JavaScript…) and content score out of 100 with its top fixes.",
      annotations: READ,
    },
    async () => {
      const sites = await getAudit(db, workspaceId);
      if (!sites.length)
        return ok(
          "No site audit yet. Run one with run_site_audit (write key) or from the app's Site audit page.",
        );
      const text = sites
        .map((s) =>
          [
            `# ${s.domain} · ${s.status === "done" ? `checked ${s.finishedAt?.toISOString().slice(0, 10)}` : "still running"}`,
            s.error ? `Couldn't audit: ${s.error}` : "",
            `Blocked AI crawlers (that feed answers): ${
              s.crawlers
                .filter((c) => c.purpose !== "training" && !c.verdict.allowed)
                .map((c) => c.agent)
                .join(", ") || "none"
            }`,
            table(
              ["Page", "Score", "Problems", "Top fix"],
              s.pages.map((p) => [
                p.url,
                p.score ?? "–",
                p.issues
                  .filter((i) => i.severity !== "note")
                  .map((i) => i.text)
                  .join("; ") || "–",
                p.fixes[0]?.fix ?? "–",
              ]),
            ),
          ].join("\n"),
        )
        .join("\n\n");
      return ok(text, {
        sites: sites.map((s) => ({
          ...s,
          pages: s.pages.map(({ check: _c, ...p }) => (void _c, p)),
        })),
      });
    },
  );

  server.registerTool(
    "get_outreach",
    {
      title: "Outreach",
      description:
        "How the outreach agent is doing: coverage of the top pages for your prompts, the pipeline (found → reviewed → sent → replied → now cited), replies waiting for you, and the pages it's working on with their contacts. Emails can only be approved in the app.",
      annotations: READ,
    },
    async () => {
      const [cover, funnel, replies, targets] = await Promise.all([
        coverage(db, workspaceId),
        pipeline(db, workspaceId),
        openReplies(db, workspaceId),
        listTargets(db, workspaceId),
      ]);
      const text = [
        `# Outreach`,
        `Coverage: ${cover.covered + cover.yours} of ${cover.total} top pages for your prompts mention you or are yours (${cover.basis === "search" ? "Google's top results" : "pages AI cites"}).`,
        `Pipeline: ${funnel.found} found, ${funnel.toReview} to review, ${funnel.approved} approved, ${funnel.sent} sent, ${funnel.replied} replied, ${funnel.won} now cited.`,
        replies.length
          ? `\n## Replies waiting\n${replies.map((r) => `- ${r.fromName ?? r.fromAddress} (${r.domain}), ${r.kind}: “${(r.snippet ?? "").slice(0, 200)}”`).join("\n")}`
          : "",
        "\n## Pages",
        table(
          ["Page", "Status", "Contact", "Why"],
          targets
            .slice(0, 25)
            .map((t) => [
              t.url,
              t.status,
              t.contact?.email ?? "–",
              t.research?.opening ?? t.note ?? "–",
            ]),
        ),
        `\nReview and approve emails: ${link("/outreach")}`,
      ].join("\n");
      return ok(text, {
        coverage: cover,
        pipeline: funnel,
        replies,
        targets: targets.slice(0, 25).map((t) => ({
          id: t.id,
          url: t.url,
          status: t.status,
          contact: t.contact?.email ?? null,
          opening: t.research?.opening ?? null,
          note: t.note,
        })),
      });
    },
  );

  server.registerTool(
    "get_content_brief",
    {
      title: "Content brief",
      description:
        "What a page of yours needs to be cited for a prompt, from the pages AI cites for it now: length, questions to answer, formats, and sites to earn a mention on. If there's none yet, ask for one with request_content_brief.",
      inputSchema: { prompt_id: uuid },
      annotations: READ,
    },
    async (a) => {
      const b = await getBrief(db, workspaceId, a.prompt_id);
      if (!b)
        return ok(
          "No brief for this prompt yet. Ask for one with request_content_brief (write key); it takes a minute or two.",
        );
      if (b.status !== "done" || !b.brief)
        return ok("The brief is still being written; try again in a minute.");
      const x = b.brief;
      const text = [
        `# Brief: “${x.prompt}”`,
        x.title && `Suggested title: ${x.title}`,
        x.angle && `Angle: ${x.angle}`,
        x.outline?.length
          ? `Outline:\n${x.outline.map((h, i) => `${i + 1}. ${h}`).join("\n")}`
          : "",
        `Length: about ${x.words} words.`,
        x.questions.length
          ? `Questions to answer:\n${x.questions.map((q) => `- ${q}`).join("\n")}`
          : "",
        x.formats.length ? `Include: ${x.formats.join(", ")}.` : "",
        `Sites to earn a mention on: ${x.sources.join(", ")}`,
        `Based on: ${x.pages.map((p) => p.url).join(" ")}`,
      ]
        .filter(Boolean)
        .join("\n");
      return ok(text, { brief: x });
    },
  );

  server.registerTool(
    "get_runs_and_usage",
    {
      title: "Runs and usage",
      description:
        "Recent runs (when, status, answers collected, cost), this month's answer usage against the free tier and any limit, and what a full run of all active prompts would use.",
      annotations: READ,
    },
    async () => {
      const [runs_, usage, estimate, schedule] = await Promise.all([
        listRuns(db, workspaceId, 10),
        getFreeTierUsage(db, workspaceId),
        estimateWorkspaceRun(db, workspaceId),
        getSchedule(db, workspaceId),
      ]);
      const fits =
        usage.used === null ? null : checkFreeTier(estimate.answers, usage.used, usage.limit);
      const text = [
        `# Runs and usage`,
        `This month: ${usage.used === null ? "unknown" : usage.used.toLocaleString("en-US")} of ${usage.limit.toLocaleString("en-US")} free answers used.`,
        `A full run now: ${estimate.answers.toLocaleString("en-US")} answers${fits === null ? "" : fits.fits ? ", within the free tier" : `, ${fits.overBy.toLocaleString("en-US")} over the free tier (about $${fits.costUsd.toFixed(2)})`}.`,
        `Schedule: ${describeSchedule(schedule)}`,
        "",
        table(
          ["Started", "Status", "Answers", "Cost"],
          runs_.map((r) => [
            r.createdAt.toISOString().slice(0, 16).replace("T", " "),
            r.status,
            `${r.doneItems}/${r.totalItems}`,
            `$${Number(r.actualCost).toFixed(2)}`,
          ]),
        ),
      ].join("\n");
      return ok(text, { usage, estimate, schedule, runs: runs_ });
    },
  );

  server.registerTool(
    "get_ai_traffic",
    {
      title: "AI crawlers and AI referral traffic",
      description:
        "Which AI crawlers visit the site (verified against each company's published IP ranges, fakes counted apart), what they read, errors the site served them, when the pages AI cites were last fetched, and how many people arrive from each AI assistant. Needs the site connected (AI traffic page).",
      inputSchema: { range: filterShape.range },
      annotations: READ,
    },
    async (a) => {
      const since = new Date(Date.now() - { "7d": 7, "30d": 30, "90d": 90 }[a.range] * 86_400_000);
      const [crawlers, refs, cited] = await Promise.all([
        crawlerSummary(db, workspaceId, since),
        referrals(db, workspaceId, since),
        citedPagesCrawled(db, workspaceId),
      ]);
      if (!crawlers.length && !refs.byAssistant.length)
        return ok(
          `No AI traffic recorded in the last ${a.range}. Connect the site on the AI traffic page (a snippet or a log upload): ${link("/traffic")}`,
        );
      const text = [
        `# AI traffic · last ${a.range}`,
        table(
          ["Crawler", "Owner", "Purpose", "Visits", "Pages", "Errors", "Fakes", "Last visit"],
          crawlers.map((c) => [
            c.agent,
            c.owner,
            c.purpose,
            c.visits,
            c.pages,
            c.errors,
            c.fake,
            c.lastSeen?.toISOString().slice(0, 10) ?? "–",
          ]),
        ),
        "",
        "## Pages AI cites: last fetched by a crawler that feeds answers",
        table(
          ["Page", "Last crawled", "By"],
          cited.map((p) => [
            p.url,
            p.lastCrawled?.toISOString().slice(0, 10) ?? "never seen",
            p.by.join(", ") || "–",
          ]),
        ),
        "",
        "## People arriving from AI assistants",
        table(
          ["Assistant", "Visits"],
          refs.byAssistant.map((r) => [r.assistant, r.visits]),
        ),
        "",
        "Top landing pages: " +
          (refs.landing.map((p) => `${p.path} (${p.visits})`).join(", ") || "–"),
      ].join("\n");
      return ok(text, { crawlers, referrals: refs, citedPages: cited });
    },
  );

  /* ── changing things (write keys) ────────────────────────── */

  server.registerTool(
    "add_prompts",
    {
      title: "Add prompts",
      description:
        "Start tracking new prompts: questions your buyers ask AI, like “best invoicing app for freelancers”. Duplicates are skipped. They're asked from the next run on.",
      inputSchema: {
        prompts: z
          .array(
            z.object({
              text: z.string().min(3).max(300),
              tags: z.array(z.string().max(40)).max(10).optional(),
              countries: z
                .array(z.string().regex(/^[A-Z]{2}$/))
                .max(20)
                .optional()
                .describe("two-letter codes; default the workspace's countries"),
            }),
          )
          .min(1)
          .max(50),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (a) => {
      const denied = needsWrite();
      if (denied) return denied;
      const id = await brandId();
      if (!id) return fail("Set up the brand in the app first.");
      const r = await addPrompts(db, id, a.prompts);
      if (!r.ok) return fail(r.message);
      return ok(
        `Added ${r.value.added} prompt(s)${r.value.skipped ? `; ${r.value.skipped} already tracked` : ""}. They're asked from the next run.`,
        r.value,
      );
    },
  );

  server.registerTool(
    "update_prompt",
    {
      title: "Edit, pause or resume a prompt",
      description:
        "Change a prompt's text, tags or countries, or pause or resume it (paused prompts aren't asked; their history stays).",
      inputSchema: {
        prompt_id: uuid,
        text: z.string().min(3).max(300).optional(),
        active: z.boolean().optional().describe("false pauses, true resumes"),
        tags: z.array(z.string().max(40)).max(10).optional(),
        countries: z
          .array(z.string().regex(/^[A-Z]{2}$/))
          .max(20)
          .optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (a) => {
      const denied = needsWrite();
      if (denied) return denied;
      const r = await updatePrompt(db, workspaceId, a.prompt_id, {
        text: a.text,
        active: a.active,
        tags: a.tags,
        countries: a.countries,
      });
      return r.ok ? ok("Updated.") : fail(r.message);
    },
  );

  server.registerTool(
    "delete_prompts",
    {
      title: "Delete prompts",
      description:
        "Stop tracking prompts for good. Their past answers stay in the archive. Prefer update_prompt with active=false to pause instead.",
      inputSchema: { prompt_ids: z.array(uuid).min(1).max(50) },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (a) => {
      const denied = needsWrite();
      if (denied) return denied;
      await deletePrompts(db, workspaceId, a.prompt_ids);
      return ok(
        `Deleted ${a.prompt_ids.length} prompt(s). Their past answers stay in the archive.`,
      );
    },
  );

  server.registerTool(
    "start_run",
    {
      title: "Start a run",
      description:
        "Ask every active prompt on every engine now. Costs answers from the Bright Data allowance: if the run would go past this month's free tier, it doesn't start unless confirm_over_free_tier is true. Tell the user the cost before confirming.",
      inputSchema: { confirm_over_free_tier: z.boolean().default(false) },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (a) => {
      const denied = needsWrite();
      if (denied) return denied;
      const [estimate, usage] = await Promise.all([
        estimateWorkspaceRun(db, workspaceId),
        getFreeTierUsage(db, workspaceId),
      ]);
      if (!usage.keySource && process.env.OV_FAKE_ANSWERS !== "1")
        return fail(
          "No Bright Data key is set up for this workspace; add one in the app's Settings.",
        );
      if (usage.used !== null && !a.confirm_over_free_tier) {
        const check = checkFreeTier(estimate.answers, usage.used, usage.limit);
        if (!check.fits)
          return fail(
            `Not started: this run uses ${estimate.answers.toLocaleString("en-US")} answers, ${check.overBy.toLocaleString("en-US")} more than the free tier has left this month (about $${check.costUsd.toFixed(2)} at Bright Data's pay-as-you-go price). Ask the user, then call again with confirm_over_free_tier=true.`,
          );
      }
      const r = await createRun(db, workspaceId);
      if (!r.ok) return fail(r.message);
      return ok(
        `Started a run of ${r.items} answers. Results arrive over the next minutes; check with get_runs_and_usage, then get_visibility.`,
        { runId: r.runId, items: r.items },
      );
    },
  );

  server.registerTool(
    "run_site_audit",
    {
      title: "Audit the site",
      description:
        "Check whether AI crawlers can read your own site: robots.txt for each AI crawler, and your home page, cited pages and sitemap pages for problems and a content score. Takes a few minutes; read the result with get_site_audit.",
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async () => {
      const denied = needsWrite();
      if (denied) return denied;
      const r = await queueAudits(db, workspaceId);
      return r.ok
        ? ok(`Auditing ${r.domains} domain(s). Check back with get_site_audit in a few minutes.`)
        : fail(r.message);
    },
  );

  server.registerTool(
    "find_outreach_targets",
    {
      title: "Find pages to get onto",
      description:
        "Refresh the outreach agent's list: the top pages for your prompts (Google's top results and pages AI cites) that leave you out. It then researches each and finds a published contact. Emails are drafted for review in the app; nothing is sent from here.",
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      const denied = needsWrite();
      if (denied) return denied;
      const r = await syncTargets(db, workspaceId);
      return ok(
        r.total
          ? `${r.total} pages on the list, ${r.added} new. The agent researches them over the next minutes; see get_outreach.`
          : "No pages to get onto yet: run your prompts first.",
        r,
      );
    },
  );

  server.registerTool(
    "request_content_brief",
    {
      title: "Ask for a content brief",
      description:
        "Have the agent read the pages AI cites for a prompt and write a brief for a page of yours that could be cited. Takes a minute or two; read it with get_content_brief.",
      inputSchema: { prompt_id: uuid },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (a) => {
      const denied = needsWrite();
      if (denied) return denied;
      const [p] = await db
        .select({ id: prompts.id })
        .from(prompts)
        .innerJoin(brands, eq(prompts.brandId, brands.id))
        .where(and(eq(prompts.id, a.prompt_id), eq(brands.workspaceId, workspaceId)))
        .limit(1);
      if (!p) return fail("No prompt with that id in this workspace.");
      await requestBrief(db, workspaceId, a.prompt_id);
      return ok("Writing the brief. Read it with get_content_brief in a minute or two.");
    },
  );

  server.registerTool(
    "add_chart_note",
    {
      title: "Note a change on the chart",
      description:
        "Record what changed on a day (a new page, a PR mention, a pricing change), so later moves in the trend have a reason. Shown on the Overview chart.",
      inputSchema: {
        date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .describe("YYYY-MM-DD"),
        text: z.string().min(1).max(200),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (a) => {
      const denied = needsWrite();
      if (denied) return denied;
      const problem = validateNote(a.date, a.text);
      if (problem) return fail(problem);
      await db
        .insert(annotations)
        .values({ workspaceId, day: a.date, text: a.text.trim(), createdBy: "MCP" });
      return ok(`Noted on ${a.date}.`);
    },
  );

  /* ── resources ───────────────────────────────────────────── */

  server.registerResource(
    "prompts",
    "openvisibility://prompts",
    {
      title: "Tracked prompts",
      description: "Every prompt the workspace tracks, with ids and whether it's active.",
      mimeType: "text/markdown",
    },
    async (uri) => {
      const rows = await db
        .select({ id: prompts.id, text: prompts.text, active: prompts.active, tags: prompts.tags })
        .from(prompts)
        .innerJoin(brands, eq(prompts.brandId, brands.id))
        .where(eq(brands.workspaceId, workspaceId))
        .orderBy(desc(prompts.active), prompts.createdAt);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "text/markdown",
            text: `# Tracked prompts\n\n${rows.map((r) => `- ${r.text}${r.active ? "" : " (paused)"}${r.tags.length ? ` [${r.tags.join(", ")}]` : ""} · ${r.id}`).join("\n") || "_none yet_"}`,
          },
        ],
      };
    },
  );

  server.registerResource(
    "report",
    "openvisibility://report",
    {
      title: "Visibility report, last 30 days",
      description:
        "The headline numbers, competitors, gaps and next steps as one markdown document.",
      mimeType: "text/markdown",
    },
    async (uri) => {
      const f: ViewFilter = { range: "30d" };
      const [o, v, r] = await Promise.all([
        getOverview(db, workspaceId, f),
        competitorView(db, workspaceId, f),
        recommendations(db, workspaceId, f, new Date(), { limit: 5 }),
      ]);
      const you = o.brands.find((b) => b.competitorId === null);
      const text = [
        `# AI visibility report · last 30 days`,
        `${o.samples} answers. Mention rate ${pct(you?.mentionRate)}, share of voice ${pct(you?.shareOfVoice)}, visibility index ${o.visibilityIndex === null ? "–" : Math.round(o.visibilityIndex)}/100.`,
        "",
        "## Competitors",
        table(
          ["Brand", "Named in", "Share of voice"],
          v.leaderboard.map((b) => [
            b.competitorId === null ? `${b.name} (you)` : b.name,
            pct(b.mentionRate),
            pct(b.shareOfVoice),
          ]),
        ),
        "",
        "## Next steps",
        ...r.items.map((x, i) => `${i + 1}. ${x.title}: ${x.evidence}`),
        "",
        `_${SOURCE_NOTE}_`,
      ].join("\n");
      return { contents: [{ uri: uri.href, mimeType: "text/markdown", text }] };
    },
  );

  server.registerResource(
    "answer",
    new ResourceTemplate("openvisibility://answers/{id}", { list: undefined }),
    {
      title: "An AI answer",
      description: "One stored answer, word for word.",
      mimeType: "text/markdown",
    },
    async (uri, vars) => {
      const id = String(vars.id);
      const x = z.string().uuid().safeParse(id).success
        ? await getAnswer(db, workspaceId, id)
        : null;
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "text/markdown",
            text: x
              ? `# ${ENGINES[x.engine].name}: “${x.prompt}”\n\n${x.text}`
              : "No answer with that id in this workspace.",
          },
        ],
      };
    },
  );

  /* ── prompts: ready-made questions for the assistant ─────── */

  server.registerPrompt(
    "weekly_review",
    {
      title: "Weekly visibility review",
      description: "How visibility moved this week, who's ahead, and the three things to do next.",
    },
    async () => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: "Review our AI visibility for the last 7 days. Use get_visibility (range 7d) and compare_competitors (7d), then get_recommendations. Tell me in plain words: how often we're named and how that changed, which competitor is ahead and on which engine, and the three most useful things to do this week, each with the numbers behind it. Mention how many answers the numbers rest on.",
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "beat_competitor",
    {
      title: "How to beat a competitor",
      description: "Where a competitor is named instead of us, and a plan to close the gap.",
      argsSchema: { competitor: z.string().describe("the competitor's name") },
    },
    async ({ competitor }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Find where ${competitor} is named in AI answers instead of us. Use compare_competitors (30d), get_content_gaps and get_citations. List the prompts and engines where they lead, the sources those answers cite that we're missing from, and a concrete plan: pages to get onto (check get_outreach), pages of ours to write or fix (get_site_audit), with the evidence for each.`,
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "find_new_prompts",
    {
      title: "Suggest prompts to track",
      description: "Questions our buyers likely ask AI that we don't track yet.",
    },
    async () => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: "Look at get_workspace and list_prompts. Suggest 10 questions our buyers are likely to ask AI assistants that we don't track yet, mostly ones that don't name us (non-branded). Explain each in a line. Don't add them until I say which; then use add_prompts.",
          },
        },
      ],
    }),
  );

  return server;
}
