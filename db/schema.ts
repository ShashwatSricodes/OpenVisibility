/**
 * Database schema: what a workspace tracks.
 *
 * A workspace (a person, a team, or an agency) tracks one or more brands.
 * Each brand has its own aliases, competitors and prompts, so an agency
 * can track several clients side by side. Below them: runs and their results.
 *
 * Change a table here, then `npm run db:generate` to write a migration.
 */

import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { user } from "./auth-schema";

export * from "./auth-schema";

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
/** Postgres text[] that is never null; an empty array means "none". */
const textList = (name: string) =>
  text(name)
    .array()
    .notNull()
    .default(sql`'{}'::text[]`);

export const engine = pgEnum("engine", [
  "chatgpt",
  "gemini",
  "ai_mode",
  "ai_overviews",
  "perplexity",
  "claude",
  "copilot",
  "grok",
]);

export const workspaceMode = pgEnum("workspace_mode", ["self_hosted", "hosted"]);

export const scheduleFrequency = pgEnum("schedule_frequency", ["off", "daily", "weekly"]);

export const workspaces = pgTable("workspaces", {
  id: id(),
  name: text("name").notNull(),
  mode: workspaceMode("mode").notNull().default("self_hosted"),
  /** two-letter country codes prompts run in unless a prompt overrides them */
  defaultCountries: textList("default_countries"),
  /** times each prompt is asked per engine and country in a run; answers vary, so one ask isn't enough */
  samples: integer("samples").notNull().default(3),
  /**
   * Most Bright Data answers this workspace may use in a calendar month; null means no limit.
   * Defaults to the free tier, so nobody pays by accident.
   */
  monthlyAnswerCap: integer("monthly_answer_cap").default(5000),
  /** the engines this workspace tracks (Settings); see core/tracking-config.ts */
  engines: engine("engines")
    .array()
    .notNull()
    .default(sql`'{chatgpt,gemini,ai_mode,ai_overviews}'::engine[]`),
  /** automatic runs; see core/schedule-rules.ts */
  scheduleFrequency: scheduleFrequency("schedule_frequency").notNull().default("off"),
  /** local time of day, in minutes after midnight */
  scheduleMinute: integer("schedule_minute").notNull().default(540),
  /** for weekly runs: 0 Sunday … 6 Saturday */
  scheduleWeekday: integer("schedule_weekday").notNull().default(1),
  /** IANA name, e.g. Europe/London */
  scheduleTimezone: text("schedule_timezone").notNull().default("UTC"),
  /** when the worker starts the next scheduled run; null when off */
  scheduleNextAt: timestamp("schedule_next_at", { withTimezone: true }),
  /** reuse an identical answer this many hours old or newer instead of paying again; null: off */
  cacheHours: integer("cache_hours"),
  /** whether scheduled runs reuse answers too; off, so tracking over time stays fresh */
  cacheScheduled: boolean("cache_scheduled").notNull().default(false),
  /** skip the remaining samples when the first two agree on whether the brand is mentioned */
  smartSampling: boolean("smart_sampling").notNull().default(false),
  createdAt: createdAt(),
});

export const memberRole = pgEnum("member_role", ["owner", "member"]);

/** Which users belong to which workspace, and as what. */
export const memberships = pgTable(
  "memberships",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    role: memberRole("role").notNull().default("member"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("memberships_user_workspace_uq").on(t.userId, t.workspaceId),
    index("memberships_workspace_idx").on(t.workspaceId),
  ],
);

export const credentialProvider = pgEnum("credential_provider", ["brightdata"]);

/**
 * A workspace's own API keys, encrypted with AES-256-GCM (core/crypto.ts).
 * The plain key never leaves the server; pages see only the last 4 characters.
 */
export const providerCredentials = pgTable(
  "provider_credentials",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    provider: credentialProvider("provider").notNull(),
    encryptedKey: text("encrypted_key").notNull(),
    last4: text("last4").notNull(),
    createdBy: uuid("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    /** when the key last passed a test call */
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("provider_credentials_workspace_provider_uq").on(t.workspaceId, t.provider)],
);

export const brands = pgTable(
  "brands",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** one line about what the brand does; used to suggest prompts */
    description: text("description"),
    /** what kind of product it is, e.g. "invoicing software"; drives prompt suggestions */
    category: text("category"),
    /** who it's for, e.g. "freelancers and small agencies" */
    audience: text("audience"),
    /** domains the brand owns; citations to these count as "owned" */
    domains: textList("domains"),
    createdAt: createdAt(),
  },
  (t) => [
    index("brands_workspace_idx").on(t.workspaceId),
    uniqueIndex("brands_workspace_name_uq").on(t.workspaceId, t.name),
  ],
);

/** Other names the brand goes by in answers, e.g. "Zoho Invoice" for "Zoho". */
export const brandAliases = pgTable(
  "brand_aliases",
  {
    id: id(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    alias: text("alias").notNull(),
  },
  (t) => [uniqueIndex("brand_aliases_brand_alias_uq").on(t.brandId, t.alias)],
);

export const competitors = pgTable(
  "competitors",
  {
    id: id(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    aliases: textList("aliases"),
    domains: textList("domains"),
    createdAt: createdAt(),
  },
  (t) => [
    index("competitors_brand_idx").on(t.brandId),
    uniqueIndex("competitors_brand_name_uq").on(t.brandId, t.name),
  ],
);

export const prompts = pgTable(
  "prompts",
  {
    id: id(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    text: text("text").notNull(),
    tags: textList("tags"),
    /** overrides the workspace's default countries; empty uses the default */
    countries: textList("countries"),
    /** paused prompts keep their history but stop running */
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [
    index("prompts_brand_idx").on(t.brandId),
    uniqueIndex("prompts_brand_text_uq").on(t.brandId, t.text),
  ],
);

/* ── tracking and results (Day 4) ─────────────────────────────── */

/** Cost in US dollars: exact decimal, never a float. 6 places fits $0.0015 answers. */
const usd = (name: string) => numeric(name, { precision: 12, scale: 6 });

/** Where an answer came from: the real app (via a scraper) or the model's API. */
export const answerSource = pgEnum("answer_source", ["consumer_app", "official_api"]);

export const runTrigger = pgEnum("run_trigger", ["manual", "scheduled"]);

export const runStatus = pgEnum("run_status", [
  "queued",
  "running",
  "completed",
  /** finished, but some items failed */
  "partial",
  "failed",
  "canceled",
  /** a scheduled run that didn't start; the note says why */
  "skipped",
]);

export const itemStatus = pgEnum("item_status", ["queued", "running", "done", "failed", "skipped"]);

/** Why an item was skipped: the monthly limit, or smart sampling (not a failure). */
export const skipReason = pgEnum("skip_reason", ["limit", "sampling"]);

export const citationKind = pgEnum("citation_kind", ["owned", "competitor", "third_party"]);

/** One tracking run: every active prompt × engine × country × sample for a brand. */
export const runs = pgTable(
  "runs",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    trigger: runTrigger("trigger").notNull(),
    status: runStatus("status").notNull().default("queued"),
    estimatedCost: usd("estimated_cost").notNull().default("0"),
    actualCost: usd("actual_cost").notNull().default("0"),
    totalItems: integer("total_items").notNull().default(0),
    doneItems: integer("done_items").notNull().default(0),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    /** why a run failed or finished partly, in words for the run page */
    note: text("note"),
    /** smart sampling was on when the run started */
    smartSampling: boolean("smart_sampling").notNull().default(false),
    /** answers reused from earlier runs instead of asked again */
    reusedItems: integer("reused_items").notNull().default(0),
    /** samples smart sampling didn't need to ask */
    sampledOutItems: integer("sampled_out_items").notNull().default(0),
    /** when this run's day was last added up into metrics_daily; null: due (core/rollup.ts) */
    rolledUpAt: timestamp("rolled_up_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index("runs_workspace_created_idx").on(t.workspaceId, t.createdAt),
    index("runs_brand_created_idx").on(t.brandId, t.createdAt),
  ],
);

/** One question asked of one engine: prompt × engine × country × sample. */
export const runItems = pgTable(
  "run_items",
  {
    id: id(),
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    /** null once the prompt is deleted; promptText keeps the history readable */
    promptId: uuid("prompt_id").references(() => prompts.id, { onDelete: "set null" }),
    promptText: text("prompt_text").notNull(),
    engine: engine("engine").notNull(),
    source: answerSource("source").notNull(),
    country: text("country"),
    sampleIndex: integer("sample_index").notNull().default(0),
    status: itemStatus("status").notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    error: text("error"),
    /** the provider's job id, e.g. a Bright Data snapshot id */
    externalId: text("external_id"),
    /** position in that job's batch, so each answer goes back to the right item */
    batchIndex: integer("batch_index"),
    skipReason: skipReason("skip_reason"),
    /**
     * Smart sampling: whether the brand was mentioned in the samples that were
     * asked, carried over to this unasked one so mention rates stay honest.
     */
    inferredMentioned: boolean("inferred_mentioned"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    index("run_items_run_idx").on(t.runId),
    index("run_items_status_idx").on(t.status),
    index("run_items_external_idx").on(t.externalId),
  ],
);

/** What the engine said. One per successful run item. */
export const answers = pgTable(
  "answers",
  {
    id: id(),
    runItemId: uuid("run_item_id")
      .notNull()
      .unique()
      .references(() => runItems.id, { onDelete: "cascade" }),
    text: text("text").notNull(),
    /** the provider record, minus bulky HTML; kept so answers can be re-parsed */
    raw: jsonb("raw"),
    /** the model the app or API reported, e.g. Gemini's logged-out "Flash-Lite" */
    model: text("model"),
    /** ChatGPT reports whether it actually searched; null when unknown */
    webSearchTriggered: boolean("web_search_triggered"),
    /** AI Overviews only: whether Google showed an overview at all */
    shown: boolean("shown"),
    latencyMs: integer("latency_ms"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    costUsd: usd("cost_usd").notNull().default("0"),
    /** set when this answer was copied from an earlier one instead of asked again (cost 0) */
    reusedFromId: uuid("reused_from_id").references((): AnyPgColumn => answers.id, {
      onDelete: "set null",
    }),
    /** when mentions were last found (core/analysis.ts); null: waiting, e.g. after names change */
    analyzedAt: timestamp("analyzed_at", { withTimezone: true }),
    /** when the analysis model rated its mentions (core/sentiment.ts); null: not yet, or no model */
    ratedAt: timestamp("rated_at", { withTimezone: true }),
    /** failed rating attempts; rating stops after a few */
    ratingAttempts: integer("rating_attempts").notNull().default(0),
    /** what the analysis model cost for this answer */
    analysisCostUsd: usd("analysis_cost_usd").notNull().default("0"),
    createdAt: createdAt(),
  },
  (t) => [
    index("answers_unanalyzed_idx")
      .on(t.id)
      .where(sql`${t.analyzedAt} is null`),
  ],
);

/** A brand named in an answer: the tracked brand (competitorId null) or a competitor. */
export const mentions = pgTable(
  "mentions",
  {
    id: id(),
    answerId: uuid("answer_id")
      .notNull()
      .references(() => answers.id, { onDelete: "cascade" }),
    competitorId: uuid("competitor_id").references(() => competitors.id, {
      onDelete: "cascade",
    }),
    /** 1 = first brand named; null when the answer doesn't rank brands */
    position: integer("position"),
    /** -1 (negative) to 1 (positive); null until the analysis model rates it */
    sentiment: real("sentiment"),
    /** the answer recommends this brand, not just names it; null until rated */
    recommended: boolean("recommended"),
    /** the surrounding sentence, for the answer archive */
    snippet: text("snippet"),
  },
  (t) => [
    index("mentions_answer_idx").on(t.answerId),
    index("mentions_competitor_idx").on(t.competitorId),
  ],
);

export const citations = pgTable(
  "citations",
  {
    id: id(),
    answerId: uuid("answer_id")
      .notNull()
      .references(() => answers.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    /** normalized host without "www.", for grouping */
    domain: text("domain").notNull(),
    title: text("title"),
    position: integer("position"),
    kind: citationKind("kind").notNull(),
    /** whose page it is, when kind is "competitor" */
    competitorId: uuid("competitor_id").references(() => competitors.id, { onDelete: "set null" }),
  },
  (t) => [index("citations_answer_idx").on(t.answerId), index("citations_domain_idx").on(t.domain)],
);

/**
 * Daily counters behind every dashboard number (docs/metrics.md): one row per
 * workspace × day × engine × country × prompt × tracked brand. Counters, not
 * ratios, so any selection is a sum. Rebuilt a day at a time (core/rollup.ts).
 */
export const metricsDaily = pgTable(
  "metrics_daily",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    /** the day the runs started, UTC */
    day: date("day", { mode: "string" }).notNull(),
    engine: engine("engine").notNull(),
    country: text("country").notNull().default(""),
    /** null once the prompt is deleted */
    promptId: uuid("prompt_id").references(() => prompts.id, { onDelete: "set null" }),
    /** null: the workspace's own brand */
    competitorId: uuid("competitor_id").references(() => competitors.id, { onDelete: "cascade" }),
    samples: integer("samples").notNull().default(0),
    asked: integer("asked").notNull().default(0),
    mentioned: integer("mentioned").notNull().default(0),
    mentions: integer("mentions").notNull().default(0),
    positioned: integer("positioned").notNull().default(0),
    positionSum: integer("position_sum").notNull().default(0),
    reciprocalSum: real("reciprocal_sum").notNull().default(0),
    allMentions: integer("all_mentions").notNull().default(0),
    citations: integer("citations").notNull().default(0),
    allCitations: integer("all_citations").notNull().default(0),
    rated: integer("rated").notNull().default(0),
    sentimentSum: real("sentiment_sum").notNull().default(0),
    positive: integer("positive").notNull().default(0),
    negative: integer("negative").notNull().default(0),
  },
  (t) => [index("metrics_daily_workspace_day_idx").on(t.workspaceId, t.day)],
);

/** A note on a day of the trend chart: what changed, so moves in the line have a reason. */
export const annotations = pgTable(
  "annotations",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    day: date("day", { mode: "string" }).notNull(),
    text: text("text").notNull(),
    /** the user who added it */
    createdBy: text("created_by"),
    createdAt: createdAt(),
  },
  (t) => [index("annotations_workspace_day_idx").on(t.workspaceId, t.day)],
);

/* ── GEO audit: can AI crawlers read the brand's own pages? (core/geo) ── */

export const auditStatus = pgEnum("audit_status", ["queued", "running", "done"]);

/** One owned domain's audit. Running it again replaces the previous one. */
export const siteAudits = pgTable(
  "site_audits",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    domain: text("domain").notNull(),
    status: auditStatus("status").notNull().default("queued"),
    requestedAt: createdAt(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    /** "found", "missing" (all allowed) or "unreachable" (all blocked) */
    robotsState: text("robots_state"),
    robotsText: text("robots_text"),
    /** HTTP status of /llms.txt; null when it couldn't be fetched */
    llmsTxtStatus: integer("llms_txt_status"),
    sitemapUrl: text("sitemap_url"),
    /** why the audit stopped early, e.g. the domain doesn't resolve */
    error: text("error"),
  },
  (t) => [index("site_audits_workspace_idx").on(t.workspaceId)],
);

/** One page of an audit, and what checking it found (core/geo/page.ts PageCheck). */
export const pageAudits = pgTable(
  "page_audits",
  {
    id: id(),
    auditId: uuid("audit_id")
      .notNull()
      .references(() => siteAudits.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    /** why it was picked: the home page, cited in answers, or listed in the sitemap */
    source: text("source").notNull(),
    /** the order pages were picked in: home, cited, then the sitemap's */
    position: integer("position").notNull().default(0),
    checkedAt: timestamp("checked_at", { withTimezone: true }),
    result: jsonb("result"),
  },
  (t) => [index("page_audits_audit_idx").on(t.auditId)],
);

/* ── The outreach agent (core/outreach): getting the brand onto pages AI cites ── */

export const outreachStatus = pgEnum("outreach_status", [
  /** listed from the citations, not yet researched */
  "found",
  /** researched, with a contact: ready for a pitch */
  "ready",
  /** researched, but the site lists no contact */
  "no_contact",
  /** needs the user, not an email: a directory listing, a review profile, a forum */
  "task",
  /** set aside: by the user, or the page already names the brand */
  "skipped",
  "drafted",
  "approved",
  "sent",
  "replied",
  /** the page is now cited in an answer that names the brand */
  "won",
]);

/** A page on another site the brand should be on, and what the agent knows about it. */
export const outreachTargets = pgTable(
  "outreach_targets",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    domain: text("domain").notNull(),
    title: text("title"),
    status: outreachStatus("status").notNull().default("found"),
    /** why it's a target: answers without the brand, prompts, engines, competitors named */
    evidence: jsonb("evidence"),
    /** what the page is and what mention would fit (core/outreach/research.ts) */
    research: jsonb("research"),
    /** who to write to, and where that address was found; null when there's none */
    contact: jsonb("contact"),
    /** why it was skipped or set as a task, in words */
    note: text("note"),
    researchedAt: timestamp("researched_at", { withTimezone: true }),
    researchAttempts: integer("research_attempts").notNull().default(0),
    /** when a run first showed this page cited in an answer that names the brand */
    wonAt: timestamp("won_at", { withTimezone: true }),
    /** what the analysis model cost for this target */
    costUsd: usd("cost_usd").notNull().default("0"),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("outreach_targets_workspace_url_uq").on(t.workspaceId, t.url)],
);

/** What a page needs to be cited for a prompt, from the pages that are (core/outreach/brief.ts). */
export const contentBriefs = pgTable(
  "content_briefs",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    promptId: uuid("prompt_id")
      .notNull()
      .references(() => prompts.id, { onDelete: "cascade" }),
    status: auditStatus("status").notNull().default("queued"),
    brief: jsonb("brief"),
    costUsd: usd("cost_usd").notNull().default("0"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("content_briefs_workspace_prompt_uq").on(t.workspaceId, t.promptId)],
);

/**
 * Google's top results for each prompt (core/search/serp.ts), through Bright
 * Data's SERP API: the pages that rank, to get onto alongside the pages AI
 * cites. The latest snapshot per prompt and country; refreshed weekly.
 */
export const searchResults = pgTable(
  "search_results",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    promptId: uuid("prompt_id")
      .notNull()
      .references(() => prompts.id, { onDelete: "cascade" }),
    country: text("country").notNull().default(""),
    /** 1 = the first organic result, across the searches for this prompt */
    position: integer("position").notNull(),
    url: text("url").notNull(),
    domain: text("domain").notNull(),
    title: text("title"),
    fetchedAt: createdAt(),
  },
  (t) => [index("search_results_workspace_idx").on(t.workspaceId, t.promptId)],
);

/** When each prompt was last searched, per country, so the worker knows what's due. */
export const searchChecks = pgTable(
  "search_checks",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    promptId: uuid("prompt_id")
      .notNull()
      .references(() => prompts.id, { onDelete: "cascade" }),
    country: text("country").notNull().default(""),
    checkedAt: timestamp("checked_at", { withTimezone: true }).notNull(),
    /** searches that failed in a row; after a few, wait for the next week */
    failures: integer("failures").notNull().default(0),
    error: text("error"),
  },
  (t) => [uniqueIndex("search_checks_prompt_country_uq").on(t.promptId, t.country)],
);

/** Who outreach emails come from, and the limits on sending (one row per workspace). */
export const outreachSettings = pgTable("outreach_settings", {
  workspaceId: uuid("workspace_id")
    .primaryKey()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  senderName: text("sender_name"),
  senderEmail: text("sender_email"),
  company: text("company"),
  /** a postal address: anti-spam law (CAN-SPAM) requires one in every commercial email */
  address: text("address"),
  website: text("website"),
  /** emails a day, at most */
  dailyCap: integer("daily_cap").notNull().default(10),
  /** the user's own mailbox, over SMTP (core/outreach/send.ts) */
  smtpHost: text("smtp_host"),
  smtpPort: integer("smtp_port"),
  /** true: TLS from the start (usually port 465); false: STARTTLS (usually 587) */
  smtpSecure: boolean("smtp_secure").notNull().default(true),
  smtpUser: text("smtp_user"),
  /** encrypted like the Bright Data key (core/crypto.ts), never shown again */
  smtpPassword: text("smtp_password"),
  /** the same mailbox over IMAP, to read replies (core/outreach/replies.ts); same login */
  imapHost: text("imap_host"),
  imapPort: integer("imap_port"),
  imapCheckedAt: timestamp("imap_checked_at", { withTimezone: true }),
  imapError: text("imap_error"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const messageKind = pgEnum("message_kind", ["pitch", "follow_up"]);
export const messageStatus = pgEnum("message_status", [
  /** written by the agent, waiting for a person */
  "draft",
  /** approved by a person: the only status that can be sent */
  "approved",
  "sent",
  "failed",
  /** not sent: skipped, or stopped by a reply or an opt-out */
  "cancelled",
]);

/** An email the agent drafted for a target: the pitch, or its one follow-up. */
export const outreachMessages = pgTable(
  "outreach_messages",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    targetId: uuid("target_id")
      .notNull()
      .references(() => outreachTargets.id, { onDelete: "cascade" }),
    kind: messageKind("kind").notNull(),
    status: messageStatus("status").notNull().default("draft"),
    to: text("to").notNull(),
    toName: text("to_name"),
    subject: text("subject").notNull(),
    /** the part a person can edit; the sender block, address and opt-out line are added when sent */
    body: text("body").notNull(),
    /** "model" or "template" */
    source: text("source").notNull(),
    costUsd: usd("cost_usd").notNull().default("0"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approvedBy: text("approved_by"),
    /** a follow-up waits this long after the pitch is sent */
    sendAfter: timestamp("send_after", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    /** the Message-ID header, to match replies */
    messageId: text("message_id"),
    error: text("error"),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("outreach_messages_workspace_idx").on(t.workspaceId, t.status),
    uniqueIndex("outreach_messages_target_kind_uq").on(t.targetId, t.kind),
  ],
);

/** Addresses and domains never to email: added by hand, or when someone opts out. */
export const doNotContact = pgTable(
  "do_not_contact",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    /** an email address, or a domain (everyone at it) */
    value: text("value").notNull(),
    reason: text("reason"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("do_not_contact_workspace_value_uq").on(t.workspaceId, t.value)],
);

export const replyKind = pgEnum("reply_kind", ["reply", "opt_out", "bounce"]);

/** A reply to an outreach email, read from the user's mailbox over IMAP. */
export const outreachReplies = pgTable(
  "outreach_replies",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    targetId: uuid("target_id")
      .notNull()
      .references(() => outreachTargets.id, { onDelete: "cascade" }),
    /** the reply's own Message-ID, so it's read once */
    messageId: text("message_id").notNull(),
    kind: replyKind("kind").notNull(),
    fromAddress: text("from_address").notNull(),
    fromName: text("from_name"),
    subject: text("subject"),
    /** the start of what they wrote, without the quoted email */
    snippet: text("snippet"),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
    /** the user has dealt with it */
    handled: boolean("handled").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("outreach_replies_workspace_message_uq").on(t.workspaceId, t.messageId)],
);

/** read and write: the MCP server; ingest: a site key that can only report visits (core/traffic) */
export const keyAccess = pgEnum("key_access", ["read", "write", "ingest"]);

/**
 * API keys for the MCP server (core/mcp). Only a SHA-256 hash is stored; the
 * key is shown once when created. "write" keys can change prompts and start
 * runs; nothing over the API can approve or send outreach emails.
 */
export const apiKeys = pgTable(
  "api_keys",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** the first characters, to tell keys apart: "ov_k3J9f…" */
    prefix: text("prefix").notNull(),
    hash: text("hash").notNull(),
    access: keyAccess("access").notNull().default("read"),
    createdBy: text("created_by"),
    createdAt: createdAt(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("api_keys_hash_uq").on(t.hash),
    index("api_keys_workspace_idx").on(t.workspaceId),
  ],
);

export const visitKind = pgEnum("visit_kind", ["crawler", "referral"]);

/**
 * AI traffic to the brand's own site (core/traffic): requests from AI
 * crawlers and agents, and people arriving from AI assistants. Reported
 * live by a site snippet or read from uploaded server logs. Ordinary visits
 * are never stored; people's IP addresses never are either.
 */
export const aiVisits = pgTable(
  "ai_visits",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    kind: visitKind("kind").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull(),
    /** the crawler's name (GPTBot…) or, for referrals, the assistant (ChatGPT…) */
    agent: text("agent").notNull(),
    host: text("host"),
    path: text("path").notNull(),
    status: integer("status"),
    /** crawlers only: the address, to check it against the company's published ranges */
    ip: text("ip"),
    /** true: from the company's published ranges; false: claims to be it but isn't; null: can't tell */
    verified: boolean("verified"),
    source: text("source").notNull(),
    /** so the same log uploaded twice counts once */
    fingerprint: text("fingerprint").notNull(),
  },
  (t) => [
    index("ai_visits_workspace_at_idx").on(t.workspaceId, t.at),
    uniqueIndex("ai_visits_fingerprint_uq").on(t.workspaceId, t.fingerprint),
  ],
);

/**
 * Free public tools that take a while (core/tools/fan-out.ts): one Bright
 * Data answer per run, started and then checked on. Also how runs are
 * counted per visitor; the address is kept only as a salted hash.
 */
export const toolRuns = pgTable(
  "tool_runs",
  {
    id: id(),
    tool: text("tool").notNull(),
    input: jsonb("input").notNull(),
    /** queued, running, done or failed */
    status: text("status").notNull().default("running"),
    jobId: text("job_id"),
    result: jsonb("result"),
    error: text("error"),
    visitor: text("visitor").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("tool_runs_visitor_idx").on(t.visitor, t.createdAt)],
);
