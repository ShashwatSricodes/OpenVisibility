"use client";

import { useMemo, useState, useTransition } from "react";
import { Check, CheckCircle2, CircleAlert, Minus, Plus, TriangleAlert, X } from "lucide-react";
import { COUNTRIES, countryName } from "@/core/countries";
import { ENGINES, type EngineInfo } from "@/core/providers/registry";
import type { EngineId } from "@/core/providers/types";
import {
  DEFAULT_SAMPLES,
  MAX_COUNTRIES,
  MAX_SAMPLES,
  answersPerPrompt,
  trackingWarnings,
} from "@/core/tracking-rules";
import { cn } from "../../_lib/cn";
import { saveTrackingAction, type KeyFormState } from "./actions";

const STATUS_LABEL: Record<EngineInfo["status"], string> = {
  available: "Available",
  unreliable: "Unreliable",
  unavailable: "Not yet",
};

const STATUS_STYLE: Record<EngineInfo["status"], string> = {
  available: "bg-[color-mix(in_srgb,var(--good)_12%,transparent)] text-good",
  unreliable: "bg-[color-mix(in_srgb,var(--series-4)_16%,transparent)] text-[var(--series-4)]",
  unavailable: "bg-pressed text-fg-subtle",
};

const sameSet = (a: string[], b: string[]) =>
  a.length === b.length && a.every((x) => b.includes(x));

export function TrackingForm({
  engines: savedEngines,
  countries: savedCountries,
  samples: savedSamples,
  canEdit,
}: {
  engines: EngineId[];
  countries: string[];
  samples: number;
  canEdit: boolean;
}) {
  const [engines, setEngines] = useState<EngineId[]>(savedEngines);
  const [countries, setCountries] = useState<string[]>(savedCountries);
  const [samples, setSamples] = useState(savedSamples);
  const [result, setResult] = useState<KeyFormState>(null);
  const [pending, start] = useTransition();

  const config = { engines, countries, samples };
  const warnings = useMemo(
    () => trackingWarnings({ engines, countries, samples }),
    [engines, countries, samples],
  );
  const changed =
    !sameSet(engines, savedEngines) ||
    !sameSet(countries, savedCountries) ||
    samples !== savedSamples;
  const addable = COUNTRIES.filter((c) => !countries.includes(c.code));

  const toggle = (id: EngineId) => {
    setResult(null);
    setEngines((list) => (list.includes(id) ? list.filter((e) => e !== id) : [...list, id]));
  };

  const save = () =>
    start(async () => {
      setResult(await saveTrackingAction(config));
    });

  return (
    <div className="flex flex-col">
      {/* engines */}
      <div className="px-5 py-4">
        <h3 className="text-[13px] font-medium">Engines</h3>
        <ul className="mt-2 divide-y divide-line rounded-lg border border-line">
          {Object.values(ENGINES).map((e) => {
            const disabled = !canEdit || e.provider === null;
            const on = engines.includes(e.id);
            return (
              <li key={e.id}>
                <label
                  className={cn(
                    "flex items-start gap-3 px-3 py-2.5",
                    disabled ? "cursor-not-allowed" : "cursor-pointer hover:bg-hover",
                  )}
                >
                  <input
                    type="checkbox"
                    className="peer sr-only"
                    checked={on}
                    disabled={disabled}
                    onChange={() => toggle(e.id)}
                  />
                  <span
                    aria-hidden="true"
                    className={cn(
                      "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-line-strong",
                      on ? "border-inverted bg-inverted text-on-inverted" : "border-line-strong",
                      disabled && "opacity-40",
                    )}
                  >
                    {on && <Check className="size-3" strokeWidth={3} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span
                        className={cn(
                          "text-[13px] font-medium",
                          e.provider === null && "text-fg-subtle",
                        )}
                      >
                        {e.name}
                      </span>
                      <span className="text-xs text-fg-muted">{e.maker}</span>
                      <span
                        className={cn(
                          "rounded px-1.5 py-px text-[11px] font-medium",
                          STATUS_STYLE[e.status],
                        )}
                      >
                        {STATUS_LABEL[e.status]}
                      </span>
                    </span>
                    {e.note && (
                      <span className="mt-0.5 block text-xs text-fg-subtle">{e.note}</span>
                    )}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      </div>

      {/* countries */}
      <div className="border-t border-line px-5 py-4">
        <h3 className="text-[13px] font-medium">Countries</h3>
        <p className="mt-0.5 text-xs text-fg-subtle">
          Each prompt is asked from each country, unless the prompt picks its own.
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {countries.map((code) => (
            <span
              key={code}
              className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-line pl-2.5 pr-1.5 text-[13px]"
            >
              <span className="font-mono text-[11px] text-fg-subtle">{code}</span>
              {countryName(code)}
              {canEdit && (
                <button
                  type="button"
                  aria-label={`Remove ${countryName(code)}`}
                  onClick={() => {
                    setResult(null);
                    setCountries((list) => list.filter((c) => c !== code));
                  }}
                  className="rounded p-0.5 text-fg-muted hover:bg-pressed hover:text-fg"
                >
                  <X className="size-3" />
                </button>
              )}
            </span>
          ))}
          {canEdit && addable.length > 0 && countries.length < MAX_COUNTRIES && (
            <label className="relative inline-flex h-7 items-center gap-1 rounded-lg border border-dashed border-line-strong px-2.5 text-[13px] text-fg-subtle hover:text-fg">
              <Plus className="size-3.5" />
              Add country
              <select
                aria-label="Add country"
                value=""
                onChange={(ev) => {
                  if (!ev.target.value) return;
                  setResult(null);
                  setCountries((list) => [...list, ev.target.value]);
                }}
                className="absolute inset-0 cursor-pointer opacity-0"
              >
                <option value="">Add country</option>
                {addable.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      </div>

      {/* samples */}
      <div className="flex flex-col gap-3 border-t border-line px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-[13px] font-medium">Times each prompt is asked</h3>
          <p className="mt-0.5 max-w-md text-xs text-fg-subtle">
            AI answers change from one ask to the next. Asking {DEFAULT_SAMPLES}× per run turns
            &ldquo;mentioned or not&rdquo; into a reliable rate; more is steadier but uses more
            answers.
          </p>
        </div>
        <div className="flex shrink-0 items-center rounded-lg border border-line">
          <button
            type="button"
            aria-label="Ask fewer times"
            disabled={!canEdit || samples <= 1}
            onClick={() => {
              setResult(null);
              setSamples((n) => n - 1);
            }}
            className="flex size-8 items-center justify-center text-fg-subtle hover:text-fg disabled:opacity-40"
          >
            <Minus className="size-3.5" />
          </button>
          <span className="tabular w-10 text-center text-[13px] font-medium" aria-live="polite">
            {samples}×
          </span>
          <button
            type="button"
            aria-label="Ask more times"
            disabled={!canEdit || samples >= MAX_SAMPLES}
            onClick={() => {
              setResult(null);
              setSamples((n) => n + 1);
            }}
            className="flex size-8 items-center justify-center text-fg-subtle hover:text-fg disabled:opacity-40"
          >
            <Plus className="size-3.5" />
          </button>
        </div>
      </div>

      {/* summary, warnings and save */}
      <div className="flex flex-col gap-3 border-t border-line px-5 py-4">
        <p className="text-xs text-fg-subtle">
          {engines.length} {engines.length === 1 ? "engine" : "engines"} × {countries.length}{" "}
          {countries.length === 1 ? "country" : "countries"} × {samples}{" "}
          {samples === 1 ? "ask" : "asks"} ={" "}
          <span className="font-medium text-fg">
            {answersPerPrompt(config)} {answersPerPrompt(config) === 1 ? "answer" : "answers"}
          </span>{" "}
          per prompt each run.
        </p>

        {warnings.length > 0 && (
          <ul className="flex flex-col gap-1">
            {warnings.map((w) => (
              <li key={w} className="flex items-start gap-1.5 text-xs text-fg-default">
                <TriangleAlert className="mt-px size-3.5 shrink-0 text-[var(--series-4)]" />
                {w}
              </li>
            ))}
          </ul>
        )}

        {canEdit ? (
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={save}
              disabled={pending || !changed || engines.length === 0 || countries.length === 0}
              className="flex h-8 items-center justify-center rounded-lg bg-inverted px-3 text-[13px] font-medium text-on-inverted transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              {pending ? "Saving…" : "Save changes"}
            </button>
            {engines.length === 0 && (
              <span className="text-xs text-bad">Pick at least one engine.</span>
            )}
            {countries.length === 0 && (
              <span className="text-xs text-bad">Pick at least one country.</span>
            )}
            {result && (
              <span
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
              </span>
            )}
          </div>
        ) : (
          <p className="text-xs text-fg-subtle">
            Only the workspace owner can change what&rsquo;s tracked.
          </p>
        )}
      </div>
    </div>
  );
}
