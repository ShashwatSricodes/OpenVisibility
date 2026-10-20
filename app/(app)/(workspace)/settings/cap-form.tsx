"use client";

import { useState, useTransition } from "react";
import { CheckCircle2, CircleAlert } from "lucide-react";
import { BRIGHT_DATA_PRICING } from "@/core/providers/registry";
import { cn } from "../../_lib/cn";
import { saveCapAction, type KeyFormState } from "./actions";

const n = (v: number) => v.toLocaleString("en-US");

/** The monthly answer limit: a number, or none. */
export function CapForm({
  cap: savedCap,
  used,
  canEdit,
}: {
  cap: number | null;
  used: number;
  canEdit: boolean;
}) {
  const [limited, setLimited] = useState(savedCap !== null);
  const [value, setValue] = useState(String(savedCap ?? BRIGHT_DATA_PRICING.freeAnswersPerMonth));
  const [result, setResult] = useState<KeyFormState>(null);
  const [pending, start] = useTransition();

  const cap = limited ? Number(value) : null;
  const valid = cap === null || (Number.isInteger(cap) && cap >= 1);
  const changed = cap !== savedCap;
  const paid = cap === null ? null : Math.max(0, cap - BRIGHT_DATA_PRICING.freeAnswersPerMonth);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <label className="inline-flex items-center gap-2 text-[13px]">
          <input
            type="checkbox"
            checked={limited}
            disabled={!canEdit}
            onChange={(e) => {
              setResult(null);
              setLimited(e.target.checked);
            }}
            className="size-4 accent-[var(--fg)]"
          />
          Limit to
        </label>
        <input
          type="number"
          min={1}
          step={100}
          inputMode="numeric"
          aria-label="Monthly answer limit"
          disabled={!canEdit || !limited}
          value={value}
          onChange={(e) => {
            setResult(null);
            setValue(e.target.value);
          }}
          className="h-8 w-28 rounded-lg border border-line bg-panel px-3 text-[13px] tabular text-fg outline-none focus:border-line-strong focus:ring-2 focus:ring-line disabled:opacity-50"
        />
        <span className="text-[13px] text-fg-subtle">answers a month</span>
        {canEdit && (
          <button
            type="button"
            disabled={pending || !changed || !valid}
            onClick={() => start(async () => setResult(await saveCapAction(cap)))}
            className="flex h-8 items-center justify-center rounded-lg bg-inverted px-3 text-[13px] font-medium text-on-inverted transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {pending ? "Saving…" : "Save limit"}
          </button>
        )}
      </div>
      <p className="text-xs text-fg-subtle">
        {cap === null
          ? `No limit: runs can go past the free ${n(BRIGHT_DATA_PRICING.freeAnswersPerMonth)} answers, at $${BRIGHT_DATA_PRICING.perAnswerUsd} each.`
          : paid
            ? `Up to ${n(paid)} answers past the free tier: at most about $${(paid * BRIGHT_DATA_PRICING.perAnswerUsd).toFixed(2)} a month.`
            : "Within Bright Data's free tier, so this workspace alone can't push you into paying."}{" "}
        This workspace has used {n(used)} this month. A run that won&rsquo;t fit isn&rsquo;t
        started, and one in progress stops at the limit.
      </p>
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
  );
}
