/**
 * What a workspace tracks, stored on the workspace. Set on the Settings page;
 * read by the cost estimate and, later, by every run. Rules: tracking-rules.ts.
 */

import { eq } from "drizzle-orm";
import type { AnyDb } from "@/db/client";
import { workspaces } from "@/db/schema";
import { DEFAULT_ENGINES, canAnswer } from "./providers/registry";
import { DEFAULT_COUNTRIES, type TrackingConfig } from "./tracking-rules";

export type { TrackingConfig } from "./tracking-rules";

/**
 * The workspace's engines and countries, cleaned up: engines that lost their
 * data source are dropped, and an empty choice falls back to the defaults.
 */
export async function getTrackingConfig(db: AnyDb, workspaceId: string): Promise<TrackingConfig> {
  const [row] = await db
    .select({
      engines: workspaces.engines,
      countries: workspaces.defaultCountries,
      samples: workspaces.samples,
    })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);
  if (!row) throw new Error(`No workspace ${workspaceId}`);

  const engines = row.engines.filter(canAnswer);
  return {
    engines: engines.length ? engines : [...DEFAULT_ENGINES],
    countries: row.countries.length ? row.countries : [...DEFAULT_COUNTRIES],
    samples: row.samples,
  };
}

export async function saveTrackingConfig(db: AnyDb, workspaceId: string, config: TrackingConfig) {
  await db
    .update(workspaces)
    .set({ engines: config.engines, defaultCountries: config.countries, samples: config.samples })
    .where(eq(workspaces.id, workspaceId));
}
