"use client";

import { useEffect, useState, useTransition } from "react";
import { ArrowLeft, Check, CircleAlert, Plus, RefreshCw, Sparkles } from "lucide-react";
import { checkPromptText, cleanPromptText } from "@/core/prompt-rules";
import type { Suggestion } from "@/core/prompt-suggest";
import { buttonPrimary, buttonSecondary } from "../_components/page-frame";
import { cn } from "../_lib/cn";
import { savePromptsAction, suggestPromptsAction } from "./actions";

const RECOMMENDED = 10;

type Row = Suggestion & { id: number; on: boolean };

const tagStyle = (t: string) =>
  t === "branded"
    ? "bg-[color-mix(in_srgb,var(--series-1)_14%,transparent)] text-[var(--series-1)]"
    : t === "non-branded"
      ? "bg-pressed text-fg-subtle"
      : "bg-pressed text-fg-default";

export function PromptsStep({
  brandName,
  canEdit,
  onBack,
  onDone,
}: {
  brandName: string;
  canEdit: boolean;
  onBack: () => void;
  onDone: (total: number) => void;
}) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [meta, setMeta] = useState<{ source: string; note?: string; existing: number } | null>(
    null,
  );
  const [draft, setDraft] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [loading, startLoading] = useTransition();
  const [saving, startSaving] = useTransition();

  const load = () =>
    startLoading(async () => {
      const r = await suggestPromptsAction();
      if (!r.ok) return setProblem(r.message);
      setProblem(null);
      setMeta({ source: r.source, note: r.note, existing: r.existing });
      setRows(r.suggestions.map((s, id) => ({ ...s, id, on: true })));
    });

  // suggestions load when the step opens
  useEffect(load, []);

  const chosen = rows?.filter((r) => r.on) ?? [];
  const total = (meta?.existing ?? 0) + chosen.length;

  const add = () => {
    const text = cleanPromptText(draft);
    const issue = checkPromptText(text);
    if (issue) return setProblem(issue);
    if (rows?.some((r) => r.text.toLowerCase() === text.toLowerCase()))
      return setProblem("That one is already on the list.");
    setProblem(null);
    setRows((list) => [...(list ?? []), { text, tags: ["custom"], id: Date.now(), on: true }]);
    setDraft("");
  };

  const save = () => {
    const bad = chosen.find((r) => checkPromptText(r.text));
    if (bad) return setProblem(`“${bad.text.slice(0, 50)}”: ${checkPromptText(bad.text)}`);
    startSaving(async () => {
      const r = await savePromptsAction(
        chosen.map((c) => ({ text: c.text, tags: c.tags.filter((t) => t !== "custom") })),
      );
      if (!r.ok) return setProblem(r.message);
      onDone(r.total);
    });
  };

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-lg font-semibold">What do customers ask AI?</h1>
        <p className="mt-1 text-[13px] text-fg-subtle">
          Each prompt is asked on every engine you track. Most should{" "}
          <span className="text-fg">not</span> name {brandName}: those show whether AI recommends
          you when people don&rsquo;t know you yet. Untick any that don&rsquo;t fit, edit the
          wording, or add your own. Around {RECOMMENDED}–20 is a good start.
        </p>
      </div>

      {meta && (
        <p className="flex items-center gap-1.5 text-xs text-fg-subtle">
          <Sparkles className="size-3.5 shrink-0" />
          {meta.source === "ai"
            ? "Written by an AI model from your brand, category and competitors."
            : (meta.note ??
              "Built from your category and competitors. Set AI_GATEWAY_API_KEY to have an AI model write them.")}
          {meta.existing > 0 && ` You already track ${meta.existing}; those aren't repeated.`}
        </p>
      )}

      <div className="overflow-hidden rounded-xl border border-line bg-panel">
        {!rows ? (
          <p className="px-4 py-10 text-center text-[13px] text-fg-subtle">
            {loading ? "Writing suggestions…" : "No suggestions yet."}
          </p>
        ) : rows.length === 0 ? (
          <p className="px-4 py-10 text-center text-[13px] text-fg-subtle">
            Nothing new to suggest. Add your own below.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((r) => (
              <li
                key={r.id}
                className={cn("flex items-start gap-3 px-4 py-2.5", !r.on && "opacity-50")}
              >
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={r.on}
                  aria-label={r.on ? "Leave out" : "Include"}
                  disabled={!canEdit}
                  onClick={() =>
                    setRows((list) => list!.map((x) => (x.id === r.id ? { ...x, on: !x.on } : x)))
                  }
                  className={cn(
                    "mt-1.5 flex size-4 shrink-0 items-center justify-center rounded border transition-colors",
                    r.on ? "border-inverted bg-inverted text-on-inverted" : "border-line-strong",
                  )}
                >
                  {r.on && <Check className="size-3" strokeWidth={3} />}
                </button>
                <div className="min-w-0 flex-1">
                  <input
                    value={r.text}
                    disabled={!canEdit}
                    aria-label="Prompt"
                    onChange={(e) =>
                      setRows((list) =>
                        list!.map((x) => (x.id === r.id ? { ...x, text: e.target.value } : x)),
                      )
                    }
                    className="w-full rounded-md bg-transparent px-1.5 py-1 text-[13px] text-fg outline-none hover:bg-hover focus:bg-hover focus:ring-1 focus:ring-line-strong"
                  />
                  <div className="mt-0.5 flex flex-wrap gap-1 px-1.5">
                    {r.tags.map((t) => (
                      <span
                        key={t}
                        className={cn("rounded px-1.5 py-px text-[11px] font-medium", tagStyle(t))}
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
        {canEdit && (
          <div className="flex gap-2 border-t border-line bg-hover px-4 py-3">
            <input
              value={draft}
              onChange={(e) => {
                setProblem(null);
                setDraft(e.target.value);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  add();
                }
              }}
              placeholder="Add your own, e.g. “invoicing app that accepts UPI payments”"
              aria-label="Add a prompt"
              className="h-8 min-w-0 flex-1 rounded-lg border border-line bg-panel px-3 text-[13px] text-fg outline-none placeholder:text-fg-muted focus:border-line-strong focus:ring-2 focus:ring-line"
            />
            <button type="button" onClick={add} className={buttonSecondary}>
              <Plus className="size-3.5" />
              Add
            </button>
          </div>
        )}
      </div>

      {problem && (
        <p role="alert" className="flex items-center gap-1.5 text-[13px] text-bad">
          <CircleAlert className="size-3.5 shrink-0" />
          {problem}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2">
          <button type="button" onClick={onBack} className={buttonSecondary}>
            <ArrowLeft className="size-3.5" />
            Back
          </button>
          <button type="button" onClick={load} disabled={loading} className={buttonSecondary}>
            <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
            Suggest again
          </button>
        </div>
        <div className="flex items-center gap-3">
          <span className={cn("text-xs", total < RECOMMENDED ? "text-fg-subtle" : "text-good")}>
            {total} {total === 1 ? "prompt" : "prompts"}
            {total < RECOMMENDED && ` · ${RECOMMENDED} recommended`}
          </span>
          <button
            type="button"
            onClick={save}
            disabled={saving || !canEdit || (chosen.length === 0 && (meta?.existing ?? 0) === 0)}
            className={buttonPrimary}
          >
            {saving
              ? "Saving…"
              : chosen.length
                ? `Save ${chosen.length} ${chosen.length === 1 ? "prompt" : "prompts"}`
                : "Continue"}
          </button>
        </div>
      </div>
    </div>
  );
}
