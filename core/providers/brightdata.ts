/**
 * Bright Data adapter for the consumer AI apps (ChatGPT, Gemini, Google AI
 * Mode, Google AI Overviews, Perplexity). Bright Data runs each prompt in
 * the real app, logged out, and returns the answer with its citations.
 *
 * Flow: trigger a batch -> poll progress -> download the snapshot.
 * Docs: https://docs.brightdata.com/products/scrapers/scrapers-library/async-requests
 *
 * Rate limits matter here: 25 HTTP 429 responses within 5 minutes gets the
 * calling IP blocked until Bright Data support clears it. So we send one
 * batch per engine rather than one job per prompt, and stop at the second
 * 429 instead of hammering the API.
 */

import { ProviderError, isRetryable, kindForStatus, type ProviderErrorKind } from "./errors";
import { BRIGHT_DATA_PRICING } from "./registry";
import type {
  Citation,
  EngineId,
  ItemError,
  JobState,
  Provider,
  QueryInput,
  QueryResult,
} from "./types";

const API = "https://api.brightdata.com/datasets/v3";

/**
 * Dataset IDs from https://docs.brightdata.com/scrapers.json.
 * Most scrapers take the app's home page; AI Mode needs the full search URL
 * with the prompt and `udm=50` (the AI Mode tab), plus an interface language.
 * AI Overviews come from the Google search results scraper, which returns
 * the overview as `aio_text` / `aio_citations` and takes a `keyword`.
 * Copilot's scraper exists but hits a login wall (see registry.ts).
 */
export const BRIGHT_DATA_DATASETS = {
  chatgpt: { datasetId: "gd_m7aof0k82r803d5bjm", url: () => "https://chatgpt.com/" },
  perplexity: { datasetId: "gd_m7dhdot1vw9a7gc1n", url: () => "https://www.perplexity.ai/" },
  gemini: { datasetId: "gd_mbz66arm2mf9cu856y", url: () => "https://gemini.google.com/" },
  copilot: { datasetId: "gd_m7di5jy6s9geokz8w", url: () => "https://copilot.microsoft.com/" },
  ai_mode: {
    datasetId: "gd_mcswdt6z2elth3zqr2",
    url: (prompt: string) => `https://www.google.com/search?udm=50&q=${encodeURIComponent(prompt)}`,
  },
  ai_overviews: { datasetId: "gd_mfz5x93lmsjjjylob", url: () => "https://www.google.com/" },
} as const;

export type BrightDataEngine = keyof typeof BRIGHT_DATA_DATASETS;

export const isBrightDataEngine = (e: string): e is BrightDataEngine => e in BRIGHT_DATA_DATASETS;

export type BrightDataInput = QueryInput & {
  /** ChatGPT only: allow web search (a permission, not a guarantee) */
  webSearch?: boolean;
};

type ProgressStatus =
  | "running"
  | "ready"
  | "failed"
  | "canceled"
  | "starting"
  | "building"
  | "collecting"
  | "digesting";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The raw API: trigger, progress, download. The provider below builds on it. */
export class BrightDataClient {
  constructor(private readonly apiKey: string) {
    if (!apiKey)
      throw new ProviderError(
        "auth",
        "Missing Bright Data API key. Add BRIGHT_DATA_API_KEY to .env.local.",
      );
  }

  private async request(path: string, init?: RequestInit, retried = false): Promise<Response> {
    let res: Response;
    try {
      res = await fetch(`${API}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          ...init?.headers,
        },
      });
    } catch (err) {
      throw new ProviderError("upstream", `Couldn't reach Bright Data: ${(err as Error).message}`);
    }

    if (res.status === 429 && !retried) {
      // one polite retry, honouring Retry-After; a second 429 is an error
      const wait = Number(res.headers.get("retry-after")) || 10;
      await sleep(wait * 1000);
      return this.request(path, init, true);
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new ProviderError(
        kindForStatus(res.status),
        `Bright Data ${res.status} on ${path.split("?")[0]}: ${body.slice(0, 500)}`,
        res.status,
      );
    }
    return res;
  }

  /** Start a collection for many prompts on one engine. Returns the snapshot ID. */
  async trigger(engine: BrightDataEngine, inputs: BrightDataInput[]): Promise<string> {
    const { datasetId, url } = BRIGHT_DATA_DATASETS[engine];
    const input = inputs.map((it, index) =>
      engine === "ai_overviews"
        ? {
            url: url(it.prompt),
            keyword: it.prompt,
            index,
            language: "en",
            ...(it.country ? { country: it.country.toUpperCase() } : {}),
          }
        : {
            url: url(it.prompt),
            prompt: it.prompt,
            index,
            ...(it.country ? { country: it.country.toUpperCase() } : {}),
            ...(engine === "chatgpt" && it.webSearch !== undefined
              ? { web_search: it.webSearch }
              : {}),
            ...(engine === "ai_mode" ? { hl: "en" } : {}),
          },
    );

    const res = await this.request(
      `/trigger?dataset_id=${datasetId}&format=json&include_errors=true`,
      { method: "POST", body: JSON.stringify({ input }) },
    );
    const json = (await res.json()) as { snapshot_id?: string };
    if (!json.snapshot_id)
      throw new ProviderError(
        "upstream",
        `No snapshot_id in trigger response: ${JSON.stringify(json)}`,
      );
    return json.snapshot_id;
  }

  async progress(snapshotId: string): Promise<{ status: string; error?: string }> {
    const res = await this.request(`/progress/${snapshotId}`);
    const json = (await res.json()) as { status?: ProgressStatus; error_message?: string };
    return { status: json.status ?? "unknown", error: json.error_message };
  }

  /** Download a ready snapshot's records. */
  async download(snapshotId: string): Promise<Record<string, unknown>[]> {
    const res = await this.request(`/snapshot/${snapshotId}?format=json`);
    const json = (await res.json()) as unknown;
    if (!Array.isArray(json))
      throw new ProviderError(
        "upstream",
        `Unexpected snapshot shape: ${JSON.stringify(json).slice(0, 300)}`,
      );
    return json as Record<string, unknown>[];
  }

  /**
   * Check the key works, for free: listing past snapshots costs nothing and
   * answers 401 to a bad key. Throws a ProviderError when the key is refused.
   */
  async verify(): Promise<void> {
    await this.request(`/snapshots?dataset_id=${BRIGHT_DATA_DATASETS.chatgpt.datasetId}&limit=1`);
  }
}

/* ── the provider ────────────────────────────────────────────── */

/** Engines whose Bright Data scraper works at least some of the time. */
const ANSWERABLE: readonly EngineId[] = [
  "chatgpt",
  "gemini",
  "ai_mode",
  "ai_overviews",
  "perplexity",
];

export class BrightDataProvider implements Provider {
  readonly id = "brightdata";
  readonly source = "consumer_app" as const;
  private readonly client: BrightDataClient;

  constructor(
    apiKey: string,
    private readonly opts: { webSearch?: boolean } = {},
  ) {
    this.client = new BrightDataClient(apiKey);
  }

  supports(engine: EngineId) {
    return ANSWERABLE.includes(engine);
  }

  private dataset(engine: EngineId): BrightDataEngine {
    if (!this.supports(engine) || !isBrightDataEngine(engine))
      throw new ProviderError("unavailable", `Bright Data can't answer for ${engine} yet`);
    return engine;
  }

  async submit(engine: EngineId, inputs: QueryInput[]) {
    if (inputs.length === 0) throw new ProviderError("bad_input", "No prompts to submit");
    return this.client.trigger(
      this.dataset(engine),
      // ChatGPT searches only when it decides to; allow it so answers match what users see
      inputs.map((i) => ({ ...i, webSearch: this.opts.webSearch ?? true })),
    );
  }

  async check(jobId: string): Promise<JobState> {
    const { status, error } = await this.client.progress(jobId);
    if (status === "ready") return { state: "ready" };
    if (status === "failed" || status === "canceled")
      return {
        state: "failed",
        error: {
          kind: "upstream",
          message: `Snapshot ${jobId} ${status}: ${error ?? "no details"}`,
          retryable: true,
        },
      };
    return { state: "pending", detail: status };
  }

  async collect(engine: EngineId, jobId: string, inputs: QueryInput[]) {
    const records = await this.client.download(jobId);
    return matchRecords(this.dataset(engine), inputs, records);
  }
}

/**
 * Pair each input with its record. Bright Data echoes the input on every
 * record, including failed ones, but the Google search scraper drops our
 * `index`, so fall back to matching on the prompt text and country.
 * Repeated samples of one prompt are interchangeable, so taking them in
 * order is fine.
 */
export function matchRecords(
  engine: BrightDataEngine,
  inputs: QueryInput[],
  records: Record<string, unknown>[],
): QueryResult[] {
  const results: (QueryResult | undefined)[] = new Array(inputs.length);
  const sameCountry = (a?: string, b?: string) => !a || !b || a.toUpperCase() === b.toUpperCase();

  for (const record of records) {
    const answer = normalize(engine, record);
    let i = answer.index;
    if (!(i >= 0 && i < inputs.length && !results[i] && inputs[i].prompt === answer.prompt)) {
      i = inputs.findIndex(
        (input, j) =>
          !results[j] &&
          input.prompt === answer.prompt &&
          sameCountry(input.country, answer.country),
      );
    }
    if (i === -1) continue; // not one of ours; ignore rather than mislabel
    results[i] = { ...answer, index: i, country: inputs[i].country ?? answer.country };
  }

  return inputs.map(
    (input, i) =>
      results[i] ??
      failed(engine, input, i, {
        kind: "upstream",
        message: "Bright Data returned no record for this prompt",
        retryable: true,
      }),
  );
}

function failed(engine: EngineId, input: QueryInput, index: number, error: ItemError): QueryResult {
  return {
    engine,
    source: "consumer_app",
    prompt: input.prompt,
    country: input.country,
    index,
    ok: false,
    error,
    text: "",
    citations: [],
    links: [],
    costUsd: 0,
    raw: {},
  };
}

/* ── normalization ───────────────────────────────────────────── */

const str = (v: unknown) => (typeof v === "string" && v.length > 0 ? v : undefined);

const toIndex = (v: unknown) => {
  const n = typeof v === "number" ? v : typeof v === "string" && v !== "" ? Number(v) : NaN;
  return Number.isInteger(n) ? n : -1;
};

function toCitations(v: unknown): Citation[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((item, i): Citation | null => {
      if (typeof item === "string") return { url: item, position: i + 1 };
      if (item && typeof item === "object") {
        const o = item as Record<string, unknown>;
        const url = str(o.url) ?? str(o.link) ?? str(o.href);
        if (!url) return null;
        return {
          url,
          title: str(o.title) ?? str(o.text) ?? str(o.name),
          position: typeof o.position === "number" ? o.position : i + 1,
        };
      }
      return null;
    })
    .filter((c): c is Citation => c !== null);
}

const stripHtml = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * ChatGPT often shows its sources only as small chips ("IndieToolkit +1")
 * and Bright Data leaves `citations` empty. Each chip renders as a favicon
 * image, so the cited domain can be recovered from the favicon URL.
 * "+1" means more sources are hidden behind the chip; those aren't recoverable.
 */
function sourceChipsFromMarkdown(md: string | undefined): Citation[] {
  if (!md) return [];
  const domains = new Set<string>();
  for (const m of md.matchAll(/google\.com\/s2\/favicons\?domain=([^&)\s]+)/g)) {
    try {
      domains.add(new URL(decodeURIComponent(m[1])).hostname.replace(/^www\./, ""));
    } catch {
      /* not a URL; skip */
    }
  }
  return [...domains].map((d, i) => ({ url: `https://${d}`, title: d, position: i + 1 }));
}

/** Fields that hold the full page HTML (1 MB+) or page chrome; never worth storing. */
const BULKY_FIELDS = new Set([
  "page_html",
  "answer_html",
  "answer_section_html",
  "response_raw",
  "response_raw_additional_prompt",
  "additional_answer_text_markdown",
]);

const slim = (r: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(r).filter(([k]) => !BULKY_FIELDS.has(k)));

/** Turn a scraper's error into one of our error kinds. */
function itemError(code: string | undefined, message: string): ItemError {
  let kind: ProviderErrorKind = "upstream";
  if (code === "blocked" || /sign in|log ?in|captcha/i.test(message)) kind = "blocked";
  else if (/too many requests|rate limit/i.test(message)) kind = "blocked";
  else if (code === "dead_page" || code === "bad_input") kind = "bad_input";
  return { kind, message, retryable: isRetryable(kind) };
}

/**
 * Turn one Bright Data record into a result. Each platform names its fields
 * slightly differently: ChatGPT and Gemini use `citations`, Perplexity uses
 * `sources`, and the Google search scraper uses `aio_*`.
 */
export function normalize(engine: BrightDataEngine, r: Record<string, unknown>): QueryResult {
  const input = (r.input && typeof r.input === "object" ? r.input : {}) as Record<string, unknown>;
  const errorText = str(r.error) ?? str(r.warning);
  const error = errorText ? itemError(str(r.error_code), errorText) : undefined;
  const base = {
    engine,
    source: "consumer_app" as const,
    index: toIndex(r.index) >= 0 ? toIndex(r.index) : toIndex(input.index),
    country: str(r.country) ?? str(input.country),
    raw: slim(r),
  };

  if (engine === "ai_overviews") {
    // no overview is a normal outcome, not an error: Google shows one only for some queries
    // drop the labels Google puts before the overview ("AI Overview", "AI Mode replied:")
    const text = (str(r.aio_text) ?? str(r.aio_markdown) ?? "")
      .replace(/^\s*AI Overview\s*/, "")
      .replace(/^\s*AI Mode replied:\s*/, "");
    return {
      ...base,
      prompt: str(r.keyword) ?? str(input.keyword) ?? "",
      ok: !error,
      error,
      text,
      // titles carry Google's screen-reader suffix ". Opens in new tab."
      citations: toCitations(r.aio_citations).map((c) => ({
        ...c,
        title: c.title?.replace(/\.?\s*Opens in new tab\.?$/, "").trim(),
      })),
      links: [],
      shown: text.length > 0,
      costUsd: error ? 0 : BRIGHT_DATA_PRICING.perAnswerUsd,
    };
  }

  const text =
    str(r.answer_text) ??
    str(r.answer_text_markdown) ??
    (str(r.answer_html) ? stripHtml(str(r.answer_html)!) : "");

  const listed = toCitations(r.citations).length
    ? toCitations(r.citations)
    : toCitations(r.sources);
  const citations = listed.length ? listed : sourceChipsFromMarkdown(str(r.answer_text_markdown));
  const finalError =
    error ??
    (text.length
      ? undefined
      : { kind: "upstream" as const, message: "empty answer", retryable: true });

  return {
    ...base,
    prompt: str(r.prompt) ?? str(input.prompt) ?? "",
    ok: !finalError,
    error: finalError,
    text,
    citations,
    links: toCitations(r.links_attached),
    model: str(r.model),
    webSearchTriggered:
      typeof r.web_search_triggered === "boolean" ? r.web_search_triggered : undefined,
    // Bright Data bills records it delivered; error records are free
    costUsd: error ? 0 : BRIGHT_DATA_PRICING.perAnswerUsd,
  };
}
