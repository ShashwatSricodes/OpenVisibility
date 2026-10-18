"use client";

import { useState, type ReactNode } from "react";
import { cn } from "../_lib/cn";

export type BarItem = {
  key: string;
  label: ReactNode;
  value: number;
  /** shown left of the label: a favicon, colour swatch or icon */
  icon?: ReactNode;
  /** small tag after the label, e.g. "You" or "Owned" */
  tag?: string;
};

export type ValueFormat = "percent" | "position" | "count";

export type BarTab = {
  id: string;
  label: string;
  /** a name, not a function: tabs are passed from server components */
  format: ValueFormat;
  /** scale bars against a fixed maximum, e.g. 100 for rates */
  max?: number;
  /** lower values are better (positions): the best value gets the longest bar */
  invert?: boolean;
  /** Dub's grey strip of sub-views, e.g. Domain | URL */
  subTabs?: { id: string; label: string; items: BarItem[] }[];
  items?: BarItem[];
};

const FORMATTERS: Record<ValueFormat, (v: number) => string> = {
  percent: (v) => `${Math.round(v)}%`,
  position: (v) => `#${v.toFixed(1)}`,
  count: (v) => v.toLocaleString("en-US"),
};

/* Dub tints each card with one hue: a pale bar, and on hover a fading
   wash with a coloured left edge */
const TINTS = {
  blue: {
    bar: "bg-[var(--bar-blue)]",
    hover:
      "hover:border-[var(--bar-blue-edge)] hover:bg-linear-to-r hover:from-[var(--bar-blue-hover)] hover:to-transparent",
  },
  red: {
    bar: "bg-[var(--bar-red)]",
    hover:
      "hover:border-[var(--bar-red-edge)] hover:bg-linear-to-r hover:from-[var(--bar-red-hover)] hover:to-transparent",
  },
  green: {
    bar: "bg-[var(--bar-green)]",
    hover:
      "hover:border-[var(--bar-green-edge)] hover:bg-linear-to-r hover:from-[var(--bar-green-hover)] hover:to-transparent",
  },
  orange: {
    bar: "bg-[var(--bar-orange)]",
    hover:
      "hover:border-[var(--bar-orange-edge)] hover:bg-linear-to-r hover:from-[var(--bar-orange-hover)] hover:to-transparent",
  },
};

export function BarListCard({
  tabs,
  tint,
  caption,
  captionIcon,
}: {
  tabs: BarTab[];
  tint: keyof typeof TINTS;
  /** right-aligned label in the header, like Dub's "CLICKS" */
  caption: string;
  /** a rendered icon element; components can't cross the server boundary */
  captionIcon: ReactNode;
}) {
  const [tabId, setTabId] = useState(tabs[0].id);
  const [subId, setSubId] = useState<string | undefined>(tabs[0].subTabs?.[0].id);
  const [expanded, setExpanded] = useState(false);

  const tab = tabs.find((t) => t.id === tabId) ?? tabs[0];
  const sub = tab.subTabs?.find((s) => s.id === subId) ?? tab.subTabs?.[0];
  const list = sub?.items ?? tab.items ?? [];

  const values = list.map((i) => i.value);
  const max = tab.max ?? Math.max(...values, 1);
  const min = Math.min(...values);

  const selectTab = (t: BarTab) => {
    setTabId(t.id);
    setSubId(t.subTabs?.[0].id);
    setExpanded(false);
  };

  return (
    <section
      className={cn(
        "relative z-0 overflow-hidden rounded-xl border border-line bg-panel",
        expanded ? "h-auto" : "h-100",
      )}
    >
      <div className="flex items-center justify-between border-b border-line px-4">
        <div role="tablist" className="scrollbar-hide flex overflow-x-auto">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={t.id === tab.id}
              onClick={() => selectTab(t)}
              className="relative overflow-hidden px-1 py-2.5 focus:outline-none"
            >
              <span
                className={cn(
                  "block whitespace-nowrap rounded-md px-2.5 py-1.5 text-sm transition-colors hover:bg-hover",
                  t.id === tab.id ? "text-fg" : "text-fg-subtle",
                )}
              >
                {t.label}
              </span>
              <span
                aria-hidden="true"
                className={cn(
                  "absolute inset-x-1 bottom-0 h-0.5 bg-fg transition-transform duration-100",
                  t.id !== tab.id && "translate-y-0.75",
                )}
              />
            </button>
          ))}
        </div>
        <p className="hidden shrink-0 items-center gap-1 pl-2 text-fg-subtle sm:flex">
          {captionIcon}
          <span className="text-xs uppercase">{caption}</span>
        </p>
      </div>

      {tab.subTabs && (
        <div className="flex gap-1 border-b border-line bg-hover px-4 py-2">
          {tab.subTabs.map((s) => (
            <button
              key={s.id}
              type="button"
              aria-pressed={s.id === sub?.id}
              onClick={() => {
                setSubId(s.id);
                setExpanded(false);
              }}
              className={cn(
                "rounded-md px-2 py-0.5 text-xs transition-colors",
                s.id === sub?.id
                  ? "bg-pressed font-medium text-fg"
                  : "text-fg-default hover:bg-pressed",
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
      )}

      <ul className="grid auto-rows-min py-4" role="tabpanel">
        {list.map((item) => {
          const ratio = tab.invert ? min / item.value : item.value / max;
          return (
            <li
              key={item.key}
              className={cn(
                "group block min-w-0 border-l-2 border-transparent px-4 py-1 transition-all",
                TINTS[tint].hover,
              )}
            >
              <div className="relative flex items-center justify-between">
                <div
                  className={cn(
                    "absolute inset-y-0 left-0 -z-10 h-full origin-left rounded-md",
                    TINTS[tint].bar,
                  )}
                  style={{ width: `${Math.max(1, ratio * 100)}%` }}
                />
                <div className="relative z-10 flex h-8 min-w-0 items-center gap-3 px-3">
                  {item.icon}
                  <span className="truncate text-sm text-fg">{item.label}</span>
                  {item.tag && (
                    <span className="shrink-0 rounded-md border border-line bg-panel px-1.5 text-[11px] text-fg-subtle">
                      {item.tag}
                    </span>
                  )}
                </div>
                <span className="tabular z-10 shrink-0 px-2 text-sm text-fg-default">
                  {FORMATTERS[tab.format](item.value)}
                </span>
              </div>
            </li>
          );
        })}
      </ul>

      {list.length > 7 && (
        <div
          className={cn(
            "flex w-full justify-center py-4",
            !expanded && "absolute bottom-0 left-0 z-10 items-end",
          )}
        >
          {!expanded && (
            <div className="pointer-events-none absolute bottom-0 left-0 h-48 w-full bg-linear-to-t from-panel" />
          )}
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="relative h-8 rounded-lg border border-line bg-panel px-3 text-sm text-fg-default transition-colors hover:bg-hover active:border-line-strong"
          >
            {expanded ? "Show less" : "View All"}
          </button>
        </div>
      )}
    </section>
  );
}
