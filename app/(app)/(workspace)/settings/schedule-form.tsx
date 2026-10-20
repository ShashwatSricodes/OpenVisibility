"use client";

import { useEffect, useState, useTransition } from "react";
import { CheckCircle2, CircleAlert, TriangleAlert } from "lucide-react";
import {
  RUNS_PER_MONTH,
  WEEKDAYS,
  formatInZone,
  nextRunAt,
  parseTimeOfDay,
  timeOfDay,
  type Frequency,
  type Schedule,
} from "@/core/schedule-rules";
import { cn } from "../../_lib/cn";
import { saveScheduleAction, type KeyFormState } from "./actions";

const n = (v: number) => Math.round(v).toLocaleString("en-US");

const FREQUENCIES: { id: Frequency; label: string }[] = [
  { id: "off", label: "Off" },
  { id: "daily", label: "Daily" },
  { id: "weekly", label: "Weekly" },
];

const field =
  "h-8 rounded-lg border border-line bg-panel px-2.5 text-[13px] text-fg outline-none focus:border-line-strong focus:ring-2 focus:ring-line disabled:opacity-50";

export function ScheduleForm({
  schedule: saved,
  answersPerRun,
  cap,
  canEdit,
}: {
  schedule: Schedule;
  answersPerRun: number;
  cap: number | null;
  canEdit: boolean;
}) {
  const [frequency, setFrequency] = useState(saved.frequency);
  const [time, setTime] = useState(timeOfDay(saved.minute));
  const [weekday, setWeekday] = useState(saved.weekday);
  const [timezone, setTimezone] = useState(saved.timezone);
  const [zones, setZones] = useState<string[]>([saved.timezone]);
  const [result, setResult] = useState<KeyFormState>(null);
  const [pending, start] = useTransition();

  // after hydration: the full list, and the browser's own zone for a schedule never set
  useEffect(() => {
    const all = Intl.supportedValuesOf("timeZone");
    setZones(all.includes("UTC") ? all : ["UTC", ...all]);
    if (saved.frequency === "off" && saved.timezone === "UTC")
      setTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone);
  }, [saved.frequency, saved.timezone]);

  const minute = parseTimeOfDay(time);
  const schedule: Schedule | null =
    minute === null ? null : { frequency, minute, weekday, timezone };
  const changed =
    frequency !== saved.frequency ||
    (frequency !== "off" &&
      (minute !== saved.minute ||
        timezone !== saved.timezone ||
        (frequency === "weekly" && weekday !== saved.weekday)));
  const next = schedule ? nextRunAt(schedule, new Date()) : null;
  const perMonth = answersPerRun * RUNS_PER_MONTH[frequency];

  const reset = () => setResult(null);

  return (
    <div className="flex flex-col gap-3 px-5 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <div
          role="radiogroup"
          aria-label="How often"
          className="flex rounded-lg border border-line p-0.5"
        >
          {FREQUENCIES.map((f) => (
            <button
              key={f.id}
              type="button"
              role="radio"
              aria-checked={frequency === f.id}
              disabled={!canEdit}
              onClick={() => {
                reset();
                setFrequency(f.id);
              }}
              className={cn(
                "h-7 rounded-md px-3 text-[13px] transition-colors disabled:cursor-not-allowed",
                frequency === f.id
                  ? "bg-inverted font-medium text-on-inverted"
                  : "text-fg-subtle hover:bg-hover hover:text-fg",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        {frequency === "weekly" && (
          <select
            aria-label="Day of the week"
            value={weekday}
            disabled={!canEdit}
            onChange={(e) => {
              reset();
              setWeekday(Number(e.target.value));
            }}
            className={field}
          >
            {WEEKDAYS.map((d, i) => (
              <option key={d} value={i}>
                on {d}
              </option>
            ))}
          </select>
        )}
        {frequency !== "off" && (
          <>
            <span className="text-[13px] text-fg-subtle">at</span>
            <input
              type="time"
              aria-label="Time of day"
              value={time}
              disabled={!canEdit}
              onChange={(e) => {
                reset();
                setTime(e.target.value);
              }}
              className={cn(field, "tabular")}
            />
            <select
              aria-label="Timezone"
              value={timezone}
              disabled={!canEdit}
              onChange={(e) => {
                reset();
                setTimezone(e.target.value);
              }}
              className={cn(field, "max-w-[220px]")}
            >
              {zones.map((z) => (
                <option key={z} value={z}>
                  {z.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </>
        )}
      </div>

      {frequency !== "off" && (
        <p className="text-xs text-fg-subtle">
          {next ? (
            <>
              Next run <span className="font-medium text-fg">{formatInZone(next, timezone)}</span>
              {". "}
            </>
          ) : null}
          {answersPerRun > 0
            ? `About ${n(answersPerRun)} answers a run, ${n(perMonth)} a month.`
            : "Add prompts so scheduled runs have something to ask."}
        </p>
      )}
      {frequency !== "off" && cap !== null && perMonth > cap && (
        <p className="flex items-start gap-1.5 text-xs text-[var(--series-4)]">
          <TriangleAlert className="mt-px size-3.5 shrink-0" />
          That&rsquo;s more than your monthly limit of {n(cap)}. Runs that won&rsquo;t fit are
          skipped, and the Runs page says so.
        </p>
      )}

      {canEdit && (
        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={pending || !changed || !schedule}
            onClick={() =>
              schedule && start(async () => setResult(await saveScheduleAction(schedule)))
            }
            className="flex h-8 items-center justify-center rounded-lg bg-inverted px-3 text-[13px] font-medium text-on-inverted transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {pending ? "Saving…" : "Save schedule"}
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
