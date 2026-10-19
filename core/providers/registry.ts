/**
 * Every engine OpenVisibility knows about, in one place: what it's called,
 * where its answers come from, and how well that works today. Update this
 * file when a scraper starts or stops working (see docs/providers.md).
 */

import type { AnswerSource, EngineId } from "./types";

export type EngineStatus =
  /** works reliably */
  | "available"
  /** works, but often fails; failed answers aren't billed */
  | "unreliable"
  /** no working data source yet */
  | "unavailable";

export type EngineInfo = {
  id: EngineId;
  name: string;
  maker: string;
  /** null while no provider can answer for this engine */
  provider: "brightdata" | null;
  source: AnswerSource;
  status: EngineStatus;
  /** countries verified to work; other countries may fail */
  verifiedCountries: readonly string[];
  /** rough time for a batch to finish, in seconds, as measured */
  typicalSeconds?: number;
  note?: string;
};

export const ENGINES: Record<EngineId, EngineInfo> = {
  chatgpt: {
    id: "chatgpt",
    name: "ChatGPT",
    maker: "OpenAI",
    provider: "brightdata",
    source: "consumer_app",
    status: "available",
    verifiedCountries: ["US", "IN"],
    typicalSeconds: 90,
  },
  gemini: {
    id: "gemini",
    name: "Gemini",
    maker: "Google",
    provider: "brightdata",
    source: "consumer_app",
    status: "available",
    verifiedCountries: ["US", "IN"],
    typicalSeconds: 200,
    note: "Logged-out Gemini answers with Flash-Lite.",
  },
  ai_mode: {
    id: "ai_mode",
    name: "Google AI Mode",
    maker: "Google",
    provider: "brightdata",
    source: "consumer_app",
    status: "available",
    verifiedCountries: ["US"],
    typicalSeconds: 30,
    note: "Failed for India in testing; verified for the US.",
  },
  ai_overviews: {
    id: "ai_overviews",
    name: "Google AI Overviews",
    maker: "Google",
    provider: "brightdata",
    source: "consumer_app",
    status: "available",
    verifiedCountries: ["US"],
    typicalSeconds: 230,
    note: "Google shows an overview only for some searches; no overview is a result, not an error.",
  },
  perplexity: {
    id: "perplexity",
    name: "Perplexity",
    maker: "Perplexity",
    provider: "brightdata",
    source: "consumer_app",
    status: "unreliable",
    verifiedCountries: [],
    note: "Perplexity often turns Bright Data away with “too many requests”.",
  },
  copilot: {
    id: "copilot",
    name: "Copilot",
    maker: "Microsoft",
    provider: null,
    source: "consumer_app",
    status: "unavailable",
    verifiedCountries: [],
    note: "Copilot requires sign-in since 31 August 2026, so the scraper can't reach it.",
  },
  claude: {
    id: "claude",
    name: "Claude",
    maker: "Anthropic",
    provider: null,
    source: "official_api",
    status: "unavailable",
    verifiedCountries: [],
    note: "Claude requires sign-in; it will come through the official API later.",
  },
  grok: {
    id: "grok",
    name: "Grok",
    maker: "xAI",
    provider: null,
    source: "consumer_app",
    status: "unavailable",
    verifiedCountries: [],
    note: "Bright Data has no Grok scraper yet.",
  },
};

/** What a new workspace tracks unless it chooses otherwise. */
export const DEFAULT_ENGINES: readonly EngineId[] = [
  "chatgpt",
  "gemini",
  "ai_mode",
  "ai_overviews",
];

/** Bright Data list prices (https://brightdata.com/pricing/web-scraper), checked 18 October 2026. */
export const BRIGHT_DATA_PRICING = {
  /** pay as you go, per successful answer */
  perAnswerUsd: 0.0015,
  /** free answers per account per month; resets on the 1st, no rollover */
  freeAnswersPerMonth: 5000,
} as const;

export const engineIds = Object.keys(ENGINES) as EngineId[];

export const isEngineId = (v: string): v is EngineId => v in ENGINES;

export const canAnswer = (engine: EngineId) => ENGINES[engine].provider !== null;
