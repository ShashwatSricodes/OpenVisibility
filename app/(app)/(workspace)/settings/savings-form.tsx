"use client";

import { useState, useTransition } from "react";
import { CheckCircle2, CircleAlert } from "lucide-react";
import {
  DEFAULT_CACHE_HOURS,
  MAX_CACHE_HOURS,
  SAMPLING_DECIDES_FROM,
  type SavingsSettings,
} from "@/core/savings";
import { cn } from "../../_lib/cn";
import { saveSavingsAction, type KeyFormState } from "./actions";

const checkbox = "mt-0.5 size-4 shrink-0 accent-[var(--fg)]";

export function SavingsForm({
  savings: saved,
  samples,
  canEdit,
}: {
  savings: SavingsSettings;
  samples: number;
  canEdit: boolean;
}) {
  const [cache, setCache] = useState(saved.cacheHours !== null);
  const [hours, setHours] = useState(String(saved.cacheHours ?? DEFAULT_CACHE_HOURS));
  const [scheduled, setScheduled] = useState(saved.cacheScheduled);
  const [sampling, setSampling] = useState(saved.smartSampling);
  const [result, setResult] = useState<KeyFormState>(null);
  const [pending, start] = useTransition();

  const settings: SavingsSettings = {
    cacheHours: cache ? Number(hours) : null,
    cacheScheduled: scheduled,
    smartSampling: sampling,
  };
  const valid =
    settings.cacheHours === null ||
    (Number.isInteger(settings.cacheHours) &&
      settings.cacheHours >= 1 &&
      settings.cacheHours <= MAX_CACHE_HOURS);
  const changed =
    settings.cacheHours !== saved.cacheHours ||
    settings.cacheScheduled !== saved.cacheScheduled ||
    settings.smartSampling !== saved.smartSampling;
  const changing =
    <T,>(set: (v: T) => void) =>
    (v: T) => {
      setResult(null);
      set(v);
    };

  return (
    <div className="flex flex-col">
      <div className="px-5 py-4">
        <label className="flex items-start gap-3 text-[13px]">
          <input
            type="checkbox"
            checked={cache}
            disabled={!canEdit}
            onChange={(e) => changing(setCache)(e.target.checked)}
            className={checkbox}
          />
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-medium">Reuse answers up to</span>
            <input
              type="number"
              min={1}
              max={MAX_CACHE_HOURS}
              inputMode="numeric"
              aria-label="Reuse answers up to this many hours old"
              value={hours}
              disabled={!canEdit || !cache}
              onChange={(e) => changing(setHours)(e.target.value)}
              className="h-7 w-16 rounded-lg border border-line bg-panel px-2 text-[13px] tabular text-fg outline-none focus:border-line-strong focus:ring-2 focus:ring-line disabled:opacity-50"
            />
            <span className="font-medium">hours old</span>
          </span>
        </label>
        <p className="ml-7 mt-1 text-xs text-fg-subtle">
          When Run now asks a prompt that was asked of the same engine in the same country that
          recently, the earlier answer is copied in for free. Test runs always ask fresh.
        </p>
        <label className="ml-7 mt-2 flex items-start gap-2 text-[13px]">
          <input
            type="checkbox"
            checked={scheduled}
            disabled={!canEdit || !cache}
            onChange={(e) => changing(setScheduled)(e.target.checked)}
            className={checkbox}
          />
          <span className={cn(!cache && "opacity-50")}>
            Scheduled runs too
            <span className="block text-xs text-fg-subtle">
              Off by default: tracking over time needs fresh answers.
            </span>
          </span>
        </label>
      </div>

      <div className="border-t border-line px-5 py-4">
        <label className="flex items-start gap-3 text-[13px]">
          <input
            type="checkbox"
            checked={sampling}
            disabled={!canEdit}
            onChange={(e) => changing(setSampling)(e.target.checked)}
            className={checkbox}
          />
          <span>
            <span className="font-medium">Smart sampling</span>
            <span className="mt-1 block text-xs text-fg-subtle">
              Ask each prompt twice first. If both answers name your brand, or neither does, skip
              the remaining samples and count them the same way. Runs take a little longer, since
              the rest wait for the first two.
              {samples <= SAMPLING_DECIDES_FROM &&
                ` It only saves answers with more than ${SAMPLING_DECIDES_FROM} samples; you ask ${samples}.`}
            </span>
          </span>
        </label>
      </div>

      {canEdit && (
        <div className="flex items-center gap-3 border-t border-line px-5 py-3">
          <button
            type="button"
            disabled={pending || !changed || !valid}
            onClick={() => start(async () => setResult(await saveSavingsAction(settings)))}
            className="flex h-8 items-center justify-center rounded-lg bg-inverted px-3 text-[13px] font-medium text-on-inverted transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {pending ? "Saving…" : "Save"}
          </button>
          {result && (
            <p
              role="status"
              className={cn(
                "flex items-center gap-1.5 text-[13px]",
                result.ok ? "text-good" : "text-bad",
              )}
            >
              {result.ok ? (
                <CheckCircle2 className="size-3.5 shrink-0" />
              ) : (
                <CircleAlert className="size-3.5 shrink-0" />
              )}
              {result.message}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
