/** How each Overview KPI is labelled, formatted and compared; shared by server and client. */

import type { Kpi, KpiId } from "@/core/overview";
import type { EngineId } from "@/core/providers/types";

export type KpiInfo = {
  label: string;
  hint: string;
  invert?: boolean;
  format: (v: number) => string;
};

export const KPI: Record<KpiId, KpiInfo> = {
  mention: {
    label: "Mention rate",
    hint: "Share of answers that name your brand",
    format: (v) => `${Math.round(v)}%`,
  },
  position: {
    label: "Avg. position",
    hint: "Where you appear among the tracked brands an answer names; 1 is first",
    invert: true,
    format: (v) => `#${v.toFixed(1)}`,
  },
  sov: {
    label: "Share of voice",
    hint: "Your mentions as a share of all tracked brands' mentions",
    format: (v) => `${Math.round(v)}%`,
  },
  owned: {
    label: "Owned citations",
    hint: "Citations pointing to your own site",
    format: (v) => `${Math.round(v)}%`,
  },
  sentiment: {
    label: "Sentiment",
    hint: "How answers talk about you, from -1 to 1",
    format: (v) => (v > 0 ? `+${v.toFixed(2)}` : v.toFixed(2)),
  },
};

/** The change from the previous period, and whether it's good news. */
export function change(id: KpiId, k: Pick<Kpi, "value" | "previous">) {
  if (k.value === null || k.previous === null) return null;
  const d = k.value - k.previous;
  const pct = id === "mention" || id === "sov" || id === "owned";
  const shown = pct ? Math.round(d) : Number(d.toFixed(id === "sentiment" ? 2 : 1));
  if (shown === 0) return { text: "no change", tone: "flat" as const, delta: 0 };
  const better = KPI[id].invert ? d < 0 : d > 0;
  const sign = shown > 0 ? "+" : "−";
  const abs = Math.abs(shown);
  return {
    text: pct ? `${sign}${abs} pts` : `${sign}${abs}`,
    tone: better ? ("up" as const) : ("down" as const),
    delta: d,
  };
}

/* an engine keeps its colour on every chart */
export const ENGINE_COLOR: Record<EngineId, string> = {
  chatgpt: "var(--series-1)",
  gemini: "var(--series-2)",
  ai_mode: "var(--series-3)",
  ai_overviews: "var(--series-4)",
  perplexity: "var(--series-5)",
  copilot: "var(--series-6)",
  claude: "var(--series-6)",
  grok: "var(--series-6)",
};
