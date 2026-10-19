/**
 * The one way into the providers: `getProvider(engine)` picks the data
 * source for an engine, and `query()` runs a batch from start to finish.
 * The worker uses submit / check / collect directly so it can survive restarts.
 */

import { env } from "../env";
import { BrightDataProvider } from "./brightdata";
import { ProviderError } from "./errors";
import { ENGINES } from "./registry";
import type { EngineId, Provider } from "./types";

export * from "./errors";
export * from "./registry";
export * from "./query";
export * from "./retry";
export * from "./rate-guard";
export type * from "./types";

export type ProviderKeys = {
  /** the workspace's own key; falls back to BRIGHT_DATA_API_KEY */
  brightData?: string;
};

export function getProvider(engine: EngineId, keys: ProviderKeys = {}): Provider {
  const info = ENGINES[engine];
  if (!info) throw new ProviderError("bad_input", `Unknown engine "${engine}"`);

  switch (info.provider) {
    case "brightdata": {
      const key = keys.brightData ?? env().BRIGHT_DATA_API_KEY;
      if (!key)
        throw new ProviderError(
          "auth",
          `${info.name} answers come from Bright Data, and no Bright Data key is set. Add your key in Settings, or set BRIGHT_DATA_API_KEY in .env.local (the free tier covers 5,000 answers a month).`,
        );
      return new BrightDataProvider(key);
    }
    case null:
      throw new ProviderError(
        "unavailable",
        `${info.name} isn't available yet. ${info.note ?? ""}`,
      );
  }
}
