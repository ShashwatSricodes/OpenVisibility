import { CheckCircle2, TriangleAlert } from "lucide-react";
import {
  checkFreeTier,
  daysLeftInMonth,
  type FreeTierCheck,
  type RunEstimate,
} from "@/core/estimate";
import type { TrackingConfig } from "@/core/tracking-rules";
import type { FreeTierUsage } from "@/core/usage";
import { cn } from "../../_lib/cn";

const n = (v: number) => v.toLocaleString("en-US");
const plural = (v: number, one: string, many = `${one}s`) => `${n(v)} ${v === 1 ? one : many}`;
const usd = (v: number) => `$${v < 1 ? v.toFixed(2) : v.toFixed(0)}`;

function Fit({ check, label }: { check: FreeTierCheck; label: string }) {
  return check.fits ? (
    <p className="flex items-start gap-1.5 text-xs text-fg-default">
      <CheckCircle2 className="mt-px size-3.5 shrink-0 text-good" />
      {label} fits, leaving {plural(check.after, "free answer")} this month.
    </p>
  ) : (
    <p className="flex items-start gap-1.5 text-xs text-fg-default">
      <TriangleAlert className="mt-px size-3.5 shrink-0 text-[var(--series-4)]" />
      {label} goes past the free tier by {plural(check.overBy, "answer")}, about{" "}
      {usd(check.costUsd)} at Bright Data&rsquo;s pay-as-you-go price.
    </p>
  );
}

export function UsageSection({
  usage,
  estimate,
  config,
}: {
  usage: FreeTierUsage;
  estimate: RunEstimate;
  config: TrackingConfig;
}) {
  const used = usage.used;
  const pct = used === null ? 0 : Math.min(100, Math.round((used / usage.limit) * 100));
  const resets = new Date(usage.resetsAt).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
  const days = daysLeftInMonth();
  const run = used === null ? null : checkFreeTier(estimate.answers, used, usage.limit);
  const daily = used === null ? null : checkFreeTier(estimate.answers * days, used, usage.limit);

  return (
    <section className="rounded-xl border border-line bg-panel">
      <div className="border-b border-line px-5 py-4">
        <h2 className="text-sm font-semibold">Usage this month</h2>
        <p className="mt-1 text-[13px] text-fg-subtle">
          {usage.keySource === "workspace"
            ? "Counted by Bright Data for your account, so it includes answers asked outside OpenVisibility."
            : usage.keySource === "server"
              ? "Counted by Bright Data for the server's account, which every workspace without its own key shares."
              : "Add a Bright Data key to see usage."}
        </p>
      </div>

      <div className="flex flex-col gap-4 px-5 py-4">
        {usage.keySource && (
          <div>
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-[13px]">
                <span className="tabular text-base font-semibold">
                  {used === null ? "–" : n(used)}
                </span>{" "}
                <span className="text-fg-subtle">of {n(usage.limit)} free answers used</span>
              </p>
              <p className="text-xs text-fg-subtle">
                Resets {resets} ({plural(days, "day")})
              </p>
            </div>
            <div
              className="mt-2 h-2 overflow-hidden rounded-full bg-pressed"
              role="progressbar"
              aria-valuenow={pct}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Bright Data free tier used"
            >
              <div
                className={cn(
                  "h-full rounded-full",
                  pct >= 100 ? "bg-bad" : pct >= 80 ? "bg-[var(--series-4)]" : "bg-fg",
                )}
                style={{ width: `${pct}%` }}
              />
            </div>
            <p className="mt-1.5 text-xs text-fg-subtle">
              {usage.error ??
                `This workspace used ${plural(usage.workspaceUsed, "answer")} of these. Failed answers aren't counted.`}
            </p>
          </div>
        )}

        <div className="rounded-lg border border-line px-3.5 py-3">
          <h3 className="text-[13px] font-medium">What a run uses</h3>
          {estimate.prompts === 0 ? (
            <p className="mt-1 text-xs text-fg-subtle">
              Add prompts to see how many answers a run uses.
            </p>
          ) : (
            <div className="mt-1 flex flex-col gap-1.5">
              <p className="text-xs text-fg-subtle">
                <span className="font-medium text-fg">{plural(estimate.answers, "answer")}</span>{" "}
                per run: {plural(estimate.prompts, "active prompt")} on{" "}
                {plural(config.engines.length, "engine")}, in{" "}
                {plural(config.countries.length, "country", "countries")} (or each prompt&rsquo;s
                own), each asked {config.samples}×.
              </p>
              {run && <Fit check={run} label="One run" />}
              {daily && (
                <Fit
                  check={daily}
                  label={`Running daily until the reset (${plural(days, "run")}, ${plural(estimate.answers * days, "answer")})`}
                />
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
