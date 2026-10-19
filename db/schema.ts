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
  boolean,
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

export const workspaceMode = pgEnum("workspace_mode", ["self_hosted", "hosted"]);

export const workspaces = pgTable("workspaces", {
  id: id(),
  name: text("name").notNull(),
  mode: workspaceMode("mode").notNull().default("self_hosted"),
  /** two-letter country codes prompts run in unless a prompt overrides them */
  defaultCountries: textList("default_countries"),
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
]);

export const itemStatus = pgEnum("item_status", ["queued", "running", "done", "failed", "skipped"]);

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
export const answers = pgTable("answers", {
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
  createdAt: createdAt(),
});

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
    /** -1 (negative) to 1 (positive) */
    sentiment: real("sentiment"),
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
  },
  (t) => [index("citations_answer_idx").on(t.answerId), index("citations_domain_idx").on(t.domain)],
);
