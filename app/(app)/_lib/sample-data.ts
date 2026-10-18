/**
 * Sample data for the dashboard until the database lands (Day 3 onwards).
 * Deterministic, so server and client render identical numbers.
 * The brand is fictional; competitors and cited domains come from the
 * real Day 1 answers (scripts/fixtures/brightdata-*.json).
 */

export type EngineId = "chatgpt" | "gemini" | "ai_mode" | "ai_overviews" | "perplexity" | "claude";

export type Engine = {
  id: EngineId;
  name: string;
  /** fixed series colour: an engine keeps its colour on every chart */
  color: string;
  source: string;
};

export const ENGINES: Engine[] = [
  { id: "chatgpt", name: "ChatGPT", color: "var(--series-1)", source: "App" },
  { id: "gemini", name: "Gemini", color: "var(--series-2)", source: "App" },
  { id: "ai_mode", name: "AI Mode", color: "var(--series-3)", source: "App" },
  { id: "ai_overviews", name: "AI Overviews", color: "var(--series-4)", source: "Google" },
  { id: "perplexity", name: "Perplexity", color: "var(--series-5)", source: "API" },
  { id: "claude", name: "Claude", color: "var(--series-6)", source: "API" },
];

export const BRAND = { name: "Ledgerly", domain: "ledgerly.app" };

export type MetricId = "mention" | "sov" | "position" | "owned";

export type Metric = {
  id: MetricId;
  label: string;
  /** how to show a value */
  format: (v: number) => string;
  /** lower is better (position) */
  invert?: boolean;
  hint: string;
};

export const METRICS: Metric[] = [
  {
    id: "mention",
    label: "Mention rate",
    format: (v) => `${Math.round(v)}%`,
    hint: "Share of answers that name your brand",
  },
  {
    id: "sov",
    label: "Share of voice",
    format: (v) => `${Math.round(v)}%`,
    hint: "Your mentions as a share of all tracked brands",
  },
  {
    id: "position",
    label: "Avg. position",
    format: (v) => `#${v.toFixed(1)}`,
    invert: true,
    hint: "Where you appear in answers that list several brands",
  },
  {
    id: "owned",
    label: "Owned citations",
    format: (v) => `${Math.round(v)}%`,
    hint: "Citations pointing to your own site",
  },
];

/* ── deterministic noise ──────────────────────────────────── */

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DAYS = 30;
const END = Date.UTC(2026, 9, 18); // 18 Oct 2026

/** per engine: [mention %, share of voice %, position, owned citation %] at the start and end of the range */
const SHAPE: Record<EngineId, [number, number][]> = {
  chatgpt: [
    [34, 46],
    [22, 29],
    [3.1, 2.2],
    [9, 14],
  ],
  gemini: [
    [28, 33],
    [18, 21],
    [3.4, 3.0],
    [6, 8],
  ],
  ai_mode: [
    [30, 41],
    [20, 26],
    [2.9, 2.4],
    [11, 15],
  ],
  ai_overviews: [
    [18, 27],
    [15, 19],
    [3.6, 3.1],
    [12, 13],
  ],
  perplexity: [
    [36, 38],
    [24, 25],
    [2.6, 2.5],
    [14, 17],
  ],
  claude: [
    [22, 31],
    [16, 22],
    [3.3, 2.7],
    [5, 9],
  ],
};

export type Point = { date: string } & Record<EngineId, number>;

function buildSeries(metricIndex: number): Point[] {
  const out: Point[] = [];
  const noise = Object.fromEntries(ENGINES.map((e, i) => [e.id, rng(97 * (metricIndex + 1) + i)]));
  for (let d = 0; d < DAYS; d++) {
    const t = d / (DAYS - 1);
    const point = {
      date: new Date(END - (DAYS - 1 - d) * 86_400_000).toISOString().slice(0, 10),
    } as Point;
    for (const e of ENGINES) {
      const [from, to] = SHAPE[e.id][metricIndex];
      const isPosition = metricIndex === 2;
      const jitter = (noise[e.id]() - 0.5) * (isPosition ? 0.35 : 5);
      const v = from + (to - from) * t + jitter;
      point[e.id] = isPosition ? Math.round(v * 10) / 10 : Math.max(0, Math.round(v));
    }
    out.push(point);
  }
  return out;
}

export const SERIES: Record<MetricId, Point[]> = {
  mention: buildSeries(0),
  sov: buildSeries(1),
  position: buildSeries(2),
  owned: buildSeries(3),
};

const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** Average across engines for the last and first 7 days, for the KPI delta. */
export function summary(metric: MetricId) {
  const s = SERIES[metric];
  const across = (p: Point) => avg(ENGINES.map((e) => p[e.id]));
  const current = avg(s.slice(-7).map(across));
  const previous = avg(s.slice(0, 7).map(across));
  return { current, change: current - previous };
}

export function engineAverages(metric: MetricId) {
  const s = SERIES[metric].slice(-7);
  return ENGINES.map((e) => ({ engine: e, value: avg(s.map((p) => p[e.id])) }));
}

/* ── lists for the cards ──────────────────────────────────── */

export const COMPETITORS = [
  { name: "Zoho Invoice", domain: "zoho.com", sov: 31, mentions: 412 },
  { name: "Ledgerly", domain: "ledgerly.app", sov: 24, mentions: 318, you: true },
  { name: "FreshBooks", domain: "freshbooks.com", sov: 19, mentions: 251 },
  { name: "Wave", domain: "waveapps.com", sov: 14, mentions: 186 },
  { name: "Refrens", domain: "refrens.com", sov: 8, mentions: 104 },
  { name: "Invoice2go", domain: "invoice2go.com", sov: 4, mentions: 53 },
];

export const PROMPTS = [
  { text: "best invoicing software for freelancers", rate: 58 },
  { text: "Ledgerly vs FreshBooks", rate: 92 },
  { text: "free invoice generator with GST", rate: 12 },
  { text: "how to send recurring invoices", rate: 34 },
  { text: "invoicing app that accepts UPI", rate: 7 },
  { text: "alternatives to Zoho Invoice", rate: 41 },
  { text: "best app to track unpaid invoices", rate: 22 },
  { text: "multi-currency invoicing for agencies", rate: 47 },
  { text: "invoice software with time tracking", rate: 18 },
];

export type CitationKind = "owned" | "competitor" | "third_party";

export const CITED_DOMAINS: { domain: string; count: number; kind: CitationKind }[] = [
  { domain: "nerdwallet.com", count: 41, kind: "third_party" },
  { domain: "reddit.com", count: 33, kind: "third_party" },
  { domain: "thewritelife.com", count: 21, kind: "third_party" },
  { domain: "waveapps.com", count: 18, kind: "competitor" },
  { domain: "wise.com", count: 15, kind: "third_party" },
  { domain: "business.org", count: 12, kind: "third_party" },
  { domain: "zoho.com", count: 11, kind: "competitor" },
  { domain: "ledgerly.app", count: 8, kind: "owned" },
  { domain: "billdu.com", count: 9, kind: "third_party" },
  { domain: "indietoolkit.in", count: 6, kind: "third_party" },
];

export const CITED_PAGES = [
  { url: "nerdwallet.com/business/software/best/invoicing-software", count: 24 },
  { url: "reddit.com/r/software/comments/what_invoicing_software", count: 17 },
  { url: "thewritelife.com/invoicing-systems", count: 15 },
  { url: "waveapps.com/invoicing", count: 12 },
  { url: "ledgerly.app/pricing", count: 6 },
  { url: "business.org/finance/accounting/best-billing-software", count: 9 },
  { url: "indietoolkit.in/best-invoicing-software", count: 6 },
];

export const FREE_TIER = { used: 1_348, limit: 5_000, resets: "1 Nov" };
