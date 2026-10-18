/**
 * Bright Data client for the consumer AI apps (ChatGPT, Perplexity, Gemini,
 * Copilot, Google AI Mode). Bright Data runs each prompt in the real app and
 * returns the answer with its citations.
 *
 * Flow: trigger a batch -> poll progress -> download the snapshot.
 * Docs: https://docs.brightdata.com/products/scrapers/scrapers-library/async-requests
 *
 * Rate limits matter here: 25 HTTP 429 responses within 5 minutes gets the
 * calling IP blocked until Bright Data support clears it. So we send one
 * batch per engine rather than one job per prompt, and stop at the first
 * 429 after a short backoff instead of hammering the API.
 */

const API = "https://api.brightdata.com/datasets/v3";

/**
 * Dataset IDs from https://docs.brightdata.com/scrapers.json.
 * Most scrapers take the app's home page; AI Mode needs the full search URL
 * with the prompt and `udm=50` (the AI Mode tab), plus an interface language.
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
} as const;

export type BrightDataEngine = keyof typeof BRIGHT_DATA_DATASETS;

export type BrightDataInput = {
  prompt: string;
  /** two-letter country code, e.g. "US" or "IN" (Bright Data wants uppercase) */
  country?: string;
  /** ChatGPT only: allow web search (a permission, not a guarantee) */
  webSearch?: boolean;
};

export type Citation = { url: string; title?: string; position?: number };

export type BrightDataAnswer = {
  engine: BrightDataEngine;
  prompt: string;
  /** position of the input in the batch, so results can be matched back */
  index: number;
  ok: boolean;
  error?: string;
  text: string;
  citations: Citation[];
  /** links inside the answer text, separate from the cited sources */
  links: Citation[];
  /** model the app used, when Bright Data reports it (ChatGPT does) */
  model?: string;
  /** whether the app actually searched; ChatGPT reports this */
  webSearchTriggered?: boolean;
  country?: string;
  raw: Record<string, unknown>;
};

export class BrightDataError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "BrightDataError";
  }
}

type ProgressStatus = "running" | "ready" | "failed" | "canceled" | "starting" | "building" | "collecting" | "digesting";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class BrightDataClient {
  constructor(private readonly apiKey: string) {
    if (!apiKey) throw new BrightDataError("Missing Bright Data API key");
  }

  private async request(path: string, init?: RequestInit, retried = false): Promise<Response> {
    const res = await fetch(`${API}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        ...init?.headers,
      },
    });

    if (res.status === 429 && !retried) {
      // one polite retry, honouring Retry-After; a second 429 is an error
      const wait = Number(res.headers.get("retry-after")) || 10;
      await sleep(wait * 1000);
      return this.request(path, init, true);
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new BrightDataError(`Bright Data ${res.status} on ${path}: ${body.slice(0, 1500)}`, res.status);
    }
    return res;
  }

  /** Start a collection for many prompts on one engine. Returns the snapshot ID. */
  async trigger(engine: BrightDataEngine, inputs: BrightDataInput[]): Promise<string> {
    const { datasetId, url } = BRIGHT_DATA_DATASETS[engine];
    const input = inputs.map((it, index) => ({
      url: url(it.prompt),
      prompt: it.prompt,
      index,
      ...(it.country ? { country: it.country.toUpperCase() } : {}),
      ...(engine === "chatgpt" && it.webSearch !== undefined ? { web_search: it.webSearch } : {}),
      ...(engine === "ai_mode" ? { hl: "en" } : {}),
    }));

    const res = await this.request(
      `/trigger?dataset_id=${datasetId}&format=json&include_errors=true`,
      { method: "POST", body: JSON.stringify({ input }) },
    );
    const json = (await res.json()) as { snapshot_id?: string };
    if (!json.snapshot_id) throw new BrightDataError(`No snapshot_id in trigger response: ${JSON.stringify(json)}`);
    return json.snapshot_id;
  }

  /** Poll until the snapshot is ready. Polls every 10 seconds by default. */
  async waitForSnapshot(
    snapshotId: string,
    { intervalMs = 10_000, timeoutMs = 15 * 60_000, onStatus }: {
      intervalMs?: number;
      timeoutMs?: number;
      onStatus?: (status: string) => void;
    } = {},
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const res = await this.request(`/progress/${snapshotId}`);
      const progress = (await res.json()) as { status?: ProgressStatus; error_message?: string };
      onStatus?.(progress.status ?? "unknown");
      if (progress.status === "ready") return;
      if (progress.status === "failed" || progress.status === "canceled") {
        throw new BrightDataError(`Snapshot ${snapshotId} ${progress.status}: ${progress.error_message ?? "no details"}`);
      }
      await sleep(intervalMs);
    }
    throw new BrightDataError(`Snapshot ${snapshotId} not ready after ${Math.round(timeoutMs / 1000)}s`);
  }

  /** Download a ready snapshot's records. */
  async download(snapshotId: string): Promise<Record<string, unknown>[]> {
    const res = await this.request(`/snapshot/${snapshotId}?format=json`);
    const json = (await res.json()) as unknown;
    if (!Array.isArray(json)) throw new BrightDataError(`Unexpected snapshot shape: ${JSON.stringify(json).slice(0, 300)}`);
    return json as Record<string, unknown>[];
  }

  /** Trigger, wait and download in one call, returning normalized answers. */
  async run(
    engine: BrightDataEngine,
    inputs: BrightDataInput[],
    opts?: Parameters<BrightDataClient["waitForSnapshot"]>[1],
  ): Promise<{ snapshotId: string; answers: BrightDataAnswer[] }> {
    const snapshotId = await this.trigger(engine, inputs);
    await this.waitForSnapshot(snapshotId, opts);
    const records = await this.download(snapshotId);
    return { snapshotId, answers: records.map((r) => normalize(engine, r)) };
  }
}

/* ── normalization ───────────────────────────────────────────── */

const str = (v: unknown) => (typeof v === "string" ? v : undefined);

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
  html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

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
  "answer_html",
  "answer_section_html",
  "response_raw",
  "response_raw_additional_prompt",
  "additional_answer_text_markdown",
]);

const slim = (r: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(r).filter(([k]) => !BULKY_FIELDS.has(k)));

/**
 * Each platform names its fields slightly differently:
 * ChatGPT and Gemini use `citations`, Perplexity uses `sources`.
 */
export function normalize(engine: BrightDataEngine, r: Record<string, unknown>): BrightDataAnswer {
  const error = str(r.error) ?? str(r.error_code) ?? str(r.warning_code);
  const text =
    str(r.answer_text) ??
    str(r.answer_text_markdown) ??
    (str(r.answer_html) ? stripHtml(str(r.answer_html)!) : "") ??
    "";

  const listed = toCitations(r.citations).length ? toCitations(r.citations) : toCitations(r.sources);
  const citations = listed.length ? listed : sourceChipsFromMarkdown(str(r.answer_text_markdown));

  return {
    engine,
    prompt: str(r.prompt) ?? "",
    index: typeof r.index === "number" ? r.index : -1,
    ok: !error && text.length > 0,
    error: error ?? (text.length ? undefined : "empty answer"),
    text,
    citations,
    links: toCitations(r.links_attached),
    model: str(r.model),
    webSearchTriggered: typeof r.web_search_triggered === "boolean" ? r.web_search_triggered : undefined,
    country: str(r.country),
    raw: slim(r),
  };
}
