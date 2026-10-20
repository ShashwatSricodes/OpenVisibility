/** Labels and formats shared by the Runs list and a run's page. */

export const STATUS: Record<string, { label: string; style: string }> = {
  queued: { label: "Queued", style: "bg-pressed text-fg-default" },
  running: {
    label: "Running",
    style: "bg-[color-mix(in_srgb,var(--series-1)_14%,transparent)] text-[var(--series-1)]",
  },
  completed: {
    label: "Completed",
    style: "bg-[color-mix(in_srgb,var(--good)_12%,transparent)] text-good",
  },
  partial: {
    label: "Partly done",
    style: "bg-[color-mix(in_srgb,var(--series-4)_16%,transparent)] text-[var(--series-4)]",
  },
  failed: { label: "Failed", style: "bg-[color-mix(in_srgb,var(--bad)_12%,transparent)] text-bad" },
  canceled: { label: "Canceled", style: "bg-pressed text-fg-subtle" },
  skipped: { label: "Skipped", style: "bg-pressed text-fg-subtle" },
};

export const when = (d: Date) =>
  d.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  }) + " UTC";

export function duration(start: Date | null, end: Date | null) {
  if (!start) return "–";
  const s = Math.round(((end ?? new Date()).getTime() - start.getTime()) / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

export const usd = (v: string | number) => `$${Number(v).toFixed(4)}`;

export const isActive = (status: string) => status === "queued" || status === "running";

/**
 * The note worth showing: why a run stopped short, was skipped, or can't go
 * on. Passing hiccups the worker handles itself ("Retrying shortly") aren't.
 */
export function visibleNote(run: { status: string; note: string | null }) {
  if (!run.note || run.note.endsWith("Retrying shortly.")) return null;
  return ["partial", "failed", "skipped"].includes(run.status) ? run.note : null;
}
