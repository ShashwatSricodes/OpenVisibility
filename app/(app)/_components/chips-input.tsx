"use client";

import { useId, useState } from "react";
import { X } from "lucide-react";
import { cn } from "../_lib/cn";

/**
 * A list of short values as chips. Type and press Enter or comma to add;
 * paste "a, b, c" to add several; Backspace on an empty field removes the last.
 */
export function ChipsInput({
  label,
  value,
  onChange,
  placeholder,
  normalize = (v) => v.trim(),
  check,
  max = 10,
  hint,
  disabled,
}: {
  label: string;
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  /** applied to each value before it's added, e.g. reducing a URL to its domain */
  normalize?: (v: string) => string;
  /** returns a message when a value can't be added */
  check?: (v: string) => string | null;
  max?: number;
  hint?: string;
  disabled?: boolean;
}) {
  const id = useId();
  const [draft, setDraft] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  const add = (raw: string) => {
    const parts = raw.split(/[,\n]/).map(normalize).filter(Boolean);
    if (!parts.length) return;
    const next = [...value];
    for (const v of parts) {
      const issue = check?.(v);
      if (issue) {
        setProblem(issue);
        setDraft(v);
        return;
      }
      if (next.length >= max) {
        setProblem(`At most ${max}.`);
        break;
      }
      if (!next.some((x) => x.toLowerCase() === v.toLowerCase())) next.push(v);
    }
    onChange(next);
    setDraft("");
    setProblem(null);
  };

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[13px] font-medium text-fg-default">
        {label}
      </label>
      <div
        className={cn(
          "flex min-h-8 flex-wrap items-center gap-1 rounded-lg border border-line bg-panel px-1.5 py-1 transition-colors focus-within:border-line-strong focus-within:ring-2 focus-within:ring-line",
          problem && "border-bad",
          disabled && "opacity-60",
        )}
      >
        {value.map((v) => (
          <span
            key={v}
            className="inline-flex h-6 items-center gap-1 rounded-md bg-pressed pl-2 pr-1 text-xs text-fg"
          >
            {v}
            {!disabled && (
              <button
                type="button"
                aria-label={`Remove ${v}`}
                onClick={() => onChange(value.filter((x) => x !== v))}
                className="rounded p-0.5 text-fg-muted hover:bg-line hover:text-fg"
              >
                <X className="size-3" />
              </button>
            )}
          </span>
        ))}
        <input
          id={id}
          value={draft}
          disabled={disabled}
          onChange={(e) => {
            setProblem(null);
            if (/[,\n]/.test(e.target.value)) add(e.target.value);
            else setDraft(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add(draft);
            } else if (e.key === "Backspace" && !draft && value.length) {
              onChange(value.slice(0, -1));
            }
          }}
          onBlur={() => draft && add(draft)}
          placeholder={value.length ? "" : placeholder}
          className="h-6 min-w-[8rem] flex-1 bg-transparent px-1 text-[13px] text-fg outline-none placeholder:text-fg-muted"
        />
      </div>
      {problem ? (
        <p className="text-xs text-bad">{problem}</p>
      ) : (
        hint && <p className="text-xs text-fg-muted">{hint}</p>
      )}
    </div>
  );
}
