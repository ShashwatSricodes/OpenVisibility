/**
 * Rules for what a workspace tracks: which engines, in which countries.
 * No database code, so the Settings form can show warnings as you choose.
 */

import { countryName, isCountryCode } from "./countries";
import { ENGINES, canAnswer, isEngineId } from "./providers/registry";
import type { EngineId } from "./providers/types";

export const DEFAULT_COUNTRIES = ["US"] as const;
export const MAX_COUNTRIES = 10;

export type TrackingConfig = { engines: EngineId[]; countries: string[] };

/** Check a choice from the Settings form. Returns the cleaned config, or what's wrong. */
export function validateTrackingConfig(input: {
  engines: string[];
  countries: string[];
}): { ok: true; config: TrackingConfig } | { ok: false; message: string } {
  const engines = [...new Set(input.engines)];
  const countries = [...new Set(input.countries.map((c) => c.toUpperCase()))];

  for (const e of engines) {
    if (!isEngineId(e)) return { ok: false, message: `Unknown engine "${e}".` };
    if (!canAnswer(e))
      return {
        ok: false,
        message: `${ENGINES[e].name} can't be tracked yet. ${ENGINES[e].note ?? ""}`,
      };
  }
  for (const c of countries) {
    if (!isCountryCode(c)) return { ok: false, message: `Unknown country "${c}".` };
  }
  if (engines.length === 0) return { ok: false, message: "Pick at least one engine." };
  if (countries.length === 0) return { ok: false, message: "Pick at least one country." };
  if (countries.length > MAX_COUNTRIES)
    return { ok: false, message: `Pick at most ${MAX_COUNTRIES} countries.` };

  // keep the registry's order, so the dashboard lists engines consistently
  const ordered = (Object.keys(ENGINES) as EngineId[]).filter((e) => engines.includes(e));
  return { ok: true, config: { engines: ordered, countries } };
}

/** Things worth knowing about a choice before running it. Not errors: it can still be saved. */
export function trackingWarnings({ engines, countries }: TrackingConfig): string[] {
  const warnings: string[] = [];
  for (const e of engines) {
    const info = ENGINES[e];
    if (info.status === "unreliable")
      warnings.push(`${info.name} often fails right now. ${info.note ?? ""}`.trim());
    const untested = countries.filter((c) => !info.verifiedCountries.includes(c));
    if (info.status === "available" && untested.length)
      warnings.push(
        `${info.name} hasn't been tested in ${untested.map(countryName).join(", ")} yet; answers there may fail.`,
      );
  }
  return warnings;
}

/** Answers one run of one prompt uses: one per engine per country, before repeat samples. */
export const answersPerPrompt = ({ engines, countries }: TrackingConfig) =>
  engines.length * countries.length;
