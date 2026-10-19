/**
 * Database schema: what a workspace tracks.
 *
 * A workspace (a person, a team, or an agency) tracks one or more brands.
 * Each brand has its own aliases, competitors and prompts, so an agency
 * can track several clients side by side. Results tables come on Day 4.
 *
 * Change a table here, then `npm run db:generate` to write a migration.
 */

import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

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
