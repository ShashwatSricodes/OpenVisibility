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

export type BarTab = {
  id: string;
  label: string;
  items: BarItem[];
  /** a name, not a function: tabs are passed from server components */
  format: ValueFormat;
  /** scale bars against a fixed maximum, e.g. 100 for rates */
  max?: number;
  /** show each value's share of the total on hover */
  shareOfTotal?: boolean;
  /** lower values are better (positions): the best value gets the longest bar */
  invert?: boolean;
};

export type ValueFormat = "percent" | "position" | "count";

const FORMATTERS: Record<ValueFormat, (v: number) => string> = {
  percent: (v) => `${Math.round(v)}%`,
  position: (v) => `#${v.toFixed(1)}`,
  count: (v) => v.toLocaleString("en-US"),
};

const TINTS = {
  blue: {
    bar: "bg-[var(--bar-blue)]",
    hover:
      "hover:border-[var(--bar-blue-edge)] hover:bg-linear-to-r hover:from-[var(--bar-blue-hover)] hover:to-transparent",
  },
  orange: {
    bar: "bg-[var(--bar-orange)]",
    hover:
      "hover:border-[var(--bar-orange-edge)] hover:bg-linear-to-r hover:from-[var(--bar-orange-hover)] hover:to-transparent",
  },
};

const COLLAPSED = 6;

export function BarListCard({
  tabs,
  tint = "blue",
  caption,
  className,
}: {
  tabs: BarTab[];
  tint?: keyof typeof TINTS;
  /** right-aligned label in the header, like Dub's event name */
  caption: string;
  className?: string;
}) {
  const [tabId, setTabId] = useState(tabs[0].id);
  const [expanded, setExpanded] = useState(false);
  const tab = tabs.find((t) => t.id === tabId) ?? tabs[0];
  const values = tab.items.map((i) => i.value);
  const max = tab.max ?? Math.max(...values, 1);
  const min = Math.min(...values);
  const total = tab.items.reduce((a, i) => a + i.value, 0);
  // when collapsed, one extra row peeks out under the fade, as in Dub
  const items = expanded ? tab.items : tab.items.slice(0, COLLAPSED + 1);
  const more = tab.items.length > COLLAPSED;

  return (
    <section
      className={cn(
        "relative flex flex-col overflow-hidden rounded-md border border-line bg-panel",
        className,
      )}
    >
      <div className="flex items-center justify-between border-b border-line px-4">
        <div role="tablist" className="flex gap-1">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={t.id === tab.id}
              onClick={() => {
                setTabId(t.id);
                setExpanded(false);
              }}
              className="relative overflow-hidden py-3 focus:outline-none"
            >
              <span
                className={cn(
                  "rounded-xs px-2.5 py-1.5 text-sm transition-colors hover:bg-hover",
                  t.id === tab.id ? "font-medium text-fg" : "text-fg-subtle",
                )}
              >
                {t.label}
              </span>
              <span
                aria-hidden="true"
                className={cn(
                  "absolute inset-x-1 bottom-0 h-0.5 bg-fg transition-transform duration-150",
                  t.id !== tab.id && "translate-y-0.75",
                )}
              />
            </button>
          ))}
        </div>
        <p className="hidden text-xs uppercase tracking-wide text-fg-muted sm:block">{caption}</p>
      </div>

      <ul className="flex flex-col py-3" role="tabpanel">
        {items.map((item) => {
          const ratio = tab.invert ? min / item.value : item.value / max;
          const width = Math.max(2, ratio * 100);
          const share = total > 0 ? Math.round((item.value / total) * 100) : 0;
          return (
            <li
              key={item.key}
              className={cn(
                "group border-l-2 border-transparent px-4 py-1 transition-colors",
                TINTS[tint].hover,
              )}
            >
              <div className="relative flex h-8 items-center justify-between">
                <div
                  className={cn(
                    "absolute inset-y-0 left-0 z-0 rounded-xs transition-[width] duration-300",
                    TINTS[tint].bar,
                  )}
                  style={{ width: `${width}%` }}
                />
                <div className="relative z-10 flex min-w-0 items-center gap-2.5 px-2.5 text-sm text-fg-default">
                  {item.icon}
                  <span className="truncate">{item.label}</span>
                  {item.tag && (
                    <span className="shrink-0 rounded border border-line bg-panel px-1.5 text-[11px] font-medium text-fg-subtle">
                      {item.tag}
                    </span>
                  )}
                </div>
                <div className="relative z-10 flex shrink-0 items-center">
                  <span
                    className={cn(
                      "tabular px-2 text-sm text-fg-default transition-transform duration-300",
                      tab.shareOfTotal && "group-hover:-translate-x-12",
                    )}
                  >
                    {FORMATTERS[tab.format](item.value)}
                  </span>
                  {tab.shareOfTotal && (
                    <span className="tabular invisible absolute right-0 translate-x-3 px-2 text-sm text-fg-subtle opacity-0 transition-all duration-300 group-hover:visible group-hover:translate-x-0 group-hover:opacity-100">
                      {share}%
                    </span>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {more && (
        <div
          className={cn(
            "flex justify-center pb-4",
            !expanded &&
              "pointer-events-none absolute inset-x-0 bottom-0 z-20 h-24 items-end bg-linear-to-t from-panel from-45% to-transparent",
          )}
        >
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="pointer-events-auto h-8 rounded border border-line bg-panel px-3 text-sm text-fg-default transition-colors hover:bg-hover"
          >
            {expanded ? "Show less" : "View all"}
          </button>
        </div>
      )}
    </section>
  );
}
