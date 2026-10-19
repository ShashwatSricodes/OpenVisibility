"use client";

import { useState, useTransition } from "react";
import * as Menu from "@radix-ui/react-dropdown-menu";
import { Check, ChevronDown, CircleAlert, Globe, Pause, Play, Plus, Trash2 } from "lucide-react";
import { COUNTRIES, countryName } from "@/core/countries";
import { checkPromptText } from "@/core/prompt-rules";
import { buttonPrimary } from "../../_components/page-frame";
import { cn } from "../../_lib/cn";
import {
  addPromptAction,
  deletePromptAction,
  updatePromptAction,
  type ActionResult,
} from "./actions";

export type PromptRow = {
  id: string;
  text: string;
  tags: string[];
  countries: string[];
  active: boolean;
};

type Filter = "all" | "non-branded" | "branded" | "paused";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "non-branded", label: "Non-branded" },
  { id: "branded", label: "Branded" },
  { id: "paused", label: "Paused" },
];

const chip = "rounded px-1.5 py-px text-[11px] font-medium";

const tagStyle = (t: string) =>
  t === "branded"
    ? "bg-[color-mix(in_srgb,var(--series-1)_14%,transparent)] text-[var(--series-1)]"
    : "bg-pressed text-fg-subtle";

/** Countries for one prompt: the workspace default, or its own list. */
function CountryPicker({
  value,
  defaults,
  disabled,
  onChange,
}: {
  value: string[];
  defaults: string[];
  disabled?: boolean;
  onChange: (next: string[]) => void;
}) {
  const label = value.length ? value.join(", ") : `Default (${defaults.join(", ")})`;
  return (
    <Menu.Root modal={false}>
      <Menu.Trigger
        disabled={disabled}
        className="inline-flex h-6 max-w-[11rem] items-center gap-1 rounded-md px-1.5 text-xs text-fg-subtle hover:bg-hover hover:text-fg disabled:pointer-events-none"
      >
        <Globe className="size-3 shrink-0" />
        <span className="truncate">{label}</span>
        <ChevronDown className="size-3 shrink-0" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content
          align="end"
          sideOffset={4}
          className="z-50 max-h-72 w-56 overflow-y-auto rounded-lg border border-line bg-panel p-1 text-[13px] shadow-lg"
        >
          <Menu.Item
            onSelect={() => onChange([])}
            className="flex cursor-pointer items-center justify-between rounded-md px-2 py-1.5 outline-none data-[highlighted]:bg-hover"
          >
            Workspace default
            {value.length === 0 && <Check className="size-3.5" />}
          </Menu.Item>
          <Menu.Separator className="my-1 h-px bg-line" />
          {COUNTRIES.map((c) => (
            <Menu.CheckboxItem
              key={c.code}
              checked={value.includes(c.code)}
              onSelect={(e) => e.preventDefault()}
              onCheckedChange={(on) =>
                onChange(on ? [...value, c.code] : value.filter((x) => x !== c.code))
              }
              className="flex cursor-pointer items-center justify-between rounded-md px-2 py-1.5 outline-none data-[highlighted]:bg-hover"
            >
              {c.name}
              <Menu.ItemIndicator>
                <Check className="size-3.5" />
              </Menu.ItemIndicator>
            </Menu.CheckboxItem>
          ))}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}

export function PromptManager({
  prompts,
  defaultCountries,
  canEdit,
}: {
  prompts: PromptRow[];
  defaultCountries: string[];
  canEdit: boolean;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const run = (action: () => Promise<ActionResult>, then?: () => void) =>
    start(async () => {
      const r = await action();
      if (!r.ok) return setProblem(r.message);
      setProblem(null);
      then?.();
    });

  const add = (e: React.FormEvent) => {
    e.preventDefault();
    const issue = checkPromptText(draft);
    if (issue) return setProblem(issue);
    run(
      () => addPromptAction(draft, []),
      () => setDraft(""),
    );
  };

  const saveEdit = () => {
    if (!editing) return;
    const original = prompts.find((p) => p.id === editing.id)?.text;
    if (editing.text.trim() === original) return setEditing(null);
    run(
      () => updatePromptAction(editing.id, { text: editing.text }),
      () => setEditing(null),
    );
  };

  const counts = {
    all: prompts.length,
    "non-branded": prompts.filter((p) => p.tags.includes("non-branded")).length,
    branded: prompts.filter((p) => p.tags.includes("branded")).length,
    paused: prompts.filter((p) => !p.active).length,
  };
  const shown = prompts.filter((p) =>
    filter === "all" ? true : filter === "paused" ? !p.active : p.tags.includes(filter),
  );

  return (
    <div className="flex flex-col gap-3">
      {canEdit && (
        <form onSubmit={add} className="flex gap-2">
          <input
            value={draft}
            onChange={(e) => {
              setProblem(null);
              setDraft(e.target.value);
            }}
            placeholder="Add a prompt, e.g. “invoicing app that accepts UPI payments”"
            aria-label="New prompt"
            className="h-8 min-w-0 flex-1 rounded-lg border border-line bg-panel px-3 text-[13px] text-fg outline-none placeholder:text-fg-muted focus:border-line-strong focus:ring-2 focus:ring-line"
          />
          <button type="submit" disabled={pending || !draft.trim()} className={buttonPrimary}>
            <Plus className="size-3.5" />
            Add
          </button>
        </form>
      )}

      {problem && (
        <p role="alert" className="flex items-center gap-1.5 text-[13px] text-bad">
          <CircleAlert className="size-3.5 shrink-0" />
          {problem}
        </p>
      )}

      <div className="flex flex-wrap gap-1">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFilter(f.id)}
            className={cn(
              "h-7 rounded-md px-2.5 text-xs transition-colors",
              filter === f.id
                ? "bg-panel font-medium text-fg ring-1 ring-line"
                : "text-fg-subtle hover:bg-hover hover:text-fg",
            )}
          >
            {f.label} <span className="tabular text-fg-muted">{counts[f.id]}</span>
          </button>
        ))}
      </div>

      <div className="overflow-hidden rounded-xl border border-line">
        {shown.length === 0 ? (
          <p className="px-4 py-8 text-center text-[13px] text-fg-subtle">
            No prompts in this view.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {shown.map((p) => (
              <li
                key={p.id}
                className={cn(
                  "group flex flex-col gap-1.5 px-4 py-2.5 sm:flex-row sm:items-center sm:gap-3",
                  !p.active && "bg-hover",
                )}
              >
                <div className="min-w-0 flex-1">
                  {editing?.id === p.id ? (
                    <input
                      autoFocus
                      value={editing.text}
                      aria-label="Edit prompt"
                      onChange={(e) => setEditing({ id: p.id, text: e.target.value })}
                      onBlur={saveEdit}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") saveEdit();
                        if (e.key === "Escape") setEditing(null);
                      }}
                      className="w-full rounded-md border border-line-strong bg-panel px-1.5 py-1 text-[13px] text-fg outline-none ring-2 ring-line"
                    />
                  ) : (
                    <button
                      type="button"
                      disabled={!canEdit}
                      onClick={() => setEditing({ id: p.id, text: p.text })}
                      title={canEdit ? "Click to edit" : undefined}
                      className={cn(
                        "w-full rounded-md px-1.5 py-1 text-left text-[13px] enabled:hover:bg-hover",
                        p.active ? "text-fg" : "text-fg-subtle",
                      )}
                    >
                      {p.text}
                    </button>
                  )}
                  <div className="mt-0.5 flex flex-wrap gap-1 px-1.5">
                    {!p.active && (
                      <span className={cn(chip, "bg-pressed text-fg-subtle")}>paused</span>
                    )}
                    {p.tags.map((t) => (
                      <span key={t} className={cn(chip, tagStyle(t))}>
                        {t}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-1">
                  <CountryPicker
                    value={p.countries}
                    defaults={defaultCountries}
                    disabled={!canEdit || pending}
                    onChange={(countries) => run(() => updatePromptAction(p.id, { countries }))}
                  />
                  {canEdit && (
                    <>
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => run(() => updatePromptAction(p.id, { active: !p.active }))}
                        aria-label={p.active ? "Pause" : "Resume"}
                        title={p.active ? "Pause: keeps its history, stops asking it" : "Resume"}
                        className="rounded-md p-1.5 text-fg-subtle hover:bg-hover hover:text-fg"
                      >
                        {p.active ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
                      </button>
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => {
                          if (
                            confirm(
                              `Delete “${p.text}”? Past answers stay in your history; it just stops being asked.`,
                            )
                          )
                            run(() => deletePromptAction(p.id));
                        }}
                        aria-label="Delete"
                        className="rounded-md p-1.5 text-fg-subtle hover:bg-hover hover:text-bad"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="text-xs text-fg-muted">
        Countries: each prompt is asked from the workspace&rsquo;s countries (
        {defaultCountries.map(countryName).join(", ")}) unless you pick its own.
      </p>
    </div>
  );
}
